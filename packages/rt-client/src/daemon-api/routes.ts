/**
 * The daemon's REST contract. The daemon binds its routing to this table,
 * the OpenAPI document registers it, and the typed client infers from it.
 * Request schemas describe what each route reads; nothing validates a
 * request against them.
 */
import { z } from "zod";
import * as S from "../command-schemas.ts";
import { okData, okFlat } from "./envelopes.ts";

export interface DaemonRoute {
  id: string;
  method: "get" | "post";
  /** OpenAPI form, e.g. `/api/runs/{repo}/{runId}`. */
  path: string;
  /** Hono match pattern; parameterized routes are wildcards because dispatch slices the raw path itself. */
  honoPath: string;
  cmd: string;
  /** The area the docs group this route under; one of `ROUTE_TAGS`. */
  tag?: string;
  summary: string;
  description?: string;
  /** Needs `X-RT-Token`. */
  token: boolean;
  /** Every reply past the token gate carries `Cache-Control: no-store`, so no browser cache keeps it. */
  noStore?: boolean;
  /** A path under this route's prefix without its full shape answers the shared 404. */
  shapeNotFound?: boolean;
  /** `generic` builds the command payload from the query or body, and only these answer 405 on a wrong method; `special` reads its own inputs. */
  kind: "generic" | "special";
  request: { query?: z.ZodObject<z.ZodRawShape, z.core.$ZodObjectConfig>; params?: z.ZodObject<z.ZodRawShape, z.core.$ZodObjectConfig>; body?: z.ZodType };
  /** The 200 envelope as the handler really answers it. */
  success: z.ZodType;
}

export const API_VERSION = "1.0.0";

/** In the order the docs list the groups. */
export const ROUTE_TAGS: readonly { name: string; description: string }[] = [
  { name: "Status", description: "Daemon health and listening ports" },
  { name: "Cache", description: "Branch cache entries and refreshes" },
  { name: "Repos", description: "Tracked repos and their worktrees" },
  { name: "Notifications", description: "The pending notification queue" },
  { name: "Processes", description: "Repo-associated processes" },
  { name: "StrongDM", description: "Recent StrongDM connections" },
  { name: "Events", description: "The pane-communication event bus" },
  { name: "Runs", description: "Pipeline runs" },
  { name: "Usage", description: "Token usage and estimated cost" },
  { name: "Reconciler", description: "The executor reconciler" },
  { name: "Hooks", description: "Repo hooks paths" },
  { name: "Secrets", description: "Whitelisted secret values" },
  { name: "Daemon", description: "Daemon lifecycle" },
];

export const ShutdownReplySchema = okFlat({ message: z.string() });

export const WEBSOCKET_EVENTS: readonly { type: string; description: string }[] = [
  { type: "status", description: "Full daemon status — after each cache refresh (~5 min)" },
  { type: "ports", description: "Full port list — after each port scan (~30s)" },
  { type: "notification", description: "Notification event — when a transition fires" },
  { type: "event", description: "Events-bus broadcast frame; topic run-updated announces pipeline run writes" },
];

export const statusGetRoute = {
  id: "status.get",
  method: "get",
  path: "/api/status",
  honoPath: "/api/status",
  cmd: "tray:status",
  tag: "Status",
  summary: "Get daemon status",
  description: "Health, uptime, memory and cache stats.",
  token: false,
  kind: "generic",
  request: { query: S.trayStatusPayloadSchema },
  success: okData(S.trayStatusDataSchema),
} as const satisfies DaemonRoute;

export const portsListRoute = {
  id: "ports.list",
  method: "get",
  path: "/api/ports",
  honoPath: "/api/ports",
  cmd: "ports",
  tag: "Status",
  summary: "List listening ports",
  description: "Grouped by repo and worktree.",
  token: false,
  kind: "generic",
  request: { query: S.portsPayloadSchema },
  success: okData(S.portsDataSchema),
} as const satisfies DaemonRoute;

