-- A JSON list of subtasks: {id, title, done}, in display order.
ALTER TABLE tasks ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checklist));
PRAGMA user_version=18;
