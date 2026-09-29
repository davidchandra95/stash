CREATE TABLE tag_body_migrations (note_id TEXT PRIMARY KEY REFERENCES notes(id));
PRAGMA user_version=7;
