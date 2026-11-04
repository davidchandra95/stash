-- Projects and tasks join the sync queue. Soft deletes are ordinary updates, so undo syncs too.
CREATE TRIGGER IF NOT EXISTS sync_projects_insert AFTER INSERT ON projects
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'project',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='project' AND id=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS sync_projects_update AFTER UPDATE ON projects
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'project',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='project' AND id=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS sync_tasks_insert AFTER INSERT ON tasks
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'task',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='task' AND id=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS sync_tasks_update AFTER UPDATE ON tasks
WHEN (SELECT applying FROM sync_state WHERE id=1)=0
BEGIN INSERT INTO sync_dirty SELECT 'task',NEW.id WHERE NOT EXISTS(SELECT 1 FROM sync_dirty WHERE kind='task' AND id=NEW.id); END;
INSERT OR IGNORE INTO sync_dirty SELECT 'project',id FROM projects;
INSERT OR IGNORE INTO sync_dirty SELECT 'task',id FROM tasks;
PRAGMA user_version=14;
