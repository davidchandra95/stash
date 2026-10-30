CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    completed_at INTEGER,
    notebook_id TEXT,
    color TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'project',
    sort REAL NOT NULL,
    deleted_at INTEGER,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id),
    priority INTEGER NOT NULL DEFAULT 0,
    start_date TEXT,
    due_date TEXT,
    completed_at INTEGER,
    sort REAL NOT NULL,
    deleted_at INTEGER,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    revision INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
PRAGMA user_version=11;
