// A Client posts { type: 'engaged' } on a click or key; the mod reads the post here and keeps its own atom.
export function isEngaged(e: { data: unknown }): boolean {
  return (e.data as { type?: unknown } | null)?.type === 'engaged'
}
