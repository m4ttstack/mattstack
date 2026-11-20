/**
 * zod schemas for the commands the daemon serves over REST, and every shape
 * they reach. `commands.ts` derives its types from these with `import type`
 * only: `dist/index.js` sits on rt's startup path and must never load zod
 * (test/no-zod-in-dist.test.ts).
 *
 * Data schemas are plain (non-strict) objects so extra wire fields still parse.
 */
import { z } from "zod";

// ─── Shared enums ───────────────────────────────────────────────────────────

/** Reconciler's view of an agent's liveness; also the value `GateRow.executor` is stamped with. */
export const ExecutorStateSchema = z.enum(["live", "blocked", "hidden", "gone", "cleared", "unknown"]);

export const AgentSurfaceSchema = z.enum(["herdr", "headless"]);

// Mirrors lib/daemon/health.ts's HealthSnapshot; rt-client cannot import daemon internals.
export const HealthLevelSchema = z.enum(["ok", "degraded", "unhealthy"]);
export const HealthMetricsSchema = z.object({
  rss: z.number(),
  heapUsed: z.number(),
  external: z.number(),
  uptimeMs: z.number(),
  wsClients: z.number(),
  watchers: z.number(),
});
export const HealthEventLoopSchema = z.object({
  maxLagMs: z.number(),
  lastStallAt: z.number().nullable(),
  lastStallCmd: z.string().nullable(),
  stalls: z.number(),
});

// ─── Branch cache ───────────────────────────────────────────────────────────

// A trimmed view of the daemon's `CacheEntry` (lib/state/branch-cache.ts),
// naming only the fields console's run-view rows read, spelled as they land
// on the wire (`mr` is `toMRInfo(pr)`: camelCase `webUrl`, nested
// `pipeline.status`, no `ciStatus`).
export const BranchEnrichmentSchema = z.object({
  ticket: z.object({ identifier: z.string(), title: z.string(), url: z.string() }).nullable(),
  mr: z
    .object({
      iid: z.number(),
      webUrl: z.string().nullable(),
      state: z.string(),
      pipeline: z.object({ status: z.string() }).nullable(),
    })
    .nullable(),
  fetchedAt: z.number(),
});

// ─── Events bus ─────────────────────────────────────────────────────────────

// Mirrors lib/daemon/events-bus.ts's BusEvent (RT-44).
export const EventsBusEventSchema = z.object({
  id: z.number(),
  topic: z.string(),
  payload: z.unknown(),
  emittedAt: z.number(),
});

// ─── Runs ───────────────────────────────────────────────────────────────────

// SKILLS-53: one judgment, computed once in rt, so the console and the tray
// never derive two verdicts that can disagree.
export const AttentionSchema = z.object({
  needs: z.boolean(),
  reason: z.enum(["failed", "stale", "stranded", "blocked"]).nullable(),
  evidence: z.string(),
});

export const RunOutcomeSchema = z.object({
  status: z.enum(["running", "done", "abandoned", "failed"]),
  mr: z
    .object({
      iid: z.number(),
      state: z.enum(["opened", "merged", "closed", "unknown"]),
      url: z.string().nullable(),
      mergedAt: z.number().optional(),
    })
    .optional()
    .describe("The run's own MR, written by ship or watch-ci."),
  reviewed: z
    .object({ iid: z.number(), url: z.string().nullable(), posted: z.string().nullable() })
    .optional()
    .describe("The MR a review or respond run looked at; never counts as merged."),
  ci: z.string().nullable().optional(),
});

export const RunAgentSchema = z.object({
  status: z.enum(["working", "idle", "blocked", "done", "unknown"]),
  pane: z.string(),
});

