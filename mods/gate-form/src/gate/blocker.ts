// herdr keys a pane's blockers by source, so this mod raises and clears only its own.
export const BLOCKER_SOURCE = 'mattstack:gate'
// herdr cuts a blocker's message at this many characters.
export const BLOCKER_MESSAGE_MAX = 80

export function raiseArgs(paneId: string, message: string): string[] {
  return ['pane', 'report-blocker', paneId, '--source', BLOCKER_SOURCE, '--message', message]
}

export function clearArgs(paneId: string): string[] {
  return ['pane', 'clear-blocker', paneId, '--source', BLOCKER_SOURCE]
}
