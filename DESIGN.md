# Stash UI design

Stash should feel like a well-made Mac app: quiet, compact, precise. Chrome stays out of the
way so the note is the main content. Density comes from tight, consistent geometry, not from
small type. The writing surface is the one roomy place, and it follows the user's own
typography settings.

The reference mockups are `documents/ui-v2/mockup.html` (desktop) and
`documents/ui-v2/mobile-mockup.html` (Android). These rules cover both; [Android](#android)
lists what changes for touch. Shared components must keep working on both.

## Principles

1. **Native first.** Use macOS conventions: system font, traffic lights, translucent sidebar,
   accent-colored selection, native context menus, 42px unified toolbar rows.
2. **Compact by default.** 28px rows and controls, 2/4/6/8/12/16px spacing. Don't add padding
   to make something look important.
3. **One way to do each thing.** Tokens and shared classes own geometry and color. Area
   stylesheets own layout only.
4. **Quiet until needed.** Hover reveals secondary actions. Notices appear only for problems,
   progress and undo. Successful saves are silent.

## Where things live

| Area                     | Code                                                     | Styles                                              |
| ------------------------ | -------------------------------------------------------- | --------------------------------------------------- |
| Tokens, base, controls   | –                                                        | `src/styles/tokens.css`, `base.css`, `controls.css` |
| Menus, popovers, dialogs | Radix + `components/*`                                   | `src/styles/floating.css`, `dialogs.css`            |
| Window shell             | `src/App.tsx`, `src/app/WindowControls.tsx`              | `src/styles/shell.css`                              |
| Sidebar                  | `src/app/Sidebar.tsx`, `components/NotebookTree.tsx`     | `src/styles/sidebar.css`                            |
| Notes list               | `src/app/NoteListPane.tsx`, `components/VirtualNoteRows` | `src/styles/notelist.css`                           |
| Editor chrome            | `src/app/EditorPane.tsx`, `NoteDocument.tsx`             | `src/styles/editor.css`                             |
| Note content             | `src/editor/*`, `components/NoteEditor.tsx`              | `src/styles/document.css`                           |
| Writing tools and menus  | `components/DesktopWritingToolbar.tsx`, editor menus     | `src/styles/writing.css`                            |
| Command palette          | `components/CommandPalette.tsx`                          | `src/styles/palette.css`                            |
| Settings                 | `src/app/Settings.tsx`                                   | `src/styles/settings.css`                           |
| Android                  | `src/mobile/*`                                           | `src/mobile/index.css`, `src/mobile/mobile.css`     |
| PDF reader, drawings     | `src/pdf/*`, `src/drawing/*`                             | `src/pdf/pdf.css`, `src/drawing/drawing.css`        |

All workspace state and behavior lives in `src/app/useAppController.ts`. Views read it through
`useApp()` and render; they don't own workspace logic. Panes are wrapped in `trackApp()`
(`src/app/context.ts`), so they re-render only when a value they read while rendering changes.
Read controller values where they are used, and don't call functions that build new objects
during render (pass a function such as `() => app.actionsFor(note)` to menus instead).

## Tokens

Defined in `src/styles/tokens.css`. Never hard-code a color or size in a component stylesheet
when a token exists.

- **Type:** `--text-xs` 12 (counts, dates, section headers), `--text-sm` 13 (secondary),
  `--text-md` 14 (default UI), `--text-lg` 16, `--text-xl` 18 (palette input).
  `--font-ui` is the system font. The interface font is not configurable.
- **Geometry:** `--bar` 42px (pane title bars), `--row` 28px (sidebar rows), `--control` 28px
  (buttons, fields, icon buttons), `--control-sm` 22px, `--icon` 17px, `--icon-sm` 15px.
- **Spacing:** `--space-1…8` = 2, 4, 6, 8, 12, 16, 20, 24px.
- **Radii:** `--radius-xs` 4 (menu items), `-sm` 5 (rows), `-md` 6 (controls), `-lg` 8 (groups,
  menus), `-xl` 10 (popovers), `-2xl` 12 (dialogs, palette, settings).
- **Color roles:** surfaces `--bg-window`, `--bg-sidebar`, `--bg-sidebar-translucent`,
  `--bg-content`, `--bg-elevated` (menus, popovers, palette; translucent with blur),
  `--bg-input`, `--bg-control`, `--bg-code`. Text `--text`, `--text-2` (secondary),
  `--text-3` (tertiary: counts, dates, section headers), `--text-4` (disabled, placeholders on
  titles). Lines `--line`, `--line-strong`. Neutral fills `--fill-1` (hover), `--fill-2`
  (pressed/open), `--fill-3` (inactive selection). Status `--danger`, `--warning`,
  `--success`. Search `--mark`, `--mark-current`.
- **Accent:** `--accent` and `--on-accent` are set at runtime by `useDocumentTheme`
  (`src/appearance.ts`) from the user's accent choice. `system` follows the macOS accent color
  (read natively, refreshed when the window regains focus). Derived: `--accent-soft`,
  `--accent-text`, `--focus-ring`, `--text-selection`. Use the accent for active state
  (selection, focus, pressed tools), not for resting icons.
- **Notebook colors** are the `--notebook-*` presets in `src/notebookColors.ts`, each with a
  light and a dark value at matched lightness and chroma. Notebooks store the preset's light
  hex; paint them with `notebookColorValue()` so presets follow the color mode, older hexes map
  to the nearest preset, and custom colors are pulled slightly toward `--text`.
- **Color mode** is `<html data-theme="light|dark">`. Portaled menus and dialogs inherit it;
  never put `data-theme` on individual surfaces.

## Surfaces

- The sidebar is the only translucent pane. With the native Mac app and "Translucent sidebar"
  on, the window uses the macOS sidebar material and the page is transparent behind the
  sidebar (`:root[data-vibrancy]`). Otherwise it is `--bg-sidebar`.
- The notes list and editor are `--bg-content` with 1px `--line` dividers. No cards, no gaps.
- Floating surfaces (menus, popovers, palette, notices, tooltips) use `--bg-elevated`,
  backdrop blur and `--shadow-pop`. Dialogs and Settings use `--bg-content` and
  `--shadow-window`.
- PDF pages, drawings and authored note colors keep their own colors.
- **Cards layout** (Settings › Appearance › Layout, `appearance.layout = 'cards'`, desktop
  only): the window takes the sidebar tone and the notes list and editor become rounded panels
  (`--radius-xl`, `--shadow-card`) with 6px margins; note rows lose their dividers and get 2px
  gaps. A saved v1 "Modern cards" style migrates to it. Standard stays the default.
- Desktop scrollbars are thin (4px thumb in a 10px gutter) and use `--scrollbar-idle` until
  their scroll area is hovered (`--scrollbar-hover`); the thumb itself brightens to
  `--scrollbar-active` while hovered or dragged. Android keeps native scrollbars.

## Selection, hover, focus

- Sidebar view icons rest in `--text-2`; the selected row is `--fill-3` with an accent icon
  (`--text-2` while the window is inactive). Notebook icons keep their notebook color.
- Notes list selection: accent fill with `--on-accent` text while the list is the active pane
  (`.window[data-active-pane='list']`) and the window is key; otherwise `--fill-3`.
- Menus, palette rows and slash menus highlight with the accent fill.
- Hover is always a neutral `--fill-1`. Pressed or open controls use `--fill-2`.
- Cursors: clickable controls (buttons, tabs, menu items, options, links) show `pointer`;
  disabled ones fall back to `default`. Text stays `text`; body tags only switch to `pointer`
  while Command is held. During an active note or tab drag the whole window shows `grabbing`
  (`base.css`, keyed off `.note-drag-ghost` / `.tabs.is-reordering`). Splitters keep `col-resize`.
- Keyboard focus: a 2px `--focus-ring` outline. Text fields show focus with an accent border and
  a soft accent ring instead.
- A row whose context menu is open gets an inset accent outline.
- Radix tooltip triggers overwrite `data-state`, so style open popup buttons with
  `[aria-haspopup][aria-expanded='true']`, not `[data-state='open']`.

## Window layout

- Three columns: sidebar (default 232px), notes list (300px), editor. Widths are saved; pane
  resizers are invisible until focused.
- No global title bar. Each pane has a 42px `.pane-bar` that is also a window drag region
  (`data-tauri-drag-region` on the bar and on empty filler elements).
- The leftmost visible pane hosts the window controls: 70px traffic-light clearance in the native
  app (`--window-controls`), the sidebar toggle, and, in the editor when the notes list is
  hidden, the notes-list toggle.
- Sidebar bar: traffic lights and the sidebar toggle. Notes bar: view title, count, "Sort and
  view options" menu, New note. Editor bar: Back/Forward, tabs, note controls (Focus mode, Table
  of contents, Find in note, Note actions).
