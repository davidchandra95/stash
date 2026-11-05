-- A JSON list of normalized tag names, separate from the tags in note bodies.
ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags));
PRAGMA user_version=17;
