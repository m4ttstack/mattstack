/**
 * rt git auth: lets a clone's git sign in with the forge token rt holds.
 * `--check` reports every registered clone and changes nothing. The plain
 * form and `--https` change only the clone's local config, and only after a
 * yes at a terminal or `--yes`.
 */

import { existsSync } from "fs";
import { basename } from "path";
import type { CommandContext } from "../../lib/command-tree.ts";
import { shellQuote } from "../../lib/herdr-launch.ts";
import { loadRepoIndexEntries } from "../../lib/repo-index.ts";
import { repoLabel } from "../../lib/repo-label.ts";
import { rtCredentialHelper } from "../../lib/setup/steps/repos.ts";
import * as out from "../../lib/ui/out.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { warn } from "../../lib/ui/warn.ts";
import { runGit, type GitResult } from "../../lib/worktree/git-async.ts";
import { redactCredentials } from "../../packages/rt-client/src/redact.ts";
import { classifyClone, readHelperOrder, realCloneDeps, type CloneCause, type CloneDeps, type CloneState } from "./clone-state.ts";
import { forgeName, sshToHttps } from "./origin-auth.ts";
import { failUsage, failWith, printable, refusalNote, refuseWith } from "./shared.ts";

export interface AuthDeps extends CloneDeps {
  entries(): { repoName: string; path: string }[];
  interactive: boolean;
  confirm(message: string): Promise<boolean>;
  /** The --json envelope only. */
  print(line: string): void;
  /** Defaults to `runGit`. */
  git?: (cwd: string, args: string[]) => Promise<GitResult>;
}

export function realAuthDeps(): AuthDeps {
  return {
    ...realCloneDeps(),
    entries: () => loadRepoIndexEntries().map(({ repoName, path }) => ({ repoName, path })),
    interactive: Boolean(process.stdin.isTTY) && !process.env.RT_BATCH,
    confirm: async (message) => {
      const { confirm } = await import("../../lib/rt-render.ts");
      return confirm({ message, stderr: true });
    },
    print: (line) => out.payload(`${line}\n`),
    git: runGit,
  };
}

/** `s` is null when the clone's git config could not be read: it still gets a row, so one bad clone never stops the report. */
export type CheckRow = { label: string; path: string; s: CloneState | null };

const UNREADABLE_REASON = "rt could not read its git config";

export function checkBlocks(rows: CheckRow[]): Block[] {
  if (rows.length === 0) return [out.line("skipped", "rt has no registered clones")];
  const blocks: Block[] = [];
  for (const { label, s } of rows) {
    if (s === null) {
      blocks.push(out.line("skipped", label, UNREADABLE_REASON));
      continue;
    }
    blocks.push(out.line(s.state, label, s.reason));
    if (s.next) blocks.push(out.callout("next", out.cmd(s.next)));
  }
  return blocks;
}

async function checkRows(deps: AuthDeps): Promise<CheckRow[]> {
  const rows: CheckRow[] = [];
  for (const { repoName, path } of deps.entries()) {
    if (!existsSync(path)) continue;
    const label = repoLabel(repoName);
    let s: CloneState | null;
    try {
      s = await classifyClone(path, deps);
    } catch {
      warn("git-auth", "rt could not read a clone's git config", { context: { path } });
      s = null;
    }
    rows.push({ label, path, s });
  }
  return rows;
}

/** Only these fields leave: origin's URL and a clone's own helpers can hold a secret. */
function jsonRow({ label, path, s }: CheckRow): Record<string, unknown> {
  if (s === null) return { path, label, state: "skipped", transport: null, host: null };
  return { path, label, state: s.state, transport: s.transport, host: s.host, ...(s.next ? { next: s.next } : {}) };
}

const USAGE = "usage: rt git auth [path] [--https] [--yes] [--json] | rt git auth --check [--json]";
const FLAGS = new Set(["--check", "--https", "--yes", "--json"]);

