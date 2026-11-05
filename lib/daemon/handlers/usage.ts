import { usageMr, usageMrs, usageStatus, usageTrends } from "../../usage/queries.ts";
import { usageDbPath } from "../../usage/store.ts";
import type { HandlerContext, CommandResult } from "./types.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";

type UsageHandlers = { "usage:mrs": (payload: unknown) => Promise<CommandResult<"usage:mrs">> }
  & { "usage:mr": (payload: unknown) => Promise<CommandResult<"usage:mr">> }
  & { "usage:trends": (payload: unknown) => Promise<CommandResult<"usage:trends">> }
  & { "usage:status": (payload: unknown) => Promise<CommandResult<"usage:status">> };

export interface UsageSeams {
  dbPath?: string;
}

/** The trends route takes no token and runs one synchronous query per week on the daemon's event loop. */
const MAX_DAYS = 3650;
const DAYS_ERROR = `days must be a positive number up to ${MAX_DAYS}`;

function readDays(raw: unknown): number | null {
  return typeof raw === "number" && raw > 0 && raw <= MAX_DAYS ? raw : null;
}

function readRepo(raw: unknown): string | undefined {
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

export function createUsageHandlers(
  ctx: Pick<HandlerContext, "log">,
  seams: UsageSeams = {},
): UsageHandlers {
  const dbPath = () => seams.dbPath ?? usageDbPath();
  return {
    "usage:mrs": async (rawPayload: unknown): Promise<CommandResult<"usage:mrs">> => {
      const payload = rawPayload as Commands["usage:mrs"]["payload"] | undefined;
      const hasDays = payload?.days !== undefined;
      const days = hasDays ? readDays(payload?.days) : undefined;
      if (hasDays && days === null) return { ok: false as const, error: DAYS_ERROR };
      try {
        const q: { days?: number; repo?: string; now: number } = { now: Date.now() };
        if (days !== undefined && days !== null) q.days = days;
        const repo = readRepo(payload?.repo);
        if (repo !== undefined) q.repo = repo;
        return { ok: true as const, data: usageMrs(dbPath(), q) };
      } catch (err) {
        ctx.log.warn({ err }, "usage:mrs failed");
        return { ok: false as const, error: String(err) };
      }
    },
    "usage:mr": async (rawPayload: unknown): Promise<CommandResult<"usage:mr">> => {
      const payload = rawPayload as Commands["usage:mr"]["payload"] | undefined;
      const mrKey = typeof payload?.mrKey === "string" ? payload.mrKey.trim() : "";
      if (!mrKey) return { ok: false as const, error: "missing mrKey" };
      try {
        return { ok: true as const, data: usageMr(dbPath(), mrKey) };
      } catch (err) {
        ctx.log.warn({ err, mrKey }, "usage:mr failed");
        return { ok: false as const, error: String(err) };
      }
    },
    "usage:trends": async (rawPayload: unknown): Promise<CommandResult<"usage:trends">> => {
      const payload = rawPayload as Commands["usage:trends"]["payload"] | undefined;
      const days = readDays(payload?.days);
      if (days === null) return { ok: false as const, error: DAYS_ERROR };
      try {
        const q: { days: number; repo?: string; now: number } = { days, now: Date.now() };
        const repo = readRepo(payload?.repo);
        if (repo !== undefined) q.repo = repo;
        return { ok: true as const, data: usageTrends(dbPath(), q) };
      } catch (err) {
        ctx.log.warn({ err }, "usage:trends failed");
        return { ok: false as const, error: String(err) };
      }
    },
    "usage:status": async (): Promise<CommandResult<"usage:status">> => {
      try {
        return { ok: true as const, data: usageStatus(dbPath()) };
      } catch (err) {
        ctx.log.warn({ err }, "usage:status failed");
        return { ok: false as const, error: String(err) };
      }
    },
  };
}
