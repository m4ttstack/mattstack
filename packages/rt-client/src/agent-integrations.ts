/** Portable integration vocabulary, exported through the package entry point. */
export type HarnessId = string;
export type Mode = "herdr" | "headless";
export type Capability =
  | "launch" | "resume" | "caller-context" | "observe"
  | "peer-idle" | "peer-working" | "questions-form" | "questions-wait"
  | "question-recovery" | "questions-async" | "gate-policy"
  | "continuation-policy" | "background-state" | "skills" | "worktrees";
export type FaultCode = "unsupported" | "not-ready" | "refused" | "transient"
  | "stale-binding" | "stale-frame" | "ambiguous" | "invalid";
export type Outcome<T> = { ok: true; data: T }
  | { ok: false; error: { code: FaultCode; message: string } };
export type NativeSessionRef = {
  harness: HarnessId; profile: string; kind: "id" | "path"; value: string;
};
export type Attachment = {
  generation: number; mode: Mode; pane?: string; socket?: string; pid?: number;
};
export type SessionBinding = {
  key: string; identity: string; native: NativeSessionRef;
  attachment: Attachment; agentId?: string; attemptId?: string;
};
export type CallerContext = {
  binding: SessionBinding;
};
export type Observation = {
  connectivity: "connected" | "disconnected" | "unknown";
  execution: "idle" | "working" | "blocked" | "dead" | "unknown";
  background: "active" | "inactive" | "unknown";
  observedAt: number; source: string; generation: number;
};
export type AgentOptions = {
  model?: string; effort?: string; account?: string; extraArgs?: string; yolo?: boolean;
};
export type Selection = { harness: HarnessId; options: AgentOptions };
export type Readiness = { ready: boolean; reason?: string; version?: string };
export type CapabilityReport = { readiness: Readiness; supported: Capability[]; mode: Mode };
export type OptionDescriptor = {
  name: keyof AgentOptions; kind: "text" | "boolean" | "choice"; choices?: string[];
};
/** Something wrong with the enabled set or the default that the user should fix; rt never fixes it by replacing either value. */
export type IntegrationProblem = { code: "default-not-enabled" | "invalid-preference"; message: string; next: string };
/** What `agent:integrations` reports for one registered harness, for the asked mode. */
export type IntegrationSummary = {
  id: HarnessId; label: string;
  /** The user enabled it; whether it can run now is `readiness`. */
  enabled: boolean;
  readiness: Readiness;
  capabilities: Capability[];
  options: OptionDescriptor[];
  /** Claude lists its live mod links; Codex says whether its connection negotiated experimentalApi. Each is absent while unknown. */
  diagnostics?: IntegrationDiagnostics;
};
export type IntegrationDiagnostics = {
  /** `capabilities` is what each session advertises through its link: both policies only with the policy and stop-gate blocks; an older daemon omits it. */
  claudeLinks?: { sessionId: string; claudeCode: string; plugin: string; blocks: ModBlock[]; capabilities?: Capability[]; lastHeartbeatAgoMs: number }[];
  experimentalApi?: boolean;
};
export type PeerInput = { id: string; body: string; sender: string; recipient: string };
export type DeliveryReceipt = {
  id: string; evidence: "submitted" | "queued" | "consumed";
  nativeId?: string; turnId?: string; itemId?: string;
};
/**
 * A Claude Code mod block the mattstack-mods plugin reports at registration.
 * Claude-internal: it never widens `Capability`. The plugin keeps its own copy
 * (`plugins/mattstack-mods/src/core/blocks.ts`), and a parity test holds the
 * two lists equal.
 */
export type ModBlock =
  | "delivery" | "gate-form" | "gate-wait" | "gate-panel" | "presence"
  | "policy" | "stop-gate" | "relocation" | "observe" | "board";
export const MOD_BLOCKS: readonly ModBlock[] = [
  "delivery", "gate-form", "gate-wait", "gate-panel", "presence",
  "policy", "stop-gate", "relocation", "observe", "board",
];
/**
 * What a board pane's `board` block reported after a stand-down: the turn
 * ended, the turn ended with background work still finishing, or that work
 * has since finished.
 */
export type StandDownState = "stood-down" | "stood-down-background" | "background-finished";
export type QuestionBinding = {
  gateId: string; sessionKey: string; generation: number;
  nativeThread?: string; nativeTurn?: string; nativeItem?: string;
  /** Durable question IDs, never connection-local RPC IDs. */
  nativeQuestions?: string[]; presentation: "form" | "wait";
};
