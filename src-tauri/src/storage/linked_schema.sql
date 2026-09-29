CREATE TABLE linked_roots (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, error TEXT);
ALTER TABLE notebooks ADD COLUMN parent_id TEXT REFERENCES notebooks(id);
ALTER TABLE notebooks ADD COLUMN root_id TEXT REFERENCES linked_roots(id);
ALTER TABLE notebooks ADD COLUMN relative_path TEXT;
ALTER TABLE notebooks ADD COLUMN manual INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX notebook_folder ON notebooks(root_id,relative_path);
CREATE TABLE linked_notes (
 note_id TEXT PRIMARY KEY REFERENCES notes(id), root_id TEXT NOT NULL REFERENCES linked_roots(id),
 relative_path TEXT NOT NULL, fingerprint TEXT NOT NULL, markdown TEXT NOT NULL,
 identity TEXT NOT NULL, unavailable TEXT, trash_path TEXT
);
CREATE UNIQUE INDEX linked_live_path ON linked_notes(root_id,relative_path) WHERE trash_path IS NULL;
CREATE TABLE file_operations (id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL);
CREATE TABLE file_conflicts (note_id TEXT PRIMARY KEY, draft TEXT NOT NULL, error TEXT NOT NULL);
PRAGMA user_version=4;
