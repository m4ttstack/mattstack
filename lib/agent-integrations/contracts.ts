import type {
  AgentOptions, Attachment, Capability, CapabilityReport, DeliveryReceipt,
  HarnessId, Mode, NativeSessionRef, Observation, OptionDescriptor, Outcome,
  PeerInput, QuestionBinding, Readiness, Selection, SessionBinding,
} from "../../packages/rt-client/src/agent-integrations.ts";
import type { GateRow } from "../../packages/rt-client/src/commands.ts";
import type { Logger } from "pino";
import type { HerdrRunner } from "../agent-herdr.ts";
import type { herdrRequest } from "../herdr/client.ts";
import type { PluginListEntry } from "../skills/sources.ts";

/** The ID survives acknowledgement ambiguity; native deduplication is not implied. */
export type WorkInput = { id: string; text: string };

/** A process a caller runs and reaps for a session's work; the integration only decides its argv and environment. */
export type WorkProcess = { pid?: number; exited: Promise<number>; stdout: () => Promise<string> };
export type RunWorkProcess = (
  argv: string[], cwd: string, env: Record<string, string>, opts: { stdin?: string; unset?: readonly string[] },
) => WorkProcess;

/**
 * How the caller presents and transports a launch. Held in memory only, never
 * persisted, so it may carry transports and environment values.
 */
export type LaunchHost = {
  workspace?: string; tab?: string;
  /** The pane's own name, shown over its terminal title. */
  label?: string;
  /** The herdr server socket the pane runs on; absent is the visible server. */
  socket?: string;
  /** The socket is rt's background server, so pane refs are recorded as bg: refs. */
  background?: boolean;
  /** Exported to the worker: on its pane line, or in its process environment. */
  env?: Record<string, string>;
  /** Variables the worker must not inherit; the launcher fills in other harnesses' session variables. */
  unsetEnv?: readonly string[];
  /** The gate subject this worker asks under, for integrations that install a gate hook. */
  gate?: { agentId: string; subject?: string };
  /** The worker holds a chat identity, so it accepts cross-session inbound messages. */
  chat?: boolean;
  /** Paint budget for a folder-trust check on a freshly opened pane. */
  trustWaitMs?: number;
  herdr?: {
    runner?: HerdrRunner;
    runnerForSocket?: (socket: string) => HerdrRunner;
    request?: typeof herdrRequest;
    trustBudgets?: { registerBudgetMs?: number; waitBudgetMs?: number; settleMs?: number; stepMs?: number };
  };
  log?: Logger;
  /** Runs a headless worker process; without it an integration spawns its own. */
  runProcess?: RunWorkProcess;
};

export type LaunchRequest = {
  reservationId: string; cwd: string; mode: Mode; selection: Selection;
  required: readonly Capability[];
  /** Deferred work: launch/resume must not submit this prompt. */
  prompt?: string;
  access: { readRoots: string[] };
  /** A session id rt already minted for this launch; used by an integration that takes rt-minted ids. */
  nativeHint?: string;
  host?: LaunchHost;
};
/** What a pane launch reported beyond the attachment itself. */
export type LaunchSurface = { tabId?: string; workspaceId?: string; trust?: string };
/** A verified native reference; the shared store assigns attachment generation. */
export type NativeLaunch = { native: NativeSessionRef; attachment: Omit<Attachment, "generation">; surface?: LaunchSurface };
/** The launch a session was prepared by, handed back when its work starts. */
export type PreparedLaunch = { request: LaunchRequest; kind: "launch" | "resume" };
/** A finished headless run; null when its outcome cannot be known. */
export type WorkCompletion = { exitCode: number; body: string } | null;
/**
 * A submission's evidence. `attachment` is set when starting the work also
 * started the native process (a session that takes its first work at spawn).
 */
export type WorkReceipt = DeliveryReceipt & {
  attachment?: Omit<Attachment, "generation">;
  surface?: LaunchSurface;
  completion?: Promise<WorkCompletion>;
};
/** What the launcher knows about a submission whose outcome is unknown. */
export type WorkProbe = { id: string; digest: string; submittedAt?: number };
export type PreparedPolicy = {
  id: string; harness: HarnessId; profile: string; cwd: string; revision: string;
};
/**
 * installation: the harness loads the inspected hooks at every session start
 * (Claude Code), so inspecting them is the evidence. receipts: the bound
 * session ran them in a controller-issued check turn (Codex).
 */
