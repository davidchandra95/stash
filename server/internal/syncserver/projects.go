package syncserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Every client applies these records through its own validation, so a record accepted here must
// pass there too. Otherwise one bad record would stop every device from finishing a sync.
var (
	recordIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	colorPattern    = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	timePattern     = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)
)

const (
	minInstant = -62_135_596_800_000
	maxInstant = 253_402_300_799_999
)

func isProjectKind(kind string) bool { return kind == "project" || kind == "task" }

func validDate(date *string) bool {
	if date == nil {
		return true
	}
	parsed, err := time.Parse("2006-01-02", *date)
	return err == nil && len(*date) == 10 && parsed.Year() > 0
}
func validInstant(value int64) bool { return value >= minInstant && value <= maxInstant }
func validZone(zone string) bool {
	if zone == "" || zone == "Local" {
		return false
	}
	_, err := time.LoadLocation(zone)
	return err == nil
}
func validOptionalRecordID(id *string) bool { return id == nil || recordIDPattern.MatchString(*id) }

// validateRepeat mirrors the client's rule, since clients reject a malformed record on download.
func validateRepeat(raw json.RawMessage) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return true
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var r struct {
		Unit     string  `json:"unit"`
		Interval int64   `json:"interval"`
		Weekdays []int64 `json:"weekdays"`
		MonthDay *int64  `json:"monthDay"`
		From     string  `json:"from"`
	}
	if dec.Decode(&r) != nil || r.Interval < 1 || r.Interval > 99 {
		return false
	}
	switch r.Unit {
	case "day", "week", "month", "year":
	default:
		return false
	}
	if r.From != "schedule" && r.From != "completion" {
		return false
	}
	seen := map[int64]bool{}
	for _, day := range r.Weekdays {
		if day < 1 || day > 7 || seen[day] {
			return false
		}
		seen[day] = true
	}
	if len(r.Weekdays) > 0 && (r.Unit != "week" || r.From != "schedule") {
		return false
	}
	if r.MonthDay != nil && (*r.MonthDay < 1 || *r.MonthDay > 31 || (r.Unit != "month" && r.Unit != "year")) {
		return false
	}
	return true
}

func validateSchedule(raw json.RawMessage) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return true
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var s struct {
		Kind     string          `json:"kind"`
		Start    json.RawMessage `json:"start"`
		End      json.RawMessage `json:"end"`
		TimeZone *string         `json:"timeZone"`
	}
	if dec.Decode(&s) != nil {
		return false
	}
	switch s.Kind {
	case "allDay":
		var start, end *string
		if s.TimeZone != nil || json.Unmarshal(s.Start, &start) != nil || json.Unmarshal(s.End, &end) != nil || start == nil || end == nil {
			return false
		}
		return validDate(start) && validDate(end) && *end > *start
	case "point":
		var start *int64
		if len(s.End) != 0 || s.TimeZone == nil || json.Unmarshal(s.Start, &start) != nil || start == nil {
			return false
		}
		return validInstant(*start) && validZone(*s.TimeZone)
	case "range":
		var start, end *int64
		if s.TimeZone == nil || json.Unmarshal(s.Start, &start) != nil || json.Unmarshal(s.End, &end) != nil || start == nil || end == nil {
			return false
		}
		return validInstant(*start) && validInstant(*end) && *end > *start && validZone(*s.TimeZone)
	}
	return false
}

func validateProjectRecord(op Operation) error {
	if !recordIDPattern.MatchString(op.ID) {
		return errors.New("invalid record ID")
	}
	if op.Kind == "project" {
		var p struct {
			ID, Name, Description, Status, Color *string
			StartDate                            *string  `json:"startDate"`
			EndDate                              *string  `json:"endDate"`
			CompletedAt                          *int64   `json:"completedAt"`
			NotebookID                           *string  `json:"notebookId"`
			Sort                                 *float64 `json:"sort"`
			DeletedAt                            *int64   `json:"deletedAt"`
			Created, Updated, Revision           *int64
		}
		if json.Unmarshal(op.Data, &p) != nil || p.ID == nil || p.Name == nil || p.Description == nil || p.Status == nil || p.Color == nil || p.Sort == nil || p.Created == nil || p.Updated == nil || p.Revision == nil {
			return errors.New("invalid project")
		}
		if *p.ID != op.ID {
			return errors.New("record ID mismatch")
		}
		switch *p.Status {
		case "planned", "active", "on_hold", "done", "cancelled":
		default:
			return errors.New("invalid project status")
		}
		if strings.TrimSpace(*p.Name) == "" || utf8.RuneCountInString(*p.Name) > 200 || utf8.RuneCountInString(*p.Description) > 10_000 {
			return errors.New("invalid project text")
		}
		if !validDate(p.StartDate) || !validDate(p.EndDate) || (p.StartDate != nil && p.EndDate != nil && *p.EndDate < *p.StartDate) {
			return errors.New("invalid project dates")
		}
		if !colorPattern.MatchString(*p.Color) || !validOptionalRecordID(p.NotebookID) {
			return errors.New("invalid project")
		}
		return nil
	}
	var t struct {
		ID, Title, Description, Status *string
		ProjectID                      *string         `json:"projectId"`
		Priority                       *int64          `json:"priority"`
		StartDate                      *string         `json:"startDate"`
		DueDate                        *string         `json:"dueDate"`
		DueTime                        *string         `json:"dueTime"`
		Schedule                       json.RawMessage `json:"schedule"`
		DueLinked                      *bool           `json:"dueLinked"`
		Repeat                         json.RawMessage `json:"repeat"`
		CompletedAt                    *int64          `json:"completedAt"`
		Sort                           *float64        `json:"sort"`
		DeletedAt                      *int64          `json:"deletedAt"`
		Created, Updated, Revision     *int64
	}
	if json.Unmarshal(op.Data, &t) != nil || t.ID == nil || t.Title == nil || t.Description == nil || t.Status == nil || t.Priority == nil || t.Sort == nil || t.Created == nil || t.Updated == nil || t.Revision == nil {
		return errors.New("invalid task")
	}
	if *t.ID != op.ID {
		return errors.New("record ID mismatch")
	}
	switch *t.Status {
	case "todo", "doing", "done", "cancelled":
	default:
		return errors.New("invalid task status")
	}
	if strings.TrimSpace(*t.Title) == "" || utf8.RuneCountInString(*t.Title) > 500 || utf8.RuneCountInString(*t.Description) > 10_000 {
		return errors.New("invalid task text")
	}
	if *t.Priority < 0 || *t.Priority > 3 || !validOptionalRecordID(t.ProjectID) {
		return errors.New("invalid task")
	}
	if !validDate(t.StartDate) || !validDate(t.DueDate) {
		return errors.New("invalid task dates")
	}
	if t.DueTime != nil && (t.DueDate == nil || !timePattern.MatchString(*t.DueTime)) {
		return errors.New("invalid task due time")
	}
	if !validateSchedule(t.Schedule) {
		return errors.New("invalid task schedule")
	}
	if !validateRepeat(t.Repeat) {
		return errors.New("invalid task repeat")
	}
	hasSchedule := len(t.Schedule) != 0 && string(t.Schedule) != "null"
	if t.DueLinked != nil && *t.DueLinked && (!hasSchedule || t.DueDate != nil || t.DueTime != nil) {
		return errors.New("invalid linked deadline")
	}
	return nil
}