export const RunSummarySchema = z.object({
  id: z.string(),
  repo: z.string(),
  work_type: z.string(),
  pipeline: z.string(),
  status: z.string(),
  current_stage: z.string().nullable(),
  spawned_by: z.string().nullable(),
  started_at: z.number(),
  ended_at: z.number().nullable(),
  pack_commits: z.string().nullable().describe("Null on runs written before schema v2."),
  pack_dirty: z
    .number()
    .describe("Set when the pack tree had uncommitted changes, so the as-run text may exist in no commit."),
  attention: AttentionSchema,
  last_event_at: z
    .number()
    .describe(
      "Max over stage, field and decision timestamps; `started_at` when the run has produced no events yet. The board orders by silence, so this is its sort key.",
    ),
  ticket: z
    .string()
    .nullable()
    .describe("Denormalized from the run's `ticket` field; null when the run has not produced it yet."),
  branch: z
    .string()
    .nullable()
    .describe("Denormalized from the run's `branch` field; null when the run has not produced it yet."),
  test: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The run's `test` field, recorded from `RT_RUN_TEST` when a validation harness started it. `runs:list` leaves these runs out unless asked.",
    ),
  session: z
    .string()
    .nullable()
    .optional()
    .describe("The run's `claude-session` field; always set by the daemon, null when unrecorded."),
  mr: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The run's own MR url (latest `mr` field, produced by a work stage, an http(s) url); null when none or cleared.",
    ),
  agent: RunAgentSchema.nullable()
    .optional()
    .describe(
      "The herdr agent attributed to this run (matched by recorded claude session, else by worktree), mirrored live from `herdr agent list`. Null when no agent matches or herdr is unavailable; absent on pre-mirror daemons.",
    ),
  stages: z
    .array(
      z.object({
        name: z.string(),
        status: z.string(),
        started_at: z.number().nullable(),
        ended_at: z.number().nullable().optional(),
        attempt: z.number().optional(),
      }),
    )
    .optional()
    .describe("Executed stages only, in run order; the pipeline may define more that have not started."),
  decision_count: z.number().optional(),
  evidence_count: z
    .number()
    .optional()
    .describe(
      "Images the run's `evidence` field records (each base and each annotated copy); 0 for legacy or absent evidence.",
    ),
  evidence_cases: z
    .number()
    .optional()
    .describe("Cases the run's `evidence` field records (v1 counts as one); 0 for legacy or absent evidence."),
  evidence_links: z
    .number()
    .optional()
    .describe("Links a legacy (pre-v1) `evidence` field names; 0 for v1 or absent evidence."),
  outcome: RunOutcomeSchema.optional().describe(
    "How the run ended up: its own status plus the MR it opened or reviewed. Absent on pre-outcome daemons.",
  ),
  hold: z
    .object({ reason: z.string(), at: z.number() })
    .nullable()
    .optional()
    .describe(
      "A pause that applies to the current attempt (the `hold` field written during it), else null. Absent on older daemons.",
    ),
  redo: z
    .object({ gate: z.string(), to: z.string(), note: z.string() })
    .nullable()
    .optional()
    .describe("An operator's Redo waiting for the worker's next `run_next`, else null. Absent on older daemons."),
});

export const RunStageRowSchema = z.object({
  name: z.string(),
  status: z.string(),
  attempt: z.number(),
  started_at: z.number().nullable(),
  ended_at: z.number().nullable(),
  reason: z.string().nullable(),
  detail_path: z.string().nullable(),
});
export const RunFieldRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  produced_by: z.string(),
  at: z.number(),
});
export const RunDecisionRowSchema = z.object({
  contract: z.string(),
  scope: z.string(),
  selection: z.string(),
  decided_by: z.string(),
  decided_at: z.number(),
});
export const RunDetailSchema = z.object({
  run: RunSummarySchema,
  stages: z.array(RunStageRowSchema),
  fields: z.array(RunFieldRowSchema),
  decisions: z.array(RunDecisionRowSchema),
  schemaAhead: z.boolean(),
});

// ─── Usage ──────────────────────────────────────────────────────────────────

// Mirrors lib/usage/mr-key.ts's UsageKind.
export const UsageKindSchema = z.enum(["work", "review", "respond", "doctor", "other"]);

export const UsageTotalsSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  messages: z.number(),
  cost: z.number().describe("Estimated USD, covering priced models only."),
  unpricedTokens: z
    .number()
    .describe("Tokens from models with no price, so a new model reads as incomplete rather than cheap."),
});

export const UsageModelRowSchema = z.object({ model: z.string().nullable(), totals: UsageTotalsSchema });

export const UsageSplitsSchema = z.object({
  byModel: z.array(UsageModelRowSchema),
  main: UsageTotalsSchema,
  subagent: UsageTotalsSchema,
});

