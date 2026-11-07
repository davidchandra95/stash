use super::habits::*;
use super::*;

fn habit(id: &str) -> SaveHabit {
    SaveHabit {
        id: id.into(),
        name: " Read a book ".into(),
        color: "#3F9C2F".into(),
        frequency: HabitFrequency::Daily,
        start_date: "2026-11-01".into(),
        archived_at: None,
        sort: 1.0,
        deleted: false,
        expected_revision: 0,
    }
}
fn checkin(habit_id: &str, date: &str, note: &str) -> SaveCheckin {
    SaveCheckin { habit_id: habit_id.into(), date: date.into(), done: true, note: note.into(), expected_revision: 0 }
}
fn changes(habits: Vec<SaveHabit>, checkins: Vec<SaveCheckin>) -> HabitChanges {
    HabitChanges { habits, checkins }
}

#[test]
fn habits_and_checkins_round_trip_with_revisions() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let saved = store
        .save_habit_changes(&changes(vec![habit("h")], vec![checkin("h", "2026-11-03", "Read “ABC”, ch. 1–3")]))
        .unwrap();
    assert_eq!(saved.habits[0].name, "Read a book");
    assert_eq!(saved.habits[0].color, "#3f9c2f");
    assert_eq!(saved.habits[0].revision, 1);
    assert_eq!(saved.checkins[0].id, "h_20261103");
    assert_eq!(saved.checkins[0].note, "Read “ABC”, ch. 1–3");

    // Unchecking keeps the note; a stale revision is rejected.
    let update = SaveCheckin { done: false, expected_revision: 1, ..checkin("h", "2026-11-03", "Read “ABC”, ch. 1–3") };
    let saved = store.save_habit_changes(&changes(vec![], vec![update.clone()])).unwrap();
    assert_eq!((saved.checkins[0].done, saved.checkins[0].revision), (false, 2));
    assert!(store.save_habit_changes(&changes(vec![], vec![update])).unwrap_err().contains("changed"));

    let weekly = SaveHabit { frequency: HabitFrequency::Weekly { times: 3 }, expected_revision: 1, ..habit("h") };
    store.save_habit_changes(&changes(vec![weekly], vec![])).unwrap();
    let data = store.habit_data().unwrap();
    assert_eq!(data.habits[0].frequency, HabitFrequency::Weekly { times: 3 });
    assert_eq!(data.checkins.len(), 1);
    let json = serde_json::to_value(&data.habits[0]).unwrap();
    assert_eq!(json["frequency"], serde_json::json!({"kind": "weekly", "times": 3}));
}

#[test]
fn invalid_habits_and_checkins_reject_the_whole_batch() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    for bad in [
        SaveHabit { name: "  ".into(), ..habit("h") },
        SaveHabit { name: "x".repeat(201), ..habit("h") },
        SaveHabit { color: "green".into(), ..habit("h") },
        SaveHabit { frequency: HabitFrequency::Weekdays { days: vec![] }, ..habit("h") },
        SaveHabit { frequency: HabitFrequency::Weekdays { days: vec![1, 1] }, ..habit("h") },
        SaveHabit { frequency: HabitFrequency::Weekdays { days: vec![8] }, ..habit("h") },
        SaveHabit { frequency: HabitFrequency::Weekly { times: 0 }, ..habit("h") },
        SaveHabit { frequency: HabitFrequency::Weekly { times: 8 }, ..habit("h") },
        SaveHabit { start_date: "2026-02-30".into(), ..habit("h") },
        SaveHabit { id: "x".repeat(120), ..habit("h") },
    ] {
        assert!(store.save_habit_changes(&changes(vec![bad, habit("ok")], vec![])).is_err());
    }
    assert!(store.habit_data().unwrap().habits.is_empty());
    store.save_habit_changes(&changes(vec![habit("h")], vec![])).unwrap();
    assert!(store.save_habit_changes(&changes(vec![], vec![checkin("missing", "2026-11-03", "")])).unwrap_err().contains("no longer exists"));
    assert!(store.save_habit_changes(&changes(vec![], vec![checkin("h", "2026-13-01", "")])).is_err());
    assert!(store.save_habit_changes(&changes(vec![], vec![checkin("h", "2026-11-03", &"x".repeat(2001))])).unwrap_err().contains("2,000"));
    // Multi-line notes are allowed.
    store.save_habit_changes(&changes(vec![], vec![checkin("h", "2026-11-03", "Line one\nLine two")])).unwrap();
}

#[test]
fn version_eighteen_upgrade_adds_habits_without_requeueing() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    store
        .conn
        .execute_batch("DROP TABLE habit_checkins; DROP TABLE habits; DELETE FROM sync_dirty; PRAGMA user_version=18;")
        .unwrap();
    drop(store);
    let mut store = Store::open(dir.path()).unwrap();
    assert_eq!(store.conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap(), 20);
    let dirty: i64 = store.conn.query_row("SELECT COUNT(*) FROM sync_dirty", [], |r| r.get(0)).unwrap();
    assert_eq!(dirty, 0);
    store.save_habit_changes(&changes(vec![habit("h")], vec![checkin("h", "2026-11-03", "")])).unwrap();
    let queued: Vec<String> = store
        .conn
        .prepare("SELECT kind FROM sync_dirty ORDER BY kind")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(|k| k.unwrap())
        .collect();
    assert_eq!(queued, ["habit", "habitCheckin"]);
}
