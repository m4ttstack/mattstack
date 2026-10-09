export interface PaneHints { paneId?: string; sessionId?: string; worktree?: string }

export interface LivePane {
  paneRef: string; sockPath: string; workspaceId: string;
  agentStatus: "idle" | "working" | "blocked" | "done" | "unknown";
  cwd?: string; sessionId?: string;
}

export type EscapeInjector = (
  hints: PaneHints,
  opts?: { paneRef?: string },
) => Promise<{ ok: true; paneRef: string } | { ok: false; error: string }>;

export type PaneStatusProbe = (hints: PaneHints) => Promise<{ paneRef: string; status: LivePane["agentStatus"] } | null>;
