/**
 * Codex's rows: the CLI and its sign-in, and the Mattstack MCP entry in its
 * user config. Shown only while the integrations switch is on and Codex is
 * enabled; nothing here runs or reads Claude.
 */

import { join } from "path";
import { codexHomeFor, parseCodexPluginList } from "../../agent-integrations/codex/skills.ts";
import { codexConfigFile, codexMcpEntry, readCodexMcpState, type CodexMcpEntry } from "../../agent-integrations/codex/mcp-config.ts";
import { resolveTool } from "../../deps/resolve.ts";
import type { Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { PolicyInstallPlan, PolicyReview } from "../../agent-integrations/codex/policy-install.ts";
import { applyStepAction, row, type Action, type CodexHookReview, type Row } from "../contract.ts";
import type { ExecResult, Probes } from "../probes.ts";
import type { PluginEntry } from "../../skills/writing-style-sources.ts";
import { readSetupState } from "../state.ts";

const PROBE_TIMEOUT_MS = 5000;

const CODEX_INSTALL_STEPS: Action = {
  type: "steps",
  label: "Show steps…",
  steps: ["Open a terminal", "Run: npm install -g @openai/codex", "Then run: codex --version"],
};
const CODEX_SIGNIN_STEPS: Action = { type: "steps", label: "Show steps…", steps: ["Open a terminal", "Run: codex login", "Follow the sign-in prompt"] };
const removeOwnEntry = (path: string): Action => ({
  type: "steps",
  label: "Show steps…",
  steps: [`Open ${path}`, "Remove the [mcp_servers.mattstack] table", "Then run: rt setup apply --only codex.mcp"],
});
const SIGNIN_LATER = { required: false, optionalNote: "Sign in after Install: run codex login." };

function exec(p: Probes, argv: string[]): Promise<ExecResult> {
  return p.exec(argv, { timeoutMs: PROBE_TIMEOUT_MS });
}

function versionOf(stdout: string): string {
  return stdout.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? stdout.trim();
}

/** The Codex home setup installs into: CODEX_HOME, else ~/.codex. Null when CODEX_HOME names no folder. */
export function codexHomeOf(p: Pick<Probes, "env" | "home">): string | null {
  const home = codexHomeFor(undefined, { ...p.env, HOME: p.home });
  return home.ok ? home.data.home : null;
}

/** The rt the MCP entry starts: the PATH link Install makes, else the copy rt resolves. */
export function codexMcpCommand(p: Probes): string | null {
  const linked = join(p.home, ".local", "bin", "rt");
  if (p.exists(linked)) return linked;
  return resolveTool(p, "rt").chosen;
}

export function desiredCodexMcpEntry(p: Probes, codexHome: string): CodexMcpEntry | null {
  const rt = codexMcpCommand(p);
  return rt === null ? null : codexMcpEntry(rt, codexHome);
}

export async function codexToolRow(p: Probes): Promise<Row> {
  const base = { id: "tool.codex", kind: "tool" as const, title: "Codex", why: "Runs the agent sessions rt drives and hands work off to.", required: true, recheck: "on-activate" as const };

  const versionRes = await exec(p, ["codex", "--version"]);
  if (versionRes.code === 127) return row({ ...base, status: "missing", detail: "Codex is not installed", action: CODEX_INSTALL_STEPS });
  if (versionRes.code === 124) return row({ ...base, status: "error", detail: "Codex did not answer in time" });
  if (versionRes.code !== 0) return row({ ...base, status: "error", detail: `Could not run Codex (exit ${versionRes.code})` });
  const named = `Codex ${versionOf(versionRes.stdout)}`;

  const authRes = await exec(p, ["codex", "login", "status"]);
  if (authRes.code === 124) return row({ ...base, status: "error", detail: "Codex's sign-in check did not answer in time" });
  if (authRes.code === 0) return row({ ...base, status: "ready", detail: `${named}, signed in` });
  // codex-cli 0.160 prints "Not logged in" and exits 1 when signed out; any other failure says nothing about the sign-in.
  if (/not logged in/i.test(`${authRes.stdout}\n${authRes.stderr}`)) {
    return row({ ...base, ...SIGNIN_LATER, status: "needs-you", detail: "Not signed in yet. Run codex login and sign in", action: CODEX_SIGNIN_STEPS });
  }
  return row({ ...base, ...SIGNIN_LATER, status: "needs-you", detail: `${named} is installed, but the sign-in could not be checked. Confirm you are signed in`, action: CODEX_SIGNIN_STEPS });
}

export function codexMcpRow(p: Probes): Row {
  const base = {
    id: "tool.codex-mcp",
    kind: "tool" as const,
    title: "Mattstack in Codex",
    why: "Codex reaches rt's tools through this MCP server.",
    required: false,
    optionalNote: "Installed by Install (codex.mcp).",
  };
  const home = codexHomeOf(p);
  if (home === null) return row({ ...base, status: "error", detail: "CODEX_HOME does not name a folder" });
  const path = codexConfigFile(home);
  const desired = desiredCodexMcpEntry(p, home);
  const add = applyStepAction("Add to Codex", "codex.mcp");
  if (desired === null) return row({ ...base, status: "missing", detail: "rt is not on this Mac's PATH yet", action: add });

  const text = p.readFile(path);
  if (text === null && p.exists(path)) return row({ ...base, status: "error", detail: `Could not read ${path}` });
  const state = readCodexMcpState(text, desired);
  if (state.kind === "unparsable") return row({ ...base, status: "error", detail: `${path} is not valid TOML` });
  if (state.kind === "current") return row({ ...base, status: "ready", detail: "Codex starts rt's MCP server" });
  if (state.kind === "other") {
    if (readSetupState(p).codexMcp?.[path] === state.fingerprint) return row({ ...base, status: "missing", detail: "The entry rt added to Codex is out of date", action: add });
    return row({ ...base, status: "needs-you", detail: "Codex has its own mattstack server, so rt left it alone", action: removeOwnEntry(path) });
  }
  return row({ ...base, status: "missing", detail: "Not added to Codex yet", action: add });
}

export type CodexPolicyPlanner = () => Promise<Outcome<PolicyInstallPlan>>;

/** The review as a person sees it, at a terminal or in the menu-bar app's sheet. */
export function codexHookReviewPayload(review: PolicyReview): CodexHookReview {
  return {
    id: review.id, codexHome: review.codexHome, hooksPath: review.hooksPath, configPath: review.configPath,
    executable: review.executable, digest: review.digest,
    hooks: review.hooks.map((h) => ({ event: h.event, key: h.key, hash: h.hash, command: h.command })),
  };
}

export const CODEX_POLICY_PLAN_DEADLINE_MS = PROBE_TIMEOUT_MS;

/** A plan that is not back by `ms` reads as Codex not answering, so a wedged app server cannot hold the checklist. */
export function withPlanDeadline(plan: CodexPolicyPlanner, ms: number): CodexPolicyPlanner {
  return () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<Outcome<PolicyInstallPlan>>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: { code: "not-ready", message: "rt could not ask Codex right now. Re-check in a moment." } }), ms);
    });
    return Promise.race([plan(), late]).finally(() => clearTimeout(timer));
  };
}

