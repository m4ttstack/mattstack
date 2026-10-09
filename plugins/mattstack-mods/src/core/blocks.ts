// Imported by an rt-side bun test that compares this list with rt's copy, so
// this file takes no imports and never touches the engine.

export type ModBlock =
  | 'delivery'
  | 'gate-form'
  | 'gate-wait'
  | 'gate-panel'
  | 'presence'
  | 'policy'
  | 'stop-gate'
  | 'relocation'
  | 'observe'
  | 'board'

export const MOD_BLOCKS: readonly ModBlock[] = [
  'delivery',
  'gate-form',
  'gate-wait',
  'gate-panel',
  'presence',
  'policy',
  'stop-gate',
  'relocation',
  'observe',
  'board',
]
