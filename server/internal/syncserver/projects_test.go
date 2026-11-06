package syncserver

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func projectOp(id, name string, base int64, patch map[string]any) Operation {
	d := map[string]any{"id": id, "name": name, "description": "", "status": "active", "startDate": nil, "endDate": nil, "completedAt": nil, "notebookId": nil, "color": "#112233", "sort": 1.5, "deletedAt": nil, "created": 1, "updated": 2, "revision": 1}
	for k, v := range patch {
		d[k] = v
	}
	data, _ := json.Marshal(d)
	return Operation{OperationID: NewID(), Kind: "project", ID: id, BaseRevision: base, Data: data}
}
func taskOp(id, title string, base int64, patch map[string]any) Operation {
	d := map[string]any{"id": id, "title": title, "description": "", "status": "todo", "projectId": nil, "priority": 0, "startDate": nil, "dueDate": nil, "dueTime": nil, "schedule": nil, "dueLinked": false, "completedAt": nil, "sort": 1.5, "deletedAt": nil, "created": 1, "updated": 2, "revision": 1}
	for k, v := range patch {
		d[k] = v
	}
	data, _ := json.Marshal(d)
	return Operation{OperationID: NewID(), Kind: "task", ID: id, BaseRevision: base, Data: data}
}
func changesByTitle(t *testing.T, s *Server, token string) map[string]Entity {
	t.Helper()
	out := map[string]Entity{}
	for _, e := range pull(t, s, token, "/v1/pull?after=0").Changes {
		var d struct {
			Title string `json:"title"`
			Name  string `json:"name"`
		}
		if err := json.Unmarshal(e.Data, &d); err != nil {
			t.Fatal(err)
		}
		out[d.Title+d.Name] = e
	}
	return out
}

func TestProjectRecordValidationPreventsPoison(t *testing.T) {
	s, _, token := setup(t)
	long := strings.Repeat("x", 501)
	bad := []Operation{
		projectOp("p", " ", 0, nil),
		projectOp("p", "P", 0, map[string]any{"status": "paused"}),
		projectOp("p", "P", 0, map[string]any{"color": "red"}),
		projectOp("p", "P", 0, map[string]any{"startDate": "2026-02-30"}),
		projectOp("p", "P", 0, map[string]any{"startDate": "2026-03-02", "endDate": "2026-03-01"}),
		projectOp("p p", "P", 0, nil),
		projectOp("p", "P", 0, map[string]any{"sort": nil}),
		taskOp("t", long, 0, nil),
		taskOp("t", "T", 0, map[string]any{"status": "later"}),
		taskOp("t", "T", 0, map[string]any{"priority": 4}),
		taskOp("t", "T", 0, map[string]any{"dueTime": "10:00"}),
		taskOp("t", "T", 0, map[string]any{"dueDate": "2026-03-01", "dueTime": "24:00"}),
		taskOp("t", "T", 0, map[string]any{"dueLinked": true}),
		taskOp("t", "T", 0, map[string]any{"schedule": map[string]any{"kind": "point", "start": 1, "timeZone": "Mars/Base"}}),
		taskOp("t", "T", 0, map[string]any{"schedule": map[string]any{"kind": "point", "start": 1, "end": 2, "timeZone": "UTC"}}),
		taskOp("t", "T", 0, map[string]any{"schedule": map[string]any{"kind": "allDay", "start": "2026-03-02", "end": "2026-03-01"}}),
		{OperationID: NewID(), Kind: "task", ID: "t", Deleted: true, Data: json.RawMessage(`{}`)},
	}
	for i, op := range bad {
		if w := request(s, token, "POST", "/v1/push", op); w.Code != 422 {
			t.Fatalf("bad record %d accepted: %d", i, w.Code)
		}
	}
	good := taskOp("t", "T", 0, map[string]any{"dueLinked": true, "schedule": map[string]any{"kind": "range", "start": 1, "end": 2, "timeZone": "Asia/Hong_Kong"}})
	if r := apply(t, s, token, good); r.Conflict {
		t.Fatal(r)
	}
}

