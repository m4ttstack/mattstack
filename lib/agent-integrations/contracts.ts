import type {
  AgentOptions, Attachment, Capability, CapabilityReport, DeliveryReceipt,
  HarnessId, Mode, NativeSessionRef, Observation, OptionDescriptor, Outcome,
  PeerInput, QuestionBinding, Readiness, Selection, SessionBinding,
} from "../../packages/rt-client/src/agent-integrations.ts";
import type { GateRow } from "../../packages/rt-client/src/commands.ts";
import type { PluginListEntry } from "../skills/sources.ts";

/** The ID survives acknowledgement ambiguity; native deduplication is not implied. */
export type WorkInput = { id: string; text: string };
export type LaunchRequest = {
  reservationId: string; cwd: string; mode: Mode; selection: Selection;
  required: readonly Capability[];
  /** Deferred work: launch/resume must not submit this prompt. */
  prompt?: string;
  access: { readRoots: string[] };
};
/** A verified native reference; the shared store assigns attachment generation. */
export type NativeLaunch = { native: NativeSessionRef; attachment: Omit<Attachment, "generation"> };
export type PreparedPolicy = {
  id: string; harness: HarnessId; profile: string; cwd: string; revision: string;
};
export type PolicyProof = {
  sessionKey: string; generation: number; revision: string;
  verified: Capability[]; observedAt: number;
};
/** In memory only; reconnect must match a durable QuestionBinding first. */
export type ActiveQuestionHandle = {
  connection: string; requestId: string | number;
  threadId: string; turnId: string; itemId: string;
};
export interface SessionAdapter {
  launch(request: LaunchRequest): Promise<Outcome<NativeLaunch>>;
  resume(ref: NativeSessionRef, request: LaunchRequest): Promise<Outcome<NativeLaunch>>;
  discover(): Promise<NativeLaunch[]>;
  observe(binding: SessionBinding): Promise<Outcome<Observation>>;
  startWork(binding: SessionBinding, input: WorkInput): Promise<Outcome<DeliveryReceipt>>;
}
export interface MessageAdapter {
  submit(binding: SessionBinding, input: PeerInput): Promise<Outcome<DeliveryReceipt>>;
  reconcile?(binding: SessionBinding, inputId: string): Promise<Outcome<DeliveryReceipt | null>>;
}
export interface QuestionAdapter {
  complete(binding: SessionBinding, question: QuestionBinding, row: GateRow): Promise<Outcome<"completed" | "pending" | "gone" | "conflict">>;
}
export interface PolicyAdapter {
  prepare(request: LaunchRequest): Promise<Outcome<PreparedPolicy>>;
  verify(binding: SessionBinding, prepared: PreparedPolicy): Promise<Outcome<PolicyProof>>;
}
export interface SkillAdapter {
  inventory(): Promise<Outcome<PluginListEntry[]>>;
  resourceRoots(): Promise<Outcome<string[]>>;
  resolveResource(plugin: string, relativePath: string): Promise<Outcome<string>>;
  maintain(operation: "init" | "sync" | "link", source: string): Promise<Outcome<void>>;
}
type AdapterFactories = {
  loadSessions(): Promise<SessionAdapter>;
  loadMessaging(): Promise<MessageAdapter>;
  loadQuestions(): Promise<QuestionAdapter>;
  loadPolicy(): Promise<PolicyAdapter>;
  loadSkills(): Promise<SkillAdapter>;
};
/** An absent factory narrows the capabilities a typed implementation may report.
 * This is a declaration constraint, not validation of untrusted native reports.
 */
type OptionalAdapter<Key extends keyof AdapterFactories, Cap extends Capability> =
  | Pick<AdapterFactories, Key>
  | ({ [K in Key]?: never } & {
      capabilities(mode: Mode): Promise<Omit<CapabilityReport, "supported"> & { supported: Exclude<Capability, Cap>[] }>;
    });
export type HarnessIntegration = {
  readonly id: HarnessId;
  readonly label: string;
  capabilities(mode: Mode): Promise<CapabilityReport>;
  validateOptions(options: AgentOptions): Outcome<AgentOptions>;
  options(): Promise<OptionDescriptor[]>;
} & OptionalAdapter<"loadSessions", "launch" | "resume" | "observe">
  & OptionalAdapter<"loadMessaging", "peer-idle" | "peer-working">
  & OptionalAdapter<"loadQuestions", "questions-form" | "questions-wait" | "question-recovery" | "questions-async">
  & OptionalAdapter<"loadPolicy", "gate-policy" | "continuation-policy">
  & OptionalAdapter<"loadSkills", "skills">;
export interface IntegrationRegistry {
  get(id: HarnessId): HarnessIntegration | undefined;
  list(): readonly HarnessIntegration[];
}
