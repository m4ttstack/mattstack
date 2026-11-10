export type TodoKind = 'task' | 'run' | 'terminal' | 'link'

export type TodoStatus = 'open' | 'confirming' | 'running' | 'done' | 'failed' | 'skipped'

export type AddInput = {
  kind: TodoKind
  title: string
  detail?: string
  script?: string
  url?: string
  cwd?: string
}

export type Todo = {
  id: string
  kind: TodoKind
  title: string
  detail?: string
  script?: string
  url?: string
  cwd?: string
  status: TodoStatus
  exitCode?: number
  outputTail?: string
  liveTail?: string[]
  note?: string
  isStopping?: boolean
  runner?: 'herdr' | 'local'
  paneId?: string
  tabId?: string
  token?: string
  logPath?: string
}

declare module 'claude-code' {
  interface PluginState {
    'human-todos': {
      todos: Shaped<Todo[]>
      nextId: number
      expanded: string[]
      loadedFor: string | null
      isSaveFailed: boolean
      frame: number
      workspace: string | null
      runnerPref: 'auto' | 'herdr' | 'local'
    }
  }
}