export type PolicyProofKind = "installation" | "receipts";
/** One check turn's correlated evidence: each event's native hook run, under the nonce issued for that turn. */
export type PolicyReceiptEvidence = {
  turnId: string; nonce: string; sourcePath: string;
  /** The manifest revision every receipt named, built from the inspected executable. */
  manifest: string;
  runs: { PreToolUse: string; Stop: string };
  /** Set when a resumed session kept the proof an earlier attachment earned. */
  retainedFrom?: number;
};
export type PolicyProof = {
  sessionKey: string; generation: number; revision: string;
  verified: Capability[]; observedAt: number;
  kind?: PolicyProofKind;
  evidence?: PolicyReceiptEvidence;
};
/**
 * What a verification is for. A new session may run a harmless check turn; a
 * resumed one keeps a still-current retained proof only with observed health,
 * unless its caller agreed to a check for that session.
 */
export type PolicyVerifyContext = { kind: "launch" | "resume"; retained?: PolicyProof; check?: boolean };
/** In memory only; reconnect must match a durable QuestionBinding first. */
export type ActiveQuestionHandle = {
  connection: string; requestId: string | number;
  threadId: string; turnId: string; itemId: string;
};
/** A per-pass cache an integration fills on first use; opaque to the caller. */
export interface ObservationSweep {
  memo<T>(key: string, load: () => T): T;
}
export function createObservationSweep(): ObservationSweep {
  const values = new Map<string, unknown>();
  return {
    memo<T>(key: string, load: () => T): T {
      if (!values.has(key)) values.set(key, load());
      return values.get(key) as T;
    },
  };
}
export interface SessionAdapter {
  /**
   * True when the adapter holds what an unfinished launch made under its
   * reservation id, so calling launch again with that id carries on rather
   * than starting again. Without it, a retried reservation is reconciled
   * through discover() and is never launched a second time.
   */
  readonly carriesReservations?: boolean;
  launch(request: LaunchRequest): Promise<Outcome<NativeLaunch>>;
  resume(ref: NativeSessionRef, request: LaunchRequest): Promise<Outcome<NativeLaunch>>;
  discover(): Promise<NativeLaunch[]>;
  /** `sweep` is shared by every observe of one pass, so a native source is read once per pass, not per binding. */
  observe(binding: SessionBinding, sweep?: ObservationSweep): Promise<Outcome<Observation>>;
  /** `prepared` is the launch that bound this session, when this process made it. */
  startWork(binding: SessionBinding, input: WorkInput, prepared?: PreparedLaunch): Promise<Outcome<WorkReceipt>>;
  /** Native evidence that an interrupted submission reached the session; null when there is none. */
  reconcileWork?(binding: SessionBinding, probe: WorkProbe, sweep?: ObservationSweep): Promise<Outcome<DeliveryReceipt | null>>;
  /** Stops a session rt runs with no pane to close: its running turn is interrupted and the harness lets it go. */
  end?(binding: SessionBinding): Promise<Outcome<void>>;
}
/**
 * Peer input into a bound session. `input.id` is the logical delivery id and
 * stays the same across retries; `input.sender` labels who it is from as the
 * recipient sees it, and `input.body` is the rendered text, reply guidance
 * included. Both reach the session verbatim inside a peer-message envelope.
 *
 * A receipt states only the evidence the harness gave: `submitted` (written to
 * the transport), `queued` (a native queue acknowledged it) or `consumed` (the
 * session was seen taking it). None of them is completed work, and an
 * ambiguous outcome is a fault, never a receipt.
 */
export interface MessageAdapter {
  /** The native connection evidence is held on, when evidence lives with a connection; a new value is a reconnect. */
  readonly connection?: string;
  submit(binding: SessionBinding, input: PeerInput): Promise<Outcome<DeliveryReceipt>>;
  /** Evidence observed since submission, from the binding's own attachment generation; null when there is none. */
  reconcile?(binding: SessionBinding, inputId: string): Promise<Outcome<DeliveryReceipt | null>>;
  /** rt no longer waits on this delivery's evidence (its row was settled another way): anything held for it is let go. */
  settle?(binding: SessionBinding, inputId: string): void;
}
export interface QuestionAdapter {
  complete(binding: SessionBinding, question: QuestionBinding, row: GateRow): Promise<Outcome<"completed" | "pending" | "gone" | "conflict">>;
}
export interface PolicyAdapter {
  /**
   * The harness proves policy per session, after bind, so its mode-level
   * capability report never lists the policy capabilities; a launch that
   * requires them is admitted on `prepare` and `verify` instead.
   */
  readonly verifiesPerSession?: boolean;
  prepare(request: LaunchRequest): Promise<Outcome<PreparedPolicy>>;
  verify(binding: SessionBinding, prepared: PreparedPolicy, context?: PolicyVerifyContext): Promise<Outcome<PolicyProof>>;
}
export interface SkillAdapter {
  inventory(): Promise<Outcome<PluginListEntry[]>>;
  resourceRoots(): Promise<Outcome<string[]>>;
  resolveResource(plugin: string, relativePath: string): Promise<Outcome<string>>;
  /** The folder this harness loads a user's own skills from; links made for it land here and nowhere else. */
  skillsDir(): Outcome<string>;
  /**
   * A change on the host, through the harness's own CLI where it has one.
   * `init` registers the marketplace folder `source` and installs
   * `options.plugin` from it; `sync` updates the installed plugin `source`
   * (`plugin@marketplace`), or with `options.catalog` refreshes the
   * marketplace named `source`; `link` reconciles the skills folder `source`
   * into `skillsDir()`, or drops the links into it once `source` is gone.
   * A fault carries the harness's own words.
   */
  maintain(operation: "init" | "sync" | "link", source: string, options?: MaintainOptions): Promise<Outcome<void>>;
}
export type MaintainOptions = {
  plugin?: string;
  catalog?: boolean;
  /** The install scope an update moves; one id can sit at several. */
  scope?: string;
  /** Answers the harness's own confirmation prompt. */
  assumeYes?: boolean;
  /** Skill folder names the source declines to distribute. */
  ignore?: string[];
};
type AdapterFactories = {
  loadSessions(): Promise<SessionAdapter>;
  loadMessaging(): Promise<MessageAdapter>;
  loadQuestions(): Promise<QuestionAdapter>;
  loadPolicy(): Promise<PolicyAdapter>;
  loadSkills(): Promise<SkillAdapter>;
};
type MessagingCapability = "peer-idle" | "peer-working";
type QuestionCapability = "questions-form" | "questions-wait" | "question-recovery" | "questions-async";
type PolicyCapability = "gate-policy" | "continuation-policy";
type SessionCapability = "launch" | "resume" | "observe" | "caller-context"
  | MessagingCapability | QuestionCapability | PolicyCapability;
