import type { Register } from 'claude-code'

import { deliveryRow } from './slack-support-text.ts'

const PLUGIN = 'mattstack'

/** A delivery carries the support rules on every message, which would fill the
    pane. It folds to one dim line; ctrl+o still shows all of it. */
export const register: Register = on => {
  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'plugin' } } }, ($, e, next) => {
    const { origin, isExpanded, text } = e.props
    const row = origin.kind === 'plugin' && origin.name === PLUGIN && !isExpanded ? deliveryRow(text) : null
    if (row === null) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{row}</Text>
  }).catch(($, e, next) => next(e))
}
