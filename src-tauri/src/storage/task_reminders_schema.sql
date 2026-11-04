-- NULL keeps the default reminder at the task's moment; an empty list turns reminders off.
ALTER TABLE tasks ADD COLUMN reminders TEXT CHECK (reminders IS NULL OR json_valid(reminders));
PRAGMA user_version=14;