type NarrowedCapabilities<Cap extends Capability> = {
  capabilities(mode: Mode): Promise<Omit<CapabilityReport, "supported"> & { supported: Exclude<Capability, Cap>[] }>;
};
/** An absent factory narrows the capabilities a typed implementation may report.
 * This is a declaration constraint, not validation of untrusted native reports.
 */
type OptionalAdapter<Key extends keyof AdapterFactories, Cap extends Capability> =
  | Pick<AdapterFactories, Key>
  | ({ [K in Key]?: never } & NarrowedCapabilities<Cap>);
/** Messaging, questions and policy act on a SessionBinding, which only a session adapter produces. */
type SessionFacets =
  | (Pick<AdapterFactories, "loadSessions">
    & OptionalAdapter<"loadMessaging", MessagingCapability>
    & OptionalAdapter<"loadQuestions", QuestionCapability>
    & OptionalAdapter<"loadPolicy", PolicyCapability>)
  | ({ loadSessions?: never; loadMessaging?: never; loadQuestions?: never; loadPolicy?: never }
    & NarrowedCapabilities<SessionCapability>);
export type HarnessIntegration = {
  readonly id: HarnessId;
  readonly label: string;
  /** Environment variables this harness names its own session by; another harness's worker never inherits them. */
  readonly sessionEnv?: readonly string[];
  /**
   * The native session id a pane's foreground process runs, read from the
   * harness's own records without loading sessions, connecting or spawning.
   * Absent when the harness cannot match a pane to a session by process.
   */
  readonly sessionForPid?: (pid: number) => Promise<string | null>;
  /**
   * The id of the connection peer messaging would use now, or null while it
   * has none, read without loading, connecting or spawning. Absent when the
   * harness's transport has no connection to wait for.
   */
  readonly messagingConnection?: () => string | null;
  /**
   * Whether the bound native session can take input now: false when the
   * harness knows nothing would run input sent to it, undefined when it does
   * not know. Read without loading, connecting or spawning. Absent when the
   * harness has no per-session answer beyond its connection.
   */
  readonly sessionLive?: (binding: SessionBinding) => boolean | undefined;
  /**
   * Input typed into the session's pane, an invite's join command, is
   * prompted there through herdr, which keeps a draft in the composer. Absent,
   * such input reaches the session as peer input through its messaging.
   */
  readonly typedPaneInput?: boolean;
  /**
   * The background work a herdr pane running this harness shows on its
   * visible screen, or null when it shows none. Read only for a pane rt
   * supervises without a session binding. Absent when the screen says
   * nothing rt can read.
   */
  readonly paneBackground?: (screen: string) => string | null;
  /** How this harness's sessions prove their policy; a policy proof of any other kind, or for a harness that declares none, is refused. */
  readonly policyProofKind?: PolicyProofKind;
  capabilities(mode: Mode): Promise<CapabilityReport>;
  validateOptions(options: AgentOptions): Outcome<AgentOptions>;
  options(): Promise<OptionDescriptor[]>;
} & SessionFacets
  & OptionalAdapter<"loadSkills", "skills">;
export interface IntegrationRegistry {
  get(id: HarnessId): HarnessIntegration | undefined;
  list(): readonly HarnessIntegration[];
}