func TestTaskConflictsKeepBothVersions(t *testing.T) {
	s, _, token := setup(t)
	base := apply(t, s, token, taskOp("t", "Original", 0, nil)).Current.Revision
	accepted := apply(t, s, token, taskOp("t", "From phone", base, nil))
	stale := apply(t, s, token, taskOp("t", "From mac", base, nil))
	if !stale.Conflict || stale.CopyID == "" || stale.Message == "" {
		t.Fatalf("%+v", stale)
	}
	if stale.Current.Revision != accepted.Current.Revision {
		t.Fatal("the accepted record changed")
	}
	if _, ok := changesByTitle(t, s, token)["From mac (conflict copy)"]; !ok {
		t.Fatal("missing conflict copy")
	}
	// The name stays within the limit every client enforces.
	long := strings.Repeat("é", 500)
	head := apply(t, s, token, taskOp("long", "First", 0, nil)).Current.Revision
	apply(t, s, token, taskOp("long", "Second", head, nil))
	r := apply(t, s, token, taskOp("long", long, head, nil))
	var copied Entity
	if err := s.DB.QueryRow(context.Background(), "SELECT data FROM entities WHERE id=$1", r.CopyID).Scan(&copied.Data); err != nil {
		t.Fatal(err)
	}
	copied.Kind, copied.ID = "task", r.CopyID
	if err := validate(Operation{OperationID: "x", Kind: "task", ID: r.CopyID, Data: copied.Data}); err != nil {
		t.Fatal(err)
	}
}

func TestProjectConflictsWithoutContentDifferencesStayQuiet(t *testing.T) {
	s, _, token := setup(t)
	base := apply(t, s, token, taskOp("t", "Same", 0, nil)).Current.Revision
	apply(t, s, token, taskOp("t", "Same", base, map[string]any{"status": "done", "completedAt": 5}))
	r := apply(t, s, token, taskOp("t", "Same", base, map[string]any{"status": "done", "completedAt": 9, "sort": 8.5, "updated": 9}))
	if r.Conflict || r.CopyID != "" {
		t.Fatalf("%+v", r)
	}
	b := apply(t, s, token, taskOp("order", "Order", 0, nil)).Current.Revision
	apply(t, s, token, taskOp("order", "Order", b, map[string]any{"sort": 3.5}))
	if r = apply(t, s, token, taskOp("order", "Order", b, map[string]any{"sort": 4.5})); r.Conflict {
		t.Fatalf("%+v", r)
	}
	if r.Current == nil || !strings.Contains(string(r.Current.Data), "3.5") {
		t.Fatalf("%+v", r)
	}
}

func TestStaleTaskDeletionDoesNotRemoveNewerEdit(t *testing.T) {
	s, _, token := setup(t)
	base := apply(t, s, token, taskOp("t", "Original", 0, nil)).Current.Revision
	apply(t, s, token, taskOp("t", "Edited", base, nil))
	r := apply(t, s, token, taskOp("t", "Original", base, map[string]any{"deletedAt": 7}))
	if !r.Conflict || r.CopyID != "" || r.Message == "" {
		t.Fatalf("%+v", r)
	}
	if strings.Contains(string(r.Current.Data), `"deletedAt":7`) || !strings.Contains(string(r.Current.Data), "Edited") {
		t.Fatal(string(r.Current.Data))
	}
}

func TestTasksLeaveDeletedProjects(t *testing.T) {
	s, _, token := setup(t)
	p := apply(t, s, token, projectOp("p", "Project", 0, nil)).Current.Revision
	apply(t, s, token, projectOp("p", "Project", p, map[string]any{"deletedAt": 7}))
	live := apply(t, s, token, taskOp("offline", "Added offline", 0, map[string]any{"projectId": "p"}))
	if !strings.Contains(string(live.Current.Data), `"projectId":null`) {
		t.Fatal(string(live.Current.Data))
	}
	deleted := apply(t, s, token, taskOp("gone", "Deleted", 0, map[string]any{"projectId": "p", "deletedAt": 7}))
	if !strings.Contains(string(deleted.Current.Data), `"projectId":"p"`) {
		t.Fatal(string(deleted.Current.Data))
	}
	missing := apply(t, s, token, taskOp("orphan", "Orphan", 0, map[string]any{"projectId": "nope", "deletedAt": 7}))
	if !strings.Contains(string(missing.Current.Data), `"projectId":null`) {
		t.Fatal(string(missing.Current.Data))
	}
}

func TestProjectConflictCopyKeepsEdits(t *testing.T) {
	s, _, token := setup(t)
	base := apply(t, s, token, projectOp("p", "Original", 0, nil)).Current.Revision
	apply(t, s, token, projectOp("p", "Phone", base, nil))
	if r := apply(t, s, token, projectOp("p", "Mac", base, nil)); !r.Conflict || r.CopyID == "" {
		t.Fatalf("%+v", r)
	}
	if _, ok := changesByTitle(t, s, token)["Mac (conflict copy)"]; !ok {
		t.Fatal("missing conflict copy")
	}
}