export const UsageBillingSchema = z
  .enum(["metered", "plan", "unknown"])
  .describe(
    "`metered` bills per token, `plan` rides a subscription, `unknown` has no account recorded. A `byBilling` split always adds up to the `totals` beside it.",
  );

const UsageByBillingSchema = z.record(UsageBillingSchema, UsageTotalsSchema);

export const UsageAccountSchema = z.object({
  account: z.string(),
  label: z.string().nullable(),
  billing: UsageBillingSchema,
});

export const UsageMrRowSchema = z.object({
  mrKey: z.string(),
  url: z.string().nullable(),
  ticket: z.string().nullable(),
  branch: z.string().nullable(),
  firstActivity: z.number(),
  lastActivity: z.number(),
  totals: UsageTotalsSchema,
  byBilling: UsageByBillingSchema,
  costByKind: z.record(UsageKindSchema, z.number()),
  runCount: z.number(),
  roundCount: z.number(),
});

export const UsageMrsDataSchema = z.object({
  mrs: z.array(UsageMrRowSchema),
  summary: z.object({
    mrCount: z.number(),
    totals: UsageTotalsSchema,
    byBilling: UsageByBillingSchema,
    medianCost: z.number(),
  }),
});

export const UsageOutsideSchema = z
  .enum(["before", "between", "after", "none", "session"])
  .describe(
    "When a run's message fell outside every stage; `none` is a run with no stages at all. `session` is the run's session before it started or after it ended: shown, never counted.",
  );

export const UsageStageRowSchema = z
  .object({
    name: z.string().nullable(),
    attempt: z.number().nullable(),
    outside: UsageOutsideSchema.nullable(),
    status: z.string().nullable(),
    startedAt: z.number().nullable(),
    endedAt: z.number().nullable(),
    firstActivity: z.number().nullable().describe("The messages' own span, null on a stage with none."),
    lastActivity: z.number().nullable(),
    subagentCost: z.number(),
    totals: UsageTotalsSchema,
  })
  .describe("`name` and `attempt` are null, and `outside` set, on a row of a run's messages outside every stage.");

export const UsageMrEntrySchema = UsageSplitsSchema.extend({
  runId: z.string().nullable(),
  sessionId: z.string().nullable(),
  kind: UsageKindSchema,
  round: z.number().nullable().describe("Position among the MR's respond runs, from 1. Null on every other kind."),
  pipeline: z.string().nullable(),
  status: z.string().nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  firstActivity: z.number(),
  lastActivity: z.number(),
  totals: UsageTotalsSchema,
  byBilling: UsageByBillingSchema,
  accounts: z
    .array(UsageAccountSchema)
    .describe("In the order the entry first ran on each; empty when none was recorded."),
  stages: z.array(UsageStageRowSchema),
}).describe("One run, or one agent-only session when `runId` is null.");

export const UsageMrDataSchema = UsageSplitsSchema.extend({
  mrKey: z.string(),
  url: z.string().nullable(),
  ticket: z.string().nullable(),
  branch: z.string().nullable(),
  firstActivity: z.number(),
  lastActivity: z.number(),
  totals: UsageTotalsSchema,
  byBilling: UsageByBillingSchema,
  costByKind: z.record(UsageKindSchema, z.number()),
  outsideRuns: UsageTotalsSchema.describe(
    "The runs' sessions outside the runs themselves, which none of the totals above count.",
  ),
  runs: z.array(UsageMrEntrySchema),
});

export const UsageRunDataSchema = z
  .object({
    runId: z.string(),
    mrKey: z.string().nullable(),
    totals: UsageTotalsSchema,
    mrCost: z.number().nullable(),
  })
  .describe("What one run cost, beside the MR it counts toward. `mrCost` is null with no MR.");

export const UsageWeekRowSchema = z.object({
  weekStart: z.number().describe("Local Monday midnight, epoch ms."),
  totals: UsageTotalsSchema,
  byKind: z.record(UsageKindSchema, UsageTotalsSchema),
});

export const UsagePipelineRowSchema = z.object({ pipeline: z.string().nullable(), totals: UsageTotalsSchema });

export const UsageTrendsDataSchema = z.object({
  weeks: z.array(UsageWeekRowSchema).describe("Weeks with no messages are left out."),
  totals: UsageTotalsSchema,
  byBilling: UsageByBillingSchema,
  byPipeline: z.array(UsagePipelineRowSchema),
  byModel: z.array(UsageModelRowSchema),
});

