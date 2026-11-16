export type FormOption = { value: string; label: string; description?: string }

export type FormQuestion = {
  id: string
  header: string
  label: string
  multi: boolean
  writeIn: boolean
  // Whether the question ends in a "Something else" row: a gate takes typed text only where it says writeIn.
  other: boolean
  context?: string
  options: FormOption[]
}

// The run controls a gate offers; More actions shows a row for each that is set.
export type Controls = { pause: boolean; goBack: string[] }

export type Form = {
  id: string
  title: string
  context?: string
  questions: FormQuestion[]
  status: 'open' | 'answered' | 'cancelled'
  // A plugin form is another plugin's one-pick question, asked through `$.gateForm`.
  source: 'gate' | 'ask' | 'plugin'
  // A plugin form drawn as a confirm dialog: its options are numbered rows, and a pick is the answer.
  confirm?: true
  gateId?: string
  controls?: Controls
  // What the person reads about the last answer, which may not be recorded; `attempt` counts the failures so the Client knows to take the form back.
  error?: string
  attempt?: number
  // What the closed form says in place of its own ending, such as where the gate was answered.
  note?: string
  // The answers that won when another surface answered the gate, in gate_answer's shape, which the closed form shows in place of its own picks.
  won?: Record<string, unknown>
}

// A board-only gate raised in this pane: the band above the prompt links to it on the board.
export type BoardGate = { gateId: string; kind: string }

export type LegacyForm = {
  id: string
  title: string
  context?: string
  questions: Omit<FormQuestion, 'other'>[]
  status: Form['status']
  replyTo: 'agent' | 'toast'
}

export type GateFormAskBase = {
  title: string
  context?: string
  options: { value: string; label: string; description?: string }[]
  timeoutMs: number
}

// `choice` (the default) draws the options as radio rows under `label`, with Submit; `confirm` draws 2 or 3 options
// as numbered Buttons under the context, with no question line, the keys starting on the first. An option's value may
// not be `__other__`, which the form keeps for itself.
export type GateFormAskArgs = (GateFormAskBase & { kind?: 'choice'; label: string }) | (GateFormAskBase & { kind: 'confirm'; label?: string })

export type GateFormAskResult = { value: string } | { timedOut: true } | { closed: true }

// A call on a plugin noun must answer within 10 s, so the question is a long poll: `ask` opens it (or queues it
// behind an open one) and answers at once; `wait` answers within about 5 s, pending until there is an outcome.
// Once `wait` has handed an outcome back the id is forgotten, so a later wait on it, like one on an id this
// load never issued, answers `{ closed: true }`.
export type GateForm = {
  ask: (args: GateFormAskArgs) => Promise<{ id: string }>
  wait: (args: { id: string }) => Promise<GateFormAskResult | { pending: true }>
}

declare module 'claude-code' {
  interface EngineInterface {
    gateForm: GateForm
  }

  interface PluginState {
    'gate-form': {
      forms: Shaped<Form[]>
      form: Shaped<LegacyForm | null>
      keysInForm: boolean
      board: Shaped<BoardGate[]>
    }
  }
}
