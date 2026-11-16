import type { EngineInterface, RenderElement } from 'claude-code'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

export type HotkeyChoice = { label: string; onPress: () => void }

export type HotkeyChoicesSpec = {
  // Prefixes each Button's address, so two lists in one pane keep apart.
  key: string
  choices: HotkeyChoice[]
  // Whether the pane holds the keys (the Pane render's `isFocused`).
  focused: boolean
  indent?: number
}

// Answers drawn by the hooks module as the engine's own plain Buttons, one per row (`1: label`). A pane opened with
// `focus` hands its keys to engine elements the moment it appears, while a Client gets keys only after a click, so the
// first Button is autoFocus and each carries its number as a hotkey. The numbers show only while the pane holds the
// keys: without them a number reads as a key that does nothing.
export function hotkeyChoices(els: Elements, spec: HotkeyChoicesSpec): RenderElement {
  const { Box, Text, Button } = els
  const lead = ' '.repeat(spec.indent ?? 3)
  return (
    <Box flexDirection="column">
      {spec.choices.map((choice, idx) => (
        <Box key={`${spec.key}-row-${idx}`} flexDirection="row">
          <Text>{lead}</Text>
          <Button key={`${spec.key}:${idx}`} plain hotkey={spec.focused && idx < 9 ? String(idx + 1) : undefined} autoFocus={idx === 0 ? true : undefined} onPress={choice.onPress}>
            {choice.label}
          </Button>
        </Box>
      ))}
    </Box>
  )
}
