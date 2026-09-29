# Stash UI design

Stash is a compact desktop notes app with a touch-friendly mobile interface. Keep navigation and controls quiet, readable, and consistent so the note remains the main content. Preserve the user's chosen palette, app style, and fonts.

## Shared sizing

The `--ui-*` variables at the start of `src/styles.css` are the implementation source for UI geometry. They live on the document root so dialogs and menus rendered through portals receive the same sizes. Touch-friendly defaults are overridden by `:root[data-platform='desktop']`. Use the platform attribute, not window width, to choose input-target sizes.

| Element                          | Desktop                               | Token                                     |
| -------------------------------- | ------------------------------------- | ----------------------------------------- |
| Main UI text / line height       | 13px / 18px                           | `--ui-font-size`, `--ui-line-height`      |
| Supporting text                  | 12px                                  | `--ui-font-small`                         |
| Counts, dates, shortcuts         | 11px                                  | `--ui-font-meta`                          |
| Dialog and page titles           | 18px                                  | `--ui-font-title`                         |
| UI icons / secondary indicators  | 16px / 14px                           | `--ui-icon`, `--ui-icon-small`            |
| Form controls and action buttons | At least 30px                         | `--ui-control-height`                     |
| Icon and toolbar buttons         | At least 28px square                  | `--ui-target`                             |
| Navigation and menu rows         | At least 28px high                    | `--ui-menu-height`                        |
| Simple settings rows             | At least 44px, including padding      | `--ui-settings-row`                       |
| Settings rows with descriptions  | At least 56px, including padding      | `--ui-settings-description`               |
| Settings control column          | 160px, constrained by available width | `--ui-settings-column`                    |
| App-style / color-mode previews  | 48px / 40px                           | `--ui-preview-style`, `--ui-preview-mode` |
| Ordinary dialog padding          | 20px                                  | `--ui-dialog-padding`                     |

Use the 4, 8, 12, 16, and 24px spacing scale (`--ui-space-1/2/3/4/6`). Menu containers have 4px padding; controls and menu items use their shared padding tokens. Settings groups have 16px horizontal padding and 16px section gaps. Item wrappers do not add another layer of vertical padding around setting rows.

The desktop Settings dialog is at most 780px wide with a 200px sidebar. A quiet divider separates the sidebar from the content; below 700px, the stacked layout uses a horizontal divider. Keep each pane's intended scrolling behavior.

Desktop notebook disclosure controls are a compact navigation exception: use a 16px-wide column with a centered 12px chevron, retaining the 28px minimum target height. The notebook icon follows the disclosure column without extra left padding, with a 4px gap between the notebook icon and title. Leaf placeholders use the same column width. Keep the 14px child indentation, visible muted chevrons, and individual hover and keyboard-focus states. Mobile disclosure targets and notebook spacing retain the shared touch sizing.

Desktop navigation and notebook note counts sit directly beside their labels in a quiet, rounded badge. Hide zero counts. Keep notebook badges and both action buttons visible when a long title truncates. Show a New note button immediately before the three-dot menu button on row hover, keyboard focus, or while the menu is open; selection alone does not reveal them. The New note button creates a note in that notebook, and the menu keeps its New note action. Mobile drawer counts keep their existing layout.

The desktop Notes-pane heading uses the same badge beside its title for the current filtered note count. Hide the badge when the filtered list is empty, and let long titles truncate while the badge remains visible.

Desktop workspace pane boundaries are keyboard-focusable resize separators below the title bar. Keep their visual divider quiet until hover or focus, preserve a useful writing area when widths are clamped, and share the resulting CSS widths with the title bar. Navigation and Notes-pane titles must stay on one line and use ellipsis instead of widening or wrapping a narrow pane. Saved pane widths are workspace preferences; mobile does not render these separators.

The desktop table of contents has the same quiet, keyboard-focusable resize boundary. Its saved width is a workspace preference, temporarily clamped in narrow windows to leave at least 280px for the document. Mobile keeps its overlay width and has no resize boundary.

Desktop note-list clicks use one replaceable preview tab with an italic title. Double-clicking a note row or its preview tab, or editing the note title or body, keeps that tab open. Ctrl/Cmd-click and explicit new-tab actions open permanent tabs. Keep the preview state when restoring the workspace, and preserve each tab's Back/Forward history.

The desktop navigation pane has an independently scrolling content area and a fixed bottom account control. Its default avatar and name form one button. The compact account menu opens above it and contains Sync, Trash with its count, and Settings. Keep the footer itself free of extra status labels. Mobile navigation retains its separate drawer pattern.

Quick access, Notebooks, and Tags have independent disclosure buttons in the desktop navigation pane. Their headings stay visible when closed, and the New notebook button stays beside the Notebooks heading. Closing a section only hides its contents; it does not change the selected view or reset nested notebook disclosure state.

Use radii by purpose: 4px for menu items, 6px for controls, 8px for groups and popovers, and 12px for dialogs. Modern cards retains separate workspace panels with 8px gaps and 4px gaps between note cards. Changing app style must not enlarge menus or controls.

Use minimum heights for rows and controls that contain text. Long labels, descriptions, errors, and custom fonts must be able to increase their height. Keep titles, metadata, and action buttons visible in note rows; use 8px vertical padding. Workspace headers remain 36px high. The 44px macOS title bar and native traffic-light clearance are separate platform constraints.

## Surfaces and states

