export const fonts: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, sans-serif',
  helvetica: '"Helvetica Neue", sans-serif',
  avenir: '"Avenir Next", sans-serif',
  georgia: 'Georgia, serif',
  palatino: 'Palatino, serif',
  menlo: 'Menlo, monospace',
  monaco: 'Monaco, monospace',
  courier: '"Courier New", monospace',
}

// Prefix installed families so their names cannot collide with legacy preset IDs.
export function fontFamily(value: string): string {
  if (!value.startsWith('font:')) return fonts[value] ?? fonts.system
  const name = value
    .slice(5)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\n\r\f]/g, ' ')
  return `"${name}"`
}
