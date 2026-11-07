package syncserver

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

const maxCheckinNote = 2_000

// validateHabitFrequency mirrors the client: every day, chosen ISO weekdays, or 1-7 times a week.
func validateHabitFrequency(raw json.RawMessage) bool {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var f struct {
		Kind  string  `json:"kind"`
		Days  []int64 `json:"days"`
		Times *int64  `json:"times"`
	}
	if dec.Decode(&f) != nil {
		return false
	}
	switch f.Kind {
	case "daily":
		return f.Days == nil && f.Times == nil
	case "weekdays":
		if f.Times != nil || len(f.Days) == 0 {
			return false
		}
		seen := map[int64]bool{}
		for _, day := range f.Days {
			if day < 1 || day > 7 || seen[day] {
				return false
			}
			seen[day] = true
		}
		return true
	case "weekly":
		return f.Days == nil && f.Times != nil && *f.Times >= 1 && *f.Times <= 7
	}
	return false
}

// validateHabitRecord mirrors the client's rules for habits and check-ins.
func validateHabitRecord(op Operation) error {
	if op.Kind == "habit" {
		var h struct {
			ID, Name, Color            *string
			Frequency                  json.RawMessage `json:"frequency"`
			StartDate                  *string         `json:"startDate"`
			ArchivedAt                 *int64          `json:"archivedAt"`
			Sort                       *float64        `json:"sort"`
			DeletedAt                  *int64          `json:"deletedAt"`
			Created, Updated, Revision *int64
		}
		if json.Unmarshal(op.Data, &h) != nil || h.ID == nil || h.Name == nil || h.Color == nil || h.StartDate == nil || h.Sort == nil || h.Created == nil || h.Updated == nil || h.Revision == nil {
			return errors.New("invalid habit")
		}
		if *h.ID != op.ID || len(op.ID) > 119 {
			return errors.New("record ID mismatch")
		}
		if strings.TrimSpace(*h.Name) == "" || utf8.RuneCountInString(*h.Name) > 200 || !colorPattern.MatchString(*h.Color) || !validDate(h.StartDate) {
			return errors.New("invalid habit")
		}
		if !validateHabitFrequency(h.Frequency) {
			return errors.New("invalid habit frequency")
		}
		return nil
	}
	var c struct {
		ID                         *string
		HabitID                    *string `json:"habitId"`
		Date                       *string
		Done                       *bool
		Note                       *string
		Created, Updated, Revision *int64
	}
	if json.Unmarshal(op.Data, &c) != nil || c.ID == nil || c.HabitID == nil || c.Date == nil || c.Done == nil || c.Note == nil || c.Created == nil || c.Updated == nil || c.Revision == nil {
		return errors.New("invalid habit check-in")
	}
	if !recordIDPattern.MatchString(*c.HabitID) || !validDate(c.Date) || *c.ID != op.ID || op.ID != *c.HabitID+"_"+strings.ReplaceAll(*c.Date, "-", "") {
		return errors.New("invalid habit check-in")
	}
	if utf8.RuneCountInString(*c.Note) > maxCheckinNote {
		return errors.New("invalid habit check-in note")
	}
	return nil
}

// mergeCheckins combines two versions of the same day: done if either is, and both notes when
// they differ, so a note written offline is never lost. The result stays within the note limit.
func mergeCheckins(current, incoming map[string]any) map[string]any {
	if current == nil {
		return incoming
	}
	merged := map[string]any{}
	for k, v := range current {
		merged[k] = v
	}
	done, _ := current["done"].(bool)
	other, _ := incoming["done"].(bool)
	merged["done"] = done || other
	a, _ := current["note"].(string)
	b, _ := incoming["note"].(string)
	note := a
	switch {
	case strings.TrimSpace(b) == "" || b == a || strings.Contains(a, b):
	case strings.TrimSpace(a) == "" || strings.Contains(b, a):
		note = b
	default:
		note = a + "\n\n" + b
	}
	if runes := []rune(note); len(runes) > maxCheckinNote {
		note = string(runes[:maxCheckinNote])
	}
	merged["note"] = note
	if updated, ok := incoming["updated"].(float64); ok {
		if current, ok := merged["updated"].(float64); !ok || updated > current {
			merged["updated"] = updated
		}
	}
	return merged
}
