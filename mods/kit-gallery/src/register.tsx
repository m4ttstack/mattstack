import type { On } from 'claude-code'
import { paneMessage, showPane, type HideablePane } from '@mattstack/mod-kit'

const PANE = 'kit-gallery'
const TITLE = 'Kit gallery'

const GALLERY_PANE: HideablePane = { id: PANE }

// A function declaration, not a const arrow: a bundler keeps it one, and the engine's source check requires it.
export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'kit-gallery', description: 'Open the mod kit gallery: every kit piece, drawn live' })
    return next(e)
  })

  on('command.run', { command: 'kit-gallery' }, async $ => {
    await showPane($, GALLERY_PANE, TITLE)
    return { text: `${TITLE} opened.` }
  })

  on('ui.message', async ($, e, next) => {
    await paneMessage($, e, GALLERY_PANE, undefined)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Client = 'Client' in els ? els.Client : undefined
    if (!Client) return <Text dimColor>This screen can't draw the gallery. Open it in the terminal or the desktop app.</Text>
    return (
      <Box flexDirection="column" paddingX={1}>
        <Client key="gallery" module="./gallery.tsx" props={{ cols: (e.props.bodyColumns ?? 60) - 2 }} />
      </Box>
    )
  })
}
