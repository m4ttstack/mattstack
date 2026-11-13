import type { ClientElements } from 'claude-code'

import { hovered, muted, pressed } from './theme'
import { lineHoverKey, spanHoverKey, type Line, type Span, type Style } from './text'

// `hover` and `pressed` are hover keys (hoverKeyAt): the control under the pointer, and the one held down.
export type Look = { focused: boolean; hover?: string; pressed?: string }

function isControl<A>(span: Span<A>, line: Line<A>, row: number, key: string): boolean {
  if (span.action !== undefined) return spanHoverKey(span, row) === key
  return span.isLabel === true && lineHoverKey(line) === key
}

function styleOf<A>(span: Span<A>, line: Line<A>, row: number, look: Look): Style {
  if (!look.focused) return muted(span)
  if (look.pressed !== undefined && isControl(span, line, row, look.pressed)) return pressed(span)
  if (look.hover !== undefined && isControl(span, line, row, look.hover)) return hovered(span)
  return span
}

// One Text per line with nested spans, so the terminal truncates a long line instead of squashing the rail.
export function renderLines<A>(lines: Line<A>[], elements: Pick<ClientElements, 'Box' | 'Text'>, look: Look) {
  const { Box, Text } = elements
  return (
    <Box flexDirection="column">
      {lines.map((line, n) => (
        <Text key={`l${n}`} wrap="truncate-end">
          {line.map((span, m) => {
            const style = styleOf(span, line, n, look)
            return (
              <Text
                key={`s${m}`}
                {...(style.color && { color: style.color })}
                {...(style.bg && { backgroundColor: style.bg })}
                {...(style.dim && { dimColor: true })}
                {...(style.bold && { bold: true })}
                {...(style.italic && { italic: true })}
                {...(style.underline && { underline: true })}
                {...(style.inverse && { inverse: true })}
              >
                {span.t}
              </Text>
            )
          })}
        </Text>
      ))}
    </Box>
  )
}
