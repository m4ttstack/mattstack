/**
 * `deck.managed`: brings the pre-deck board row under its real name. Which
 * apps deck serves is deck's own decision, made by its boot sweep from the
 * bundle's catalog, so this step registers no app itself.
 *
 * board ran under mattstack.app's own bootstrap as "mrs" before deck existed.
 * `deck adopt mrs --as board --json` exits 0 both when it renames that row and
 * when board is already rt's, which deck's sweep makes true of every machine
 * it has started on. Only a reply of `changed: true` is a real adoption, and
 * only that repoints the record at the bundled board binary through deck's
 * `/api/v1/apps/board` PATCH. A machine with neither row answers "unknown app"
 * and the step still completes.
 *
 * The gate is `bundledToolPath`, not `resolveTool().chosen`: a PATH copy
 * would pass `.chosen` and hand deck a command outside its own bundle.
 */

import { join } from "path";
import { bundledToolPath } from "../../deps/resolve.ts";
import { isSolo } from "../contract.ts";
import type { ApplyContext } from "../apply.ts";
import type { StepDef, StepOutcome } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { toFailedOutcome } from "./step-utils.ts";

interface DeckApiFile {
  port?: unknown;
}

export function readDeckApiPortFrom(p: Pick<Probes, "readFile" | "home">): number | null {
  const raw = p.readFile(join(p.home, ".mattstack", "deck", "api.json"));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as DeckApiFile;
    return typeof parsed.port === "number" ? parsed.port : null;
  } catch {
    return null;
  }
}

/** Exported for `lib/setup/uninstall.ts`'s deck.managed-remove, which needs the same "is deck actually up" check before asking it to unmanage anything. */
export function readDeckApiPort(ctx: ApplyContext): number | null {
  return readDeckApiPortFrom(ctx.p);
}

export async function deckIsHealthy(ctx: ApplyContext, port: number): Promise<boolean> {
  const res = await ctx.p.fetch(`http://127.0.0.1:${port}/healthz`);
  return res.status === 200;
}

/** deck's own frozen error vocabulary for `adopt` — matched as substrings since the real CLI wraps them in a sentence, not a bare code. */
const FROZEN_ADOPT_ERRORS = ["unknown app", "deck not running", "name taken"] as const;

function matchFrozenError(text: string): (typeof FROZEN_ADOPT_ERRORS)[number] | null {
  return FROZEN_ADOPT_ERRORS.find((needle) => text.includes(needle)) ?? null;
}

/** deck's registrar id for mattstack's rows. Deck refuses a structural change to a row from any caller but its registrar, and an unnamed caller is "user". */
const MATTSTACK_REGISTRAR = "rt";

type AdoptResult = { kind: "renamed" } | { kind: "skip"; detail: string } | { kind: "failed"; outcome: StepOutcome };

function adoptChanged(stdout: string): boolean {
  try {
    return (JSON.parse(stdout) as { changed?: unknown }).changed === true;
  } catch {
    return false;
  }
}

async function adoptBoard(ctx: ApplyContext, deckBin: string): Promise<AdoptResult> {
  const result = await ctx.p.exec([deckBin, "adopt", "mrs", "--as", "board", "--json"]);
  if (result.code === 0) return adoptChanged(result.stdout) ? { kind: "renamed" } : { kind: "skip", detail: "board already adopted" };

  const frozen = matchFrozenError(`${result.stdout}\n${result.stderr}`);

  // Deck holds neither "mrs" nor an rt-owned "board": there is nothing to
  // adopt, which is not a failed adopt.
  if (frozen === "unknown app") return { kind: "skip", detail: "no legacy mrs to adopt" };

  if (frozen === "deck not running") {
    // A precondition, not a rejection of the adopt itself — deck answered
    // /healthz a moment ago and stopped between then and this exec.
    return { kind: "failed", outcome: { state: "failed", detail: "deck stopped responding before it could adopt board", remedy: "Start deck, then Retry" } };
  }
  return { kind: "failed", outcome: { state: "failed", detail: frozen ?? (result.stderr.trim() || result.stdout.trim() || `deck adopt exited ${result.code}`), remedy: "Retry" } };
}

/**
 * Skips honestly, never pointing the record at a binary that doesn't exist,
 * when board isn't bundled yet. A refused repoint is reported, not thrown: a
 * re-run answers `changed: false` and would never retry it, and deck's sweep
 * serves the bundled board whatever command the row stores.
 */
