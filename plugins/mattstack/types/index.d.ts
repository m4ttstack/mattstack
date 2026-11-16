// The session values the mattstack hooks module keeps in `$.state`, which outlive a reload of the module.
declare module 'claude-code' {
  interface PluginState {
    mattstack: {
      // The token of the one worktree-leave watch that may act; a watch holding any other token stops.
      worktreeLeaveWatch: string
    }
  }
}

// What `$.state` holds under the worktree-leave watch's key.
export type WorktreeLeaveWatch = string
