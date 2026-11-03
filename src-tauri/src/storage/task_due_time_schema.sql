ALTER TABLE tasks ADD COLUMN due_time TEXT
    CHECK (due_time IS NULL OR (
        due_date IS NOT NULL
        AND due_time GLOB '[0-2][0-9]:[0-5][0-9]'
        AND due_time <= '23:59'
    ));
PRAGMA user_version=12;
