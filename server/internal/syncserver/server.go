package syncserver

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

type Server struct{ DB *pgxpool.Pool }
type Entity struct {
	Kind     string          `json:"kind"`
	ID       string          `json:"id"`
	Revision int64           `json:"revision"`
	Deleted  bool            `json:"deleted"`
	Data     json.RawMessage `json:"data"`
}
type Operation struct {
	OperationID  string          `json:"operationId"`
	Kind         string          `json:"kind"`
	ID           string          `json:"id"`
	BaseRevision int64           `json:"baseRevision"`
	Deleted      bool            `json:"deleted"`
	Data         json.RawMessage `json:"data"`
}
type Receipt struct {
	Current     *Entity `json:"current,omitempty"`
	OperationID string  `json:"operationId"`
	Conflict    bool    `json:"conflict"`
	CopyID      string  `json:"copyId,omitempty"`
	Message     string  `json:"message,omitempty"`
}
type Page struct {
	LibraryID string   `json:"libraryId"`
	Changes   []Entity `json:"changes"`
	Cursor    int64    `json:"cursor"`
	Target    int64    `json:"target"`
}

func NewID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func Hash(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func (s *Server) Migrate(ctx context.Context) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7349201)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, schema); err != nil {
		return err
	}
	var version int
	if err = tx.QueryRow(ctx, "SELECT max(version) FROM schema_version").Scan(&version); err != nil {
		return err
	}
	if version != 1 {
		return errors.New("unsupported database version")
	}
	return tx.Commit(ctx)
}
func (s *Server) CreateDevice(ctx context.Context, name string) (string, string, error) {
	id, token := NewID(), NewID()+NewID()
	_, err := s.DB.Exec(ctx, "INSERT INTO devices(id,name,token_hash) VALUES($1,$2,$3)", id, name, Hash(token))
	return id, token, err
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if err := s.DB.Ping(ctx); err != nil {
			http.Error(w, "unavailable", 503)
			return
		}
		writeJSON(w, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /v1/info", s.auth(func(w http.ResponseWriter, r *http.Request, _ string) {
		var id string
		if err := s.DB.QueryRow(r.Context(), "SELECT identity FROM library WHERE id=1").Scan(&id); err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, map[string]any{"libraryId": id, "protocolVersion": 1})
	}))
	mux.HandleFunc("POST /v1/push", s.auth(s.push))
	mux.HandleFunc("GET /v1/pull", s.auth(s.pull))
	return mux
}
func (s *Server) auth(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || len(token) != 64 {
			http.Error(w, "invalid device token", 401)
			return
		}
		var id string
		err := s.DB.QueryRow(ctx, "SELECT id FROM devices WHERE token_hash=$1 AND NOT revoked", Hash(token)).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "invalid or revoked device token", 401)
			return
		}
		if err != nil {
			s.fail(w, err)
			return
		}
		next(w, r, id)
	}
}
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("response interrupted", "error", err)
	}
}
func (s *Server) fail(w http.ResponseWriter, err error) {
	slog.Error("sync request failed", "error", err)
	http.Error(w, "sync service unavailable; retry later", 503)
}
func validID(id string) bool {
	return len(id) > 0 && len(id) <= 200 && !strings.ContainsAny(id, "\x00\r\n")
}
func validate(op Operation) error {
	if !validID(op.ID) || !validID(op.OperationID) || op.BaseRevision < 0 || (op.Kind != "note" && op.Kind != "notebook") {
		return errors.New("invalid operation")
	}
	if op.Deleted {
		return nil
	}
	var d map[string]json.RawMessage
	if json.Unmarshal(op.Data, &d) != nil || d == nil {
		return errors.New("invalid record")
	}
	var id string
	if json.Unmarshal(d["id"], &id) != nil || id != op.ID {
		return errors.New("record ID mismatch")
	}
	if op.Kind == "note" {
		var version int
		var body map[string]any
		if json.Unmarshal(d["documentVersion"], &version) != nil || version != 1 {
			return errors.New("unsupported document version")
		}
		if json.Unmarshal(d["content"], &body) != nil || body["type"] != "doc" {
			return errors.New("invalid document")
		}
		if err := validateNode(body, 0); err != nil {
			return err
		}
		if _, ok := body["content"].([]any); !ok {
			return errors.New("document requires content")
		}
		var trashedAt *int64
		if raw, ok := d["trashedAt"]; ok {
			if json.Unmarshal(raw, &trashedAt) != nil {
				return errors.New("invalid trash timestamp")
			}
		}
		if raw, ok := d["revision"]; !ok || string(raw) == "null" {
			return errors.New("missing local revision")
		} else {
			var revision int64
			if json.Unmarshal(raw, &revision) != nil {
				return errors.New("invalid local revision")
			}
		}
		if v := d["source"]; len(v) > 0 && string(v) != "null" {
			return errors.New("linked notes are local only")
		}
		var title, text string
		var ids, tags []string
		var pinned, quick, trashed, tasks bool
		var created, updated int64
		for _, p := range []struct {
			k string
			v any
		}{{"title", &title}, {"text", &text}, {"notebookIds", &ids}, {"tags", &tags}, {"pinned", &pinned}, {"quickAccess", &quick}, {"trashed", &trashed}, {"hasTasks", &tasks}, {"created", &created}, {"updated", &updated}} {
			if string(d[p.k]) == "null" || json.Unmarshal(d[p.k], p.v) != nil {
				return fmt.Errorf("invalid %s", p.k)
			}
		}
		for _, id := range ids {
			if !validID(id) {
				return errors.New("invalid notebook membership")
			}
		}
	} else {
		var name, color, icon string
		if json.Unmarshal(d["name"], &name) != nil || strings.TrimSpace(name) == "" || json.Unmarshal(d["color"], &color) != nil || json.Unmarshal(d["icon"], &icon) != nil {
			return errors.New("invalid notebook")
		}
		switch icon {
		case "notebook", "book", "folder", "briefcase", "graduationCap", "home", "heart", "star", "lightbulb", "target", "plane", "archive", "calendar", "camera", "coffee", "dumbbell", "flag", "gamepad", "globe", "mapPin", "music", "palette", "penLine", "shoppingBag":
		default:
			return errors.New("unsupported notebook icon")
		}
		if v := d["rootId"]; len(v) > 0 && string(v) != "null" {
			return errors.New("linked notebooks are local only")
		}
	}
	return nil
}
func validateNode(node any, depth int) error {
	n, ok := node.(map[string]any)
	if !ok || depth > 128 {
		return errors.New("invalid or excessively nested document")
	}
	kind, ok := n["type"].(string)
	if !ok || kind == "" {
		return errors.New("invalid document node")
	}
	if kind == "noteReference" {
		attrs, ok := n["attrs"].(map[string]any)
		if !ok {
			return errors.New("invalid note reference")
		}
		id, ok := attrs["noteId"].(string)
		if !ok || len(id) == 0 || len(id) > 128 {
			return errors.New("invalid note reference ID")
		}
		for _, c := range id {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
				return errors.New("invalid note reference ID")
			}
		}
		if _, ok := attrs["fallbackTitle"].(string); !ok {
			return errors.New("invalid reference title")
		}
	}
	if raw, exists := n["content"]; exists {
		children, ok := raw.([]any)
		if !ok {
			return errors.New("invalid document children")
		}
		for _, child := range children {
			if err := validateNode(child, depth+1); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Server) push(w http.ResponseWriter, r *http.Request, device string) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
	var op Operation
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&op); err != nil {
		http.Error(w, "invalid operation or record exceeds 64 MiB", 400)
		return
	}
	if dec.Decode(new(any)) != io.EOF {
		http.Error(w, "expected one operation", 400)
		return
	}
	if err := validate(op); err != nil {
		http.Error(w, err.Error(), 422)
		return
	}
	receipt, err := s.Apply(r.Context(), device, op)
	if err != nil {
		var input *InputError
		if errors.As(err, &input) {
			http.Error(w, input.Error(), 409)
		} else {
			s.fail(w, err)
		}
		return
	}
	writeJSON(w, receipt)
}

