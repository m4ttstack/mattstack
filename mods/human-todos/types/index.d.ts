export type TodoKind = 'task' | 'run' | 'terminal' | 'link' | 'image'

export type TodoStatus = 'open' | 'confirming' | 'running' | 'done' | 'failed' | 'skipped'

export type AddInput = {
  kind: TodoKind
  title: string
  detail?: string
  script?: string
  url?: string
  paths?: string[]
  cwd?: string
  // The Done button's own words for this item, e.g. "I've signed in"; plain Done when left out.
  doneLabel?: string
}

export type Todo = {
  id: string
  kind: TodoKind
  title: string
  detail?: string
  script?: string
  url?: string
  paths?: string[]
  cwd?: string
  doneLabel?: string
  status: TodoStatus
  exitCode?: number
  outputTail?: string
  liveTail?: string[]
  note?: string
  isStopping?: boolean
  runner?: 'herdr' | 'local'
  paneId?: string
  herdrSession?: string
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
      composing: string | null
      composeLines: number
      loadedFor: string | null
      isSaveFailed: boolean
      frame: number
      herdrWorkspace: { session: string; id: string } | null
      runnerPref: 'auto' | 'herdr' | 'local'
      keysInPane: boolean
      scrollOffset: number
    }
  }
}
