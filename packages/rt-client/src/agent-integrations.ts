/** Portable integration vocabulary; not exposed through the package entry point yet. */
export type HarnessId = string;
export type Mode = "herdr" | "headless";
export type Capability =
  | "launch" | "resume" | "caller-context" | "observe"
  | "peer-idle" | "peer-working" | "questions-form" | "questions-wait"
  | "question-recovery" | "questions-async" | "gate-policy"
  | "continuation-policy" | "background-state" | "skills" | "worktrees";
export type FaultCode = "unsupported" | "not-ready" | "refused" | "transient"
  | "stale-binding" | "ambiguous" | "invalid";
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
  binding: SessionBinding; assignment?: { herd: string; job: string; attemptId: string };
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
export type PeerInput = { id: string; body: string; sender: string; recipient: string };
export type DeliveryReceipt = {
  id: string; evidence: "submitted" | "queued" | "consumed";
  nativeId?: string; turnId?: string; itemId?: string;
};
export type QuestionBinding = {
  gateId: string; sessionKey: string; generation: number;
  nativeThread?: string; nativeTurn?: string; nativeItem?: string;
  /** Durable question IDs, never connection-local RPC IDs. */
  nativeQuestions?: string[]; presentation: "form" | "wait";
};