/** The plan for this Mac's Codex profile; it only reads, never starts Codex, and gives up at the deadline. */
export function codexPolicyPlanner(p: Probes): CodexPolicyPlanner {
  return withPlanDeadline(async () => {
    const [{ listHooksWithin, planCodexPolicyInstall }, { canonicalCodexProfile }, { bundledToolPath }] = await Promise.all([
      import("../../agent-integrations/codex/policy-install.ts"),
      import("../../agent-integrations/codex/profile.ts"),
      import("../../deps/resolve.ts"),
    ]);
    const env = { ...p.env, HOME: p.home };
    return planCodexPolicyInstall(
      { profile: canonicalCodexProfile(undefined, env) },
      { env, home: p.home, rtSource: () => bundledToolPath(p, "rt"), listHooks: listHooksWithin(CODEX_POLICY_PLAN_DEADLINE_MS) },
    );
  }, CODEX_POLICY_PLAN_DEADLINE_MS);
}

/** rt's Codex policy hooks: added by Install, trusted only after a person approves them. */
export async function codexPolicyRow(plan: CodexPolicyPlanner): Promise<Row> {
  const base = {
    id: "tool.codex-policy",
    kind: "tool" as const,
    title: "rt's hooks in Codex",
    why: "Codex runs these hooks so rt can keep managed Codex work inside rt's rules.",
    required: false,
    recheck: "on-activate" as const,
  };
  let planned: Outcome<PolicyInstallPlan>;
  try {
    planned = await plan();
  } catch (err) {
    return row({ ...base, status: "error", detail: `rt could not check its hooks in Codex: ${err instanceof Error ? err.message : String(err)}` });
  }
  if (!planned.ok) return row({ ...base, status: planned.error.code === "refused" ? "error" : "needs-you", detail: planned.error.message });
  const { stage } = planned.data;
  if (stage === "installed") return row({ ...base, status: "ready", detail: "Codex runs rt's hooks" });
  if (stage === "definitions") {
    return row({
      ...base,
      status: "missing",
      optionalNote: "Installed by Install (codex.policy).",
      detail: "Not added to Codex yet. Codex runs none of them until you approve them",
      action: applyStepAction("Add to Codex", "codex.policy"),
    });
  }
  const review = planned.data.reviews[0]!;
  return row({
    ...base,
    status: "needs-you",
    detail: "rt's hooks are in Codex and wait on your approval",
    action: {
      type: "review-codex-hooks",
      label: "Review…",
      verb: ["setup", "codex-policy"],
      subtitle: "Codex runs these hooks in every repo you open with it. Approve them only if this is what you expect.",
      footnote: "macOS asks for Touch ID or your password. You can also run rt setup codex-policy in a terminal.",
      review: codexHookReviewPayload(review),
    },
  });
}

/** Codex's installed plugins in the writing-style inventory's shape, or null when they cannot be listed. */
export function codexPluginEntries(listing: ExecResult, codexHome: string): PluginEntry[] | null {
  if (listing.code !== 0) return null;
  const parsed = parseCodexPluginList(listing.stdout, codexHome, codexHome);
  if (!parsed.ok) return null;
  return parsed.data.map((e) => ({ id: e.id, enabled: e.enabled !== false, installPath: e.installPath, harness: "codex" }));
}

export function codexPluginListing(p: Probes): Promise<ExecResult> {
  return exec(p, ["codex", "plugin", "list", "--json"]);
}
