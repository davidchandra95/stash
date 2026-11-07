//! Habits and their daily check-ins. Triggers queue every change for sync; see documents/SYNC.md.
use super::projects::{check_revision, valid_color, valid_date, valid_record_id};
use super::*;

/// How often a habit is due. Weekdays are ISO numbers (Monday is 1).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum HabitFrequency {
    Daily,
    Weekdays { days: Vec<i64> },
    Weekly { times: i64 },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    pub id: String,
    pub name: String,
    pub color: String,
    pub frequency: HabitFrequency,
    pub start_date: String,
    pub archived_at: Option<i64>,
    pub sort: f64,
    pub deleted_at: Option<i64>,
    pub created: i64,
    pub updated: i64,
    pub revision: i64,
}

/// One day of one habit: whether it was done, and an optional note about it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HabitCheckin {
    pub id: String,
    pub habit_id: String,
    pub date: String,
    pub done: bool,
    pub note: String,
    pub created: i64,
    pub updated: i64,
    pub revision: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitData {
    pub habits: Vec<Habit>,
    pub checkins: Vec<HabitCheckin>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveHabit {
    pub id: String,
    pub name: String,
    pub color: String,
    pub frequency: HabitFrequency,
    pub start_date: String,
    pub archived_at: Option<i64>,
    pub sort: f64,
    pub deleted: bool,
    pub expected_revision: i64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCheckin {
    pub habit_id: String,
    pub date: String,
    pub done: bool,
    pub note: String,
    pub expected_revision: i64,
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitChanges {
    #[serde(default)]
    pub habits: Vec<SaveHabit>,
    #[serde(default)]
    pub checkins: Vec<SaveCheckin>,
}

pub(super) const MAX_HABIT_NAME: usize = 200;
pub(super) const MAX_CHECKIN_NOTE: usize = 2_000;

/// The check-in ID for a habit and date: `<habit>_<YYYYMMDD>`.
pub fn checkin_id(habit_id: &str, date: &str) -> String {
    format!("{habit_id}_{}", date.replace('-', ""))
}

const HABIT_COLUMNS: &str =
    "id,name,color,frequency,start_date,archived_at,sort,deleted_at,created,updated,revision";
const CHECKIN_COLUMNS: &str = "id,habit_id,date,done,note,created,updated,revision";

fn habit_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Habit> {
    Ok(Habit {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        frequency: serde_json::from_str(&r.get::<_, String>(3)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error))
        })?,
        start_date: r.get(4)?,
        archived_at: r.get(5)?,
        sort: r.get(6)?,
        deleted_at: r.get(7)?,
        created: r.get(8)?,
        updated: r.get(9)?,
        revision: r.get(10)?,
    })
}
fn checkin_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<HabitCheckin> {
    Ok(HabitCheckin {
        id: r.get(0)?,
        habit_id: r.get(1)?,
        date: r.get(2)?,
        done: r.get(3)?,
        note: r.get(4)?,
        created: r.get(5)?,
        updated: r.get(6)?,
        revision: r.get(7)?,
    })
}

fn valid_frequency(frequency: &HabitFrequency) -> bool {
    match frequency {
        HabitFrequency::Daily => true,
        HabitFrequency::Weekdays { days } => {
            let unique: std::collections::HashSet<_> = days.iter().collect();
            !days.is_empty() && unique.len() == days.len() && days.iter().all(|d| (1..=7).contains(d))
        }
        HabitFrequency::Weekly { times } => (1..=7).contains(times),
    }
}

fn validate_habit(h: &SaveHabit) -> Result<()> {
    // Leaves room for the check-in ID's date suffix within the 128-character record ID limit.
    if !valid_record_id(&h.id) || h.id.len() > 119 {
        return Err("Invalid habit ID.".into());
    }
    let name = h.name.trim();
    if name.is_empty() || name.chars().count() > MAX_HABIT_NAME {
        return Err("A habit needs a name of up to 200 characters.".into());
    }
    if !valid_color(&h.color) {
        return Err("Invalid habit color.".into());
    }
    if !valid_frequency(&h.frequency) {
        return Err("Choose every day, at least one weekday, or 1 to 7 times a week.".into());
    }
    if !valid_date(&Some(h.start_date.clone())) {
        return Err("Invalid habit start date.".into());
    }
    if !h.sort.is_finite() {
        return Err("Invalid habit order.".into());
    }
    Ok(())
}

