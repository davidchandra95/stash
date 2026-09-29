CREATE TABLE notebooks (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL);
CREATE TABLE preferences (id INTEGER PRIMARY KEY CHECK(id=1), appearance TEXT NOT NULL, revision INTEGER NOT NULL, last_op TEXT NOT NULL);
CREATE TABLE notes (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, notebook TEXT REFERENCES notebooks(id),
 body TEXT NOT NULL, document_version INTEGER NOT NULL DEFAULT 1,
 plain_text TEXT NOT NULL, has_tasks INTEGER NOT NULL DEFAULT 0,
 pinned INTEGER NOT NULL DEFAULT 0, trashed_at INTEGER,
 created INTEGER NOT NULL, updated INTEGER NOT NULL, revision INTEGER NOT NULL,
 last_op TEXT NOT NULL
);
CREATE TABLE note_tags (note_id TEXT NOT NULL REFERENCES notes(id), tag TEXT NOT NULL, PRIMARY KEY(note_id,tag));
CREATE INDEX notes_updated ON notes(updated DESC);
CREATE INDEX notes_notebook ON notes(notebook);
PRAGMA user_version=1;
