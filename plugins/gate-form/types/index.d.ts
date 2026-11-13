export type FormOption = { value: string; label: string; description?: string }

export type FormQuestion = {
  id: string
  header: string
  label: string
  multi: boolean
  writeIn: boolean
  context?: string
  options: FormOption[]
}

export type Form = {
  id: string
  title: string
  context?: string
  questions: FormQuestion[]
  status: 'open' | 'answered' | 'cancelled'
  replyTo: 'agent' | 'toast'
}

declare module 'claude-code' {
  interface PluginState {
    'gate-form': { form: Shaped<Form | null>; keysInForm: boolean }
  }
}
