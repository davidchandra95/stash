CREATE TABLE pdf_companions (
    document_id TEXT PRIMARY KEY REFERENCES pdf_documents(id) ON DELETE CASCADE,
    note_id TEXT NOT NULL UNIQUE REFERENCES notes(id) ON DELETE CASCADE
);
PRAGMA user_version=9;