func TestValidateTaskRepeat(t *testing.T) {
	valid := []string{
		`null`,
		`{"unit":"day","interval":1,"from":"completion"}`,
		`{"unit":"week","interval":2,"weekdays":[1,5],"from":"schedule"}`,
		`{"unit":"month","interval":1,"monthDay":31,"from":"schedule"}`,
	}
	for _, rule := range valid {
		if !validateRepeat(json.RawMessage(rule)) {
			t.Errorf("rejected %s", rule)
		}
	}
	invalid := []string{
		`"weekly"`,
		`{"unit":"fortnight","interval":1,"from":"schedule"}`,
		`{"unit":"day","interval":0,"from":"schedule"}`,
		`{"unit":"day","interval":100,"from":"schedule"}`,
		`{"unit":"day","interval":1,"from":"whenever"}`,
		`{"unit":"day","interval":1,"from":"schedule","extra":true}`,
		`{"unit":"week","interval":1,"weekdays":[8],"from":"schedule"}`,
		`{"unit":"week","interval":1,"weekdays":[1,1],"from":"schedule"}`,
		`{"unit":"week","interval":1,"weekdays":[1],"from":"completion"}`,
		`{"unit":"day","interval":1,"weekdays":[1],"from":"schedule"}`,
		`{"unit":"week","interval":1,"monthDay":3,"from":"schedule"}`,
		`{"unit":"month","interval":1,"monthDay":32,"from":"schedule"}`,
	}
	for _, rule := range invalid {
		if validateRepeat(json.RawMessage(rule)) {
			t.Errorf("accepted %s", rule)
		}
	}
	op := taskOp("t", "T", 0, map[string]any{"repeat": map[string]any{"unit": "day", "interval": 0, "from": "schedule"}})
	if validateProjectRecord(op) == nil {
		t.Error("accepted a task with an invalid repeat")
	}
}

func TestConflictCopyOfRepeatingTaskDoesNotRepeat(t *testing.T) {
	s, _, token := setup(t)
	rule := map[string]any{"unit": "week", "interval": 1, "from": "schedule"}
	base := apply(t, s, token, taskOp("t", "Review", 0, map[string]any{"repeat": rule})).Current.Revision
	apply(t, s, token, taskOp("t", "From phone", base, map[string]any{"repeat": rule}))
	if r := apply(t, s, token, taskOp("t", "From mac", base, map[string]any{"repeat": rule})); r.CopyID == "" {
		t.Fatalf("%+v", r)
	}
	copied, ok := changesByTitle(t, s, token)["From mac (conflict copy)"]
	if !ok {
		t.Fatal("missing conflict copy")
	}
	if strings.Contains(string(copied.Data), "repeat") {
		t.Fatalf("copy kept its repeat: %s", copied.Data)
	}
}

func TestValidateTags(t *testing.T) {
	for _, value := range []string{``, `null`, `[]`, `["work"]`, `["深度","a-b"]`} {
		if !validateTags(json.RawMessage(value)) {
			t.Errorf("rejected %s", value)
		}
	}
	for _, value := range []string{`"work"`, `{}`, `[1]`, `[""]`, `["two words"]`, `["#hash"]`, `["a","a"]`} {
		if validateTags(json.RawMessage(value)) {
			t.Errorf("accepted %s", value)
		}
	}
	if validateProjectRecord(taskOp("t", "T", 0, map[string]any{"tags": []string{"a b"}})) == nil {
		t.Error("accepted a task with invalid tags")
	}
}

func TestValidateReminders(t *testing.T) {
	for _, value := range []string{``, `null`, `[]`, `[0]`, `[0,15,60,1440,40320]`} {
		if !validateReminders(json.RawMessage(value)) {
			t.Errorf("rejected %s", value)
		}
	}
	for _, value := range []string{`0`, `{}`, `[-1]`, `[40321]`, `[5,5]`, `[0,1,2,3,4,5]`, `[1.5]`, `["5"]`} {
		if validateReminders(json.RawMessage(value)) {
			t.Errorf("accepted %s", value)
		}
	}
	if validateProjectRecord(taskOp("t", "T", 0, map[string]any{"reminders": []int{-1}})) == nil {
		t.Error("accepted a task with invalid reminders")
	}
}

func TestConflictCopyOfTaskDoesNotRemind(t *testing.T) {
	s, _, token := setup(t)
	reminders := []int{0, 60}
	base := apply(t, s, token, taskOp("t", "Review", 0, map[string]any{"reminders": reminders})).Current.Revision
	apply(t, s, token, taskOp("t", "From phone", base, map[string]any{"reminders": reminders}))
	if r := apply(t, s, token, taskOp("t", "From mac", base, map[string]any{"reminders": reminders})); r.CopyID == "" {
		t.Fatalf("%+v", r)
	}
	copied, ok := changesByTitle(t, s, token)["From mac (conflict copy)"]
	if !ok {
		t.Fatal("missing conflict copy")
	}
	if !strings.Contains(string(copied.Data), `"reminders":[]`) {
		t.Fatalf("copy kept its reminders: %s", copied.Data)
	}
}