export const cacheListRoute = {
  id: "cache.list",
  method: "get",
  path: "/api/cache",
  honoPath: "/api/cache",
  cmd: "cache:read",
  tag: "Cache",
  summary: "List cache entries",
  description: "Each branch's MR or PR, Linear ticket and pipeline. A `repoIdentity` (a serialized repo identity) keeps only that repo's entries and ignores every other parameter.",
  token: false,
  kind: "generic",
  // A query string carries one scalar per key, so the payload's `branches` array is not readable here.
  request: { query: z.object({ maxAgeMs: z.number().optional(), repoIdentity: z.string().optional() }) },
  success: okData(S.cacheReadDataSchema),
} as const satisfies DaemonRoute;

export const cacheGetRoute = {
  id: "cache.get",
  method: "get",
  path: "/api/cache/{branch}",
  honoPath: "/api/cache/*",
  cmd: "cache:read",
  tag: "Cache",
  summary: "Get a branch's entry",
  description: "A `repoIdentity` picks that repo's entry for the branch.",
  token: false,
  kind: "special",
  request: {
    params: z.object({ branch: z.string() }),
    query: z.object({ repoIdentity: z.string().optional() }),
  },
  success: okData(S.cacheReadDataSchema),
} as const satisfies DaemonRoute;

export const reposListRoute = {
  id: "repos.list",
  method: "get",
  path: "/api/repos",
  honoPath: "/api/repos",
  cmd: "repos",
  tag: "Repos",
  summary: "List tracked repos",
  description: "With their worktrees and watched status.",
  token: false,
  kind: "generic",
  request: { query: S.reposPayloadSchema },
  success: okData(S.reposDataSchema),
} as const satisfies DaemonRoute;

export const worktreesPickerRoute = {
  id: "worktrees.picker",
  method: "get",
  path: "/api/worktrees/picker",
  honoPath: "/api/worktrees/picker",
  cmd: "worktrees:picker",
  tag: "Repos",
  summary: "List a repo's worktrees",
  description: "In `rt cd`'s order, with recency groups. `path` is any worktree of the repo.",
  token: false,
  kind: "generic",
  request: { query: S.worktreesPickerPayloadSchema },
  success: okData(S.worktreesPickerDataSchema),
} as const satisfies DaemonRoute;

export const processesListRoute = {
  id: "processes.list",
  method: "get",
  path: "/api/processes/system",
  honoPath: "/api/processes/system",
  cmd: "system-processes",
  tag: "Processes",
  summary: "List repo processes",
  description: "Every repo-associated process with CPU, memory and ports, read on demand.",
  token: false,
  kind: "generic",
  request: { query: S.systemProcessesPayloadSchema },
  success: okData(S.systemProcessesDataSchema),
} as const satisfies DaemonRoute;

export const notificationsDrainRoute = {
  id: "notifications.drain",
  method: "get",
  path: "/api/notifications",
  honoPath: "/api/notifications",
  cmd: "notifications",
  tag: "Notifications",
  summary: "Drain notifications",
  description: "Returns the pending notifications and empties the queue.",
  token: true,
  kind: "generic",
  request: { query: S.notificationsPayloadSchema },
  success: okData(S.notificationsDataSchema),
} as const satisfies DaemonRoute;

export const cacheRefreshRoute = {
  id: "cache.refresh",
  method: "post",
  path: "/api/refresh",
  honoPath: "/api/refresh",
  cmd: "cache:refresh",
  tag: "Cache",
  summary: "Refresh the cache",
  description: "Starts a background cache refresh.",
  token: true,
  kind: "generic",
  request: { body: S.cacheRefreshPayloadSchema },
  success: okFlat(S.cacheRefreshDataSchema.shape),
} as const satisfies DaemonRoute;

export const hooksRepairRoute = {
  id: "hooks.repair",
  method: "post",
  path: "/api/hooks/{repo}/repair",
  honoPath: "/api/hooks/*",
  cmd: "hooks:repair",
  tag: "Hooks",
  summary: "Repair a repo's hooks",
  description: "Repairs the repo's hooks path. A path under `/api/hooks/` that does not end in `/repair` answers 404.",
  token: true,
  shapeNotFound: true,
  kind: "special",
  request: { params: z.object({ repo: z.string() }) },
  success: okFlat(S.hooksRepairDataSchema.shape),
} as const satisfies DaemonRoute;

