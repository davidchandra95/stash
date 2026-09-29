import { getTextSerializersFromSchema, type Editor, type TextSerializer } from '@tiptap/core'
import { DOMSerializer, type ResolvedPos } from '@tiptap/pm/model'

// Only the clipboard uses tight list HTML. The document schema and saved HTML
// retain paragraphs so editing, paragraph attributes, and persistence stay intact.
export class ClipboardSerializer extends DOMSerializer {
  override serializeFragment(...args: Parameters<DOMSerializer['serializeFragment']>) {
    const dom = super.serializeFragment(...args)
    for (const item of dom.querySelectorAll('li[data-type="mixedListItem"]')) {
      const children = [...item.children]
      const paragraph = children[0]
      if (
        paragraph?.tagName === 'P' &&
        paragraph.childNodes.length > 0 &&
        paragraph.attributes.length === 0 &&
        children.slice(1).every((child) => child.matches('ul, ol'))
      ) {
        // A single text paragraph plus optional nested lists is a tight item.
        // Empty, styled, and multi-paragraph items carry real paragraph meaning.
        paragraph.replaceWith(...paragraph.childNodes)
      }
    }
    return dom
  }
}

// Use the original document for numbering and ancestry, even when a selection
// starts in the middle of a list. Only numbered siblings advance the UI counter.
function listContext(position: ResolvedPos) {
  let depth = 0
  let marker = ''
  let firstParagraph = false
  for (let d = 1; d <= position.depth; d++) {
    const item = position.node(d)
    if (item.type.name !== 'mixedListItem') continue
    depth++
    firstParagraph = d === position.depth && position.index(d) === 0
    if (item.attrs.kind === 'number') {
      const list = position.node(d - 1)
      let number = Number(list.attrs.start) || 1
      for (let i = 0; i < position.index(d - 1); i++) {
        if (list.child(i).attrs.kind === 'number') number++
      }
      marker = `${number}. `
    } else {
      marker = item.attrs.kind === 'task' ? `- [${item.attrs.checked ? 'x' : ' '}] ` : '- '
    }
  }
  return { depth, marker, firstParagraph }
}

export function clipboardText(editor: Editor): string {
  const { doc, selection, schema } = editor.state
  const serializers: Record<string, TextSerializer | undefined> =
    getTextSerializersFromSchema(schema)
  return [...selection.ranges]
    .sort((a, b) => a.$from.pos - b.$from.pos)
    .map(({ $from, $to }) => {
      const range = { from: $from.pos, to: $to.pos }
      // Copying a phrase should not introduce a bullet into the middle of text.
      // Selecting the entire text of an item still copies it as a list item.
      const phrase =
        $from.sameParent($to) &&
        $from.parent.isTextblock &&
        ($from.parentOffset > 0 || $to.parentOffset < $to.parent.content.size)
      const blocks: Array<ReturnType<typeof listContext> & { text: string }> = []
      let current: (typeof blocks)[number] | undefined
      doc.nodesBetween(range.from, range.to, (node, pos, parent, index) => {
        const serializer = serializers[node.type.name]
        if (node.isBlock && (node.isTextblock || node.isLeaf || serializer)) {
          current = { ...listContext(doc.resolve(pos)), text: '' }
          blocks.push(current)
        }
        if (serializer && parent) {
          if (current) current.text += serializer({ node, pos, parent, index, range })
          return false
        }
        if (node.isText && current) {
          current.text += node.text!.slice(Math.max(range.from, pos) - pos, range.to - pos)
        }
      })
      const depths = blocks.filter((block) => block.depth > 0).map((block) => block.depth)
      const baseDepth = depths.length ? Math.min(...depths) : 0
      return blocks
        .map((block) => {
          if (phrase || !block.depth) return block.text
          const indent = '    '.repeat(block.depth - baseDepth)
          const continuation =
            indent + ' '.repeat(Math.max(4, block.marker.startsWith('-') ? 2 : block.marker.length))
          const prefix = block.firstParagraph ? indent + block.marker : continuation
          // Preserve empty paragraphs without adding whitespace-only lines.
          if (!block.text && !block.firstParagraph) return ''
          return prefix + block.text.replace(/\n(?=.)/g, '\n' + continuation)
        })
        .join('\n')
    })
    .join('\n')
}