export const UsageStatusDataSchema = z.object({
  lastSweepAt: z.number().nullable(),
  lastSweepMs: z.number().nullable(),
  messages: z.number(),
  runs: z.number(),
  skippedLines: z.number(),
  conflicts: z.number(),
  skippedRate: z.number(),
  unpricedModels: z.array(z.string()),
  sessionsMissingTranscript: z.number(),
});

// ─── Reconciler ─────────────────────────────────────────────────────────────

export const ExecutorViewSchema = z
  .object({
    agentId: z.string(),
    repo: z.string().nullable(),
    subject: z.string().nullable(),
    surface: AgentSurfaceSchema,
    sessionId: z.string(),
    paneRef: z.string().nullable(),
    state: ExecutorStateSchema,
    since: z.number(),
    openGateIds: z.array(z.string()),
  })
  .describe("The reconciler's per-agent snapshot: one row per agent it knows about, live or not.");

export const ReconcilerStatusSchema = z.object({
  sweptAt: z.number(),
  herdrReachable: z.boolean(),
  executors: z.array(ExecutorViewSchema),
});

// ─── Tray, ports, repos, notifications ──────────────────────────────────────

// Mirrors lib/worktree/ready-held.ts's ReadyHeldRepo.
export const ReadyHeldRepoSchema = z.object({
  repo: z.string().describe("Serialized repo identity. A key, never displayed."),
  label: z.string().describe("Decoded display name. Never sent back as a key."),
  hash: z.string(),
  approveCommand: z.string(),
});

export const TrayStatusDataSchema = z.object({
  pid: z.number(),
  uptime: z.number(),
  memoryUsage: z.number(),
  watchedRepos: z.number(),
  cacheEntries: z.number(),
  portsCached: z.number(),
  portCacheAge: z.number().nullable(),
  lastRefresh: z.number().nullable(),
  portsByRepo: z.record(z.string(), z.number()),
  pendingNotifications: z.number(),
  health: z.object({ level: HealthLevelSchema, reasons: z.array(z.string()) }),
  metrics: HealthMetricsSchema,
  eventLoop: HealthEventLoopSchema,
  worktreeReadyHeld: z
    .array(ReadyHeldRepoSchema)
    .optional()
    .describe("Optional because a daemon older than RT-98 does not send it."),
});

// Mirrors lib/port-scanner.ts's PortEntry.
export const PortEntrySchema = z.object({
  port: z.number(),
  pid: z.number(),
  command: z.string(),
  cwd: z.string(),
  repo: z.string().nullable(),
  worktree: z.string().nullable(),
  branch: z.string().nullable(),
  relativeDir: z.string(),
  uptime: z.string(),
});

export const PortsDataSchema = z.object({
  ports: z.array(PortEntrySchema),
  grouped: z.record(z.string(), z.record(z.string(), z.array(PortEntrySchema))),
  updatedAt: z.number(),
  age: z.number().nullable(),
});

// Mirrors lib/state/notifier-store.ts's NotificationEvent.
export const RtNotificationEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  url: z.string().optional(),
  category: z.string(),
  timestamp: z.number(),
  pids: z.array(z.number()).optional(),
});

export const ReposDataSchema = z.object({
  repos: z.record(
    z.string(),
    z.object({ path: z.string(), worktrees: z.array(z.object({ path: z.string(), branch: z.string() })) }),
  ),
  watched: z.array(z.string()),
});

// ─── System processes ───────────────────────────────────────────────────────