type InputError struct{ Message string }

func (e *InputError) Error() string { return e.Message }
func (s *Server) Apply(ctx context.Context, device string, op Operation) (Receipt, error) {
	result := Receipt{OperationID: op.OperationID}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	var revision int64
	if err = tx.QueryRow(ctx, "SELECT revision FROM library WHERE id=1 FOR UPDATE").Scan(&revision); err != nil {
		return result, err
	}
	encoded, err := json.Marshal(op)
	if err != nil {
		return result, err
	}
	fingerprint := Hash(string(encoded))
	var oldHash string
	var oldResult []byte
	err = tx.QueryRow(ctx, "SELECT request_hash,result FROM receipts WHERE device=$1 AND operation=$2", device, op.OperationID).Scan(&oldHash, &oldResult)
	if err == nil {
		if oldHash != fingerprint {
			return result, &InputError{"operation ID reused with different content"}
		}
		err = json.Unmarshal(oldResult, &result)
		return result, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	var current int64
	var deleted bool
	var currentData []byte
	err = tx.QueryRow(ctx, "SELECT revision,deleted,data FROM entities WHERE kind=$1 AND id=$2", op.Kind, op.ID).Scan(&current, &deleted, &currentData)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	conflict := current != op.BaseRevision || (deleted && !op.Deleted)
	result.Conflict = conflict
	if conflict {
		if op.Kind == "note" {
			data := op.Data
			if op.Deleted {
				data = currentData
			}
			if len(data) > 0 && string(data) != "{}" && string(data) != "null" {
				var doc map[string]any
				if err = json.Unmarshal(data, &doc); err != nil {
					return result, err
				}
				result.CopyID = NewID()
				doc["id"] = result.CopyID
				doc["title"] = fmt.Sprint(doc["title"]) + " (conflict copy)"
				doc["trashed"] = false
				doc["trashedAt"] = nil
				copyData, e := json.Marshal(doc)
				if e != nil {
					return result, e
				}
				if e = s.put(ctx, tx, &revision, Entity{Kind: "note", ID: result.CopyID, Data: copyData}); e != nil {
					return result, e
				}
				result.Message = "Both note versions were kept."
			}
		} else {
			result.Message = "Notebook changed on another device; the server version was kept."
		}
	} else {
		data := op.Data
		if op.Deleted {
			data = json.RawMessage(`{}`)
		}
		if !op.Deleted && op.Kind == "notebook" {
			var object map[string]json.RawMessage
			if err = json.Unmarshal(data, &object); err != nil {
				return result, err
			}
			var parent *string
			if err = json.Unmarshal(object["parentId"], &parent); err != nil && len(object["parentId"]) > 0 {
				return result, &InputError{"invalid notebook parent"}
			}
			if parent != nil {
				var removed bool
				err = tx.QueryRow(ctx, "SELECT deleted FROM entities WHERE kind='notebook' AND id=$1", *parent).Scan(&removed)
				if err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return result, err
				}
				if removed {
					object["parentId"] = json.RawMessage("null")
					data, err = json.Marshal(object)
					if err != nil {
						return result, err
					}
				}
			}
			if err = validateParent(ctx, tx, op.ID, data); err != nil {
				return result, err
			}
		}
		if err = s.put(ctx, tx, &revision, Entity{Kind: op.Kind, ID: op.ID, Deleted: op.Deleted, Data: data}); err != nil {
			return result, err
		}
		if op.Deleted && op.Kind == "notebook" {
			if err = s.removeNotebook(ctx, tx, &revision, op.ID); err != nil {
				return result, err
			}
		}
	}
	var latest Entity
	latest.Kind, latest.ID = op.Kind, op.ID
	if err = tx.QueryRow(ctx, "SELECT revision,deleted,data FROM entities WHERE kind=$1 AND id=$2", op.Kind, op.ID).Scan(&latest.Revision, &latest.Deleted, &latest.Data); err == nil {
		result.Current = &latest
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	encoded, err = json.Marshal(result)
	if err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO receipts VALUES($1,$2,$3,$4)", device, op.OperationID, fingerprint, encoded); err != nil {
		return result, err
	}
	if _, err = tx.Exec(ctx, "UPDATE library SET revision=$1 WHERE id=1", revision); err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
func validateParent(ctx context.Context, tx pgx.Tx, id string, data []byte) error {
	var d struct {
		Parent *string `json:"parentId"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return err
	}
	seen := map[string]bool{id: true}
	for d.Parent != nil && *d.Parent != "" {
		p := *d.Parent
		if seen[p] {
			return &InputError{"notebook hierarchy would contain a cycle"}
		}
		seen[p] = true
		var raw []byte
		err := tx.QueryRow(ctx, "SELECT data FROM entities WHERE kind='notebook' AND id=$1 AND NOT deleted", p).Scan(&raw)
		if errors.Is(err, pgx.ErrNoRows) {
			return &InputError{"sync parent notebook first"}
		}
		if err != nil {
			return err
		}
		d.Parent = nil
		if err = json.Unmarshal(raw, &d); err != nil {
			return err
		}
	}
	return nil
}
func (s *Server) put(ctx context.Context, tx pgx.Tx, revision *int64, e Entity) error {
	// Remove references to deleted notebooks from stale note submissions.
	if e.Kind == "note" && !e.Deleted {
		var d map[string]json.RawMessage
		if err := json.Unmarshal(e.Data, &d); err != nil {
			return err
		}
		var ids []string
		if err := json.Unmarshal(d["notebookIds"], &ids); err != nil {
			return err
		}
		kept := []string{}
		for _, id := range ids {
			var exists bool
			if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM entities WHERE kind='notebook' AND id=$1 AND NOT deleted)", id).Scan(&exists); err != nil {
				return err
			}
			if exists {
				kept = append(kept, id)
			}
		}
		d["notebookIds"], _ = json.Marshal(kept)
		var err error
		e.Data, err = json.Marshal(d)
		if err != nil {
			return err
		}
	}
	*revision++
	e.Revision = *revision
	if _, err := tx.Exec(ctx, "INSERT INTO entities VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted,data=excluded.data", e.Kind, e.ID, e.Revision, e.Deleted, []byte(e.Data)); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, "INSERT INTO changes VALUES($1,$2,$3,$4,$5)", e.Revision, e.Kind, e.ID, e.Deleted, []byte(e.Data))
	return err
}
func (s *Server) removeNotebook(ctx context.Context, tx pgx.Tx, revision *int64, id string) error {
	rows, err := tx.Query(ctx, "SELECT kind,id,revision,deleted,data FROM entities WHERE NOT deleted AND ((kind='note' AND data->'notebookIds' ? $1) OR (kind='notebook' AND data->>'parentId'=$1)) ORDER BY kind,id", id)
	if err != nil {
		return err
	}
	var affected []Entity
	for rows.Next() {
		var e Entity
		if err = rows.Scan(&e.Kind, &e.ID, &e.Revision, &e.Deleted, &e.Data); err != nil {
			rows.Close()
			return err
		}
		affected = append(affected, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, e := range affected {
		if e.Kind == "notebook" {
			var d map[string]json.RawMessage
			if err = json.Unmarshal(e.Data, &d); err != nil {
				return err
			}
			d["parentId"] = json.RawMessage("null")
			e.Data, err = json.Marshal(d)
			if err != nil {
				return err
			}
		}
		if err = s.put(ctx, tx, revision, e); err != nil {
			return err
		}
	}
	return nil
}
func (s *Server) pull(w http.ResponseWriter, r *http.Request, _ string) {
	after, err := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if err != nil || after < 0 {
		http.Error(w, "invalid cursor", 400)
		return
	}
	var p Page
	p.Changes = []Entity{}
	if err = s.DB.QueryRow(r.Context(), "SELECT identity,revision FROM library WHERE id=1").Scan(&p.LibraryID, &p.Target); err != nil {
		s.fail(w, err)
		return
	}
	if raw := r.URL.Query().Get("target"); raw != "" {
		target, e := strconv.ParseInt(raw, 10, 64)
		if e != nil || target < after || target > p.Target {
			http.Error(w, "invalid target cursor", 400)
			return
		}
		p.Target = target
	}
	if after > p.Target {
		http.Error(w, "cursor is ahead of server; restore requires recovery", 409)
		return
	}
	rows, err := s.DB.Query(r.Context(), "SELECT kind,id,revision,deleted,data FROM changes WHERE revision>$1 AND revision<=$2 ORDER BY revision LIMIT 100", after, p.Target)
	if err != nil {
		s.fail(w, err)
		return
	}
	defer rows.Close()
	size := 0
	p.Cursor = after
	for rows.Next() {
		var e Entity
		if err = rows.Scan(&e.Kind, &e.ID, &e.Revision, &e.Deleted, &e.Data); err != nil {
			s.fail(w, err)
			return
		}
		if size+len(e.Data) > 64<<20 && len(p.Changes) > 0 {
			break
		}
		size += len(e.Data)
		p.Changes = append(p.Changes, e)
		p.Cursor = e.Revision
	}
	if err = rows.Err(); err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, p)
}