export const daemonShutdownRoute = {
  id: "daemon.shutdown",
  method: "post",
  path: "/api/shutdown",
  honoPath: "/api/shutdown",
  cmd: "shutdown",
  tag: "Daemon",
  summary: "Stop the daemon",
  description: "Shuts the daemon down gracefully.",
  token: true,
  kind: "generic",
  request: { body: z.object({}) },
  success: ShutdownReplySchema,
} as const satisfies DaemonRoute;

export const sdmRecentsRoute = {
  id: "sdm.recents",
  method: "get",
  path: "/api/sdm/recents",
  honoPath: "/api/sdm/recents",
  cmd: "sdm:recents",
  tag: "StrongDM",
  summary: "List recent connections",
  description: "Recent StrongDM connections with their live connected state.",
  token: false,
  kind: "generic",
  request: { query: S.sdmRecentsPayloadSchema },
  success: S.SdmRecentsReplySchema,
} as const satisfies DaemonRoute;

export const sdmReconnectRoute = {
  id: "sdm.reconnect",
  method: "post",
  path: "/api/sdm/reconnect",
  honoPath: "/api/sdm/reconnect",
  cmd: "sdm:reconnect",
  tag: "StrongDM",
  summary: "Reconnect a recent",
  description: "Reconnects a recent StrongDM connection without prompting. Fails if an access request is needed.",
  token: true,
  kind: "generic",
  request: { body: S.sdmReconnectPayloadSchema },
  success: S.SdmReconnectReplySchema,
} as const satisfies DaemonRoute;

export const eventsEmitRoute = {
  id: "events.emit",
  method: "post",
  path: "/api/events/emit",
  honoPath: "/api/events/emit",
  cmd: "events:emit",
  tag: "Events",
  summary: "Emit an event",
  description: "Puts an event on the pane-communication bus.",
  token: true,
  kind: "generic",
  request: { body: S.eventsEmitPayloadSchema },
  success: okData(S.eventsEmitDataSchema),
} as const satisfies DaemonRoute;

export const eventsListRoute = {
  id: "events.list",
  method: "get",
  path: "/api/events",
  honoPath: "/api/events",
  cmd: "events:list",
  tag: "Events",
  summary: "List events",
  description: "Events matching a topic pattern.",
  token: false,
  kind: "generic",
  request: { query: S.eventsListPayloadSchema },
  success: okData(S.eventsListDataSchema),
} as const satisfies DaemonRoute;

export const secretsReadRoute = {
  id: "secrets.read",
  method: "get",
  path: "/api/secrets",
  honoPath: "/api/secrets",
  cmd: "secrets:read",
  tag: "Secrets",
  summary: "Read secrets",
  description: "The whitelisted secret values (`linearApiKey`, `gitlabToken`). Reads no query; only the `X-RT-Token` header is forwarded to the handler, which checks it again, so the reply is always the `extension` scope.",
  token: true,
  noStore: true,
  kind: "special",
  request: {},
  success: okData(S.SecretsReadExtensionDataSchema),
} as const satisfies DaemonRoute;

export const runsListRoute = {
  id: "runs.list",
  method: "get",
  path: "/api/runs",
  honoPath: "/api/runs",
  cmd: "runs:list",
  tag: "Runs",
  summary: "List runs",
  description: "Pipeline runs, newest first. `repo` scopes them.",
  token: false,
  kind: "generic",
  request: { query: S.runsListPayloadSchema },
  success: okData(S.runsListDataSchema),
} as const satisfies DaemonRoute;

export const runsGetRoute = {
  id: "runs.get",
  method: "get",
  path: "/api/runs/{repo}/{runId}",
  honoPath: "/api/runs/*",
  cmd: "runs:get",
  tag: "Runs",
  summary: "Get a run",
  description: "One run's stages, fields and decisions. A path under `/api/runs/` without both a repo and a run id answers 404.",
  token: false,
  shapeNotFound: true,
  kind: "special",
  request: { params: z.object({ repo: z.string(), runId: z.string() }) },
  success: okData(S.runsGetDataSchema),
} as const satisfies DaemonRoute;

