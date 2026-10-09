/**
 * Codex's worktree lifecycle. No native Codex worktree hook was proven, so a
 * Codex session enters and leaves pool trees only through rt's explicit
 * operations (worktree_provision and worktree_dispose, or the rt worktree
 * verbs), which record and check the holder through the shared service.
 * Nothing here emulates a native event.
 */
export const codexWorktreeLifecycle = "explicit" as const;