fn validate_checkin(c: &SaveCheckin) -> Result<()> {
    if !valid_record_id(&c.habit_id) || c.habit_id.len() > 119 || !valid_date(&Some(c.date.clone())) {
        return Err("Invalid habit check-in.".into());
    }
    if c.note.chars().count() > MAX_CHECKIN_NOTE {
        return Err("A check-in note can be up to 2,000 characters.".into());
    }
    Ok(())
}

pub(super) fn synced_habit(conn: &Connection, id: &str) -> Result<Option<Value>> {
    conn.query_row(&format!("SELECT {HABIT_COLUMNS} FROM habits WHERE id=?"), [id], habit_row)
        .optional()
        .map_err(db_err)?
        .map(|habit| serde_json::to_value(habit).map_err(db_err))
        .transpose()
}
pub(super) fn synced_checkin(conn: &Connection, id: &str) -> Result<Option<Value>> {
    conn.query_row(&format!("SELECT {CHECKIN_COLUMNS} FROM habit_checkins WHERE id=?"), [id], checkin_row)
        .optional()
        .map_err(db_err)?
        .map(|checkin| serde_json::to_value(checkin).map_err(db_err))
        .transpose()
}

pub(super) fn apply_synced_habit(conn: &Connection, id: &str, data: Value) -> Result<()> {
    let h: Habit = serde_json::from_value(data).map_err(db_err)?;
    validate_habit(&SaveHabit {
        id: h.id.clone(),
        name: h.name.clone(),
        color: h.color.clone(),
        frequency: h.frequency.clone(),
        start_date: h.start_date.clone(),
        archived_at: h.archived_at,
        sort: h.sort,
        deleted: h.deleted_at.is_some(),
        expected_revision: 0,
    })?;
    if h.id != id {
        return Err("Invalid synced habit.".into());
    }
    conn.execute(
        "INSERT INTO habits(id,name,color,frequency,start_date,archived_at,sort,deleted_at,created,updated,revision)
         VALUES(?,?,?,?,?,?,?,?,?,?,1)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,frequency=excluded.frequency,
         start_date=excluded.start_date,archived_at=excluded.archived_at,sort=excluded.sort,deleted_at=excluded.deleted_at,
         created=excluded.created,updated=excluded.updated,revision=habits.revision+1",
        params![
            h.id,
            h.name,
            h.color,
            serde_json::to_string(&h.frequency).map_err(db_err)?,
            h.start_date,
            h.archived_at,
            h.sort,
            h.deleted_at,
            h.created,
            h.updated
        ],
    )
    .map_err(db_err)?;
    Ok(())
}
pub(super) fn apply_synced_checkin(conn: &Connection, id: &str, data: Value) -> Result<()> {
    let c: HabitCheckin = serde_json::from_value(data).map_err(db_err)?;
    validate_checkin(&SaveCheckin {
        habit_id: c.habit_id.clone(),
        date: c.date.clone(),
        done: c.done,
        note: c.note.clone(),
        expected_revision: 0,
    })?;
    if c.id != id || c.id != checkin_id(&c.habit_id, &c.date) {
        return Err("Invalid synced habit check-in.".into());
    }
    conn.execute(
        "INSERT INTO habit_checkins(id,habit_id,date,done,note,created,updated,revision) VALUES(?,?,?,?,?,?,?,1)
         ON CONFLICT(id) DO UPDATE SET done=excluded.done,note=excluded.note,created=excluded.created,
         updated=excluded.updated,revision=habit_checkins.revision+1",
        params![c.id, c.habit_id, c.date, c.done, c.note, c.created, c.updated],
    )
    .map_err(db_err)?;
    Ok(())
}

