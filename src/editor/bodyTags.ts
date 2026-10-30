import { platform } from '../platform'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { tagMatches, tagTone } from '../tags'
import { confirmedTag } from './tagMark'
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history'
import type { Node as PMNode } from '@tiptap/pm/model'

export interface BodyTagContext {
  open: (tag: string) => void
  tags?: () => string[]
}

const contexts = new WeakMap<Editor, BodyTagContext>()
export const bodyTagsKey = new PluginKey('bodyTags')

export function setBodyTagContext(editor: Editor, context: BodyTagContext) {
  contexts.set(editor, context)
}

function ranges(doc: PMNode) {
  const result: { from: number; to: number; tag: string; text: string }[] = []
  doc.descendants((node, pos) => {
    const tag = node.isText && node.marks.find((mark) => mark.type.name === 'bodyTag')?.attrs.tag
    if (!tag) return
    const previous = result.at(-1)
    if (previous?.to === pos && previous.tag === tag) {
      previous.to += node.nodeSize
      previous.text += node.text
    } else result.push({ from: pos, to: pos + node.nodeSize, tag, text: node.text! })
  })
  return result
}
function decorations(doc: PMNode) {
  return DecorationSet.create(
    doc,
    ranges(doc)
      .filter((range) => confirmedTag(range.text, range.tag))
      .map(({ from, to, tag }) =>
        Decoration.inline(from, to, {
          class: 'body-tag',
          'data-body-tag': tag,
          'data-tone': tagTone(tag),
          role: 'link',
          tabindex: '0',
          'aria-label': `Open tag #${tag}`,
          title: platform.mobile ? `Open #${tag}` : `Open #${tag} with Command-click`,
        }),
      ),
  )
}