- Focus mode hides the sidebar and notes list. A PDF tab hides the notes list.
- The sidebar footer holds sync status, Trash and Settings. There is no account menu.
- Settings opens centered and can be dragged by its title bars, staying inside the window; it
  re-centers each time it opens.

## Components

Use the shared classes before writing new CSS:

- Buttons: `.btn` (push button), `.btn-primary`, `.btn-danger`, `.btn-plain`, `.btn-link`,
  `.btn-sm`; `.icon-btn` (24px) and `.icon-btn-sm` (20px).
- Fields: `.field` for plain inputs; `.field-shell` for an input with an icon or trailing
  buttons (the shell owns the border, the inner input has none). Labels `.field-label`, help
  `.field-help`, errors `.field-error`.
- Toggles: `button.switch[role=switch][aria-checked]`. Segmented control `.segmented` with
  `aria-pressed` buttons. Native `<select>` in Settings (`.select-native`); `.select` for a
  custom popup trigger.
- Menus: Radix content `.menu`, items `.menu-item` containing `.menu-icon`, `.menu-text`,
  optional `.menu-shortcut`; `.menu-separator`, `.menu-label`. `MenuActionContent` renders icon
  and text.
- Popovers `.popover`; dialogs `.dialog` with `.dialog-header`, `.dialog-title`,
  `.dialog-description`, `.dialog-body`, `.dialog-footer` (buttons right-aligned, primary last).
