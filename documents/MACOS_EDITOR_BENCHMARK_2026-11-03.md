# macOS editor benchmark - 3 November 2026

> **Typing results withdrawn:** Follow-up analysis found that the character
> detector was sensitive to pixel thresholds and could include animated caret
> pixels. The typing response numbers and comparisons below are preserved as
> historical results, not reliable measurements. A corrected investigation is
> recorded below. Paste, scrolling, and resource measurements use different
> methods, but retain the limitations described below. See the follow-up below
> for a corrected, narrower typing comparison.

## Follow-up - 4 November 2026

The earlier detector could count moving caret pixels or wait until a later
keystroke. The Stash test line could also overlap the floating formatting
toolbar. The updated test hides caret pixels in the temporary benchmark app,
centers the test line when possible, and uses a midpoint between character
endpoints. Cursor logic still runs. Single-character checks on short and long
documents passed for both editors, and the capture area was visually checked.

The follow-up reran the middle of the same large note at 1800 x 1129 points,
with 100 ms between keys and three trials per condition. It did not repeat the
entire original benchmark. Each row pools 162 character responses.

| Editor | Median | p95 |
|---|---:|---:|
| Native, in memory | 17.5 ms | 26.0 ms |
| Stash, saving paused | 43.8 ms | 46.5 ms |
| Stash, autosave | 41.7 ms | 46.5 ms |

Changing the threshold by one tenth of a character advance in either direction
did not change these pooled medians, and no response was detected before its
input callback or after the following key. Capture frames were about 16.6 ms
apart, which limits timing precision. As before, this is a controlled input
path, not physical keyboard-to-display latency. The installed app itself was not
measured, and the native prototype has fewer features and no save path.

In separate Stash-only runs with screen capture disabled, timing hooks measured
the synchronous editor dispatch at a median of about 7 ms per character on the
large note, compared with 1-2 ms on a short control document. The library note
update was about 3 ms on the large note and below the roughly 1 ms timer
resolution on the short document. Its calls are included inside the dispatch
time and must not be added to it. Three runs of 54 characters were recorded for
each note size and save condition. These hooks add some overhead.

Additional large-note runs showed about 2 ms in subscriber notification within
the library update; note normalization was typically below 1 ms, and save
enqueue was typically below 1 ms. The body-tag plugin's individual timings
were also usually below the timer's 1 ms resolution. These measurements do not
establish what accounts for the entire captured-frame delay: WebKit rendering,
compositing, capture, and unmeasured work remain possible contributors.

The deeper profile found one specific repeated cost. Every edit clears the
cached `hasTasks` value, and the library's navigation projection checks for tasks
by running `JSON.stringify` over the whole note. In two large-note passes per
save condition, this check ran once per typed character and had a median of
about 2 ms. It runs inside the subscriber notification and library update
times above, not in addition to them. This is a measurable contributor to the
large-note cost, not a complete explanation of the captured-frame difference.
The deeper profile used temporary hooks in a separate instrumented source copy;
no production editing code was changed.

Corrected diagnostic raw data is in the private temporary directory
`/var/folders/7x/28v67v_n7_7c2674m9q2tzq00000gn/T/stash-native-editor-1oJB80`.
The separate temporary profiling build and results are in
`/tmp/stash-profile-igStWZ`. Both directories contain private fixture data and
may be removed by the operating system.

## Original results - typing figures withdrawn

The original test reported that the native prototype responded faster to typing and used less CPU and memory than Stash. Its typing ratio of 2.2 to 4.0 times is withdrawn because the detector was unreliable. The paste, scrolling, CPU, and memory measurements used different methods and are retained below with their original limits.

This is evidence that the editing experience on a large note has room for improvement. It does not establish the cause of the difference or the performance of a complete native Stash editor. The native prototype has fewer features and does not save edits.

## What was tested

- **Stash autosave:** an instrumented, optimized Tauri build from a frozen snapshot of the current checkout, using a separate scratch library and the normal autosave path.
- **Stash saving paused:** the same build, with disk saving paused at the enqueue boundary. Document serialization, in-memory updates, React, and editor plugins still run.
- **Native:** a separate AppKit `NSTextView` prototype using TextKit 2, with edits kept in memory.

The installed Stash app was not directly measured, and its exact source cannot be confirmed from this run. The source snapshot was based on commit `2006b25` plus the checkout's uncommitted changes. Its snapshot SHA-256 was `0fe51b8ff8c778f154d9c88b3d58013f26aa9cdaf44ab49d58b316e97aa32b1e`.

The fixture was a frozen copy of a large note: 149,481 characters, 90 headings, and 2,160 list items. It included nested bullets, links, underline, inline code, hard breaks, and horizontal rules. Both editors used the same fixture and matched viewport and text widths. The native prototype did not exactly match the workspace palette or all heading styles; list spacing, rendering, and rule lengths also differed.

The machine was a MacBook Pro with an Apple M5 Pro, 24 GB of memory, and macOS 26.6.2. Other applications were running during the test.

## Original typing response - withdrawn

Times are milliseconds from posting a controlled native input event to the first captured frame showing the new character. They do not include the global operating system keyboard queue or measure physical keyboard-to-display latency. Lower is better. **p95** is the time at or below which 95% of measured responses fell.

Each row combines 810 character responses: five trials each at the top, middle, and bottom of the note, with 54 characters per trial. The test alternated editor order between trials. Window sizes are in logical points.

