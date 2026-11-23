/**
 * runs:* — pipeline run state (SKILLS-28). These handlers read each DB
 * readonly per request and hold nothing, except the three writes only a
 * person can make: runs:abandon (through reconcile.ts, deciding a run is
 * dead), and runs:hold and runs:redo (through control.ts, the console's
 * Pause and Redo).
 */
import { isAbsolute } from "path";
import { findRun, listRuns, readRun } from "../../runs/store.ts";
import { getRunLiveness } from "../../runs/liveness.ts";
import { abandonRun } from "../../runs/reconcile.ts";
import { badNote, CONSOLE_DECIDER, controlFail, holdAtNextStep, requestRedo, type ControlFail } from "../../runs/control.ts";
import { checkTextPath, checkUploadPath } from "../upload-guard.ts";
import {
  EVIDENCE_IMAGE_KEYS, EVIDENCE_SLOTS, EVIDENCE_TEXT_KEYS, EVIDENCE_THEMES, V1_CASE_ID, readEvidence, resolveEvidencePath,
  type EvidenceAddress, type EvidenceImageKey, type EvidenceTextKey,
} from "../../../packages/rt-client/src/evidence.ts";
import type { HandlerContext, CommandResult } from "./types.ts";
import type { Commands, GateRow } from "../../../packages/rt-client/src/commands.ts";

const EVIDENCE_MAX_BYTES = 15 * 1024 * 1024;

type RunsHandlers = { "runs:list": (payload: unknown) => Promise<CommandResult<"runs:list">> }
  & { "runs:get": (payload: unknown) => Promise<CommandResult<"runs:get">> }
  & { "runs:abandon": (payload: unknown) => Promise<CommandResult<"runs:abandon">> }
  & { "runs:hold": (payload: unknown) => Promise<CommandResult<"runs:hold">> }
  & { "runs:redo": (payload: unknown) => Promise<CommandResult<"runs:redo">> }
  & { "runs:evidence": (payload: unknown) => Promise<CommandResult<"runs:evidence">> };

export interface RunsSeams {
  /** Whether an absolute path is a checkout or worktree rt registered under the run's own repo key. */
  isRunTree?: (path: string, runRepo: string) => boolean;
  /** Id of the open kit gate for a Claude session, so a run waiting at one is not read as stale. */
  openKitGate?: (session: string) => string | null;
  gateById?: (id: string) => GateRow | null;
  /** Closes the run's open and parked gates as abandoned: those filed under the run and those whose origin names it. */
  closeRunGates?: (runId: string) => Promise<void>;
}

const PAUSE_REASON = "paused from the console";

function refusal(f: ControlFail): { ok: false; error: string; failure: { code: string; message: string } } {
  return { ok: false, error: f.error, failure: { code: f.code, message: f.error } };
}

function readAddress(p: Record<string, unknown>): EvidenceAddress | null {
  if (typeof p.case !== "string" || !(EVIDENCE_SLOTS as readonly unknown[]).includes(p.slot)) return null;
  if (p.theme !== undefined && !(EVIDENCE_THEMES as readonly unknown[]).includes(p.theme)) return null;
  if (p.annotated !== undefined && typeof p.annotated !== "boolean") return null;
  return p as unknown as EvidenceAddress;
}