export async function authCommand(args: string[], _ctx: CommandContext, deps: AuthDeps = realAuthDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const unknown = args.find((a) => a.startsWith("-") && !FLAGS.has(a));
  if (unknown !== undefined) failUsage(json, `Unknown option ${unknown}`, USAGE);
  const paths = args.filter((a) => !a.startsWith("-"));

  if (args.includes("--check")) {
    if (paths.length > 0) failUsage(json, "--check takes no path", USAGE);
    const rows = await checkRows(deps);
    if (json) {
      deps.print(JSON.stringify({ ok: true, repos: rows.map(jsonRow) }));
      return;
    }
    out.print(...checkBlocks(rows));
    return;
  }

  if (paths.length > 1) failUsage(json, "Pass one clone at a time", USAGE);
  await setUp(paths[0], { json, https: args.includes("--https"), yes: args.includes("--yes") }, deps);
}

interface SetUpOpts {
  json: boolean;
  https: boolean;
  yes: boolean;
}

type Git = (cwd: string, args: string[]) => Promise<GitResult>;

function refuse(json: boolean, code: string, f: out.FailureInput): never {
  return refuseWith(json, code, ...refusalNote(f));
}

async function repoRoot(dir: string, git: Git): Promise<string | null> {
  if (!existsSync(dir)) return null;
  try {
    const res = await git(dir, ["rev-parse", "--show-toplevel"]);
    const top = res.stdout.trim();
    return res.exitCode === 0 && top !== "" ? top : null;
  } catch {
    return null;
  }
}

/** Throws when git cannot read the config: an unread value must never pass as absent. */
async function configValues(root: string, key: string, git: Git): Promise<string[]> {
  const res = await git(root, ["config", "--local", "--get-all", "-z", key]);
  if (res.exitCode === 1) return [];
  if (res.exitCode !== 0) throw new Error("git could not read this clone's config");
  return res.stdout.split("\0").slice(0, -1);
}

function connectNext(s: CloneState): out.CellInput {
  if (s.forge === "github") return out.cmd("rt setup github connect");
  if (s.forge === "gitlab") return out.cmd("rt setup gitlab connect");
  return [out.cmd("rt setup gitlab connect"), " or ", out.cmd("rt setup github connect")];
}

/** The undo for rt's pair; it names the clone, so a paste from another folder cannot change a different one. */
function helperUndoCommand(root: string, key: string): string {
  return `git -C ${shellQuote(root)} config --unset-all ${key}`;
}

/** `undo` is set when rt's pair is already in the clone, ahead of `after`. */
function helperAfterRefusal(label: string, hint: string, after: string, undo: string | null): out.FailureInput {
  if (undo !== null) return { title: label, hint, why: `git hands rt's token to ${after} as well`, next: ["Remove rt's helper with ", out.cmd(undo)] };
  return { title: label, hint, why: `rt's helper would come before ${after}, and git would hand it rt's token` };
}

/** The refusal for every cause but the ready ones; never repeats a helper value or a raw URL. */
function causeRefusal(s: CloneState, label: string, key: string | null, root: string): out.FailureInput {
  const base = { title: label, hint: s.reason };
  switch (s.cause as Exclude<CloneCause, "wired" | "ready" | "ssh-ready">) {
    case "own-helper":
      if (s.helperAfter !== undefined) return helperAfterRefusal(label, s.reason, s.helperAfter.key, s.helperAfter.rtWrote && key !== null ? helperUndoCommand(root, key) : null);
      return { ...base, why: `rt did not make ${key ?? "it"}, so rt left it alone` };
    case "insteadof-maps-back": return { ...base, why: "git would send the https URL back to SSH" };
    case "unconfirmed-host": return { ...base, next: out.cmd(`rt setup gitlab connect --host ${shellQuote(s.host ?? "")}`) };
    case "no-token": return { ...base, next: connectNext(s) };
    default: return base;
  }
}

function cleanDetails(stderr: string): string | undefined {
  const text = redactCredentials(stderr.trim());
  return text === "" ? undefined : text;
}

const HELD_CREDENTIALS = out.callout("note", "The old URL held credentials rt will not print, so its undo is left out");