| Window size | Time between keys | Editor | Median | p95 | Range of trial medians |
|---|---:|---|---:|---:|---:|
| 1320 x 880 | 100 ms | Native | 15.2 ms | 23.9 ms | 12.2-19.2 ms |
| 1320 x 880 | 100 ms | Stash, saving paused | 44.2 ms | 137.3 ms | 34.4-70.6 ms |
| 1320 x 880 | 100 ms | Stash, autosave | 39.4 ms | 137.2 ms | 35.6-67.5 ms |
| 1320 x 880 | 30 ms | Native | 15.8 ms | 23.8 ms | 14.8-16.1 ms |
| 1320 x 880 | 30 ms | Stash, saving paused | 34.7 ms | 45.4 ms | 33.6-36.0 ms |
| 1320 x 880 | 30 ms | Stash, autosave | 34.1 ms | 45.8 ms | 33.3-35.2 ms |
| 1800 x 1129 | 100 ms | Native | 17.7 ms | 24.5 ms | 14.9-18.6 ms |
| 1800 x 1129 | 100 ms | Stash, saving paused | 70.3 ms | 138.2 ms | 45.8-71.4 ms |
| 1800 x 1129 | 100 ms | Stash, autosave | 70.8 ms | 139.8 ms | 69.2-72.8 ms |
| 1800 x 1129 | 30 ms | Native | 14.4 ms | 24.1 ms | 13.6-15.9 ms |
| 1800 x 1129 | 30 ms | Stash, saving paused | 39.5 ms | 73.8 ms | 35.8-42.5 ms |
| 1800 x 1129 | 30 ms | Stash, autosave | 39.7 ms | 74.1 ms | 35.9-41.0 ms |

At 1800 points and 100 ms between keys, the middle of the note was a particularly slow case: the median was 18.6 ms for native, 84.7 ms for Stash with saving paused, and 91.2 ms for Stash with autosave. Similar delays with saving paused indicate that disk saving alone does not explain this case. They do not identify which remaining part of the editing path is responsible.

## Paste, scrolling, and resource use

Paste is the time until the first visible change after a 10,240-byte ASCII paste, not the time until the whole paste is complete. Five paste and scroll trials were run for each condition and window size. Scroll values are the median, p95, and largest gaps between complete captured frames. These gaps include capture and compositor behavior and do not prove the number of frames dropped on the display.

CPU and memory are medians from three separate typing passes without screen capture. CPU is accumulated process CPU time divided by elapsed time; 100% represents one fully used core. Memory is summed resident memory (RSS), which can count shared pages more than once. Stash includes its renderer, GPU, and networking helper processes. These are whole-application measurements with different feature sets.

| Window width | Editor | Paste median / p95 | Scroll frame gaps: median / p95 / largest | CPU | Memory |
|---|---|---:|---:|---:|---:|
| 1320 | Native | 25.7 / 34.1 ms | 16.7 / 18.7 / 36.3 ms | 6.0% | 118.7 MiB |
| 1320 | Stash, saving paused | 60.7 / 121.0 ms | 16.7 / 18.3 / 33.3 ms | 38.2% | 631.1 MiB |
| 1320 | Stash, autosave | 67.7 / 121.9 ms | 16.7 / 18.0 / 34.2 ms | 40.1% | 719.0 MiB |
| 1800 | Native | 24.9 / 37.2 ms | 16.6 / 17.5 / 34.0 ms | 7.0% | 125.7 MiB |
| 1800 | Stash, saving paused | 54.9 / 69.6 ms | 16.7 / 17.3 / 33.8 ms | 34.6% | 798.2 MiB |
| 1800 | Stash, autosave | 51.5 / 59.1 ms | 16.7 / 17.3 / 34.2 ms | 36.6% | 809.4 MiB |

## Validation and limits

- All 9,720 typed characters, all 30 pastes, and typing undo/redo checks passed. Scrolling was checked for viewport movement. The native importer checked all source text ranges and mark attributes, plus all 2,160 list markers. TextKit 2 stayed active during the test.
- The capture requested 120 Hz, but complete frames arrived about 16.7 ms apart. That limits timing precision to roughly one captured-frame interval, so small differences and ratios should be interpreted with care.
- Results are from one large note, one machine, and normal background activity. They do not predict performance for every note or device.
- Native saving, export, recovery, sync, integration, slash commands, images, tables, drawings, PDFs, and Android were not measured. The native prototype is not a complete Stash replacement.
- The first run completed the 1320-point typing trials, then stopped when its original Stash scroll target did not move the viewport. A temporary resume script kept those results and aimed Stash scroll input at the viewport center. The remaining trials ran in a second session, and all final scroll checks passed.
- The current appearance schema had changed since the benchmark was written. The private fixture gained legacy `theme` and `dark` fields derived from its existing settings. The original note and installed app were not changed.

## Repeating the test

The benchmark implementation and its general method are in [the native editor prototype](../prototypes/macos-native-editor/README.md). The unmodified benchmark needs updates for the current appearance schema and Stash scroll target before it can reproduce this run. Its report template also contains older appearance details, so check generated reports against the actual fixture.

The private run directory for this measurement is `/var/folders/7x/28v67v_n7_7c2674m9q2tzq00000gn/T/stash-native-editor-pzL7sj`. It contains the fixture, temporary resume script, raw measurements, and corrected report. It is temporary and may be removed by the operating system; it contains private note data and should not be committed or shared as-is.

For a follow-up, update the benchmark for the current app, then profile the slow large-note typing case with saving paused. Compare the same case before and after any change, and separately test normal-sized notes and a complete save path.
