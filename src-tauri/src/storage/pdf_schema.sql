CREATE TABLE pdf_documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    fingerprint TEXT NOT NULL UNIQUE,
    size INTEGER NOT NULL CHECK(size > 0),
    imported INTEGER NOT NULL
);
CREATE TABLE pdf_reading (
    document_id TEXT PRIMARY KEY REFERENCES pdf_documents(id),
    state TEXT NOT NULL
);
PRAGMA user_version=8;
