import type { ClientElements, RenderElement } from 'claude-code'

import type { Look } from '../draw/render'
import { sp, type Line } from '../draw/text'

// A kit component's lines carry string actions: keys into the render's handlers.
export type KitLine = Line<string>

export type KitCtx = {
  width: number
  focused: boolean
  // A key for `run`, unique to this component and stable while the tree keeps its shape.
  bind: (name: string, run: () => void) => string
  // The kit components and text among `nodes`, each kit one with a ctx of its own; `view` overrides this ctx's width or focus for them.
  parts: (nodes: unknown, view?: Partial<View>) => Part[]
  layout: (nodes: unknown, view?: Partial<View>) => KitLine[]
}

type View = { width: number; focused: boolean }

export type Part = { text: string } | { component: KitComponent<any>; props: any; ctx: KitCtx }

export type KitComponent<P> = ((props: P) => RenderElement) & { toLines: (props: P, ctx: KitCtx) => KitLine[] }

export type Frame = { elements: Pick<ClientElements, 'Box' | 'Text'>; look: Look; width: number; focused: boolean }

type Render = Frame & {
  entries: Map<string, { component: KitComponent<any>; props: unknown }>
  next: number
  handlers: Map<string, () => void>
  lines?: KitLine[]
}

let current: Render | undefined

export function rendering(tag: string): Render {
  if (!current) throw new Error(`kit: <${tag}> draws only inside kitClient`)
  return current
}

// Runs `draw` with a fresh table for the kit components it evaluates; returns the Panel's lines and their handlers with the tree.
export function drawKit<T>(frame: Frame, draw: () => T): { tree: T; lines: KitLine[]; handlers: Map<string, () => void> } {
  const outer = current
  const render: Render = { ...frame, entries: new Map(), next: 0, handlers: new Map() }
  current = render
  try {
    const tree = draw()
    return { tree, lines: render.lines ?? [], handlers: render.handlers }
  } finally {
    current = outer
  }
}

// The engine's h runs a component before its parent and hands the parent only the nodes it returned,
// so a kit component returns a keyed Box marker and leaves its props in the render's table for the Panel to lay out.
export function kitComponent<P>(tag: string, toLines: (props: P, ctx: KitCtx) => KitLine[]): KitComponent<P> {
  const component = (props: P): RenderElement => {
    const render = rendering(tag)
    const key = `kit:${render.next++}`
    render.entries.set(key, { component: kit, props })
    const { Box } = render.elements
    return <Box key={key} />
  }
  const kit = Object.assign(component, { toLines })
  return kit
}

export function textOf(children: unknown): string {
  if (Array.isArray(children)) return children.map(textOf).join('')
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  return ''
}

export function ctxFor(render: Render, owner: string, view: View): KitCtx {
  const ctx: KitCtx = {
    ...view,
    bind: (name, run) => {
      const key = `${owner}:${name}`
      render.handlers.set(key, run)
      return key
    },
    parts: (nodes, over) => partsOf(render, nodes, { ...view, ...over }),
    layout: (nodes, over) => ctx.parts(nodes, over).flatMap(part => ('text' in part ? [[sp(part.text)]] : part.component.toLines(part.props, part.ctx))),
  }
  return ctx
}

type Node = { type?: unknown; props?: { key?: unknown; children?: unknown }; children?: unknown }

// A node that is no marker but has children (a fragment, a Box) is walked through; a leaf engine element cannot become lines.
function partsOf(render: Render, nodes: unknown, view: View): Part[] {
  const out: Part[] = []
  const walk = (node: unknown): void => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node === 'string' || typeof node === 'number') {
      out.push({ text: String(node) })
      return
    }
    const el = node as Node
    const key = el.props?.key
    const entry = typeof key === 'string' ? render.entries.get(key) : undefined
    if (entry && typeof key === 'string') {
      out.push({ component: entry.component, props: entry.props, ctx: ctxFor(render, key, view) })
      return
    }
    const inner = el.children ?? el.props?.children
    if (inner === undefined) throw new Error(`kit: a Panel lays out kit components and text, not a ${String(el.type)} element`)
    walk(inner)
  }
  walk(nodes)
  return out
}