- Use the existing semantic roles: `--surface-app` for the workspace background, `--surface-panel` for navigation/list panes, `--surface-editor` for writing, `--surface-card` for note cards, and `--surface-floating` for dialogs and menus.
- Scrollbars in navigation and Notes panes stay visible but quiet: use a transparent track, a narrow rounded thumb based on `--line`, and only brighten it through existing semantic theme tokens on hover.
- Use `--text`, `--soft`, and `--muted` for text hierarchy. Use the selected palette's `--accent`, `--nav-active-bg`, and `--selection`; avoid adding palette-specific colors for ordinary controls.
- Settings groups should be close to the surrounding dialog color: mix 4% text color into `--surface-floating`. Search fields, selectors, font pickers, and heading rows use a slightly stronger mix of the same surface instead of the workspace `--bg`; mobile settings controls derive that mix from `--surface-panel`. Separate settings with a subtle 8% text-color divider. Keep previews representative of their actual palette and layout.
- Default desktop note lists use 1px `--line` dividers inset to the row text. Show dividers only between unselected notes, with no trailing divider. Modern cards and mobile retain their existing separation.
- Provide visible hover, selected, keyboard-focus, disabled, and error states. Selection must remain visible in neutral palettes. Keep focus rings on individual buttons inside compound controls; text fields may share a shell focus ring.
- Note and notebook rows keep their hover background while their context menu is open. Selected rows keep their selected background instead.
- Account menu actions use the shared menu row geometry and the current palette. Surface sync failures in the workspace alert area after the menu closes; keep progress visible during sync.
- Keep existing reduced-motion behavior. Size changes must not change animation timing, menu placement logic, or focus restoration.

## Component patterns

On macOS, note context menus, the editor’s Note actions three-dot menu, and notebook action menus use the native system menu through Tauri. macOS owns their surface, sizing, highlight color, and icon tint, independent of the app palette. Menu icons use monochrome outline SF Symbols marked as AppKit template images so they follow light, dark, selected, and disabled states. The React interface also uses SF Symbols on macOS, loaded from AppKit through the shared icon mapping and tinted by the current UI color. Browser and Android use Lucide icons from the same mapping. Keep each platform's icons within the shared UI sizing rules, and use an older available symbol or a fallback when the system lacks a newer symbol. Do not use colored stock folder or document images. Preserve actions, disabled states, shortcuts, keyboard opening, and row highlighting during menu tracking. Browser, mobile, and other platforms retain the themed Radix menus.

Reuse the existing React components and Radix behavior. Shared CSS classes own visual geometry; feature-specific rules own layout. Edit the relevant existing rule instead of appending competing blanket overrides.

```css
/* A form control can grow with its label and inherits mobile sizing. */
.example-control {
  min-height: var(--ui-control-height);
  padding: var(--ui-control-padding);
  border-radius: var(--ui-radius-control);
  font-size: var(--ui-font-size);
  line-height: var(--ui-line-height);
}
```

A setting uses a `.setting-row` containing a label span and a trailing control. Put explanatory text in `small` inside the label span so the description-row minimum applies. Controls align to the shared column, while switches keep their intrinsic visual size. Use `.text-field-shell` for compound search inputs: the shell owns the border and height, and its nested `.text-field` does not add padding again.

Keep Radix titles, labels, keyboard navigation, scrolling, focus return, and disabled semantics. Multi-line menu/search results grow naturally. Icons should not determine the row height. Limit any icon-sizing rule to interface controls so note content and illustrations retain their own sizes.

## Mobile and writing boundaries

Mobile uses at least 48px action targets and 44px form/menu targets, including portals outside `.mobile-app`. Small checkbox or switch graphics can sit inside a larger clickable label. Retain safe-area and virtual-keyboard handling. Shared styles load before mobile styles so explicit mobile layout rules win.

At narrow widths, let settings controls wrap and keep categories and dialog actions reachable. A narrow desktop window still uses desktop density. Long content should scroll inside its intended pane instead of widening the page.

Editor content is a separate typography system. Preserve note/title/code fonts, heading styles, note size, line and paragraph spacing, writing width, checklists, and cursor geometry. Compact UI tokens apply to the editor's tools, not the document. Typography previews intentionally show the user's content styles.

List item spacing applies consistently between sibling items and across indent levels for bullets, numbered lists, and checklists. Nested lists do not add an extra bottom margin. Preserve the separate spacing around a whole list and between paragraphs within an item.

List markers follow the first text line's baseline. Bullets and numbers inherit its typography and use natural height. List and inline checkboxes share a one-em square centered halfway up the font's capital height (`cap`), with a zero-height inline anchor so the graphic does not add line spacing. Keep at least a 22px checkbox click area independent of the graphic, and allow the list gutter to grow with larger text. Do not add font-specific offsets or align markers to the full height of a wrapped item.

When selected text intersects a bullet or numbered list item, highlight its marker with the system selection background and readable marker text. Clear that marker highlight when the selection collapses. Checklist boxes keep their checked and unchecked appearance.

## Review checklist

- Compare matching before/after screenshots at 1280×800 and 900×650; also check the settings breakpoint below 700px.
- Inspect every settings category, ordinary dialogs, menus, search, notebook organization, sync forms, and editor tools. Check long labels, descriptions, empty/error states, disabled actions, focus visibility, Escape, and focus return.
- Check all palettes in light and dark modes and both Default and Modern cards layouts. Confirm that theme and typography choices remain independent.
- Check mobile at 390×844 and landscape, including portal menus, form targets, safe areas, and scrolling. No horizontal page overflow or inaccessible actions.
- Run the existing frontend tests and production build. Add behavioral tests when markup or interaction changes need coverage; do not use CSS-text assertions as a substitute for rendered checks.
- Report browser and rebuilt native-bundle verification separately. A browser preview or successful build does not prove the installed app was updated. Keep release/install actions explicit.
