#!/usr/bin/env bun
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { UserActionableError, failureFor, logFailureDetail } from "../lib/errors.ts";
import { stripJsonc } from "../lib/jsonc.ts";
import { shellQuote } from "../lib/team/org-branch.ts";
import { ORG_MARKER_REL, parseMarker, validBranch } from "../lib/team/org-marker.ts";
import { withoutUrls } from "../lib/team/redact.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { rolesFrom } from "../packages/rt-client/src/settings/active-team.ts";
import { isOrgAdmin, roleOf } from "../packages/rt-client/src/settings/org-roles.ts";
import { ORG_STORE_REL } from "../packages/rt-client/src/settings/paths.ts";
import { parseStoreText } from "../packages/rt-client/src/settings/stores.ts";
import { ConversionRefusal, cloneRoot } from "./lib/org-conversion.ts";

const USAGE = "bun scripts/move-to-data-branch.ts <clone-dir> --admin <username> [--data-branch <name>] [--no-pointer] [--write]";
const SOURCE_LAYOUT = 3;
const DATA_LAYOUT = 4;
const DEFAULT_DATA_BRANCH = "mattstack";
const DATA_PATHS = ["mattstack", ".sops.yaml", ".claude-plugin", ".gitignore"];
// .gitignore is copied but not compared: main's own ignore rules change for reasons that have nothing to do with the org's data.
const WATCHED_PATHS = ["mattstack", ".sops.yaml", ".claude-plugin"];
const SECRETS_IGNORE = "mattstack/org/admin-secrets/*.tmp";
const MAX_ATTEMPTS = 5;

const README = `# Org data

This branch holds the org's mattstack data: the \`mattstack/\` folder, \`.sops.yaml\`, \`.claude-plugin/\` and \`.gitignore\`.

It shares no history with \`main\`. It is never merged into \`main\`, and \`main\` is never merged into it.
`;

const errorText = (err: unknown): string => withoutUrls(err instanceof Error ? err.message : String(err));

function refuse(title: string, why?: string, next?: string | string[]): never {
  const commands = next === undefined ? [] : Array.isArray(next) ? next : [next];
  out.note(out.line("refused", title), ...(why ? [out.callout("why", why)] : []), ...(commands.length ? [out.callout("next", ...commands.map(out.cmd))] : []));
  process.exit(2);
}

interface Options {
  clone: string;
  admin: string;
  dataBranch: string;
  pointer: boolean;
  write: boolean;
}

function parseArgs(argv: string[]): Options {
  const args = [...argv];
  const clone = args.shift();
  if (!clone || clone.startsWith("--")) {
    out.fail(usageFailure("Name the org clone you want to move onto a data branch", USAGE));
    process.exit(2);
  }
  let admin: string | undefined;
  let dataBranch: string | undefined;
  let pointer = true;
  let write = false;
  const value = (i: number): string | undefined => (args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1] : undefined);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--write") write = true;
    else if (arg === "--no-pointer") pointer = false;
    else if (arg === "--admin" && value(i) !== undefined && admin === undefined) admin = args[++i]!;
    else if (arg === "--data-branch" && value(i) !== undefined && dataBranch === undefined) dataBranch = args[++i]!;
    else {
      out.fail(usageFailure("Check the arguments", USAGE));
      process.exit(2);
    }
  }
  if (!admin) {
    out.fail(usageFailure("Name the org admin who will publish the move", USAGE));
    process.exit(2);
  }
  return { clone, admin, dataBranch: dataBranch ?? DEFAULT_DATA_BRANCH, pointer, write };
}

/** Runs git in `dir`; a failure carries git's own stderr with any remote URL or token removed. */
function gitIn(dir: string, ...argv: string[]): string {
  try {
    return execFileSync("git", ["-C", dir, ...argv], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdio: "pipe" });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    throw new Error(withoutUrls((stderr || errorText(err)).trim()));
  }
}

/** The temp worktrees inherit a cone-sparse clone's sparse state; the override makes them whole without writing the clone's shared config. */
const wholeTree = (dir: string, ...argv: string[]): string => gitIn(dir, "-c", "core.sparseCheckout=false", "-c", "core.sparseCheckoutCone=false", ...argv);

