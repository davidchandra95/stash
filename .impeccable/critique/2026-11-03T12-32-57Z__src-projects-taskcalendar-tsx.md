---
target: desktop calendar
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
target_identity: "file:/Users/slowtyper/code/upnote2/src/projects/TaskCalendar.tsx"
target_fingerprint: "sha256:0a1ab9aba4ea948566582acd76e8f3a4345b7e3035683159837f99b01766d8dd"
target_path: /Users/slowtyper/code/upnote2/src/projects/TaskCalendar.tsx
timestamp: 2026-11-03T12-32-57Z
slug: src-projects-taskcalendar-tsx
---
Method: two independent assessments (design review; detector and browser measurements)

## Design Health Score: 17/40
1 System status 1: gesture feedback is ISO text in the top-right status row, up to 617px from the pointer.
2 Real-world match 2: "Time point", "Entry time zone", "(+07:00)" on blocks.
3 Control and freedom 3: Undo and Esc are good; unapplied schedule edits are lost silently.
4 Consistency 2: input type=date beside DateField; Apply inside an autosaving panel; native select instead of .segmented; project colours unused.
5 Error prevention 1: moves shift the time; a 4-day task collapses to a point; resize can invert; due-task drop ignores the time.
6 Recognition 2: project name truncated off most blocks.
7 Flexibility 1: no shortcuts, no date jump.
8 Minimalist design 2: quiet but flat; 93px of avoidable chrome.
9 Error recovery 2: "Error: ..." text shifts layout and survives navigation.
10 Help 1: no first-use or gesture hints.

## Design specificity
LLM: partly specific. Geometry is Stash; content is generic grey boxes ignoring project colours, doing state and lateness.
Detector: CLI 0 findings on TaskCalendar, CalendarDraft, CalendarOptions. Overlay 4 findings, all false positives (clipped-overflow-container x3, repeating-stripes-gradient x1). calendar.css not scanned.

## Priority issues
- [P0] Moving a block ignores the grab point. Same-height move one day right changed Fri 10:00-12:00 to Sat 11:15-13:15. TaskCalendar.tsx:203-219, 341-344, 597-603. Fix: store grab offset at dragstart. Command: harden.
- [P0] Due-dated tasks cannot be time-blocked by drag. Drop on Thu 16:00 stays a due chip; announcement falsely says at 16:00; dated tasks excluded from Arrange. TaskCalendar.tsx:187, calendarLayout.ts:173. Fix: grid drop creates schedule and keeps deadline; all-day drop moves deadline; Arrange lists dated tasks without a schedule. Command: harden.
- [P1] No direct-manipulation feedback: no range band, drop ghost or live resize; resize can invert; 4-day task dropped on grid becomes a point. Fix: snapped in-grid ghost with time label, dimmed source, live resize clamped to 15 min, edge autoscroll. Command: animate.
- [P1] Week cannot be read at a glance: 0 computed style differences across projects, overdue vs future; multi-day repeats as chips; doing state absent; offset pushes project off. Fix: project tint and edge, HH:MM-HH:MM labels, offset only when zone differs, late text in danger, continuous all-day bars, distinct due markers. Command: colorize.
- [P1] Create and edit feel like forms: click floors to 15 min so a 30-minute cell gives 14:15; centred modal with 6-8 fields; Apply schedule loses edits; input type=date breaks DESIGN.md:198 (ScheduleEditor.tsx:109). Fix: click snaps to slot start; anchored popover beside a draft block with smart input; autosave; simplified schedule fields. Command: distill.
- [P2] Space and narrow layout: empty 42px pane-bar, 27px zone row, 24px + row (93px, about 1.7h). Detail panel causes 286px sideways scroll at 900x650 and hour gutter scrolls away. Fix: toolbar in pane-bar, zone only when different, + on hover, auto 3-day when narrow, detail and Arrange share one slot. Command: layout.
- [P2] Navigation: no keys, inert range label, inert day headers, view not persisted, Today does not scroll to now, landing fixed at 08:00. Fix: date popover on range, T/arrows/D/W/3/N, clickable day headers, persist view, scroll to now, .segmented. Command: harden.
- [P2] Overlaps: 4 lanes are 39px wide with no checkbox; More tasks jumps below midnight; 32px visual minimum counts as time. Fix: cascading overlaps with clickable gutter, density by width, anchored +N popover, layout by real time. Command: layout.

## Persona red flags
Power user: no navigation keys, no block menu or keyboard delete, selecting moves focus into title.
First-timer: no hint grid is clickable; Arrange tasks reads as reorder; Time point and Entry time zone; Apply schedule loses edits.
Keyboard: blocks cannot move or resize by keyboard; first timed task after 18 tabs; focus hidden behind sticky header for 4 presses; all-day overflow misaligns columns by up to 8.6px.

## Minor
Hour and half-hour lines identical; hour labels hang under lines; crosshair cursor; dark blocks show grid lines; no pressed state on Arrange/Options; 15-minute block renders 32px and clips 7px; hyphen in range; 24-hour hardcoded.