export const usageMrsRoute = {
  id: "usage.mrs",
  method: "get",
  path: "/api/usage/mrs",
  honoPath: "/api/usage/mrs",
  cmd: "usage:mrs",
  tag: "Usage",
  summary: "Get usage per MR",
  description: "Token usage and estimated cost per MR or PR. `days` and `repo` scope it.",
  token: false,
  kind: "generic",
  request: { query: S.usageMrsPayloadSchema },
  success: okData(S.usageMrsDataSchema),
} as const satisfies DaemonRoute;

export const usageMrRoute = {
  id: "usage.mr",
  method: "get",
  path: "/api/usage/mr",
  honoPath: "/api/usage/mr",
  cmd: "usage:mr",
  tag: "Usage",
  summary: "Get one MR's usage",
  description: "One MR or PR's usage by run and stage. `mrKey` is URL-encoded.",
  token: false,
  kind: "generic",
  request: { query: S.usageMrPayloadSchema },
  success: okData(S.usageMrDataSchema),
} as const satisfies DaemonRoute;

export const usageRunRoute = {
  id: "usage.run",
  method: "get",
  path: "/api/usage/run",
  honoPath: "/api/usage/run",
  cmd: "usage:run",
  tag: "Usage",
  summary: "Get one run's usage",
  description: "One run's usage beside its MR's cost.",
  token: false,
  kind: "generic",
  request: { query: S.usageRunPayloadSchema },
  success: okData(S.usageRunDataSchema),
} as const satisfies DaemonRoute;

export const usageTrendsRoute = {
  id: "usage.trends",
  method: "get",
  path: "/api/usage/trends",
  honoPath: "/api/usage/trends",
  cmd: "usage:trends",
  tag: "Usage",
  summary: "Get weekly trends",
  description: "Weekly usage by kind, pipeline and model. `days` is required; `repo` scopes it.",
  token: false,
  kind: "generic",
  request: { query: S.usageTrendsPayloadSchema },
  success: okData(S.usageTrendsDataSchema),
} as const satisfies DaemonRoute;

export const usageStatusRoute = {
  id: "usage.status",
  method: "get",
  path: "/api/usage/status",
  honoPath: "/api/usage/status",
  cmd: "usage:status",
  tag: "Usage",
  summary: "Get sweep health",
  description: "The usage sweep's last run, skipped lines and unpriced models.",
  token: false,
  kind: "generic",
  request: { query: S.usageStatusPayloadSchema },
  success: okData(S.usageStatusDataSchema),
} as const satisfies DaemonRoute;

export const reconcilerStatusRoute = {
  id: "reconciler.status",
  method: "get",
  path: "/api/reconciler",
  honoPath: "/api/reconciler",
  cmd: "reconciler:status",
  tag: "Reconciler",
  summary: "Get the last sweep",
  description: "The executor reconciler's last sweep snapshot.",
  token: false,
  kind: "generic",
  request: { query: S.reconcilerStatusPayloadSchema },
  success: okData(S.reconcilerStatusDataSchema),
} as const satisfies DaemonRoute;

export const reconcilerClearRoute = {
  id: "reconciler.clear",
  method: "post",
  path: "/api/reconciler/clear",
  honoPath: "/api/reconciler/clear",
  cmd: "reconciler:clear",
  tag: "Reconciler",
  summary: "Clear an agent's state",
  description: "Clears an agent's reconciler state and its open or parked gates.",
  token: true,
  kind: "generic",
  request: { body: S.reconcilerClearPayloadSchema },
  success: okData(S.reconcilerClearDataSchema),
} as const satisfies DaemonRoute;

/** In today's index order, with `/api/usage/run` beside the other usage routes. */
export const DAEMON_ROUTES = [
  statusGetRoute,
  portsListRoute,
  cacheListRoute,
  cacheGetRoute,
  reposListRoute,
  worktreesPickerRoute,
  processesListRoute,
  notificationsDrainRoute,
  cacheRefreshRoute,
  hooksRepairRoute,
  daemonShutdownRoute,
  sdmRecentsRoute,
  sdmReconnectRoute,
  eventsEmitRoute,
  eventsListRoute,
  secretsReadRoute,
  runsListRoute,
  runsGetRoute,
  usageMrsRoute,
  usageMrRoute,
  usageRunRoute,
  usageTrendsRoute,
  usageStatusRoute,
  reconcilerStatusRoute,
  reconcilerClearRoute,
] as const;
