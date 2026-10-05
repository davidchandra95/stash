package syncserver

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func drawingOperation(t *testing.T, id string, revision int64, x int) Operation {
	t.Helper()
	op := noteOp(id, "Drawing", revision)
	var record map[string]any
	if err := json.Unmarshal(op.Data, &record); err != nil {
		t.Fatal(err)
	}
	record["content"] = map[string]any{"type": "doc", "content": []any{
		map[string]any{"type": "drawing", "attrs": map[string]any{
			"id": "drawing-1", "data": map[string]any{
				"version": 1, "revision": x, "previewRevision": x,
				"preview": "data:image/png;base64,aGVsbG8=",
				"scene": map[string]any{
					"elements": []any{map[string]any{"id": "shape", "type": "image", "x": x, "fileId": "image"}},
					"appState": map[string]any{"viewBackgroundColor": "#ffffff"},
					"files":    map[string]any{"image": map[string]any{"id": "image", "dataURL": "data:image/png;base64,aGVsbG8=", "mimeType": "image/png", "created": 1}},
				},
			},
		}},
	}}
	var err error
	op.Data, err = json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	return op
}

func TestDrawingSyncPreservesScenesAndConflictCopies(t *testing.T) {
	s, _, first := setup(t)
	_, second, err := s.CreateDevice(context.Background(), "drawing-second")
	if err != nil {
		t.Fatal(err)
	}
	initial := drawingOperation(t, "drawing-note", 0, 10)
	apply(t, s, first, initial)
	page := pull(t, s, second, "/v1/pull?after=0")
	if len(page.Changes) != 1 {
		t.Fatalf("expected one drawing note, got %d", len(page.Changes))
	}
	var want, got map[string]any
	if err := json.Unmarshal(initial.Data, &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(page.Changes[0].Data, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got["content"], want["content"]) {
		t.Fatal("drawing content changed during sync")
	}
	apply(t, s, first, drawingOperation(t, "drawing-note", 1, 20))
	conflicting := drawingOperation(t, "drawing-note", 1, 30)
	receipt := apply(t, s, second, conflicting)
	if !receipt.Conflict || receipt.CopyID == "" {
		t.Fatal("missing drawing conflict copy")
	}
	if !reflect.DeepEqual(apply(t, s, second, conflicting), receipt) {
		t.Fatal("retry created another conflict copy")
	}
	page = pull(t, s, first, "/v1/pull?after=1")
	if err := json.Unmarshal(conflicting.Data, &want); err != nil {
		t.Fatal(err)
	}
	for _, change := range page.Changes {
		if change.ID != receipt.CopyID {
			continue
		}
		if err := json.Unmarshal(change.Data, &got); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got["content"], want["content"]) {
			t.Fatal("conflict copy lost drawing content")
		}
		return
	}
	t.Fatal("drawing conflict copy was not downloaded")
}
