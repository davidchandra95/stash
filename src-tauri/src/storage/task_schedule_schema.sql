-- Legacy due dates and wall times remain untouched. Calendar schedules are optional.
ALTER TABLE tasks ADD COLUMN schedule TEXT CHECK (schedule IS NULL OR json_valid(schedule));
ALTER TABLE tasks ADD COLUMN due_linked INTEGER NOT NULL DEFAULT 0
    CHECK (due_linked IN (0, 1) AND (due_linked = 0 OR
        (schedule IS NOT NULL AND due_date IS NULL AND due_time IS NULL)));
PRAGMA user_version=13;
