import type { Notebook } from './model'
export function notebookPath(book: Notebook, books: Notebook[]): string {
  const names = [book.name],
    seen = new Set([book.id])
  let parent = book.parentId
  while (parent) {
    const next = books.find((b) => b.id === parent)
    if (!next || seen.has(next.id)) break
    names.unshift(next.name)
    seen.add(next.id)
    parent = next.parentId
  }
  return names.join(' / ')
}
export function orderedNotebooks(books: Notebook[]): Notebook[] {
  const result: Notebook[] = [],
    seen = new Set<string>()
  const visit = (parent: string | null) => {
    for (const book of books.filter((b) => (b.parentId ?? null) === parent)) {
      if (seen.has(book.id)) continue
      seen.add(book.id)
      result.push(book)
      visit(book.id)
    }
  }
  visit(null)
  return [...result, ...books.filter((b) => !seen.has(b.id))]
}

export function notebookDeleteScope(
  targetId: string,
  books: Notebook[],
  includeChildren: boolean,
): Notebook[] {
  const target = books.find((book) => book.id === targetId)
  if (!target) return []
  const result = [target]
  if (!includeChildren) return result
  for (let index = 0; index < result.length; index += 1) {
    const parent = result[index]
    result.push(...books.filter((book) => book.parentId === parent.id && !result.includes(book)))
  }
  return result
}

export function fileTitleError(title: string): string {
  const name = title.trim()
  if (!name || name === '.' || name === '..' || /[\x00-\x1f\x7f/\\:]/.test(name))
    return 'Use a filename without slashes, colons, or control characters.'
  if (new TextEncoder().encode(name).length > 251)
    return 'This filename is too long. Choose a shorter title.'
  return ''
}
