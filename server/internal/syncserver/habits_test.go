package syncserver

import (
	"encoding/json"
	"strings"
	"testing"
)

func habitOp(id string, patch map[string]any) Operation {
	d := map[string]any{"id": id, "name": "Read", "color": "#112233", "frequency": map[string]any{"kind": "daily"}, "startDate": "2026-11-01", "archivedAt": nil, "sort": 1.0, "deletedAt": nil, "created": 1, "updated": 2, "revision": 1}
	for k, v := range patch {
		d[k] = v
	}
	data, _ := json.Marshal(d)
	return Operation{OperationID: NewID(), Kind: "habit", ID: id, Data: data}
}
func checkinOp(habit, date string, patch map[string]any) Operation {
	id := habit + "_" + strings.ReplaceAll(date, "-", "")
	d := map[string]any{"id": id, "habitId": habit, "date": date, "done": true, "note": "", "created": 1, "updated": 2, "revision": 1}
	for k, v := range patch {
		d[k] = v
	}
	data, _ := json.Marshal(d)
	return Operation{OperationID: NewID(), Kind: "habitCheckin", ID: id, Data: data}
}

func TestHabitRecordValidation(t *testing.T) {
	for _, op := range []Operation{
		habitOp("h", nil),
		habitOp("h", map[string]any{"frequency": map[string]any{"kind": "weekdays", "days": []int{1, 3, 5}}}),
		habitOp("h", map[string]any{"frequency": map[string]any{"kind": "weekly", "times": 3}}),
		checkinOp("h", "2026-11-03", map[string]any{"note": "Read ABC\nch. 2"}),
	} {
		if err := validate(op); err != nil {
			t.Errorf("rejected %s: %v", op.Data, err)
		}
	}
	for _, op := range []Operation{
		habitOp("h", map[string]any{"name": " "}),
		habitOp("h", map[string]any{"color": "green"}),
		habitOp("h", map[string]any{"startDate": "2026-02-30"}),
		habitOp("h", map[string]any{"frequency": map[string]any{"kind": "weekdays", "days": []int{}}}),
		habitOp("h", map[string]any{"frequency": map[string]any{"kind": "weekdays", "days": []int{1, 1}}}),
		habitOp("h", map[string]any{"frequency": map[string]any{"kind": "weekly", "times": 8}}),
		habitOp("h", map[string]any{"frequency": map[string]any{"kind": "daily", "times": 1}}),
		habitOp("h", map[string]any{"frequency": map[string]any{"kind": "monthly"}}),
		habitOp(strings.Repeat("h", 120), nil),
		checkinOp("h", "2026-11-03", map[string]any{"date": "2026-11-04"}),
		checkinOp("h", "2026-11-03", map[string]any{"note": strings.Repeat("x", 2001)}),
		checkinOp("h", "2026-11-03", map[string]any{"done": nil}),
	} {
		if validate(op) == nil {
			t.Errorf("accepted %s", op.Data)
		}
	}
	deleted := habitOp("h", nil)
	deleted.Deleted = true
	if validate(deleted) == nil {
		t.Error("accepted a habit tombstone")
	}
}

func TestMergeCheckinsKeepsBothNotes(t *testing.T) {
	day := func(done bool, note string, updated float64) map[string]any {
		return map[string]any{"id": "h_20261103", "habitId": "h", "date": "2026-11-03", "done": done, "note": note, "updated": updated}
	}
	cases := []struct {
		current, incoming map[string]any
		done              bool
		note              string
	}{
		{day(true, "Read ABC", 1), day(false, "", 2), true, "Read ABC"},
		{day(false, "", 1), day(true, "Read ABC", 2), true, "Read ABC"},
		{day(true, "Read ABC", 1), day(true, "Read ABC ch. 2", 2), true, "Read ABC ch. 2"},
		{day(true, "Read ABC", 1), day(true, "Walked", 2), true, "Read ABC\n\nWalked"},
	}
	for _, c := range cases {
		got := mergeCheckins(c.current, c.incoming)
		if got["done"] != c.done || got["note"] != c.note || got["updated"] != 2.0 {
			t.Errorf("merge(%v, %v) = %v", c.current, c.incoming, got)
		}
	}
	long := mergeCheckins(day(true, strings.Repeat("a", 1500), 1), day(true, strings.Repeat("b", 1500), 2))
	if n := len([]rune(long["note"].(string))); n != maxCheckinNote {
		t.Errorf("merged note has %d characters", n)
	}
	if mergeCheckins(nil, day(true, "x", 1))["note"] != "x" {
		t.Error("a missing current record should take the incoming one")
	}
}

func TestHabitCheckinConflictsMerge(t *testing.T) {
	s, _, token := setup(t)
	apply(t, s, token, habitOp("h", nil))
	base := apply(t, s, token, checkinOp("h", "2026-11-03", map[string]any{"note": "Read ABC"})).Current.Revision
	apply(t, s, token, checkinOp("h", "2026-11-03", map[string]any{"note": "Read ABC", "done": false}))
	stale := checkinOp("h", "2026-11-03", map[string]any{"note": "Walked"})
	stale.BaseRevision = base
	r := apply(t, s, token, stale)
	if r.Conflict || r.CopyID != "" {
		t.Fatalf("%+v", r)
	}
	var d map[string]any
	if err := json.Unmarshal(r.Current.Data, &d); err != nil {
		t.Fatal(err)
	}
	if d["done"] != true || d["note"] != "Read ABC\n\nWalked" {
		t.Fatalf("%v", d)
	}
	// A stale habit edit keeps both versions, like a project.
	hb := apply(t, s, token, habitOp("x", nil)).Current.Revision
	apply(t, s, token, habitOp("x", map[string]any{"name": "Phone"}))
	old := habitOp("x", map[string]any{"name": "Mac"})
	old.BaseRevision = hb
	if r := apply(t, s, token, old); !r.Conflict || r.CopyID == "" || !strings.Contains(r.Message, "Check-ins stay") {
		t.Fatalf("%+v", r)
	}
}
