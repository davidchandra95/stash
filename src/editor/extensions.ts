import { KeyboardShortcuts } from './shortcuts'
import { FindInNote, NavigationReveal } from './noteTools'
import Code from '@tiptap/extension-code'
import { Collapsible, CollapsibleHeader, CollapsibleBody } from './collapsibles'
import { TextStyleKit } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { MixedList, MixedListItem } from './mixedLists'
import { InlineCheckbox, ContainerColors, SessionImage, ReadableColor } from './richNodes'
import { ImageClipboard } from './images'
import { ShortcutStarterKit as StarterKit } from './shortcuts'
import { TableKit } from '@tiptap/extension-table'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Placeholder from '@tiptap/extension-placeholder'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { common, createLowlight } from 'lowlight'
import { Typing } from './typing'
import { NoteReference } from './noteReferences'
import { BodyTags } from './bodyTags'
import { Slash } from './slash'
import { Clipboard } from './clipboard'
import { CursorLayer } from './cursor'
import { SelectionHighlight } from './selectionHighlight'
import { Drawing } from '../drawing/node'
export const writingExtensions = [
  Drawing,
  KeyboardShortcuts,
  CursorLayer,
  SelectionHighlight,
  FindInNote,
  NavigationReveal,
  StarterKit.configure({
    codeBlock: false,
    code: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: {
      listTypes: [{ itemName: 'mixedListItem', wrapperNames: ['mixedList'] }],
    },
    link: { openOnClick: false, protocols: ['file', 'upnote2'] },
  }),
  TableKit.configure({ table: { resizable: true } }),
  CodeBlockLowlight.configure({
    lowlight: createLowlight(common),
    defaultLanguage: 'plaintext',
    exitOnTripleEnter: false,
    enableTabIndentation: true,
  }),
  MixedList,
  MixedListItem,
  Collapsible,
  CollapsibleHeader,
  CollapsibleBody,
  Placeholder.configure({ placeholder: 'Write something, or type / for commands' }),
  Code.extend({ excludes: '', addKeyboardShortcuts: () => ({}) }),
  TextStyleKit.configure({ color: false }),
  ReadableColor,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Subscript.extend({ addKeyboardShortcuts: () => ({}) }),
  Superscript.extend({ addKeyboardShortcuts: () => ({}) }),
  InlineCheckbox,
  ContainerColors,
  SessionImage,
  ImageClipboard,
  Highlight.extend({ addKeyboardShortcuts: () => ({}) }).configure({ multicolor: true }),
  Typography,
  Typing,
  BodyTags,
  Slash,
  NoteReference,
  Clipboard,
]