const succeeds = (dir: string, ...argv: string[]): boolean => {
  try {
    gitIn(dir, ...argv);
    return true;
  } catch {
    return false;
  }
};

function show(clone: string, ref: string, rel: string): string | null {
  try {
    return gitIn(clone, "show", `${ref}:${rel}`);
  } catch {
    return null;
  }
}

function fetchOrigin(clone: string): void {
  try {
    gitIn(clone, "fetch", "-q", "origin");
  } catch (err) {
    throw new UserActionableError("fetch-failed", "Could not fetch origin to check that the clone is current", {}, { next: `git -C ${shellQuote(clone)} fetch origin`, log: errorText(err) });
  }
}

const pointerMarker = (org: string, dataBranch: string): string => `${JSON.stringify({ role: "org", org, layout: DATA_LAYOUT, dataBranch }, null, 2)}\n`;

interface Checked {
  org: string;
  mainSha: string;
  present: string[];
}

function check(opts: Options): Checked {
  let clone: string;
  try {
    clone = cloneRoot(opts.clone).path;
  } catch (err) {
    if (err instanceof ConversionRefusal) refuse(err.message, err.why, err.next);
    throw err;
  }
  if (!validBranch(opts.dataBranch) || opts.dataBranch === "main") refuse(`${opts.dataBranch} is not a usable data branch name`, "Use a plain branch name other than main.");
  if (gitIn(clone, "status", "--porcelain", "--untracked-files=all").trim() !== "") refuse("The clone has uncommitted changes", "Commit or discard them first, so the clone matches what origin holds.");
  fetchOrigin(clone);
  let mainSha: string;
  try {
    mainSha = gitIn(clone, "rev-parse", "--verify", "-q", "refs/remotes/origin/main").trim();
  } catch {
    refuse("Origin has no main branch", "The move reads the org's data from origin's main.");
  }
  if (gitIn(clone, "rev-parse", "HEAD").trim() !== mainSha) {
    refuse("The clone does not match origin's main", "The move copies what origin's main holds, so commits that exist only here would be left out.", [`git -C ${shellQuote(clone)} switch main`, `git -C ${shellQuote(clone)} pull --ff-only`]);
  }
  const markerText = show(clone, mainSha, ORG_MARKER_REL);
  const marker = parseMarker(markerText);
  if (marker.kind === "invalid") refuse("This is not a mattstack org repo", `mattstack/mattstack.jsonc cannot be read: ${marker.why}.`);
  if (marker.kind !== "org" || (JSON.parse(stripJsonc(markerText!)) as { role?: unknown }).role !== "org") refuse("This is not a mattstack org repo", "mattstack/mattstack.jsonc does not say role: org.");
  if (marker.layout !== SOURCE_LAYOUT || marker.dataBranch !== null) {
    refuse(`This org is not on layout ${SOURCE_LAYOUT}`, marker.dataBranch !== null ? `Its data already lives on the ${marker.dataBranch} branch.` : `It is on layout ${marker.layout}.`);
  }
  const storeText = show(clone, mainSha, ORG_STORE_REL.replaceAll("\\", "/"));
  const roles = rolesFrom(parseStoreText(ORG_STORE_REL, storeText ?? ""));
  if (!isOrgAdmin(roleOf(opts.admin, roles))) refuse(`${opts.admin} is not an admin of this org`);
  const taken = [opts.dataBranch, ...(opts.pointer ? [`${opts.dataBranch}-pointer`] : [])].find((name) => succeeds(clone, "ls-remote", "--exit-code", "--heads", "origin", name));
  if (taken !== undefined) {
    refuse(
      `origin already has a branch named ${taken}`,
      "The move creates it from scratch, so it will not overwrite one that exists. Choose another name with --data-branch, or delete that branch on origin if it is a leftover.",
      `git -C ${shellQuote(clone)} push origin --delete ${shellQuote(taken)}`,
    );
  }
  const present = gitIn(clone, "ls-tree", "--name-only", mainSha, "--", ...DATA_PATHS).trim().split("\n").filter(Boolean);
  return { org: marker.org, mainSha, present };
}

