-- Earlier bodies of ordinary notes, kept on this device. See versions.rs for when they're taken.
CREATE TABLE IF NOT EXISTS note_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    plain_text TEXT NOT NULL,
    -- When this body was saved, and when it was kept as a version.
    saved INTEGER NOT NULL,
    captured INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS note_versions_note ON note_versions(note_id, id);
PRAGMA user_version=20;
