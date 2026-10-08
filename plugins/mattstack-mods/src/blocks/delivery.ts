import type { EngineEventOf } from 'claude-code'
import type { Hub, ModApi } from '../core/hub.ts'
import type { Link } from '../core/link.ts'
import { trimClaudeOnlyReply } from './sections.ts'

type Render = EngineEventOf['ui.render']

/** A delivery rt's own writer wrapped (`wrapCrossSession` in rt): its sender label, logical delivery id and body. */
export type RtDelivery = { from: string; deliveryId: string; body: string }

/**
 * Rewrites a delivery's body before the model reads it. The router keeps the
 * envelope around whatever it returns, with the closing tag last: the model
 * doubts any text after that tag, as outside the message.
 */
export type DeliveryEdit = (api: ModApi, delivery: RtDelivery) => string | Promise<string>

/**
 * Trims the Claude-only half of the reply line, only in a conversation whose
 * prompt has carried the reply rule section since it started.
 */
export const trimReplyUnderSection: DeliveryEdit = async (api, delivery) =>
  (await api.state.sectionComposed.get()) === true ? trimClaudeOnlyReply(delivery.body) : delivery.body

type Parsed = RtDelivery & { lead: string; open: string; trail: string }

// Only a delivery carrying a delivery id is rt's chat: gate notices and other
// sessions' messages wrap without one, and pass through untouched.
const ENVELOPE = /^(\s*)(<cross-session-message from-name="([^"<>]*)" delivery-id="([^"<>]+)">)\n([\s\S]*)\n<\/cross-session-message>(\s*)$/
const CLOSE = '</cross-session-message>'
/** How many hidden bodies and reported ids the router remembers; older rows draw as the engine draws them. */
const REMEMBERED = 200

export function parseRtDelivery(text: string): Parsed | null {
  const m = ENVELOPE.exec(text)
  if (!m) return null
  const [, lead, open, from, deliveryId, body, trail] = m as unknown as [string, string, string, string, string, string, string]
  return { lead, open, from, deliveryId, body, trail }
}

function rebuild(d: Parsed, body: string): string {
  return `${d.lead}${d.open}\n${body}\n${CLOSE}${d.trail}`
}

function remember<T>(list: T[], value: T): void {
  list.push(value)
  if (list.length > REMEMBERED) list.splice(0, list.length - REMEMBERED)
}

/**
 * The `delivery` block: hands each rt delivery to the model (edited by
 * `edits`, in order), reports it to rt as consumed under its delivery id, and
 * draws its row as nothing outside the expanded view.
 */
export function registerDelivery(hub: Hub, link: Link, options: { edits?: readonly DeliveryEdit[] } = {}): void {
  const edits = options.edits ?? []
  const hidden: string[] = []
  const reported: string[] = []
  const reporting = new Set<string>()

  function log(api: ModApi, text: string): void {
    try {
      api.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not change what the router does.
    }
  }

  async function report(api: ModApi, deliveryId: string): Promise<void> {
    if (reported.includes(deliveryId) || reporting.has(deliveryId)) return
    reporting.add(deliveryId)
    try {
      const out = await link.call('session:delivered', { deliveryId })
      if (out.ok) remember(reported, deliveryId)
      else log(api, `delivery ${deliveryId} was not recorded as consumed (${out.error.code}: ${out.error.message})`)
    } catch (err) {
      log(api, `delivery ${deliveryId} was not recorded as consumed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      reporting.delete(deliveryId)
    }
  }

  function hides(e: Render): boolean {
    if (e.component !== 'UserMessage') return false
    const { text, origin, isExpanded } = e.props
    if (isExpanded || origin.kind !== 'peer') return false
    const shown = text.trim()
    return hidden.some(body => shown === body || shown.startsWith(`${body}\n`))
  }

  hub.block('delivery', async (_api, scope) => {
    scope.onReceive('rt-delivery', async (api, e, next) => {
      const delivery = parseRtDelivery(e.text)
      if (!delivery) return undefined
      let body = delivery.body
      for (const edit of edits) body = await edit(api, { from: delivery.from, deliveryId: delivery.deliveryId, body })

      // Marked before it is queued: the row can draw before next settles,
      // and a site is not drawn again unless its input changes.
      const mark = body.trim()
      remember(hidden, mark)
      const queued = await next(body === delivery.body ? e : { ...e, text: rebuild(delivery, body) })
      if (queued.consumed !== undefined) {
        const at = hidden.lastIndexOf(mark)
        if (at >= 0) hidden.splice(at, 1)
        return queued
      }
      const shown = parseRtDelivery(queued.text)?.body.trim()
      if (shown !== undefined && shown !== mark) remember(hidden, shown)
      void report(api, delivery.deliveryId)
      return queued
    })

    scope.onRender('UserMessage', async (api, e, next) => (hides(e) ? api.ui.blank(e) : next(e)))
  })
}
