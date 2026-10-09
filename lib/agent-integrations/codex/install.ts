/**
 * What setup installs for Codex: the Mattstack MCP entry in the selected
 * Codex home's user config, and rt's policy hooks in that home's user layer.
 * The CLI, its sign-in and the skills links are shared setup's rows and
 * steps. Hook trust is written only by `rt setup codex-policy`, after a
 * person at a terminal approves the review; Install writes the untrusted
 * definitions and reports that the review waits.
 */

import { dirname, isAbsolute, join } from "path";
import type { ApplyContext, StepDef, StepOutcome } from "../../setup/apply.ts";
import { harnessSelected, selectionFor } from "../../setup/integration-selection.ts";
import { createRealProbes, type Probes } from "../../setup/probes.ts";
import { readSetupState, updateSetupState } from "../../setup/state.ts";
import { toFailedOutcome } from "../../setup/steps/step-utils.ts";
import { codexHomeOf, codexMcpRow, codexToolRow, desiredCodexMcpEntry } from "../../setup/validators/codex.ts";
import { runAdapterSteps, type HarnessInstall, type InstallAdapter } from "../install.ts";
import { codexUserHooksPath } from "./hook-manifest.ts";
import {
  CODEX_MCP_SERVER, codexConfigFile, codexMcpFingerprint, editCodexMcpEntry, readCodexMcpState, readCodexMcpTable, removeCodexMcpEntry,
} from "./mcp-config.ts";
import {
  applyCodexPolicyInstall, collectCodexPolicyArtifacts, ownedPolicyHooksIn, planCodexPolicyInstall, removeCodexPolicyInstall, type PolicyInstallDeps,
} from "./policy-install.ts";
import { canonicalCodexProfile } from "./profile.ts";
import { codexConfigPath } from "./trust.ts";

type WriteProbes = Pick<Probes, "mkdirp" | "writeFile" | "rename" | "chmod" | "removeFile" | "fileMode" | "readlink">;

/** Atomic, mode-preserving, and through a symlink to the file it names, the way `claude.permissions` writes Claude's settings. */
function replaceText(p: WriteProbes, linkPath: string, text: string): void {
  const link = p.readlink(linkPath);
  const path = link === null ? linkPath : isAbsolute(link) ? link : join(dirname(linkPath), link);
  const tmp = `${path}.rt-tmp`;
  const mode = p.fileMode(path) ?? 0o600;
  p.mkdirp(dirname(path));
  p.removeFile(tmp);
  p.writeFile(tmp, text, mode);
  p.chmod(tmp, mode);
  try {
    p.rename(tmp, path);
  } catch (err) {
    p.removeFile(tmp);
    throw err;
  }
}

async function codexMcpRun(ctx: ApplyContext): Promise<StepOutcome> {
  const home = codexHomeOf(ctx.p);
  if (home === null) return { state: "failed", detail: "CODEX_HOME does not name a folder", remedy: "Set CODEX_HOME to Codex's folder, then Retry." };
  const path = codexConfigFile(home);
  const recorded = readSetupState(ctx.p).codexMcp?.[path];
  if (ctx.update && recorded === undefined) return { state: "skipped", detail: "Install adds Mattstack to Codex; an update only refreshes the entry rt added" };
  const desired = desiredCodexMcpEntry(ctx.p, home);
  if (desired === null) return { state: "failed", detail: "rt is not on this Mac's PATH yet", remedy: "Run rt setup apply --only path.link, then Retry." };

  const before = ctx.p.readFile(path);
  if (before === null && ctx.p.exists(path)) return { state: "failed", detail: `Could not read ${path}`, remedy: "Check that file's permissions, then Retry." };

  const state = readCodexMcpState(before, desired);
  if (state.kind === "unparsable") return { state: "failed", detail: `${path} is not valid TOML`, remedy: "Fix or remove that file, then Retry." };
  if (state.kind === "current") return { state: "skipped", detail: "Already set up" };
  if (state.kind === "absent" && ctx.update) return { state: "skipped", detail: `You took Mattstack out of ${path}, so rt left it out` };
  const owned = state.kind === "other" && recorded === state.fingerprint;
  if (state.kind === "other" && !owned) {
    const detail = `Codex has its own ${CODEX_MCP_SERVER} server in ${path}, so rt left it alone`;
    return ctx.update ? { state: "skipped", detail } : { state: "needs-you", detail };
  }

  const edit = editCodexMcpEntry(before, desired, owned ? "replace" : "append");
  if (!edit.ok) {
    return {
      state: "failed",
      detail: `rt could not add its entry to ${path} without changing your other Codex settings`,
      remedy: "Check how that file lists its MCP servers, then Retry.",
    };
  }
  if (ctx.p.readFile(path) !== before) return { state: "failed", detail: `${path} changed while rt was reading it`, remedy: "Retry." };

  replaceText(ctx.p, path, edit.text);
  const fingerprint = codexMcpFingerprint(desired);
  updateSetupState(ctx.p, (s) => ({ ...s, codexMcp: { ...(s.codexMcp ?? {}), [path]: fingerprint } }));
  ctx.log("codex.mcp", `${owned ? "updated" : "added"} ${CODEX_MCP_SERVER} in ${path}`);
  return { state: "done", detail: owned ? `Updated Mattstack in ${path}` : `Added Mattstack to ${path}` };
}