impl Store {
    pub fn habit_data(&self) -> Result<HabitData> {
        let mut stmt = self
            .conn
            .prepare(&format!("SELECT {HABIT_COLUMNS} FROM habits ORDER BY sort,rowid"))
            .map_err(db_err)?;
        let habits = stmt
            .query_map([], habit_row)
            .map_err(db_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(db_err)?;
        let mut stmt = self
            .conn
            .prepare(&format!("SELECT {CHECKIN_COLUMNS} FROM habit_checkins ORDER BY date,habit_id"))
            .map_err(db_err)?;
        let checkins = stmt
            .query_map([], checkin_row)
            .map_err(db_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(db_err)?;
        Ok(HabitData { habits, checkins })
    }

    /// Applies every change in one transaction and returns the saved records. Any invalid or
    /// stale change rejects the whole batch.
    pub fn save_habit_changes(&mut self, changes: &HabitChanges) -> Result<HabitData> {
        for habit in &changes.habits {
            validate_habit(habit)?;
        }
        for checkin in &changes.checkins {
            validate_checkin(checkin)?;
        }
        let at = now();
        let tx = self.conn.transaction().map_err(db_err)?;
        let mut saved = HabitData::default();
        for h in &changes.habits {
            let current: Option<(i64, i64, Option<i64>)> = tx
                .query_row("SELECT revision,created,deleted_at FROM habits WHERE id=?", [&h.id], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                })
                .optional()
                .map_err(db_err)?;
            let revision = check_revision(current.as_ref().map(|c| c.0), h.expected_revision, "habit")?;
            let created = current.as_ref().map_or(at, |c| c.1);
            let deleted_at = h.deleted.then(|| current.as_ref().and_then(|c| c.2).unwrap_or(at));
            tx.execute(
                "INSERT INTO habits(id,name,color,frequency,start_date,archived_at,sort,deleted_at,created,updated,revision)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,frequency=excluded.frequency,
                 start_date=excluded.start_date,archived_at=excluded.archived_at,sort=excluded.sort,
                 deleted_at=excluded.deleted_at,updated=excluded.updated,revision=excluded.revision",
                params![
                    h.id,
                    h.name.trim(),
                    h.color.to_lowercase(),
                    serde_json::to_string(&h.frequency).map_err(db_err)?,
                    h.start_date,
                    h.archived_at,
                    h.sort,
                    deleted_at,
                    created,
                    at,
                    revision + 1
                ],
            )
            .map_err(db_err)?;
            saved.habits.push(
                tx.query_row(&format!("SELECT {HABIT_COLUMNS} FROM habits WHERE id=?"), [&h.id], habit_row)
                    .map_err(db_err)?,
            );
        }
        for c in &changes.checkins {
            let exists: bool = tx
                .query_row("SELECT EXISTS(SELECT 1 FROM habits WHERE id=?)", [&c.habit_id], |r| r.get(0))
                .map_err(db_err)?;
            if !exists {
                return Err("This check-in's habit no longer exists.".into());
            }
            let id = checkin_id(&c.habit_id, &c.date);
            let current: Option<(i64, i64)> = tx
                .query_row("SELECT revision,created FROM habit_checkins WHERE id=?", [&id], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .optional()
                .map_err(db_err)?;
            let revision = check_revision(current.as_ref().map(|c| c.0), c.expected_revision, "check-in")?;
            let created = current.as_ref().map_or(at, |c| c.1);
            tx.execute(
                "INSERT INTO habit_checkins(id,habit_id,date,done,note,created,updated,revision) VALUES(?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET done=excluded.done,note=excluded.note,updated=excluded.updated,revision=excluded.revision",
                params![id, c.habit_id, c.date, c.done, c.note, created, at, revision + 1],
            )
            .map_err(db_err)?;
            saved.checkins.push(
                tx.query_row(&format!("SELECT {CHECKIN_COLUMNS} FROM habit_checkins WHERE id=?"), [&id], checkin_row)
                    .map_err(db_err)?,
            );
        }
        tx.commit().map_err(db_err)?;
        Ok(saved)
    }
}
