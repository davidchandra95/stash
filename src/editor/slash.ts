import { isMarkdownEditor, markdownCommandAllowed } from './markdownContext'
import { hideMenu } from '../motion'
import { referenceMatch } from './noteReferences'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { runCommand } from './commands'
import { slashCatalog, searchSlash, type SlashEntry } from './slashCatalog'
import { menuIcon } from './menuIcon'
export const slashKey = new PluginKey('writingSlash')
export const Slash = Extension.create({
  name: 'writingSlash',
  priority: 1400,
  addProseMirrorPlugins() {
    const editor = this.editor
    let dismissed: number | null = null,
      selected = 0,
      lastQuery = '',
      category: string | null = null,
      rootSelected = 0,
      active = true
    let menu: HTMLDivElement | null = null
    const match = () => {
      const { $from, empty } = editor.state.selection
      if (
        referenceMatch(editor) ||
        !empty ||
        !$from.parent.isTextblock ||
        $from.parent.type.spec.code ||
        $from.marks().some((mark) => mark.type.name === 'code') ||
        editor.view.composing
      )
        return null
      const text = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc'),
        result = /(^|\s)\/([^/\n]*)$/.exec(text)
      if (!result) return null
      const from = $from.start() + result.index + result[1].length
      return dismissed === from ? null : { from, to: $from.pos, query: result[2].toLowerCase() }
    }
    const entries = (): SlashEntry[] => {
      const m = match()
      if (!m) return []
      const filter = (entries: SlashEntry[]): SlashEntry[] =>
        entries.flatMap((entry) => {
          if (entry.children) {
            const children = filter(entry.children)
            return children.length ? [{ ...entry, children }] : []
          }
          return !entry.command || markdownCommandAllowed(entry.command) ? [entry] : []
        })
      const all = slashCatalog(editor.isActive('table'))
      const catalog = isMarkdownEditor(editor) ? filter(all) : all
      if (m.query) return searchSlash(catalog, m.query)
      return category
        ? (catalog.find((entry) => entry.id === category)?.children ?? catalog)
        : catalog
    }
    const position = () => {
      const m = match()
      if (!m || !menu || menu.hidden) return
      const rect = editor.view.coordsAtPos(m.from),
        height = menu.offsetHeight,
        width = menu.offsetWidth || 228
      menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
      menu.style.top = `${Math.max(8, rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 5 : rect.top - height - 5)}px`
    }
    const choose = (index: number) => {
      const m = match(),
        entry = entries()[index]
      if (!m || !entry) return
      if (entry.children) {
        rootSelected = index
        category = entry.id
        selected = 0
        render()
        return
      }
      if (entry.command && runCommand(editor, entry.command, m)) {
        dismissed = m.from
        category = null
        render()
      }
    }
    const back = () => {
      category = null
      selected = rootSelected
      render()
    }
    const render = () => {
      if (!menu) return
      const m = match()
      if (!m || !active) {
        hideMenu(menu)
        return
      }
      if (m.query !== lastQuery) {
        selected = 0
        category = null
        lastQuery = m.query
      }
      const options = entries()
      menu.replaceChildren()
      if (!options.length) hideMenu(menu)
      else menu.hidden = false
      if (!options.length) return
      selected = Math.min(selected, options.length - 1)
      menu.dataset.theme =
        editor.view.dom.closest('[data-theme]')?.getAttribute('data-theme') ?? 'light'
      menu.dataset.palette =
        editor.view.dom.closest('[data-palette]')?.getAttribute('data-palette') ?? 'classic'
      menu.classList.toggle(
        'slash-menu-dates',
        category === 'dates' || options.some((entry) => entry.command?.startsWith('date-')),
      )
      if (category && !m.query) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'slash-back'
        button.setAttribute('aria-label', 'Back to commands')
        button.append(
          menuIcon('back'),
          document.createTextNode(slashCatalog().find((e) => e.id === category)?.label ?? 'Back'),
        )
        button.onmousedown = (e) => e.preventDefault()
        button.onclick = back
        menu.append(button)
      }
      options.forEach((entry, index) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'slash-option'
        button.id = `writing-command-${index}`
        const label = entry.path ? `${entry.path} / ${entry.label}` : entry.label
        button.setAttribute('role', 'option')
        button.setAttribute('aria-label', label)
        button.setAttribute('aria-selected', String(index === selected))
        if (entry.children) button.setAttribute('aria-haspopup', 'listbox')
        const icon = menuIcon(entry.icon)
        if (entry.color) {
          icon.style.color = entry.color
          icon.classList.add('slash-color-icon')
        }
        const text = document.createElement('span')
        text.className = 'slash-label'
        if (entry.path) {
          const path = document.createElement('span')
          path.className = 'slash-path'
          path.textContent = `${entry.path} / `
          text.append(path)
        }
        text.append(document.createTextNode(entry.label))
        button.append(icon, text)
        if (entry.children) {
          const arrow = menuIcon('chevron')
          arrow.classList.add('slash-chevron')
          button.append(arrow)
        }
        button.onmousedown = (e) => e.preventDefault()
        button.onclick = () => choose(index)
        button.onmouseenter = () => {
          selected = index
          menu
            ?.querySelectorAll('.slash-option')
            .forEach((row, i) => row.setAttribute('aria-selected', String(i === index)))
        }
        menu!.append(button)
      })
      position()
      const current = menu.querySelector<HTMLElement>('[aria-selected="true"]')
      if (current) {
        if (current.offsetTop < menu.scrollTop) menu.scrollTop = current.offsetTop
        else if (current.offsetTop + current.offsetHeight > menu.scrollTop + menu.clientHeight)
          menu.scrollTop = current.offsetTop + current.offsetHeight - menu.clientHeight
      }
    }
    return [
      new Plugin({
        key: slashKey,
        props: {
          handleDOMEvents: {
            blur: () => {
              if (menu) hideMenu(menu)
              return false
            },
            focus: () => {
              active = true
              render()
              return false
            },
          },
          handleKeyDown: (_view, event) => {
            if (event.isComposing || editor.view.composing) return false
            const m = match()
            if (!m) return false
            if (event.key === 'Escape') {
              dismissed = m.from
              category = null
              render()
              return true
            }
            if (event.key === 'ArrowLeft' && category && !m.query) {
              back()
              return true
            }
            const options = entries()
            if (!options.length) return false
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              selected =
                (selected + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
              render()
              return true
            }
            if (
              event.key === 'Enter' ||
              (event.key === 'ArrowRight' && options[selected]?.children)
            ) {
              choose(selected)
              return true
            }
            return false
          },
        },
        view: () => {
          menu = document.createElement('div')
          menu.className = 'slash-menu'
          menu.setAttribute('role', 'listbox')
          menu.setAttribute('aria-label', 'Writing commands')
          menu.hidden = true
          document.body.append(menu)
          const deactivate = () => {
            active = false
            if (menu) hideMenu(menu)
          }
          editor.view.dom.addEventListener('writing-deactivate', deactivate)
          window.addEventListener('resize', position)
          document.addEventListener('scroll', position, true)
          return {
            update: () => {
              const { $from } = editor.state.selection
              if (!$from.parent.textContent.includes('/')) dismissed = null
              render()
            },
            destroy: () => {
              editor.view.dom.removeEventListener('writing-deactivate', deactivate)
              window.removeEventListener('resize', position)
              document.removeEventListener('scroll', position, true)
              menu?.remove()
              menu = null
            },
          }
        },
      }),
    ]
  },
})
