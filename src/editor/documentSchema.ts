import { getSchema } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { markdownExtensions } from './markdown'

// Search validates immutable documents without constructing an editor. These
// extension sets are fixed; rebuilding their schemas for each body is needless.
let nativeSchema: ReturnType<typeof getSchema> | undefined
let markdownSchema: ReturnType<typeof getSchema> | undefined

export function documentSchema(markdown: boolean) {
  return markdown
    ? (markdownSchema ??= getSchema(markdownExtensions))
    : (nativeSchema ??= getSchema(writingExtensions))
}
