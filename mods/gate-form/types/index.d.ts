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
  source: 'gate' | 'ask'
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

declare module 'claude-code' {
  interface PluginState {
    'gate-form': {
      forms: Shaped<Form[]>
      form: Shaped<LegacyForm | null>
      keysInForm: boolean
      board: Shaped<BoardGate[]>
    }
  }
}
