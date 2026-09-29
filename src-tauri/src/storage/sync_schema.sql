CREATE TABLE sync_state (id INTEGER PRIMARY KEY CHECK(id=1), device TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', library_id TEXT NOT NULL DEFAULT '', cursor INTEGER NOT NULL DEFAULT 0, last_success INTEGER, applying INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 0, target INTEGER, page_cursor INTEGER NOT NULL DEFAULT 0, warnings TEXT NOT NULL DEFAULT '[]');
INSERT INTO sync_state(id,device) VALUES(1,lower(hex(randomblob(16))));
CREATE TABLE sync_dirty(kind TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(kind,id));
CREATE TABLE sync_local_notebooks(id TEXT PRIMARY KEY);
CREATE TABLE sync_versions(kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(kind,id));
CREATE TABLE sync_outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL);
CREATE TABLE sync_inbox(kind TEXT NOT NULL,id TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(kind,id));
INSERT INTO sync_dirty SELECT 'note',id FROM notes WHERE id NOT IN(SELECT note_id FROM linked_notes);
INSERT INTO sync_dirty SELECT 'notebook',id FROM notebooks WHERE root_id IS NULL;
CREATE TRIGGER sync_notes_insert AFTER INSERT ON notes
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=NEW.id); END;
CREATE TRIGGER sync_notes_update AFTER UPDATE ON notes
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=NEW.id); END;
CREATE TRIGGER sync_notes_delete AFTER DELETE ON notes
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',OLD.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=OLD.id); END;
CREATE TRIGGER sync_notebooks_insert AFTER INSERT ON notebooks
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'notebook',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='notebook' AND id=NEW.id); END;
CREATE TRIGGER sync_notebooks_update AFTER UPDATE ON notebooks
WHEN (SELECT applying FROM sync_state WHERE id=1)=0 AND (OLD.name IS NOT NEW.name OR OLD.color IS NOT NEW.color OR OLD.icon IS NOT NEW.icon OR OLD.parent_id IS NOT NEW.parent_id OR OLD.root_id IS NOT NEW.root_id)
BEGIN INSERT INTO sync_dirty SELECT 'notebook',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='notebook' AND id=NEW.id); END;
CREATE TRIGGER sync_notebooks_delete AFTER DELETE ON notebooks
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'notebook',OLD.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='notebook' AND id=OLD.id); END;
CREATE TRIGGER sync_note_tags_insert AFTER INSERT ON note_tags
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',NEW.note_id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=NEW.note_id); END;
CREATE TRIGGER sync_note_tags_update AFTER UPDATE ON note_tags
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',NEW.note_id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=NEW.note_id); END;
CREATE TRIGGER sync_note_tags_delete AFTER DELETE ON note_tags
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',OLD.note_id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=OLD.note_id); END;
CREATE TRIGGER sync_note_notebooks_insert AFTER INSERT ON note_notebooks
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',NEW.note_id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=NEW.note_id); END;
CREATE TRIGGER sync_note_notebooks_update AFTER UPDATE ON note_notebooks
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',NEW.note_id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=NEW.note_id); END;
CREATE TRIGGER sync_note_notebooks_delete AFTER DELETE ON note_notebooks
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',OLD.note_id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=OLD.note_id); END;
CREATE TRIGGER sync_linked_notes_insert AFTER INSERT ON linked_notes
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',NEW.note_id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=NEW.note_id); END;
CREATE TRIGGER sync_linked_notes_update AFTER UPDATE ON linked_notes
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',NEW.note_id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=NEW.note_id); END;
CREATE TRIGGER sync_linked_notes_delete AFTER DELETE ON linked_notes
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'note',OLD.note_id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='note' AND id=OLD.note_id); END;
PRAGMA user_version=6;