export function createRunsHandlers(
  ctx: Pick<HandlerContext, "log">,
  emitEvent: (topic: string, payload: unknown) => void,
  seams: RunsSeams = {},
): RunsHandlers {
  const isRunTree = seams.isRunTree ?? (() => false);
  const handlers: RunsHandlers = {
    "runs:list": async (rawPayload: unknown): Promise<CommandResult<"runs:list">> => {
      // `repo` here is the run DIRECTORY's name — whatever key the pipeline
      // that wrote the run used, surfaced verbatim by runs:list. It is NOT
      // required to parse as an identity: refusing non-identity keys on this
      // read-only surface would 404 exactly the keys runs:list itself hands
      // out for pre-cutover runs.
      const payload = rawPayload as Commands["runs:list"]["payload"] | undefined;
      try {
        return { ok: true as const, data: { runs: listRuns(payload?.repo || undefined, await getRunLiveness(undefined, undefined, seams.openKitGate), { includeTests: payload?.includeTests === true }) } };
      } catch (err) {
        ctx.log.warn({ err }, "runs:list failed");
        return { ok: false as const, error: String(err) };
      }
    },
    "runs:get": async (rawPayload: unknown): Promise<CommandResult<"runs:get">> => {
      const payload = rawPayload as Commands["runs:get"]["payload"] | undefined;
      const runId = typeof payload?.runId === "string" ? payload.runId.trim() : "";
      if (!runId) return { ok: false as const, error: "missing runId" };
      try {
        const liveness = await getRunLiveness(undefined, undefined, seams.openKitGate);
        const detail = payload?.repo ? readRun(payload.repo, runId, liveness) : findRun(runId, liveness);
        if (!detail) return { ok: false as const, error: "run not found" };
        return { ok: true as const, data: detail };
      } catch (err) {
        ctx.log.warn({ err, runId }, "runs:get failed");
        return { ok: false as const, error: String(err) };
      }
    },
    "runs:abandon": async (rawPayload: unknown): Promise<CommandResult<"runs:abandon">> => {
      const payload = rawPayload as Commands["runs:abandon"]["payload"];
      const runId = typeof payload?.runId === "string" ? payload.runId.trim() : "";
      if (!runId) return { ok: false as const, error: "missing runId" };
      try {
        // Resolve the repo the same way runs:get does, so an id that works for
        // one verb works for the other.
        const detail = payload?.repo ? readRun(payload.repo, runId) : findRun(runId);
        if (!detail) return { ok: false as const, error: "run not found" };
        const res = abandonRun(detail.run.repo, runId, payload.reason ?? "reconciled by hand");
        if (!res.ok) return { ok: false as const, error: res.error };
        // The run is abandoned either way: a gate left behind is the board's
        // to dismiss, never a reason to report the abandon as failed.
        await seams.closeRunGates?.(runId).catch((err: unknown) => ctx.log.warn({ err, runId }, "runs:abandon: the run's gates did not settle"));
        emitEvent("run-updated", { repo: detail.run.repo, runId, stage: null, kind: "abandoned" });
        return { ok: true as const, data: { ok: true } };
      } catch (err) {
        ctx.log.warn({ err, runId }, "runs:abandon failed");
        return { ok: false as const, error: String(err) };
      }
    },
    "runs:hold": async (rawPayload: unknown): Promise<CommandResult<"runs:hold">> => {
      const payload = rawPayload as Commands["runs:hold"]["payload"] | undefined;
      const runId = typeof payload?.runId === "string" ? payload.runId.trim() : "";
      if (!runId) return { ok: false as const, error: "missing runId" };
      try {
        const detail = payload?.repo ? readRun(payload.repo, runId) : findRun(runId);
        if (!detail) return refusal(controlFail("not-found", `no run ${runId}`));
        const res = holdAtNextStep(detail.run.repo, runId, { reason: PAUSE_REASON, decidedBy: CONSOLE_DECIDER });
        if (!res.ok) return refusal(res);
        if (!res.already) emitEvent("run-updated", { repo: detail.run.repo, runId, stage: res.stage, kind: "held" });
        return { ok: true as const, data: res.already ? { held: true, stage: res.stage, already: true } : { held: true, stage: res.stage } };
      } catch (err) {
        ctx.log.warn({ err, runId }, "runs:hold failed");
        return { ok: false as const, error: String(err) };
      }
    },
    "runs:redo": async (rawPayload: unknown): Promise<CommandResult<"runs:redo">> => {
      const payload = rawPayload as Commands["runs:redo"]["payload"] | undefined;
      const gateId = typeof payload?.gate === "string" ? payload.gate.trim() : "";
      if (!gateId) return { ok: false as const, error: "missing gate" };
      const note = typeof payload?.note === "string" ? payload.note : "";
      if (badNote(note)) return refusal(controlFail("bad-note"));
      try {
        const gate = seams.gateById?.(gateId) ?? null;
        if (!gate) return refusal(controlFail("not-found", `no gate ${gateId}`));
        if (!gate.answer?.by.startsWith("mode:")) return refusal(controlFail("not-mode"));
        const to = gate.meta?.stage;
        if (typeof to !== "string" || !to) return refusal(controlFail("no-stage"));
        const headCommit = typeof gate.meta?.headCommit === "string" ? gate.meta.headCommit : null;
        const runId = gate.subject.startsWith("run:") ? gate.subject.slice("run:".length) : "";
        const detail = runId ? findRun(runId) : null;
        if (!detail) return refusal(controlFail("not-found", `no run ${runId || gate.subject}`));
        const repo = detail.run.repo;
        const res = requestRedo(repo, runId, { gate: gateId, to, note, headCommit, by: CONSOLE_DECIDER, openedAt: gate.openedAt });
        if (!res.ok) return refusal(res);
        emitEvent("run-updated", { repo, runId, stage: to, kind: "redo" });
        return { ok: true as const, data: { runId, repo, to, headCommit } };
      } catch (err) {
        ctx.log.warn({ err, gate: gateId }, "runs:redo failed");
        return { ok: false as const, error: String(err) };
      }
    },
    "runs:evidence": async (rawPayload: unknown): Promise<CommandResult<"runs:evidence">> => {
      const payload = (rawPayload ?? {}) as Record<string, unknown>;
      const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
      if (!runId) return { ok: false as const, error: "missing runId" };
      const byCase = "case" in payload;
      const address = byCase ? readAddress(payload) : null;
      if (byCase && !address) return { ok: false as const, error: "bad address: slot must be before or after, theme light or dark, annotated a boolean" };
      const key = payload.key as EvidenceImageKey | EvidenceTextKey;
      const isText = !byCase && (EVIDENCE_TEXT_KEYS as readonly string[]).includes(key);
      if (!byCase && !isText && !(EVIDENCE_IMAGE_KEYS as readonly string[]).includes(key)) return { ok: false as const, error: "unknown key" };
      try {
        const repo = typeof payload.repo === "string" && payload.repo ? payload.repo : undefined;
        const detail = repo ? readRun(repo, runId) : findRun(runId);
        if (!detail) return { ok: false as const, error: "run not found" };
        const value = detail.fields.find((f) => f.key === "evidence")?.value;
        let path: string | undefined;
        if (address) {
          const found = resolveEvidencePath(readEvidence(value), address);
          if (!found.ok) return { ok: false as const, error: found.error };
          path = found.path;
        } else {
          const record = readEvidence(value);
          if (record.version === 2) {
            if (isText) path = record.transcript;
            else {
              const slot = key.startsWith("before") ? "before" : "after";
              const found = resolveEvidencePath(record, { case: V1_CASE_ID, slot, annotated: key.endsWith("Annotated") });
              path = found.ok ? found.path : undefined;
            }
          }
        }
        if (!path) return { ok: false as const, error: "no evidence" };
        // `worktree` is a field any agent can set, so it is a root only when rt registered that tree to this run's repo.
        const worktree = detail.fields.find((f) => f.key === "worktree")?.value;
        const roots = worktree && isAbsolute(worktree) && isRunTree(worktree, detail.run.repo) ? [worktree] : [];
        if (isText) {
          const text = checkTextPath(path, roots);
          if (!text.ok) return { ok: false as const, error: text.error };
          return { ok: true as const, data: { mime: text.mime, text: text.text } };
        }
        const checked = checkUploadPath(path, roots, { maxBytes: EVIDENCE_MAX_BYTES });
        if (!checked.ok) return { ok: false as const, error: checked.error };
        return { ok: true as const, data: { mime: checked.mime, base64: Buffer.from(checked.bytes).toString("base64") } };
      } catch (err) {
        ctx.log.warn({ err, runId }, "runs:evidence failed");
        return { ok: false as const, error: String(err) };
      }
    },
  };
  return handlers;
}
