-- Habits and their daily check-ins. A check-in's ID is `<habit ID>_<YYYYMMDD>`, so the same day
-- checked on two devices is one record. Both kinds join the sync queue like projects and tasks.
CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    frequency TEXT NOT NULL CHECK (json_valid(frequency)),
    start_date TEXT NOT NULL,
    archived_at INTEGER,
    sort REAL NOT NULL,
    deleted_at INTEGER,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS habit_checkins (
    id TEXT PRIMARY KEY,
    habit_id TEXT NOT NULL REFERENCES habits(id),
    date TEXT NOT NULL,
    done INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    UNIQUE (habit_id, date)
);
CREATE TRIGGER IF NOT EXISTS sync_habits_insert AFTER INSERT ON habits
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'habit',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='habit' AND id=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS sync_habits_update AFTER UPDATE ON habits
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'habit',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='habit' AND id=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS sync_checkins_insert AFTER INSERT ON habit_checkins
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'habitCheckin',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='habitCheckin' AND id=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS sync_checkins_update AFTER UPDATE ON habit_checkins
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'habitCheckin',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='habitCheckin' AND id=NEW.id); END;
PRAGMA user_version=19;
