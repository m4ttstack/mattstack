const stand = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: { ...props, children } })

Object.assign(globalThis, { h: stand, Fragment: 'Fragment' })