function plan(opts: Options, { org, present }: Checked): void {
  const lines = [
    `data branch: ${opts.dataBranch}, created from scratch, holding ${[...present, "README.md"].join(", ")}`,
    `marker: layout ${DATA_LAYOUT}, dataBranch ${opts.dataBranch}`,
    opts.pointer ? `main: one commit deleting ${present.filter((p) => p !== ".gitignore").join(", ")} and leaving only the pointer marker for ${org}` : "main: not touched (--no-pointer)",
  ];
  out.print(out.section("Move plan", undefined, ...lines.map((line) => out.paragraph(line))));
}

class Workspace {
  readonly root = mkdtempSync(join(tmpdir(), "rt-data-branch-"));
  private readonly trees: string[] = [];
  readonly scratchBranch = `rt-data-branch-${process.pid}`;

  constructor(private readonly clone: string) {}

  tree(name: string, sha: string): string {
    const dir = join(this.root, name);
    gitIn(this.clone, "worktree", "add", "-q", "--detach", dir, sha);
    this.trees.push(dir);
    return dir;
  }

  dispose(): void {
    for (const dir of this.trees) {
      try {
        gitIn(this.clone, "worktree", "remove", "--force", dir);
      } catch {}
    }
    try {
      gitIn(this.clone, "worktree", "prune");
    } catch {}
    try {
      gitIn(this.clone, "branch", "-D", this.scratchBranch);
    } catch {}
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** Replaces everything in `dir` with the data paths as `sha` holds them, plus the README and the layout 4 marker. */
function populate(dir: string, sha: string, org: string, dataBranch: string): void {
  wholeTree(dir, "read-tree", "--empty");
  wholeTree(dir, "clean", "-fdxq");
  const present = gitIn(dir, "ls-tree", "--name-only", sha, "--", ...DATA_PATHS).trim().split("\n").filter(Boolean);
  wholeTree(dir, "checkout", sha, "--", ...present);
  const ignorePath = join(dir, ".gitignore");
  let ignore = "";
  try {
    ignore = readFileSync(ignorePath, "utf8");
  } catch {}
  if (!ignore.split("\n").includes(SECRETS_IGNORE)) writeFileSync(ignorePath, `${ignore}${ignore === "" || ignore.endsWith("\n") ? "" : "\n"}${SECRETS_IGNORE}\n`);
  mkdirSync(join(dir, "mattstack"), { recursive: true });
  writeFileSync(join(dir, ORG_MARKER_REL), pointerMarker(org, dataBranch));
  writeFileSync(join(dir, "README.md"), README);
  wholeTree(dir, "add", "-A", "-f");
}

const sameWatched = (clone: string, a: string, b: string): boolean => succeeds(clone, "diff", "--quiet", a, b, "--", ...WATCHED_PATHS);

function commitPointer(dir: string, org: string, dataBranch: string): void {
  wholeTree(dir, "rm", "-rq", "--ignore-unmatch", "--", ...WATCHED_PATHS);
  mkdirSync(join(dir, "mattstack"), { recursive: true });
  writeFileSync(join(dir, ORG_MARKER_REL), pointerMarker(org, dataBranch));
  wholeTree(dir, "add", "--", ORG_MARKER_REL);
  wholeTree(dir, "commit", "-q", "-m", `mattstack: org data lives on the ${dataBranch} branch`);
}

type PointerOutcome = { kind: "main" } | { kind: "branch"; branch: string; why: string };

function convert(opts: Options, checked: Checked): { pointer: PointerOutcome | null } {
  const clone = cloneRoot(opts.clone).path;
  const { org } = checked;
  const { dataBranch } = opts;
  const work = new Workspace(clone);
  let dataPushed = false;
  try {
    let base = checked.mainSha;
    const dataTree = work.tree("data", base);
    gitIn(dataTree, "checkout", "-q", "--orphan", work.scratchBranch);
    populate(dataTree, base, org, dataBranch);
    gitIn(dataTree, "commit", "-q", "-m", "org data moves to its own branch");
    gitIn(dataTree, "push", "-q", "origin", `HEAD:refs/heads/${dataBranch}`);
    dataPushed = true;
    if (!opts.pointer) return { pointer: null };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      fetchOrigin(clone);
      const latest = gitIn(clone, "rev-parse", "refs/remotes/origin/main").trim();
      if (!sameWatched(clone, base, latest)) {
        populate(dataTree, latest, org, dataBranch);
        if (!succeeds(dataTree, "diff", "--cached", "--quiet")) {
          gitIn(dataTree, "commit", "-q", "-m", "org data: carry changes made on main");
          gitIn(dataTree, "push", "-q", "origin", `HEAD:refs/heads/${dataBranch}`);
        }
        base = latest;
      }
      const pointerTree = work.tree(`pointer-${attempt}`, latest);
      commitPointer(pointerTree, org, dataBranch);
      try {
        gitIn(pointerTree, "push", "-q", "origin", "HEAD:refs/heads/main");
        return { pointer: { kind: "main" } };
      } catch (pushErr) {
        fetchOrigin(clone);
        if (gitIn(clone, "rev-parse", "refs/remotes/origin/main").trim() !== latest) continue;
        const branch = `${dataBranch}-pointer`;
        gitIn(pointerTree, "push", "-q", "origin", `HEAD:refs/heads/${branch}`);
        return { pointer: { kind: "branch", branch, why: errorText(pushErr) } };
      }
    }
    throw new UserActionableError("main-kept-moving", "Main kept changing while the pointer was being committed", {}, { why: "Others kept pushing to main, so the pointer could not land. Run the move again once main is quiet.", log: `gave up after ${MAX_ATTEMPTS} attempts`, next: USAGE });
  } catch (err) {
    if (!dataPushed) throw err;
    const cause = errorText(err);
    throw new UserActionableError(
      "move-stopped-after-data-branch",
      `The move stopped after the ${dataBranch} branch was created`,
      {},
      {
        why: `The ${dataBranch} branch is already on origin, and main has no pointer yet, so nothing has moved. A rerun is refused until that branch is deleted; --no-pointer would stop at the same branch. Cause: ${cause}`,
        next: `git -C ${shellQuote(clone)} push origin --delete ${shellQuote(dataBranch)}`,
        log: cause,
      },
    );
  } finally {
    work.dispose();
  }
}

function report(opts: Options, outcome: PointerOutcome | null): void {
  const { dataBranch } = opts;
  const blocks = [out.line("done", `Pushed ${dataBranch} with the org's data`)];
  if (outcome === null) {
    blocks.push(out.line("off", "Main was not touched", "Nothing moves for anyone else until the pointer lands"), out.callout("next", ["Try the branch on one Mac with ", out.cmd(`rt team branch use ${dataBranch}`)]));
  } else if (outcome.kind === "main") {
    blocks.push(out.line("done", "Committed the pointer to main and pushed it", "Updated Macs move to the data branch on their next update"));
  } else {
    blocks.push(
      out.line("needs-you", `Main did not take the pointer, so it is on ${outcome.branch}`, "Land it by the repo's own rules, for example through a merge request into main"),
      ...(outcome.why ? [out.callout("why", outcome.why.split("\n").slice(-3).join(" "))] : []),
    );
  }
  if (outcome !== null) {
    const when = outcome.kind === "main" ? "Forge access reads this Mac's own copy of the org, which stays on main until it pulls" : "Once the pointer is on main, run these in order";
    blocks.push(
      out.line("pending", "Pull this Mac's copy, then set up forge access", when),
      out.callout("note", "The pull needs this Mac's rt daemon on v2.25.0 or later; an older one holds it as a layout it cannot read"),
      out.callout("next", out.cmd("rt team pull"), out.cmd("rt team manage-membership on"), out.cmd("rt team forge-access --apply")),
    );
  }
  out.print(...blocks);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const checked = check(opts);
  plan(opts, checked);
  if (!opts.write) {
    out.print(out.line("off", "Nothing was written", "Review the plan, then run again with --write"), out.callout("next", out.cmd(USAGE)));
    return;
  }
  const { pointer } = convert(opts, checked);
  report(opts, pointer);
}

try {
  main();
} catch (err) {
  const failure = err instanceof UserActionableError ? err : new UserActionableError("move-failed", "The move could not continue", {}, { why: errorText(err), log: errorText(err) });
  logFailureDetail(failure);
  out.fail(failureFor(failure));
  process.exit(1);
}