async function repointBoard(ctx: ApplyContext, port: number): Promise<string> {
  const boardBin = bundledToolPath(ctx.p, "board");
  if (boardBin === null) return "repoint skipped (board not bundled yet)";

  const boardDir = join(ctx.p.home, ".mattstack", "board");
  ctx.p.mkdirp(boardDir);
  const body = JSON.stringify({ command: [boardBin], workingDirectory: boardDir });
  const headers = { "content-type": "application/json", "x-local-caller": MATTSTACK_REGISTRAR };
  const res = await ctx.p.fetch(`http://127.0.0.1:${port}/api/v1/apps/board`, { method: "PATCH", headers, body });
  if (res.status < 200 || res.status >= 300) return `repoint failed (deck answered ${res.status})`;
  return "repointed";
}

interface DeckAppRow {
  name: string;
  managedBy: string;
  requiresTeam?: boolean;
  enabled?: boolean;
}

const DECK_API_TIMEOUT_MS = 120_000;

async function applyAppDefaults(ctx: ApplyContext, port: number): Promise<{ ok: boolean; detail: string }> {
  // An intent is only on disk during a first run or an upgrade; a completed apply clears it. Without one this is a re-run, and a user's own toggles stand.
  if (ctx.intent === null) return { ok: true, detail: "app defaults untouched (not an install)" };
  const res = await ctx.p.fetch(`http://127.0.0.1:${port}/api/v1/apps`, { timeoutMs: DECK_API_TIMEOUT_MS });
  if (res.status !== 200) return { ok: false, detail: `app defaults not applied (deck answered ${res.status})` };
  let apps: DeckAppRow[];
  try {
    apps = (JSON.parse(res.body) as { apps?: DeckAppRow[] }).apps ?? [];
  } catch {
    return { ok: false, detail: "app defaults not applied (unreadable app list)" };
  }
  const targets = apps
    .filter((a) => a.managedBy === MATTSTACK_REGISTRAR && a.requiresTeam === true)
    .map((a) => a.name)
    .sort();
  if (targets.length === 0) return { ok: true, detail: "no team-only apps" };
  const enabled = !isSolo(ctx.team);
  const headers = { "content-type": "application/json", "x-local-caller": MATTSTACK_REGISTRAR };
  const failed: string[] = [];
  for (const name of targets) {
    const r = await ctx.p.fetch(`http://127.0.0.1:${port}/api/v1/apps/${name}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabled }),
      timeoutMs: DECK_API_TIMEOUT_MS,
    });
    if (r.status < 200 || r.status >= 300) failed.push(`${name} (${r.status})`);
  }
  if (failed.length) return { ok: false, detail: `app defaults not applied; failed: ${failed.join(", ")}` };
  const names = targets.join(", ");
  return { ok: true, detail: enabled ? `team apps on: ${names}` : `solo: ${names} off` };
}

async function deckManagedRun(ctx: ApplyContext): Promise<StepOutcome> {
  const deckBin = bundledToolPath(ctx.p, "deck");
  if (deckBin === null) return { state: "skipped", detail: "deck not bundled yet" };

  const port = readDeckApiPort(ctx);
  const healthy = port !== null && (await deckIsHealthy(ctx, port));
  if (!healthy) {
    // A fresh non-interactive install reaches here with the app absent:
    // services.register just skipped for the same reason, so nothing has
    // started deck yet — that is a sequencing fact, not a failure. Deck
    // down while the app IS running stays a hard stop.
    const tray = await ctx.p.tray("/version", { method: "GET" });
    if (tray.status === 0) {
      return { state: "skipped", detail: "deck is not running and mattstack.app is not there to start it — open the app, then Retry" };
    }
    return { state: "failed", detail: "deck is not answering its own /healthz — cannot adopt board safely", remedy: "Start deck, then Retry" };
  }

  const adopted = await adoptBoard(ctx, deckBin);
  if (adopted.kind === "failed") return adopted.outcome;
  const adoptDetail = adopted.kind === "skip" ? adopted.detail : `board adopted from legacy mrs, ${await repointBoard(ctx, port)}`;
  const defaults = await applyAppDefaults(ctx, port);
  return { state: defaults.ok ? "done" : "failed", detail: `deck ready; ${adoptDetail}; ${defaults.detail}` };
}

async function deckManagedRunSafe(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await deckManagedRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const deckManagedStep: StepDef = {
  id: "deck.managed",
  title: "Set up managed deck",
  kind: "rt",
  applies: () => true,
  run: deckManagedRunSafe,
};
