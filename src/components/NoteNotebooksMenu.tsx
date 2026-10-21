import { useRef, useState } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { ChevronDown, FolderInput, FolderPlus, Plus } from '../icons'
import { fontFamily } from '../fonts'
import type { Appearance } from '../model'
import { usesNativeContextMenu } from '../nativeContextMenu'
import MenuActionContent from './MenuActionContent'
import NativeNoteMenuButton from './NativeNoteMenuButton'
import type { NoteAction } from './NoteContextMenu'

/** One launcher under the note title for adding to and moving between notebooks. */
export default function NoteNotebooksMenu({
  noteId,
  file,
  appearance,
  disabled,
  onAdd,
  onMove,
  onError,
}: {
  noteId: string
  /** File-backed notes move their file, so the Move label says so. */
  file: boolean
  appearance: Appearance
  disabled: boolean
  onAdd: (launcher: HTMLElement) => void
  onMove: (launcher: HTMLElement) => void
  onError: (error: { message: string; retry: () => void }) => void
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  // Pickers anchor to and return focus to this button, not the menu item.
  const actions: NoteAction[] = [
    {
      label: 'Add to notebooks',
      icon: FolderPlus,
      run: (launcher) => onAdd(launcher ?? trigger.current!),
    },
    {
      label: file ? 'Move file to notebook' : 'Move to another notebook',
      icon: FolderInput,
      run: (launcher) => onMove(launcher ?? trigger.current!),
    },
  ]
  const content = (
    <>
      <Plus size={12} aria-hidden="true" />
      Notebooks
      <ChevronDown size={12} aria-hidden="true" />
    </>
  )
  if (usesNativeContextMenu())
    return (
      <NativeNoteMenuButton
        className="note-organization-button"
        label="Notebooks"
        data-move-note-id={noteId}
        actions={actions}
        disabled={disabled}
        onError={onError}
      >
        {content}
      </NativeNoteMenuButton>
    )
  return (
    <Dropdown.Root open={open} onOpenChange={setOpen}>
      <Dropdown.Trigger
        ref={trigger}
        className="note-organization-button"
        data-move-note-id={noteId}
        disabled={disabled}
      >
        {content}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="workspace-action-menu note-notebooks-menu"
          data-theme={appearance.dark ? 'dark' : 'light'}
          data-palette={appearance.theme}
          style={{ fontFamily: fontFamily(appearance.uiFont) }}
          align="start"
          sideOffset={5}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            // The chosen picker focuses its own search field.
            if (document.querySelector('.notebook-popover')) event.preventDefault()
          }}
        >
          {actions.map((action) => (
            <Dropdown.Item key={action.label} onSelect={() => action.run(trigger.current!)}>
              <MenuActionContent icon={action.icon} label={action.label} />
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
