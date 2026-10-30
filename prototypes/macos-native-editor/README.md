# Native macOS editor experiment

This is a separate, disposable AppKit editor. It does not replace Stash's editor.
Edits stay in memory. The original library is read only when creating the fixture.

## Run

From the repository root:

```sh
npm run prototype:macos-editor
npm run bench:macos-editor
```

Requires macOS 15 or later, Xcode, installed project dependencies, and the existing
Performance test copy. `STASH_BENCH_LIBRARY` can select another SQLite library and
`STASH_BENCH_NOTE` can select a note ID. Unsupported nodes or marks stop import.
The exporter never changes the source database.

Run the benchmark analysis tests with `npm run test:macos-editor`. These use Node's
built-in test runner and are separate from the app's `npm test` Vitest suite.

Both commands print a private temporary directory. Reuse the frozen input with:

```sh
npm run prototype:macos-editor -- /absolute/path/to/stash-native-editor-RUN
npm run bench:macos-editor -- --run-dir /absolute/path/to/stash-native-editor-RUN
```

The screen must stay unlocked. The benchmark prevents idle display sleep during
its run and releases that assertion when it ends. It sends native events directly
to its owned windows, so another app taking focus does not receive test input.
Avoid editing the two test windows during the run. The paste test temporarily uses
the clipboard and restores it afterward. `--stage smoke` runs calibration and one
short comparison; `--stage prepare` builds without taking measurements. Ctrl+C
stops the owned test apps and active capture helper. Results are saved incrementally.

## What is compared

- Native `NSTextView` using TextKit 2, with no save path.
- Fresh optimized Stash with disk saving paused at the enqueue boundary. Its
  document serialization, model updates, React UI, and editor plugins still run.
- The same Stash build with its normal autosave.

Stash is compiled from a frozen source snapshot with a separate application ID,
scratch library, and benchmark-only control bridge. No installed app is replaced.
Its original source hashes and generated instrumentation are kept separately.

Both windows use the same outer dimensions, editor viewport, text width, font,
and saved spacing. The native editor reserves the space used by Stash's document
header. AppKit and WebKit still have small differences in font rasterization,
bullet placement, spacing, and rule length. The prototype matches the selected
Zen palette; other palettes are explicitly flagged.

The importer supports the chosen note's entire node set: headings, paragraphs,
nested bullets, hard breaks, rules, links, underline, and inline code. Validation
checks every source text range, mark attributes, and the exact list marker count.
TextKit fallback is checked on every control request and after every typing run.

## Measurement method

The same optimized Swift helper sends timestamped messages to a process-owned
CFMessagePort in each app. The shared receiver creates native NSEvent key events
and dispatches them to the editor window's responder. Paste uses its native paste
action; scrolling uses pixel wheel events dispatched to the view under the test
point. The receiver is compiled into the prototype and loaded only into the
temporary Stash build. It never sends global keyboard events or synthetic DOM
events. The helper captures only the owned window using ScreenCaptureKit.
For repeated X glyphs, it
finds the first captured frame containing each expected glyph using measured
caret advance. Tall caret columns and isolated thin runs are removed from the
pixel signal. A short document and a caret-only idle interval validate the
detector before the long-note trials.

These are **input-post to captured-frame response times** through this controlled
native input path. The global OS keyboard queue is bypassed, so these are not
physical keyboard-to-display measurements. Capture is requested at 120 Hz; the report
records the actual frame interval and capture status counts. Idle callbacks are
not counted as dropped display frames. Timing logs are buffered.
Paste timing means the first visible change, not completion of the whole paste.
Exact pasted text is checked separately. Scrolling metrics describe complete
captured frames and include frame gaps, rather than claiming a display FPS.

Five trials alternate app order at 1320x880 and 1800x1129 logical points. Typing
uses 54 X characters at 100 ms and 30 ms spacing at the top, middle, and bottom.
Each run resets the copied fixture and verifies text plus undo/redo. Paste and
scrolling also use five trials. CPU and memory use three separate passes without
screen capture, including Stash's renderer, GPU, and networking helper processes.
CPU is accumulated process CPU time divided by elapsed time; memory is summed
RSS, which can count shared pages more than once. The capture helper's footprint
and CPU are separate, and captured/uncaptured app CPU are compared.

The full command writes `report/comparison.md`, `report/aggregates.json`, metadata,
and raw measurements in the private run directory. Regenerate/export with:

```sh
node prototypes/macos-native-editor/report.mjs /absolute/run/directory /absolute/output/directory
node --test prototypes/macos-native-editor/analyze.test.mjs
```

The report refuses incomplete runs. Native import validation is available without
capture after building:

```sh
/absolute/run/directory/NativeEditor --fixture /absolute/run/directory/fixture.json --validate
```

WebKit helper IDs come from read-only diagnostic selectors in the disposable
build, following [WebKit's own MiniBrowser](https://github.com/WebKit/WebKit/blob/main/Tools/MiniBrowser/mac/WK2BrowserWindowController.m).
These private selectors are used only for local measurement and are not added to
production code.

## Boundaries

This tests a native editor engine, not a complete Stash replacement. Native JSON
export, saving, recovery, sync, slash commands, drawings, tables, images, PDF
workflows, and Android integration are outside this experiment. Results do not
establish the performance of a future integrated native editor or its save path.
Private fixtures and raw note content stay outside the repository; reports need
only metadata and measurements.