// Read off lib/daemon/handlers/system-processes.ts, not lib's SystemProcess:
// the handler swaps `repo` for its display label and adds the tree fields.
const ProcessNodeBaseSchema = z.object({
  pid: z.number().describe("The chain root's pid on a flattened row."),
  ppid: z.number(),
  command: z
    .string()
    .describe("The binary's short name; on a flattened single-child chain, every name joined by ` › `."),
  fullCommand: z.string(),
  cpuPercent: z.number(),
  rssKb: z.number(),
  uptime: z.string(),
  cwd: z.string(),
  repo: z.string().describe("The repo's display label, never a serialized identity."),
  worktree: z.string().nullable(),
  branch: z.string().nullable(),
  relativeDir: z.string(),
  port: z.number().nullable(),
  linearTicket: z.string().nullable().describe("`<identifier>: <title>` from the branch cache."),
  packageScript: z
    .string()
    .nullable()
    .describe("Reconstructed package-script invocation; null when not launched via a package-manager script."),
  firstSeen: z.number(),
  chainPids: z
    .array(z.number())
    .optional()
    .describe("Every pid collapsed into a flattened chain row, root to leaf, so a kill signals the whole chain."),
  // Constants kept on the wire: a tray built before runaway detection was
  // removed decodes `isRunaway` as a required Bool.
  isRunaway: z.literal(false),
  runawayDurationMs: z.null(),
  totalCpuPercent: z.number().optional().describe("Summed over the whole subtree; set on root rows only."),
  totalRssKb: z.number().optional().describe("Summed over the whole subtree; set on root rows only."),
});

export type ProcessNode = z.infer<typeof ProcessNodeBaseSchema> & { children: ProcessNode[] };

export const ProcessNodeSchema: z.ZodType<ProcessNode> = z
  .lazy(() => ProcessNodeBaseSchema.extend({ children: z.array(ProcessNodeSchema) }))
  .meta({ id: "ProcessNode" });

export const SystemProcessesDataSchema = z.object({
  processes: z.array(ProcessNodeSchema),
  updatedAt: z.number(),
  ready: z.boolean().describe("False until the scanner has completed its first scan."),
});

// ─── SDM ────────────────────────────────────────────────────────────────────

// Both handlers answer a flat envelope with no `data` wrapper
// (lib/daemon/handlers/sdm.ts), so these model the whole reply.
const SdmHealthSchema = z.object({
  status: z.enum(["ok", "not-installed", "not-authenticated", "error"]),
  message: z.string().nullable(),
});

const SdmRecentSchema = z.object({
  key: z.string(),
  label: z.string(),
  sdmResource: z.string(),
  tier: z.string().optional(),
  production: z.boolean().optional(),
  reasonSuggestion: z.string().optional(),
  db: z
    .object({ database: z.string().optional(), schema: z.string().optional(), user: z.string().optional() })
    .optional(),
  lastConnectedAt: z.string(),
  connected: z.boolean(),
  address: z.string().nullable(),
});

export const SdmRecentsReplySchema = z.object({
  ok: z.literal(true),
  health: SdmHealthSchema,
  recents: z.array(SdmRecentSchema),
});

const SdmReconnectConnectedSchema = z.object({
  ok: z.literal(true),
  address: z.string(),
  verifyAttempts: z.number(),
});

// z.union takes the first branch that parses and strips keys it does not
// name, so the bare-`error` branch must come after every `outcome` branch.
export const SdmReconnectReplySchema = z.union([
  SdmReconnectConnectedSchema,
  z
    .object({ ok: z.literal(false), outcome: z.literal("needs-access-request"), resource: z.string() })
    .describe("Reconnect never submits an access request; the tray routes the human through one instead."),
  z.object({ ok: z.literal(false), outcome: z.enum(["aborted", "failed"]), error: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }).describe("An unknown recents key."),
]);

// ─── Secrets ────────────────────────────────────────────────────────────────

// Extend a whitelist only in lockstep with lib/daemon/handlers/secrets.ts
// and, for "extension", extensions/vscode/rt-context/src/secrets.ts.
// Every key is optional, so the branches are strict: a plain object would
// let the first branch match any reply and strip the other scopes' keys.
export const SecretsReadDataSchema = z
  .union([
    z
      .strictObject({ linearApiKey: z.string().optional(), gitlabToken: z.string().optional() })
      .describe("scope `extension`, the default"),
    z
      .strictObject({
        cfApiToken: z.string().optional(),
        cfZoneId: z.string().optional(),
        cfDnsToken: z.string().optional().describe("Cloudflare Zone.DNS:Edit token, distinct from the Access-scoped `cfApiToken`."),
        railwayToken: z.string().optional().describe("Railway project token."),
        railwayApiToken: z.string().optional().describe("Railway account or team token."),
      })
      .describe("scope `deck`"),
    z
      .strictObject({
        slackToken: z.string().optional(),
        slackClientSecret: z.string().optional(),
        slackSigningSecret: z.string().optional(),
        gitlabToken: z.string().optional(),
        switchboardToken: z.string().optional(),
        switchboardAdminToken: z.string().optional(),
      })
      .describe("scope `board`"),
  ])
  .describe("The requested scope's whitelisted secrets; each key is present only when set.");