- Notices: `.notice` inside `.notices` at the bottom of the window, for errors with Retry,
  progress, and Undo.
- Chips `.chip` for tags and notebook memberships; counts `.count`; key hints `kbd`.
- Icons are Lucide through `src/icons.tsx` (stroke 1.6, sized by CSS). On macOS, note and
  notebook context menus, Note actions and writing action lists use native menus
  (`src/nativeContextMenu.ts`); keep their actions identical to the Radix menus.
- All hover hints use `AppTooltip`. Icon-only buttons pass `instant`; everything else uses the
  700ms delay.

## Writing surface

- Note typography is the user's: `--note-font`, `--title-font`, `--code-font`, `--note-size`,
  `--line-spacing`, `--paragraph-spacing`, `--list-item-spacing`, heading style variables, and
  `--writing-width` (percentage of the scroll pane). Defaults: system fonts, 15px, 1.6.
- Above the title: a meta line with the edited date, word count and save problems. Below the
  title: notebook chips and the "Notebook" menu chip.
- The formatting toolbar floats beside the selection (above it, or below near the top edge) and
  shows only while the editor has focus and a selection, or while one of its pickers is open.
  "Always show formatting toolbar" docks it at the bottom center. It is at most 460px wide;
  lower-priority tools move to its overflow menu.
- The editor's caret and selection are drawn by layers (`.writing-cursor-layer`,
  `.selection-highlight`); native selection paint stays transparent in editable notes.
- Find in note sits under the editor bar; the table of contents docks on the right or overlays
  when the pane is narrow.

## Behavior that must not regress

