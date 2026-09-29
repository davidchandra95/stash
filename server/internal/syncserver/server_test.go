package syncserver

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sync"
	"testing"
)

func setup(t *testing.T) (*Server, string, string) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to an isolated PostgreSQL database")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	_, err = db.Exec(ctx, "DROP SCHEMA public CASCADE; CREATE SCHEMA public")
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	id, token, err := s.CreateDevice(ctx, "test")
	if err != nil {
		t.Fatal(err)
	}
	return s, id, token
}
func noteOp(id, body string, base int64) Operation {
	data, _ := json.Marshal(map[string]any{"id": id, "title": body, "content": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": body}}}}}, "text": body, "notebookIds": []string{}, "tags": []string{"tag"}, "quickAccess": true, "pinned": true, "trashed": false, "trashedAt": nil, "created": 1, "updated": 2, "documentVersion": 1, "hasTasks": false, "source": nil, "revision": 1})
	return Operation{OperationID: NewID(), Kind: "note", ID: id, BaseRevision: base, Data: data}
}
func bookOp(id string, base int64) Operation {
	data, _ := json.Marshal(map[string]any{"id": id, "name": id, "color": "blue", "icon": "book", "parentId": nil})
	return Operation{OperationID: NewID(), Kind: "notebook", ID: id, BaseRevision: base, Data: data}
}
func request(s *Server, token, method, path string, v any) *httptest.ResponseRecorder {
	var body bytes.Buffer
	if v != nil {
		json.NewEncoder(&body).Encode(v)
	}
	r := httptest.NewRequest(method, path, &body)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}
func apply(t *testing.T, s *Server, token string, op Operation) Receipt {
	t.Helper()
	w := request(s, token, "POST", "/v1/push", op)
	if w.Code != 200 {
		t.Fatalf("push status %d: %s", w.Code, w.Body.String())
	}
	var result Receipt
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestNotebookIconValidation(t *testing.T) {
	accepted := bookOp("icon-test", 0)
	var data map[string]any
	if err := json.Unmarshal(accepted.Data, &data); err != nil {
		t.Fatal(err)
	}
	data["icon"] = "shoppingBag"
	accepted.Data, _ = json.Marshal(data)
	if err := validate(accepted); err != nil {
		t.Fatalf("new icon was rejected: %v", err)
	}

	data["icon"] = "not-an-icon"
	rejected := accepted
	rejected.Data, _ = json.Marshal(data)
	if err := validate(rejected); err == nil || err.Error() != "unsupported notebook icon" {
		t.Fatalf("unexpected invalid-icon result: %v", err)
	}
}
func pull(t *testing.T, s *Server, token, path string) Page {
	t.Helper()
	w := request(s, token, "GET", path, nil)
	if w.Code != 200 {
		t.Fatalf("pull %d: %s", w.Code, w.Body.String())
	}
	var p Page
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	return p
}
func TestTwoClientsConflictRetryAndDeletion(t *testing.T) {
	s, _, a := setup(t)
	_, b, err := s.CreateDevice(context.Background(), "second")
	if err != nil {
		t.Fatal(err)
	}
	book := bookOp("parent", 0)
	apply(t, s, a, book)
	child := bookOp("child", 0)
	var d map[string]any
	json.Unmarshal(child.Data, &d)
	d["parentId"] = "parent"
	child.Data, _ = json.Marshal(d)
	apply(t, s, a, child)
	op := noteOp("n", "original", 0)
	json.Unmarshal(op.Data, &d)
	d["notebookIds"] = []string{"child"}
	d["content"] = map[string]any{"type": "doc", "content": []any{map[string]any{"type": "image", "attrs": map[string]any{"src": "data:image/png;base64,aGVsbG8="}}}}
	op.Data, _ = json.Marshal(d)
	first := apply(t, s, a, op)
	again := apply(t, s, a, op)
	if !reflect.DeepEqual(first, again) {
		t.Fatal("receipt changed after lost response")
	}
	page := pull(t, s, b, "/v1/pull?after=0")
	if len(page.Changes) != 3 || page.Cursor != 3 {
		t.Fatalf("initial download: %+v", page)
	}
	editA := noteOp("n", "device A", 3)
	apply(t, s, a, editA)
	editB := noteOp("n", "device B", 3)
	conflict := apply(t, s, b, editB)
	if !conflict.Conflict || conflict.CopyID == "" {
		t.Fatal("missing conflict copy")
	}
	if !reflect.DeepEqual(apply(t, s, b, editB), conflict) {
		t.Fatal("duplicate conflict")
	}
	var count int
	s.DB.QueryRow(context.Background(), "SELECT count(*) FROM entities WHERE kind='note'").Scan(&count)
	if count != 2 {
		t.Fatalf("notes: %d", count)
	}
	// Reusing a committed operation ID with different bytes is rejected.
	editB.Data = noteOp("n", "altered", 3).Data
	if w := request(s, b, "POST", "/v1/push", editB); w.Code != 409 {
		t.Fatal(w.Code)
	}
	trash := noteOp("n", "device A", 4)
	json.Unmarshal(trash.Data, &d)
	d["trashed"] = true
	d["trashedAt"] = 3
	trash.Data, _ = json.Marshal(d)
	apply(t, s, a, trash)
	late := apply(t, s, b, noteOp("n", "late edit", 4))
	if late.CopyID == "" {
		t.Fatal("trash conflict lost edit")
	}
	del := Operation{OperationID: NewID(), Kind: "notebook", ID: "child", BaseRevision: 2, Deleted: true, Data: json.RawMessage(`{}`)}
	apply(t, s, a, del)
	stale := apply(t, s, b, bookOp("child", 2))
	if !stale.Conflict {
		t.Fatal("stale notebook resurrected")
	}
	var deleted bool
	s.DB.QueryRow(context.Background(), "SELECT deleted FROM entities WHERE kind='notebook' AND id='child'").Scan(&deleted)
	if !deleted {
		t.Fatal("deleted notebook revived")
	}
}
func TestConcurrentWritesAndStablePagination(t *testing.T) {
	s, _, token := setup(t)
	apply(t, s, token, noteOp("same", "base", 0))
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := request(s, token, "POST", "/v1/push", noteOp("same", "edit", 1))
			if w.Code != 200 {
				t.Errorf("concurrent push %d", w.Code)
			}
		}()
	}
	wg.Wait()
	for i := 0; i < 105; i++ {
		apply(t, s, token, noteOp(NewID(), "page", 0))
	}
	p := pull(t, s, token, "/v1/pull?after=0")
	if len(p.Changes) != 100 {
		t.Fatal(len(p.Changes))
	}
	apply(t, s, token, noteOp("later", "later", 0))
	next := pull(t, s, token, "/v1/pull?after=100&target=114")
	if next.Cursor != 114 || next.Target != 114 {
		t.Fatal(next.Cursor, next.Target)
	}
	var total int
	s.DB.QueryRow(context.Background(), "SELECT count(*) FROM changes").Scan(&total)
	if total != 115 {
		t.Fatal(total)
	}
}
func TestAuthenticationValidationAndDatabaseFailure(t *testing.T) {
	s, id, token := setup(t)
	for _, bad := range []string{"", NewID() + NewID()} {
		if w := request(s, bad, "GET", "/v1/info", nil); w.Code != http.StatusUnauthorized {
			t.Fatal(w.Code)
		}
	}
	op := noteOp("n", "x", 0)
	var d map[string]any
	json.Unmarshal(op.Data, &d)
	d["documentVersion"] = 2
	op.Data, _ = json.Marshal(d)
	if w := request(s, token, "POST", "/v1/push", op); w.Code != 422 {
		t.Fatal(w.Code)
	}
	if w := request(s, token, "GET", "/v1/pull?after=999", nil); w.Code != 409 {
		t.Fatal(w.Code)
	}
	if _, err := s.DB.Exec(context.Background(), "UPDATE devices SET revoked=true WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	if w := request(s, token, "GET", "/v1/info", nil); w.Code != 401 {
		t.Fatal(w.Code)
	}
	s.DB.Close()
	if w := request(s, token, "GET", "/v1/info", nil); w.Code != 503 {
		t.Fatal(w.Code)
	}
}

func TestNotebookDeletionCleansMembershipsAndStaleChildrenDetach(t *testing.T) {
	s, _, token := setup(t)
	apply(t, s, token, bookOp("parent", 0))
	child := bookOp("child", 0)
	var childData map[string]any
	json.Unmarshal(child.Data, &childData)
	childData["parentId"] = "parent"
	child.Data, _ = json.Marshal(childData)
	apply(t, s, token, child)
	n := noteOp("n", "keep", 0)
	var data map[string]any
	json.Unmarshal(n.Data, &data)
	data["notebookIds"] = []string{"parent", "child"}
	n.Data, _ = json.Marshal(data)
	apply(t, s, token, n)
	apply(t, s, token, Operation{OperationID: NewID(), Kind: "notebook", ID: "parent", BaseRevision: 1, Deleted: true, Data: json.RawMessage(`{}`)})
	var memberships []byte
	var parent []byte
	if err := s.DB.QueryRow(context.Background(), "SELECT data->'notebookIds' FROM entities WHERE kind='note' AND id='n'").Scan(&memberships); err != nil {
		t.Fatal(err)
	}
	var ids []string
	json.Unmarshal(memberships, &ids)
	if len(ids) != 1 || ids[0] != "child" {
		t.Fatalf("memberships %s", memberships)
	}
	if err := s.DB.QueryRow(context.Background(), "SELECT data->'parentId' FROM entities WHERE kind='notebook' AND id='child'").Scan(&parent); err != nil {
		t.Fatal(err)
	}
	if string(parent) != "null" {
		t.Fatalf("parent %s", parent)
	}
	another := bookOp("offline-child", 0)
	json.Unmarshal(another.Data, &data)
	data["parentId"] = "parent"
	another.Data, _ = json.Marshal(data)
	receipt := apply(t, s, token, another)
	if receipt.Conflict || receipt.Current == nil {
		t.Fatal("stale child not accepted")
	}
	var obj map[string]any
	json.Unmarshal(receipt.Current.Data, &obj)
	if obj["parentId"] != nil {
		t.Fatal("stale parent retained")
	}
}
func TestMalformedDocumentCannotPoisonOtherClients(t *testing.T) {
	s, _, token := setup(t)
	for _, field := range []string{"content", "tags", "notebookIds", "title", "revision"} {
		op := noteOp("n", "bad", 0)
		var d map[string]any
		json.Unmarshal(op.Data, &d)
		d[field] = nil
		op.Data, _ = json.Marshal(d)
		w := request(s, token, "POST", "/v1/push", op)
		if w.Code != 422 {
			t.Fatalf("%s accepted: %d", field, w.Code)
		}
	}
	var count int
	if err := s.DB.QueryRow(context.Background(), "SELECT count(*) FROM changes").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal(count)
	}
}
