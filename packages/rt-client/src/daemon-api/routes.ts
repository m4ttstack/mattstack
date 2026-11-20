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
  summary: string;
  description?: string;
  /** Needs `X-RT-Token`. */
  token: boolean;
  /** `generic` is a row of the daemon's REST_ROUTES; only these answer 405 on a wrong method. */
  kind: "generic" | "special";
  request: { query?: z.ZodObject<z.ZodRawShape, z.core.$ZodObjectConfig>; params?: z.ZodObject<z.ZodRawShape, z.core.$ZodObjectConfig>; body?: z.ZodType };
  /** The 200 envelope as the handler really answers it. */
  success: z.ZodType;
}

export const API_VERSION = "1.0.0";

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
  summary: "Daemon health, uptime, memory, cache stats",
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
  summary: "Listening ports grouped by repo/worktree",
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
  summary: "All branch cache entries (MR or PR, Linear, pipeline); ?repoIdentity=<serialized identity> keeps that repo's",
  description: "A `repoIdentity` query ignores every other parameter.",
  token: false,
  kind: "generic",
  request: { query: S.cacheReadPayloadSchema },
  success: okData(S.cacheReadDataSchema),
} as const satisfies DaemonRoute;

export const cacheGetRoute = {
  id: "cache.get",
  method: "get",
  path: "/api/cache/{branch}",
  honoPath: "/api/cache/*",
  cmd: "cache:read",
  summary: "Single branch cache entry; ?repoIdentity=<serialized identity> picks that repo's entry",
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
  summary: "Tracked repos with worktrees and watched status",
  token: false,
  kind: "generic",
  request: { query: S.reposPayloadSchema },
  success: okData(S.reposDataSchema),
} as const satisfies DaemonRoute;

export const processesListRoute = {
  id: "processes.list",
  method: "get",
  path: "/api/processes/system",
  honoPath: "/api/processes/system",
  cmd: "system-processes",
  summary: "All repo-associated processes with CPU, memory and ports, read on demand",
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
  summary: "Pending notifications (drains queue)",
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
  summary: "Trigger a background cache refresh",
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
  summary: "Repair hooks path for a repo",
  token: true,
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
  summary: "Gracefully stop the daemon",
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
  summary: "Recent StrongDM connections with live connected state",
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
  summary: "Reconnect a StrongDM recent (promptless; fails if an access request is needed)",
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
  summary: "Emit an event onto the pane-communication bus",
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
  summary: "List events matching a topic pattern",
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
  summary: "Whitelisted secret values (linearApiKey, gitlabToken) — token-gated",
  description: "Reads no query; the `X-RT-Token` header is forwarded to the handler, which checks it again.",
  token: true,
  kind: "special",
  request: {},
  success: okData(S.secretsReadDataSchema),
} as const satisfies DaemonRoute;

export const runsListRoute = {
  id: "runs.list",
  method: "get",
  path: "/api/runs",
  honoPath: "/api/runs",
  cmd: "runs:list",
  summary: "Pipeline runs, newest first (?repo= to scope)",
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
  summary: "One run: stages, fields, decisions",
  token: false,
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
  summary: "Token usage and estimated cost per MR or PR (?days= &repo= to scope)",
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
  summary: "One MR or PR's usage by run and stage (?mrKey=, URL-encoded)",
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
  summary: "One run's usage beside its MR's cost (?runId=)",
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
  summary: "Weekly usage by kind, pipeline and model (?days= required, ?repo=)",
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
  summary: "Usage sweep health: last sweep, skipped lines, unpriced models",
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
  summary: "Executor reconciler's last sweep snapshot",
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
  summary: "Manually clear an agent's reconciler state and open/parked gates",
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