- Note list clicks open a replaceable preview tab (italic title); editing or double-clicking keeps
  it. Tabs can be pinned and reordered (drag after 6px, or Ctrl+Shift+Left/Right).
- The sidebar view, pane widths, list mode, sorting, tabs and contents width are workspace
  preferences restored on launch.
- Autosave is silent; failures, conflicts and preview-only storage are always visible.
- Command palette: Cmd/Ctrl+P titles, Tab toggles note text, `>` for commands,
  Cmd/Ctrl+Enter opens in a new tab. Trash is excluded.
- Reduced motion and the Animations setting disable transitions (`:root[data-motion='off']`).
- Showing or hiding the sidebar, notes list or focus mode never animates grid columns. The grid
  snaps to its final columns and panes slide with transforms (`src/layoutMotion.ts`), so the
  editor lays out its text once, not on every frame.
- Panes scroll natively; the page itself never scrolls.

## Android

Android uses the same tokens, color roles, accent and color mode, at touch size.
`src/mobile/index.css` loads the shared stylesheets (all but the sidebar and command palette),
then `src/mobile/mobile.css`, which raises the geometry and type tokens and lays out the mobile
surfaces. Don't add colors there; use the tokens.

- **Touch tokens** (on `html[data-platform='mobile']`): `--text-md` 16, `--text-sm` 14,
  `--text-lg` 18; `--bar` 56, `--row` 48, `--control` 44, `--control-sm` 36, `--icon` 22,
  `--target` 48, `--radius-sheet` 16.
- **Targets:** anything that acts on tap is at least 48px (`--target`); rows and fields are at
  least 44px. Controls that draw smaller (push buttons, switches, swatches) extend their tap
  area with a transparent `::before`.
- **Feedback:** touch screens keep `:hover` after a tap, so mobile neutralizes hover fills under
  `(hover: none)` and shows pressed states (`:active`) instead: `--fill-1` on rows, `--fill-2`
  in sheets and on buttons.
- **App bar:** 56px, 48px round icon buttons. In a note the bar is only the drawer and Note
  actions buttons, on `--fill-1`.
- **Drawer** is the desktop sidebar: `--bg-sidebar`, the same view icons (`--text-2`, accent when
  selected), notebook colors kept, selection `--fill-3`, counts follow "Show note counts".
- **Bottom sheets** (note, notebook and list actions) are floating surfaces: `--bg-elevated`,
  blur, `--shadow-pop`, 16px top radius, 48px rows with 20px `--text-2` icons. They sit above
  the keyboard and center at 560px wide on wide screens. Dialogs stay centered in the space
  above the keyboard.
- **Note:** the formatting bar floats above the keyboard on `--bg-elevated-solid` (no blur, so
  the writing-tools sheet inside it isn't clipped) and scrolls sideways. The table of contents
  is an overlay panel. Mobile keeps the native caret and selection.
- **Settings** are pages with the desktop Settings content and groups, minus desktop-only items
  (translucent sidebar, writing width, formatting toolbar, cursor drawing, shortcuts). Sliders
  stack under their label.
- Keep the safe-area padding, the visual-viewport variables (`--mobile-height`, `--mobile-top`,
  `--mobile-bottom`) and the short-screen rules that keep a writing line visible with the
  keyboard open in landscape.

## Review checklist

- Check 1280×800 and 900×650 in light and dark, with two or more accent colors.
- For Android changes, check `?mobile=1` at 390×844 and 844×390 in light and dark, plus a short
  viewport (about 844×260) for the keyboard-open case.
- Check the sidebar hidden, notes list hidden, focus mode, a PDF with notes, and Settings at a
  narrow width.
- Check hover, selection (active and inactive pane), keyboard focus, disabled and error states,
  and menus opened from both the mouse and the keyboard.
- Run `npm test` and `npm run build`. Report browser-preview checks and native-app checks
  separately; a browser preview doesn't show vibrancy, traffic lights or native menus.
- Update this file when an approved change alters these conventions.
