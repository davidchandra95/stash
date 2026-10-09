import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { renderMermaid } from './mermaid'

const isMermaid = (language: unknown) =>
  typeof language === 'string' && language.trim().toLowerCase() === 'mermaid'

export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, editor }) => {
      let current = node
      const diagram = isMermaid(node.attrs.language)
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      pre.append(code)
      const languageClass = () => {
        code.className = current.attrs.language
          ? `${this.options.languageClassPrefix}${current.attrs.language}`
          : ''
      }
      languageClass()
      if (!diagram)
        return {
          dom: pre,
          contentDOM: code,
          update(next) {
            if (next.type !== current.type || isMermaid(next.attrs.language)) return false
            current = next
            languageClass()
            return true
          },
        }

      const dom = document.createElement('div')
      dom.className = 'mermaid-block'
      const preview = document.createElement('div')
      preview.className = 'mermaid-preview'
      preview.contentEditable = 'false'
      preview.setAttribute('role', 'figure')
      preview.setAttribute('aria-label', 'Mermaid diagram')
      dom.append(pre, preview)
      let alive = true
      let version = 0
      let timer: ReturnType<typeof setTimeout>
      let appearance = ''
      const appearanceKey = () => {
        const style = getComputedStyle(editor.view.dom)
        return [
          style.fontFamily,
          ...['--text', '--code', '--muted', '--link'].map((token) =>
            style.getPropertyValue(token),
          ),
          editor.view.dom.closest('[data-theme]')?.getAttribute('data-theme'),
        ].join('\n')
      }
      const message = (text: string, error = false) => {
        const status = document.createElement('span')
        status.setAttribute('role', 'status')
        status.textContent = text
        preview.replaceChildren(status)
        preview.classList.toggle('mermaid-error', error)
      }
      const observer = new MutationObserver(() => {
        if (appearance !== appearanceKey()) schedule()
      })
      const schedule = () => {
        clearTimeout(timer)
        const request = ++version
        const source = current.textContent
        preview.setAttribute('aria-busy', String(!!source.trim()))
        if (!source.trim() || !preview.querySelector('svg'))
          message(
            source.trim() ? 'Rendering diagram…' : 'Write Mermaid code above to see a diagram.',
          )
        timer = setTimeout(async () => {
          appearance = appearanceKey()
          observer.disconnect()
          // Editor sessions can start detached and later move between hosts.
          for (
            let parent: HTMLElement | null = editor.view.dom;
            parent;
            parent = parent.parentElement
          )
            observer.observe(parent, {
              attributes: true,
              attributeFilter: ['data-theme', 'data-palette', 'style', 'class'],
            })
          if (!source.trim()) return
          try {
            const svg = await renderMermaid(source, editor.view.dom)
            if (alive && request === version) {
              preview.innerHTML = svg
              preview.classList.remove('mermaid-error')
            }
          } catch (error) {
            if (alive && request === version)
              message(
                `Unable to render diagram.\n${error instanceof Error ? error.message : String(error)}`,
                true,
              )
          } finally {
            if (alive && request === version) preview.setAttribute('aria-busy', 'false')
          }
        }, 200)
      }
      schedule()
      return {
        dom,
        contentDOM: code,
        update(next) {
          if (next.type !== current.type || !isMermaid(next.attrs.language)) return false
          const changed = next.textContent !== current.textContent
          current = next
          languageClass()
          if (changed) schedule()
          return true
        },
        ignoreMutation(mutation) {
          return mutation.type !== 'selection' && preview.contains(mutation.target)
        },
        destroy() {
          alive = false
          version++
          clearTimeout(timer)
          observer.disconnect()
        },
      }
    }
  },
})
