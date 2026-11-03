import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { colorModeIcons, colorModes } from '../appearance'
import AppTooltip from '../components/AppTooltip'
import { ChevronLeft, ChevronRight, Search } from '../icons'
import type { ColorMode } from '../model'
import { trackApp, useApp, useBlocked } from './context'
import RadioItems from './RadioItems'
import { NoteListToggle, SidebarToggle } from './WindowControls'

function AppearanceMenu() {
  const app = useApp()
  const blocked = useBlocked()
  const { appearance } = app
  const Icon = colorModeIcons[appearance.colorMode]
  return (
    <Dropdown.Root>
      <AppTooltip instant label="Appearance" disabled={blocked}>
        <Dropdown.Trigger asChild>
          <button className="icon-btn" aria-label="Appearance" disabled={blocked}>
            <Icon aria-hidden="true" />
          </button>
        </Dropdown.Trigger>
      </AppTooltip>
      <Dropdown.Portal>
        <Dropdown.Content className="menu" align="end" sideOffset={4} collisionPadding={8}>
          <RadioItems<ColorMode>
            label="Appearance"
            labels={colorModes}
            value={appearance.colorMode}
            onChange={(colorMode) => app.setAppearance({ ...appearance, colorMode })}
          />
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

/** The window's global toolbar: window controls, Back/Forward and search across both areas. */
export default trackApp(function AppBar({ onSearch }: { onSearch: () => void }) {
  const app = useApp()
  const blocked = useBlocked()
  const { history } = app
  const listToggle = !app.noteListVisible && !app.workspace.documentId && !app.projectView
  return (
    <header className="app-bar" data-tauri-drag-region>
      <div className="app-bar-side" data-tauri-drag-region>
        <span className="window-controls-space" data-tauri-drag-region />
        <SidebarToggle />
        {listToggle && <NoteListToggle />}
      </div>
      <div className="app-bar-center">
        <div className="history-buttons">
          <AppTooltip
            instant
            label="Back"
            shortcut={app.shortcutFor('back')}
            disabled={blocked || !history.canBack}
          >
            <button
              className="icon-btn"
              aria-label="Go back"
              disabled={blocked || !history.canBack}
              onClick={() => history.move(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
          </AppTooltip>
          <AppTooltip
            instant
            label="Forward"
            shortcut={app.shortcutFor('forward')}
            disabled={blocked || !history.canForward}
          >
            <button
              className="icon-btn"
              aria-label="Go forward"
              disabled={blocked || !history.canForward}
              onClick={() => history.move(1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </AppTooltip>
        </div>
        <button className="app-search" onClick={onSearch} disabled={blocked}>
          <Search aria-hidden="true" />
          <span className="app-search-label">Search notes and projects</span>
          <kbd aria-hidden="true">{app.shortcutFor('quick-open')}</kbd>
        </button>
      </div>
      <div className="app-bar-side app-bar-end" data-tauri-drag-region>
        <AppearanceMenu />
      </div>
    </header>
  )
})