export const BodyTags = Extension.create({
  name: 'bodyTags',
  priority: 1450,
  addProseMirrorPlugins() {
    const editor = this.editor
    type Candidate = { from: number; to: number; query: string }
    let candidate: Candidate | null = null
    let selected = 0
    let menu: HTMLDivElement | null = null
    let compositionFrame = 0
    const menuId = `body-tags-${crypto.randomUUID()}`
    const atCursor = (doc: PMNode, pos: number): Candidate | null => {
      const $pos = doc.resolve(pos)
      if (
        !$pos.parent.isTextblock ||
        $pos.parent.type.spec.code ||
        $pos.marks().some((mark) => mark.type.name === 'code')
      )
        return null
      const text = $pos.parent.textBetween(0, $pos.parent.content.size, '\n', '\ufffc')
      const match = tagMatches(text).find(
        (match) => match.from < $pos.parentOffset && match.to >= $pos.parentOffset,
      )
      return match
        ? { from: $pos.start() + match.from, to: $pos.start() + match.to, query: match.tag }
        : null
    }
    const options = () => {
      if (!candidate) return []
      const existing = [...new Set(contexts.get(editor)?.tags?.() ?? [])]
        .filter((tag) => confirmedTag(`#${tag}`, tag) && tag.includes(candidate!.query))
        .sort(
          (a, b) =>
            Number(b === candidate!.query) - Number(a === candidate!.query) || a.localeCompare(b),
        )
      return [
        ...existing.slice(0, 8).map((tag) => ({ tag, create: false })),
        ...(!existing.includes(candidate.query) ? [{ tag: candidate.query, create: true }] : []),
      ]
    }
    const dismiss = () => {
      candidate = null
      if (menu) menu.hidden = true
      editor.view.dom.removeAttribute('aria-activedescendant')
      editor.view.dom.removeAttribute('aria-controls')
    }
    const confirm = (index: number) => {
      const option = options()[index]
      if (!candidate || !option || !editor.isEditable) return
      const { from, to } = candidate
      dismiss()
      const original = editor.state.doc.textBetween(from, to)
      const text = confirmedTag(original, option.tag) ? original : `#${option.tag}`
      const tr = closeHistory(editor.state.tr).setMeta('bodyTagConfirm', true)
      if (text !== original) tr.insertText(text, from, to)
      tr.setSelection(TextSelection.create(tr.doc, from + text.length))
        .addMark(from, from + text.length, editor.schema.marks.bodyTag.create({ tag: option.tag }))
        .removeStoredMark(editor.schema.marks.bodyTag)
      editor.view.dispatch(tr)
      editor.view.dispatch(closeHistory(editor.state.tr))
      editor.view.focus()
    }
    const render = () => {
      if (!menu || !candidate || !editor.isEditable || editor.view.composing) {
        dismiss()
        return
      }
      const entries = options()
      selected = Math.min(selected, entries.length - 1)
      menu.replaceChildren()
      menu.hidden = false
      editor.view.dom.setAttribute('aria-controls', menuId)
      editor.view.dom.setAttribute('aria-activedescendant', `${menuId}-${selected}`)
      for (const key of ['theme', 'palette'])
        menu.setAttribute(
          `data-${key}`,
          editor.view.dom.closest(`[data-${key}]`)?.getAttribute(`data-${key}`) ?? '',
        )
      entries.forEach((entry, index) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'slash-option'
        button.id = `${menuId}-${index}`
        button.setAttribute('role', 'option')
        button.setAttribute('aria-selected', String(index === selected))
        button.textContent = entry.create ? `Create new tag "#${entry.tag}"` : `#${entry.tag}`
        button.title = button.textContent
        button.onpointermove = () => {
          selected = index
          editor.view.dom.setAttribute('aria-activedescendant', button.id)
          menu!
            .querySelectorAll('button')
            .forEach((row, i) => row.setAttribute('aria-selected', String(i === index)))
        }
        button.onmousedown = (event) => event.preventDefault()
        button.onclick = () => confirm(index)
        menu!.append(button)
      })
      const current = menu.querySelector<HTMLElement>('[aria-selected="true"]')
      if (current && current.offsetTop < menu.scrollTop) menu.scrollTop = current.offsetTop
      else if (
        current &&
        current.offsetTop + current.offsetHeight > menu.scrollTop + menu.clientHeight
      )
        menu.scrollTop = current.offsetTop + current.offsetHeight - menu.clientHeight
      const rect = editor.view.coordsAtPos(candidate.from)
      menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`
      menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`
    }
    return [
      new Plugin({
        key: bodyTagsKey,
        state: {
          init: (_, state) => decorations(state.doc),
          apply: (transaction, previous) => {
            const typed = transaction.getMeta('bodyTagTyping') as Candidate | undefined
            if (typed) {
              candidate = typed
              selected = 0
            } else if (
              !transaction.getMeta('bodyTagNormalize') &&
              (transaction.docChanged || transaction.selectionSet)
            )
              candidate = null
            return transaction.docChanged
              ? decorations(transaction.doc)
              : previous.map(transaction.mapping, transaction.doc)
          },
        },
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const invalid = ranges(state.doc).filter((range) => !confirmedTag(range.text, range.tag))
          transactions.forEach((transaction, index) => {
            if (
              !transaction.docChanged ||
              isHistoryTransaction(transaction) ||
              transaction.getMeta('bodyTagConfirm') ||
              transaction.getMeta('bodyTagNormalize')
            )
              return
            for (const range of ranges(transaction.before)) {
              let from = transaction.mapping.map(range.from, 1)
              let to = transaction.mapping.map(range.to, -1)
              if (from >= to || transaction.doc.textBetween(from, to) === range.text) continue
              // A full pasted replacement carries its own confirmation, not the old mark.
              if (transaction.getMeta('paste')) {
                let replaced = false
                transaction.mapping.maps.forEach((map) =>
                  map.forEach((start, end) => {
                    if (start <= range.from && end >= range.to) replaced = true
                  }),
                )
                if (replaced) continue
              }
              for (const next of transactions.slice(index + 1)) {
                from = next.mapping.map(from, 1)
                to = next.mapping.map(to, -1)
              }
              if (from < to) invalid.push({ ...range, from, to })
            }
          })
          if (!invalid.length) return null
          const tr = state.tr.setMeta('bodyTagNormalize', true)
          invalid.forEach(({ from, to }) => tr.removeMark(from, to, state.schema.marks.bodyTag))
          return tr
        },
        props: {
          handleTextInput(view, from, to, text) {
            if (!editor.isEditable || view.composing || !view.state.selection.empty) return false
            const $from = view.state.doc.resolve(from)
            if (
              $from.parent.type.spec.code ||
              $from.marks().some((mark) => mark.type.name === 'code')
            )
              return false
            const tr = view.state.tr.insertText(text, from, to)
            const pos = from + text.length
            const next = atCursor(tr.doc, pos)
            // Only typing starts a candidate, never paste, focus, or cursor movement.
            if (!next || /\s/u.test(text)) {
              dismiss()
              return false
            }
            tr.setMeta('bodyTagTyping', next)
            view.dispatch(tr)
            return true
          },
          handleKeyDown(_view, event) {
            if (!candidate || editor.view.composing || event.isComposing) return false
            if (event.key === 'Escape') {
              dismiss()
              return true
            }
            if (event.key === 'Enter') {
              confirm(selected)
              return true
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              const count = options().length
              selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
              render()
              return true
            }
            if (event.key === ' ' || event.key === 'Tab') dismiss()
            return false
          },
          handleDOMEvents: {
            paste: () => {
              dismiss()
              return false
            },
            blur: () => {
              dismiss()
              return false
            },
            compositionstart: () => {
              dismiss()
              return false
            },
            compositionend: () => {
              cancelAnimationFrame(compositionFrame)
              compositionFrame = requestAnimationFrame(() => {
                if (
                  editor.isDestroyed ||
                  !editor.isEditable ||
                  !editor.isFocused ||
                  editor.view.composing ||
                  !editor.state.selection.empty
                )
                  return
                candidate = atCursor(editor.state.doc, editor.state.selection.from)
                selected = 0
                render()
              })
              return false
            },
          },
          decorations: (state) => bodyTagsKey.getState(state),
        },
        view(view) {
          menu = document.createElement('div')
          menu.className = 'slash-menu body-tag-menu'
          menu.id = menuId
          menu.setAttribute('role', 'listbox')
          menu.setAttribute('aria-label', 'Tags')
          menu.hidden = true
          document.body.append(menu)
          const outside = (event: PointerEvent) => {
            if (!(event.target instanceof Node) || !menu?.contains(event.target)) dismiss()
          }
          document.addEventListener('pointerdown', outside)
          const onScroll = (event: Event) => {
            if (!(event.target instanceof Node) || !menu?.contains(event.target)) dismiss()
          }
          window.addEventListener('resize', dismiss)
          window.addEventListener('scroll', onScroll, true)
          let hoveredTag: Element | null = null
          let commandDown = false
          const setHoveredTag = (element: Element | null) => {
            if (hoveredTag !== element) hoveredTag?.classList.remove('body-tag-command-hover')
            hoveredTag = element
            hoveredTag?.classList.toggle('body-tag-command-hover', commandDown)
          }
          const pointerover = (event: PointerEvent) => {
            const target = event.target
            setHoveredTag(target instanceof Element ? target.closest('[data-body-tag]') : null)
            commandDown = event.metaKey
            hoveredTag?.classList.toggle('body-tag-command-hover', commandDown)
          }
          const pointerout = (event: PointerEvent) => {
            const next = event.relatedTarget
            setHoveredTag(
              next instanceof Element && view.dom.contains(next)
                ? next.closest('[data-body-tag]')
                : null,
            )
          }
          const modifier = (event: KeyboardEvent) => {
            commandDown = event.metaKey
            hoveredTag?.classList.toggle('body-tag-command-hover', commandDown)
          }
          const blur = () => {
            commandDown = false
            setHoveredTag(null)
          }
          const open = (element: Element | null) => {
            const tag = element?.getAttribute('data-body-tag')
            if (tag) contexts.get(editor)?.open(tag)
          }
          const click = (event: MouseEvent) => {
            const element = (event.target as Element).closest?.('[data-body-tag]')
            if (
              !element ||
              !(event.metaKey || event.ctrlKey || (platform.mobile && !editor.isFocused))
            )
              return
            event.preventDefault()
            event.stopPropagation()
            open(element)
          }
          const keydown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            const element = (event.target as Element).closest?.('[data-body-tag]')
            if (!element || event.target !== element) return
            event.preventDefault()
            event.stopPropagation()
            open(element)
          }
          // Capture these before ProseMirror treats Enter as a paragraph action.
          view.dom.addEventListener('click', click, true)
          view.dom.addEventListener('keydown', keydown, true)
          if (!platform.mobile) {
            view.dom.addEventListener('pointerover', pointerover)
            view.dom.addEventListener('pointerout', pointerout)
            document.addEventListener('keydown', modifier)
            document.addEventListener('keyup', modifier)
            window.addEventListener('blur', blur)
          }
          return {
            update: render,
            destroy() {
              cancelAnimationFrame(compositionFrame)
              menu?.remove()
              menu = null
              document.removeEventListener('pointerdown', outside)
              window.removeEventListener('resize', dismiss)
              window.removeEventListener('scroll', onScroll, true)
              blur()
              view.dom.removeEventListener('click', click, true)
              view.dom.removeEventListener('keydown', keydown, true)
              view.dom.removeEventListener('pointerover', pointerover)
              view.dom.removeEventListener('pointerout', pointerout)
              document.removeEventListener('keydown', modifier)
              document.removeEventListener('keyup', modifier)
              window.removeEventListener('blur', blur)
            },
          }
        },
      }),
    ]
  },
})
