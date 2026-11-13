// Mirrors the engine's h, as probed on mod API 2.1.322: a function component runs at once with its children flattened, and its result is returned as is.
const stand = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => {
  const flat = children.flat(Infinity)
  if (typeof type === 'function') return type({ ...props, children: flat })
  return { type, props: { ...props, children: flat } }
}

Object.assign(globalThis, { h: stand, Fragment: 'Fragment' })