export async function installCodexMcp(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await codexMcpRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

/** Under `rt setup update` it only refreshes an entry rt recorded adding and the member left as rt wrote it. */
export const codexMcpStep: StepDef = {
  id: "codex.mcp",
  title: "Add Mattstack to Codex",
  kind: "rt",
  updateSafe: true,
  applies: (ctx) => harnessSelected(selectionFor(ctx), "codex"),
  run: installCodexMcp,
};

/** Takes out the entries rt recorded adding, each only while it is still exactly what rt wrote. */
async function removeCodexMcp(ctx: ApplyContext): Promise<StepOutcome[]> {
  const records = readSetupState(ctx.p).codexMcp ?? {};
  const removed: string[] = [];
  const kept: StepOutcome[] = [];
  const left: Record<string, string> = {};
  const keep = (path: string, fingerprint: string, why: string) => {
    left[path] = fingerprint;
    kept.push({ state: "needs-you", detail: `Mattstack in ${path}, ${why}` });
  };
  for (const [path, fingerprint] of Object.entries(records)) {
    const text = ctx.p.readFile(path);
    if (text === null && ctx.p.exists(path)) {
      keep(path, fingerprint, "which rt could not read");
      continue;
    }
    const table = readCodexMcpTable(text);
    if (table.kind === "absent") continue;
    if (table.kind === "unparsable") {
      keep(path, fingerprint, "which is not valid TOML any more");
      continue;
    }
    if (table.fingerprint !== fingerprint) {
      keep(path, fingerprint, "which was changed after rt added it");
      continue;
    }
    const edit = removeCodexMcpEntry(text!);
    if (!edit.ok) {
      keep(path, fingerprint, "which rt could not take out without changing your other Codex settings");
      continue;
    }
    if (ctx.p.readFile(path) !== text) {
      keep(path, fingerprint, "which changed while rt was removing it");
      continue;
    }
    replaceText(ctx.p, path, edit.text);
    removed.push(path);
    ctx.log("integrations.remove", `removed ${CODEX_MCP_SERVER} from ${path}`);
  }
  if (Object.keys(records).length > 0) {
    updateSetupState(ctx.p, (s) => {
      const next = { ...s };
      if (Object.keys(left).length > 0) next.codexMcp = left;
      else delete next.codexMcp;
      return next;
    });
  }
  return [...(removed.length > 0 ? [{ state: "done" as const, detail: `Removed Mattstack from ${removed.join(", ")}` }] : []), ...kept];
}

export type CodexPolicyStepDeps = {
  plan?: typeof planCodexPolicyInstall;
  apply?: typeof applyCodexPolicyInstall;
  collect?: typeof collectCodexPolicyArtifacts;
  remove?: typeof removeCodexPolicyInstall;
  /** Passed to each of the above, so a test can point them all at one temporary home. */
  overrides?: Partial<PolicyInstallDeps>;
};

const REVIEW_COMMAND = "rt setup codex-policy";

/**
 * Writes rt's hook definitions into the profile's user layer (Codex runs
 * none of them until a person trusts them) and reports the review that
 * trusting them waits on. It never passes a review id, so it can never
 * trust anything.
 */
async function codexPolicyRun(ctx: ApplyContext, deps: CodexPolicyStepDeps): Promise<StepOutcome> {
  const profile = canonicalCodexProfile(undefined, ctx.p.env);
  const plan = deps.plan ?? planCodexPolicyInstall;
  let planned = await plan({ profile }, deps.overrides);
  if (planned.ok && planned.data.stage === "definitions") {
    const wrote = await (deps.apply ?? applyCodexPolicyInstall)(planned.data, [], deps.overrides);
    if (!wrote.ok) return { state: "failed", detail: wrote.error.message, remedy: "Retry." };
    ctx.log("codex.policy", `added rt's untrusted policy hooks to ${planned.data.hooksPath}`);
    planned = await plan({ profile }, deps.overrides);
  }
  if (!planned.ok) {
    ctx.log("codex.policy", planned.error.message);
    return { state: "needs-you", detail: `Codex's policy is not set up: ${planned.error.message}` };
  }
  if (planned.data.stage === "installed") return { state: "done", detail: "Codex's policy is set up for every repo" };
  return { state: "needs-you", detail: `Codex's policy hooks wait on your review. Review them in a terminal: ${REVIEW_COMMAND}` };
}

/**
 * The update run's leg: it rewrites only hook entries rt recorded adding
 * and the member kept, so a new hook program reaches the hooks file, and
 * never adds back hooks the member took out. A rewritten hook has a new
 * native hash, so it waits on review again. Old hook programs go once no
 * Codex session is attached.
 */
async function codexPolicyUpdate(ctx: ApplyContext, deps: CodexPolicyStepDeps): Promise<StepOutcome> {
  const profile = canonicalCodexProfile(undefined, ctx.p.env);
  const configPath = codexConfigPath(profile, ctx.p.env);
  const hooksPath = configPath === undefined ? undefined : codexUserHooksPath(configPath);
  const owned = hooksPath === undefined ? [] : (readSetupState(ctx.p).codexPolicy?.hooks[hooksPath] ?? []);
  if (hooksPath === undefined || owned.length === 0) {
    return { state: "skipped", detail: "Install adds Codex's policy hooks; an update only refreshes the ones rt added" };
  }
  const plan = deps.plan ?? planCodexPolicyInstall;
  let planned = await plan({ profile }, deps.overrides);
  let rewrote = false;
  let copied = false;
  if (planned.ok && planned.data.stage === "definitions") {
    const held = ownedPolicyHooksIn(ctx.p.readFile(hooksPath), owned);
    if (held === "removed") return { state: "skipped", detail: `You took rt's policy hooks out of ${hooksPath}, so rt left them out` };
    if (held !== "intact") return { state: "skipped", detail: `You changed rt's policy hooks in ${hooksPath}, so rt left them as they are` };
    const wrote = await (deps.apply ?? applyCodexPolicyInstall)(planned.data, [], deps.overrides);
    if (!wrote.ok) return { state: "failed", detail: wrote.error.message, remedy: "Retry." };
    rewrote = planned.data.hooksFile.text !== null;
    copied = !rewrote;
    ctx.log("codex.policy", `refreshed rt's policy hooks in ${hooksPath}`);
    planned = await plan({ profile }, deps.overrides);
  }
  for (const path of await (deps.collect ?? collectCodexPolicyArtifacts)(deps.overrides)) ctx.log("codex.policy", `removed the old hook program ${path}`);

  const review = `Review them in a terminal: ${REVIEW_COMMAND}`;
  if (rewrote && !(planned.ok && planned.data.stage === "installed")) {
    return { state: "needs-you", detail: `This update changed rt's Codex policy hooks, so they wait on your review again. ${review}` };
  }
  if (!planned.ok) {
    ctx.log("codex.policy", planned.error.message);
    return { state: "skipped", detail: `rt could not check Codex's policy: ${planned.error.message}` };
  }
  if (planned.data.stage === "installed") {
    if (copied) return { state: "done", detail: "Put back the hook program Codex's policy runs" };
    return rewrote ? { state: "done", detail: "Codex's policy is set up for every repo" } : { state: "skipped", detail: "Already set up" };
  }
  return { state: "skipped", detail: `Codex's policy hooks still wait on your review. ${review}` };
}

/** Never approves a review: trust is written only by `rt setup codex-policy` at a terminal. */
export function createCodexPolicyStep(deps: CodexPolicyStepDeps = {}): StepDef {
  return {
    id: "codex.policy",
    title: "Set up Codex's policy hooks",
    kind: "rt",
    updateSafe: true,
    applies: (ctx) => harnessSelected(selectionFor(ctx), "codex"),
    run: async (ctx) => {
      try {
        return await (ctx.update ? codexPolicyUpdate(ctx, deps) : codexPolicyRun(ctx, deps));
      } catch (err) {
        return toFailedOutcome(err);
      }
    },
  };
}

async function removeCodexPolicy(deps: CodexPolicyStepDeps): Promise<StepOutcome[]> {
  const { removed, kept } = await (deps.remove ?? removeCodexPolicyInstall)(deps.overrides);
  return [
    ...(removed.length > 0 ? [{ state: "done" as const, detail: `Removed ${removed.join(", ")}` }] : []),
    ...kept.map((detail): StepOutcome => ({ state: "needs-you", detail })),
  ];
}

export const codexPolicyStep: StepDef = createCodexPolicyStep();

type McpGet = { transport?: { command?: unknown; args?: unknown } };

/** Whether Codex itself reads the entry rt wrote, as `codex mcp get --json` prints it. */
async function codexReadsEntry(p: Probes): Promise<string | null> {
  const home = codexHomeOf(p);
  const desired = home === null ? null : desiredCodexMcpEntry(p, home);
  if (desired === null) return "rt's MCP entry has no rt to start";
  const res = await p.exec(["codex", "mcp", "get", CODEX_MCP_SERVER, "--json"], { timeoutMs: 5000 });
  if (res.code !== 0) return "Codex could not show rt's MCP entry";
  let got: McpGet;
  try {
    got = JSON.parse(res.stdout) as McpGet;
  } catch {
    return "Codex's description of rt's MCP entry could not be read";
  }
  const same = got.transport?.command === desired.command && Bun.deepEquals(got.transport?.args, desired.args);
  return same ? null : "Codex starts a different mattstack server";
}

export function createCodexInstall(deps: { p?: Probes; policy?: CodexPolicyStepDeps } = {}): InstallAdapter {
  const probes = (): Probes => deps.p ?? createRealProbes();
  const policyStep = deps.policy ? createCodexPolicyStep(deps.policy) : codexPolicyStep;
  const steps = (): StepDef[] => [codexMcpStep, policyStep];
  return {
    steps,
    async reconcile(mode, ctx) {
      if (mode !== "uninstall") return runAdapterSteps(steps(), mode, ctx);
      return [...(await removeCodexMcp(ctx)), ...(await removeCodexPolicy(deps.policy ?? {}))];
    },
    async verify() {
      const p = probes();
      const tool = await codexToolRow(p);
      if (tool.status !== "ready") return { ok: true, data: { ready: false, reason: tool.detail } };
      const mcp = codexMcpRow(p);
      if (mcp.status !== "ready") return { ok: true, data: { ready: false, reason: mcp.detail } };
      const fault = await codexReadsEntry(p);
      return { ok: true, data: fault === null ? { ready: true } : { ready: false, reason: fault } };
    },
  };
}

export const codexInstall: HarnessInstall = { id: "codex", loadInstall: async () => createCodexInstall() };
