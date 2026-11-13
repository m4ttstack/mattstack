import type { On } from 'claude-code'

import { BRAND } from '../draw/theme'

// The row's text is rewritten, as UserMessage's contract allows (the stored message is untouched), rather than redrawn;
// isExpanded can't gate it, since a short plugin message under its speaker label is drawn expanded too.
export function registerTranscriptSummary(on: On, opts: { plugin: string; label: string; summary: (text: string) => string }): void {
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const origin = e.props.origin as { kind: string; name?: string }
    if (origin.kind !== 'plugin' || origin.name !== opts.plugin) return next(e)
    return next({ ...e, props: { ...e.props, text: `${BRAND.glyph} ${opts.label}  ${opts.summary(e.props.text)}` } })
  })
}