// sameProjectContent ignores ordering and bookkeeping, which never justify a visible conflict.
func sameProjectContent(a, b map[string]any) bool {
	strip := func(record map[string]any) map[string]any {
		out := map[string]any{"deleted": record["deletedAt"] != nil}
		for key, value := range record {
			switch key {
			case "revision", "created", "updated", "sort", "completedAt", "deletedAt":
				continue
			}
			if value != nil && value != false {
				out[key] = value
			}
		}
		return out
	}
	return reflect.DeepEqual(strip(a), strip(b))
}

// resolveProjectConflict keeps the accepted record. Different content from a stale device becomes
// a visible copy, except a stale deletion, which never removes another device's newer edit.
func (s *Server) resolveProjectConflict(ctx context.Context, tx pgx.Tx, revision *int64, op Operation, currentData []byte, result *Receipt) error {
	var incoming, current map[string]any
	if err := json.Unmarshal(op.Data, &incoming); err != nil {
		return err
	}
	if len(currentData) > 0 {
		if err := json.Unmarshal(currentData, &current); err != nil {
			return err
		}
		if sameProjectContent(incoming, current) || (incoming["deletedAt"] != nil && current["deletedAt"] != nil) {
			result.Conflict = false
			return nil
		}
	}
	noun, field, limit := "task", "title", 500
	if op.Kind == "project" {
		noun, field, limit = "project", "name", 200
	}
	if incoming["deletedAt"] != nil {
		result.Message = "Deleted here but changed on another device; the changed " + noun + " was kept."
		return nil
	}
	const suffix = " (conflict copy)"
	name := []rune(incoming[field].(string))
	if room := limit - utf8.RuneCountInString(suffix); len(name) > room {
		name = name[:room]
	}
	result.CopyID = NewID()
	incoming["id"] = result.CopyID
	incoming[field] = string(name) + suffix
	// A copy is for review, so it must not become a second live routine.
	delete(incoming, "repeat")
	copyData, err := json.Marshal(incoming)
	if err != nil {
		return err
	}
	if err = s.put(ctx, tx, revision, Entity{Kind: op.Kind, ID: result.CopyID, Data: copyData}); err != nil {
		return err
	}
	result.Message = "Both " + noun + " versions were kept."
	if op.Kind == "project" {
		result.Message += " Tasks stay with the original."
	}
	return nil
}

// detachFromRemovedProject moves a live task to the Inbox when its project was deleted, so work
// added offline stays visible. A deleted task keeps its project for undo.
func detachFromRemovedProject(ctx context.Context, tx pgx.Tx, data json.RawMessage) (json.RawMessage, error) {
	var d map[string]json.RawMessage
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, err
	}
	var project *string
	if err := json.Unmarshal(d["projectId"], &project); err != nil && len(d["projectId"]) > 0 {
		return nil, err
	}
	if project == nil {
		return data, nil
	}
	var removed bool
	err := tx.QueryRow(ctx, "SELECT data->>'deletedAt' IS NOT NULL FROM entities WHERE kind='project' AND id=$1", *project).Scan(&removed)
	missing := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !missing {
		return nil, err
	}
	taskDeleted := len(d["deletedAt"]) > 0 && string(d["deletedAt"]) != "null"
	if !missing && (!removed || taskDeleted) {
		return data, nil
	}
	d["projectId"] = json.RawMessage("null")
	return json.Marshal(d)
}