/** What follows a failure or the done line: the undo commands, and why one is missing. */
function undoBlocks(undo: string[], withheld: boolean): Block[] {
  return [...(withheld ? [HELD_CREDENTIALS] : []), ...(undo.length > 0 ? [out.copy(undo.join("\n"), "to undo")] : [])];
}

async function setUp(path: string | undefined, o: SetUpOpts, deps: AuthDeps): Promise<void> {
  const git = deps.git ?? runGit;
  const dir = path ?? process.cwd();
  const root = await repoRoot(dir, git);
  if (root === null) refuse(o.json, "not-a-repo", { title: "Not a git repo", hint: dir });
  const label = basename(root);
  const unreadable = (): never => {
    warn("git-auth", "rt could not read a clone's git config", { context: { path: root } });
    return refuse(o.json, "config-unreadable", { title: "rt could not read this clone's git config" });
  };

  let s: CloneState;
  try {
    s = await classifyClone(root, deps);
  } catch {
    return unreadable();
  }
  const key = s.host ? `credential.https://${s.host}.helper` : null;

  if (s.transport === "ssh" && !o.https) {
    refuse(o.json, "ssh-origin", {
      title: label,
      hint: "uses SSH",
      why: "rt's token works over https only",
      ...(s.state === "off" && s.next ? { next: out.cmd(s.next) } : {}),
    });
  }

  if (s.cause === "wired") {
    if (o.json) deps.print(JSON.stringify({ ok: true, path: root, host: s.host, changed: false, undo: [] }));
    else out.print(out.line("done", label, s.reason));
    return;
  }
  if ((s.cause !== "ready" && s.cause !== "ssh-ready") || key === null || s.host === null || s.forge === null) {
    refuse(o.json, s.cause, causeRefusal(s, label, key, root));
  }

  const host = s.host;
  const switching = s.cause === "ssh-ready";
  let from = "";
  let to = "";
  let oldPush: string | null = null;
  let pushPlan: "none" | "rewrite" | "leave" = "none";
  let needHelper = true;
  try {
    if (switching) {
      to = s.httpsUrl!;
      from = (await configValues(root, "remote.origin.url", git))[0] ?? s.originUrl!;
      const pushes = await configValues(root, "remote.origin.pushurl", git);
      if (pushes.length === 1 && (await sshToHttps(pushes[0]!)) === to) {
        oldPush = pushes[0]!;
        pushPlan = "rewrite";
      } else if (pushes.length > 0 && !(pushes.length === 1 && pushes[0] === to)) {
        pushPlan = "leave";
      }
      needHelper = (await readHelperOrder(root, host, deps.rtLink)).own.length === 0;
    }
  } catch {
    unreadable();
  }

  const plan: Block[] = [];
  if (switching) {
    plan.push(out.line("pending", "Switch origin to https", pushPlan === "rewrite" ? "its push URL too" : undefined), out.kv("from", printable(from)), out.kv("to", to));
    if (pushPlan === "leave") plan.push(out.callout("note", "Its push URL points elsewhere, so rt leaves it as it is"));
  }
  if (needHelper) {
    plan.push(out.line("pending", "Add rt's credential helper", key), out.callout("note", `For ${host} in this clone, it takes the place of git's other helpers, like the keychain`));
  }

  if (!o.yes && !deps.interactive) {
    if (!o.json) out.print(...plan);
    refuse(o.json, "needs-consent", {
      title: "rt changes a clone only with your yes",
      why: "There is no terminal to ask at",
      next: out.cmd(`rt git auth${o.https ? " --https" : ""} ${shellQuote(root)} --yes`),
    });
  }
  if (!o.yes) {
    out.print(...plan);
    const question = !switching ? "Add rt's helper to this clone?" : needHelper ? "Switch origin and add rt's helper?" : "Switch origin to https?";
    if (!(await deps.confirm(question))) {
      if (o.json) deps.print(JSON.stringify({ ok: true, path: root, host, changed: false, undo: [] }));
      else out.print(out.line("skipped", label, "nothing changed"));
      return;
    }
  } else if (!o.json) {
    out.print(...plan);
  }

  const inClone = `git -C ${shellQuote(root)}`;
  const undo: string[] = [];
  let withheld = false;
  /** A URL that held credentials gets no undo: a redacted one would set a different URL. */
  const pushUrlUndo = (flag: string, url: string): void => {
    if (printable(url) === url) undo.push(`${inClone} remote set-url ${flag}origin ${shellQuote(url)}`);
    else withheld = true;
  };
  const failPartway = (error: string, title: string, details: string | undefined): never =>
    failWith(o.json, error, { title, details }, { after: undoBlocks(undo, withheld), fields: { undo } });

  if (switching) {
    const set = await git(root, ["remote", "set-url", "origin", to]);
    if (set.exitCode !== 0) failWith(o.json, "origin-switch-failed", { title: "Could not switch origin to https", details: cleanDetails(set.stderr) });
    pushUrlUndo("", from);
    if (pushPlan === "rewrite") {
      const push = await git(root, ["remote", "set-url", "--push", "origin", to]);
      if (push.exitCode !== 0) failPartway("push-switch-failed", "Switched origin to https, but not its push URL", cleanDetails(push.stderr));
      pushUrlUndo("--push ", oldPush!);
    }
  }

  if (needHelper) {
    const helperUndo = helperUndoCommand(root, key);
    const first = await git(root, ["config", "--local", "--add", key, ""]);
    const second = first.exitCode === 0 ? await git(root, ["config", "--local", "--add", key, rtCredentialHelper(deps.rtLink)]) : first;
    if (second.exitCode !== 0) {
      // A lone empty value would switch off every helper for the host.
      const cleaned = first.exitCode !== 0 || (await git(root, ["config", "--local", "--unset-all", key])).exitCode === 0;
      const details = cleanDetails(second.stderr);
      if (switching) {
        undo.push(helperUndo);
        failPartway("helper-write-failed", "Switched origin to https, but could not add rt's helper", details);
      }
      if (cleaned) failWith(o.json, "helper-write-failed", { title: "Could not add rt's credential helper", why: "Nothing changed in this clone", details });
      failWith(o.json, "helper-write-failed", { title: "Could not add rt's credential helper", next: out.cmd(helperUndo), details }, { fields: { undo: [helperUndo] } });
    }
    // git may put the pair in an earlier section for the host, ahead of a helper the check above could not place.
    let after: string | null;
    try {
      after = (await readHelperOrder(root, host, deps.rtLink)).after;
    } catch {
      after = "a credential helper";
    }
    if (after !== null) {
      const taken = (await git(root, ["config", "--local", "--unset-all", key])).exitCode === 0;
      if (!taken) {
        undo.push(helperUndo);
        failPartway("helper-write-failed", "Added rt's helper ahead of another one, and could not take it back", undefined);
      }
      const refusal = helperAfterRefusal(label, `has its own credential helper for ${host}`, after, null);
      if (o.json) {
        out.json({ ok: false, error: "own-helper", ...(undo.length > 0 ? { undo } : {}) });
        process.exit(1);
      }
      const switched = switching ? [out.callout("note", "Origin already uses https")] : [];
      refuseWith(false, "own-helper", ...refusalNote(refusal), ...switched, ...undoBlocks(undo, withheld));
    }
    undo.push(helperUndo);
  }

  if (o.json) {
    deps.print(JSON.stringify({ ok: true, path: root, host, changed: true, ...(switching ? { from: printable(from), to } : {}), undo }));
    return;
  }
  const token = `rt's ${forgeName(s.forge)} token`;
  const blocks: Block[] = [out.line("done", label, switching ? `now uses https and ${token}` : `now uses ${token}`)];
  if (pushPlan === "leave") blocks.push(out.callout("note", "Its push URL points elsewhere, so rt left it as it was"));
  out.print(...blocks, ...undoBlocks(undo, withheld));
}
