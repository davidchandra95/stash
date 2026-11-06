-- Repeat rules are optional; existing tasks stay one-off.
ALTER TABLE tasks ADD COLUMN repeat TEXT CHECK (repeat IS NULL OR json_valid(repeat));
PRAGMA user_version=15;