// ─── Per-command payload and data ───────────────────────────────────────────

const emptyPayload = () => z.object({}).strict();

export const trayStatusPayloadSchema = emptyPayload();
export const trayStatusDataSchema = TrayStatusDataSchema;

export const portsPayloadSchema = z.object({ repo: z.string().optional(), refresh: z.boolean().optional() });
export const portsDataSchema = PortsDataSchema;

export const cacheReadPayloadSchema = z.object({
  branches: z.array(z.string()).optional(),
  maxAgeMs: z.number().optional(),
  repoIdentity: z.string().optional(),
});
export const cacheReadDataSchema = z.record(z.string(), BranchEnrichmentSchema);

export const reposPayloadSchema = emptyPayload();
export const reposDataSchema = ReposDataSchema;

export const notificationsPayloadSchema = emptyPayload();
export const notificationsDataSchema = z.array(RtNotificationEventSchema);

export const cacheRefreshPayloadSchema = emptyPayload();
export const cacheRefreshDataSchema = z.object({ message: z.string() });

export const systemProcessesPayloadSchema = emptyPayload();
export const systemProcessesDataSchema = SystemProcessesDataSchema;

export const sdmRecentsPayloadSchema = emptyPayload();
export const sdmRecentsDataSchema = SdmRecentsReplySchema.omit({ ok: true });

export const sdmReconnectPayloadSchema = z.object({ key: z.string() });
export const sdmReconnectDataSchema = SdmReconnectConnectedSchema.omit({ ok: true });

export const eventsEmitPayloadSchema = z.object({ topic: z.string(), payload: z.unknown().optional() });
export const eventsEmitDataSchema = z.object({ id: z.number() });

export const eventsListPayloadSchema = z.object({
  pattern: z.string(),
  after: z.number().optional(),
  limit: z.number().optional(),
});
export const eventsListDataSchema = z.object({ events: z.array(EventsBusEventSchema), cursor: z.number() });

export const runsListPayloadSchema = z.object({ repo: z.string().optional(), includeTests: z.boolean().optional() });
export const runsListDataSchema = z.object({ runs: z.array(RunSummarySchema) });

export const runsGetPayloadSchema = z.object({ runId: z.string(), repo: z.string().optional() });
export const runsGetDataSchema = RunDetailSchema;

export const usageMrsPayloadSchema = z.object({ days: z.number().optional(), repo: z.string().optional() });
export const usageMrsDataSchema = UsageMrsDataSchema;

export const usageMrPayloadSchema = z.object({ mrKey: z.string() });
export const usageMrDataSchema = UsageMrDataSchema.nullable().describe("Null when no MR has that key.");

export const usageRunPayloadSchema = z.object({ runId: z.string() });
export const usageRunDataSchema = UsageRunDataSchema.nullable();

export const usageTrendsPayloadSchema = z.object({ days: z.number(), repo: z.string().optional() });
export const usageTrendsDataSchema = UsageTrendsDataSchema;

export const usageStatusPayloadSchema = emptyPayload();
export const usageStatusDataSchema = UsageStatusDataSchema;

export const reconcilerStatusPayloadSchema = emptyPayload();
export const reconcilerStatusDataSchema = ReconcilerStatusSchema;

export const reconcilerClearPayloadSchema = z.object({ agentId: z.string() });
export const reconcilerClearDataSchema = z.object({ cleared: z.literal(true) });

export const hooksRepairPayloadSchema = z.object({ repo: z.string() });
export const hooksRepairDataSchema = z.object({ repaired: z.boolean() });

export const secretsReadPayloadSchema = z.object({
  token: z
    .string()
    .optional()
    .describe("The daemon API token; checked by the handler on every transport. REST forwards `X-RT-Token`."),
  scope: z.enum(["extension", "deck", "board"]).optional(),
});
export const secretsReadDataSchema = SecretsReadDataSchema;
