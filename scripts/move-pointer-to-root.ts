#!/usr/bin/env bun
/**
 * Moves the org's pointer on `main` from mattstack/mattstack.jsonc to a
 * single root file, .mattstack.jsonc, in two phases. Phase 1 (`add`) adds the
 * root file beside the folder file, which every rt reads. Phase 2 (`drop`)
 * deletes the folder file, which rt v2.25.1 and older read alone, so it runs
 * only once the admin confirms every member is on a release that reads the
 * root file. Both commit to `main` through git's plumbing, never touching
 * this clone's files, and both are a dry run until --write.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { UserActionableError, failureFor, logFailureDetail } from "../lib/errors.ts";
import { shellQuote } from "../lib/team/org-branch.ts";
import { ORG_MARKER_REL, parseMarker, POINTER_REL, pointerText } from "../lib/team/org-marker.ts";
import { withoutUrls } from "../lib/team/redact.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { readForgeUsername, sameUser } from "../packages/rt-client/src/index.ts";
import { rolesFrom } from "../packages/rt-client/src/settings/active-team.ts";
import { isOrgAdmin, roleOf } from "../packages/rt-client/src/settings/org-roles.ts";
import { ORG_STORE_REL } from "../packages/rt-client/src/settings/paths.ts";
import { parseStoreText } from "../packages/rt-client/src/settings/stores.ts";
import { ConversionRefusal, cloneRoot } from "./lib/org-conversion.ts";

const USAGE = "bun scripts/move-pointer-to-root.ts <clone-dir> --admin <username> --phase add|drop [--members-confirmed] [--write]";
const MAIN_REF = "refs/rt-pointer/main";
const FALLBACK_BRANCH = "mattstack-root-pointer";
const COMMIT_MESSAGE = { add: "mattstack: point at the org's data from .mattstack.jsonc", drop: "mattstack: drop the old mattstack/mattstack.jsonc pointer" } as const;

type Phase = "add" | "drop";

interface Options {
  clone: string;
  admin: string;
  phase: Phase;
  confirmed: boolean;
  write: boolean;
}

const errorText = (err: unknown): string => withoutUrls(err instanceof Error ? err.message : String(err));

function refuse(title: string, why?: string, next?: string | string[]): never {
  const commands = next === undefined ? [] : Array.isArray(next) ? next : [next];
  out.note(out.line("refused", title), ...(why ? [out.callout("why", why)] : []), ...(commands.length ? [out.callout("next", ...commands.map(out.cmd))] : []));
  process.exit(2);
}

function usage(title: string): never {
  out.fail(usageFailure(title, USAGE));
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const args = [...argv];
  const clone = args.shift();
  if (!clone || clone.startsWith("--")) usage("Name the org clone whose main you want to change");
  let admin: string | undefined;
  let phase: string | undefined;
  let confirmed = false;
  let write = false;
  const value = (i: number): string | undefined => (args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1] : undefined);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--write") write = true;
    else if (arg === "--members-confirmed") confirmed = true;
    else if (arg === "--admin" && value(i) !== undefined && admin === undefined) admin = args[++i]!;
    else if (arg === "--phase" && value(i) !== undefined && phase === undefined) phase = args[++i]!;
    else usage("Check the arguments");
  }
  if (!admin) usage("Name the org admin who will change main");
  if (phase !== "add" && phase !== "drop") usage("Choose the phase: add, then drop once every member has updated");
  return { clone, admin, phase, confirmed, write };
}

function gitIn(dir: string, argv: string[], opts: { env?: Record<string, string>; input?: string } = {}): string {
  try {
    return execFileSync("git", ["-C", dir, ...argv], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env }, stdio: "pipe", ...(opts.input !== undefined ? { input: opts.input } : {}) });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    throw new Error(withoutUrls((stderr || errorText(err)).trim()));
  }
}

function tryGit(dir: string, argv: string[]): string | null {
  try {
    return gitIn(dir, argv);
  } catch {
    return null;
  }
}

interface Checked {
  org: string;
  dataBranch: string;
  layout: number;
  mainSha: string;
  mainFiles: string[];
}

/**
 * A scratch bare repo holding only main's tip, without its blobs: main is the
 * developers' whole repo, which this clone never fetches. It takes the clone's
 * credential settings, so a lazy blob read and the push authenticate the same way.
 */
function scratchFor(clone: string, url: string): string {
  const scratch = mkdtempSync(join(tmpdir(), "rt-root-pointer-"));
  gitIn(scratch, ["init", "-q", "--bare"]);
  const credentials = tryGit(clone, ["config", "--get-regexp", "^credential\\."]) ?? "";
  for (const line of credentials.split("\n").filter(Boolean)) {
    const at = line.indexOf(" ");
    gitIn(scratch, ["config", "--add", line.slice(0, at), line.slice(at + 1)]);
  }
  try {
    gitIn(scratch, ["fetch", "-q", "--depth", "1", "--filter=blob:none", url, `+refs/heads/main:${MAIN_REF}`]);
  } catch (err) {
    rmSync(scratch, { recursive: true, force: true });
    throw new UserActionableError("fetch-failed", "Could not fetch main from origin", {}, { log: errorText(err) });
  }
  return scratch;
}

function check(opts: Options, clone: string, scratch: string): Checked {
  const recorded = readForgeUsername(basename(clone));
  if (recorded === null || !sameUser(recorded, opts.admin)) {
    refuse(recorded === null ? "This Mac has no recorded forge username" : `This Mac is recorded as ${recorded}`, `The recorded username must match ${opts.admin}, the admin pushing to main.`);
  }
  const marker = parseMarker(tryGit(clone, ["show", `HEAD:${ORG_MARKER_REL}`]));
  if (marker.kind !== "org" || marker.dataBranch === null) refuse("This copy is not on the org's data branch", "Run this from a copy on the branch that holds the org's data.");
  const dataBranch = marker.dataBranch;
  try {
    gitIn(clone, ["fetch", "-q", "origin", `+refs/heads/${dataBranch}:refs/remotes/origin/${dataBranch}`]);
  } catch (err) {
    throw new UserActionableError("fetch-failed", "Could not fetch the data branch from origin", {}, { log: errorText(err) });
  }
  const store = tryGit(clone, ["show", `refs/remotes/origin/${dataBranch}:${ORG_STORE_REL}`]);
  if (!isOrgAdmin(roleOf(opts.admin, rolesFrom(parseStoreText(ORG_STORE_REL, store ?? ""))))) refuse(`${opts.admin} is not an admin of this org`);
  const mainSha = gitIn(scratch, ["rev-parse", MAIN_REF]).trim();
  const mainFiles = gitIn(scratch, ["ls-tree", "-r", "--name-only", mainSha]).trim().split("\n").filter(Boolean);
  const pointer = parseMarker(tryGit(scratch, ["show", `${mainSha}:${mainFiles.includes(POINTER_REL) ? POINTER_REL : ORG_MARKER_REL}`]));
  if (pointer.kind !== "org" || pointer.dataBranch !== dataBranch) {
    refuse("main does not point at this org's data branch", `Its pointer should name ${dataBranch}. Check main before moving the pointer.`);
  }
  const strays = mainFiles.filter((path) => path.startsWith("mattstack/") && path !== ORG_MARKER_REL);
  if (strays.length > 0) {
    refuse("main holds org files besides the pointer", `Revert the commit that merged the org's data into main first. main holds ${strays.slice(0, 3).join(", ")}${strays.length > 3 ? " and more" : ""}.`);
  }
  return { org: marker.org, dataBranch, layout: pointer.layout, mainSha, mainFiles };
}

/** What the phase changes on main; null when main is already there. */
function plan(opts: Options, checked: Checked): string | null {
  const hasRoot = checked.mainFiles.includes(POINTER_REL);
  const hasFolder = checked.mainFiles.includes(ORG_MARKER_REL);
  if (opts.phase === "add") return hasRoot ? null : `main: one commit adding ${POINTER_REL} beside ${ORG_MARKER_REL}, both naming the ${checked.dataBranch} branch`;
  if (!hasRoot) refuse("main has no .mattstack.jsonc yet", "Run phase 1 first, so every rt still reads a pointer after the folder file goes.", `bun scripts/move-pointer-to-root.ts ${shellQuote(opts.clone)} --admin ${opts.admin} --phase add --write`);
  if (!opts.confirmed) {
    refuse(
      "Confirm every member runs this release first",
      "rt v2.25.1 and older read only mattstack/mattstack.jsonc, so a Mac still on one would treat the org as not moved. rt keeps no record of members' versions, so check each member has updated, then run again with --members-confirmed.",
    );
  }
  return hasFolder ? `main: one commit deleting ${ORG_MARKER_REL}, leaving ${POINTER_REL} as the org's only file` : null;
}

/** A commit on main's tip with the phase's change, built in the scratch repo's own index. */
function buildCommit(scratch: string, opts: Options, checked: Checked): string {
  const env = { GIT_INDEX_FILE: join(scratch, "pointer-index") };
  gitIn(scratch, ["read-tree", checked.mainSha], { env });
  if (opts.phase === "add") {
    const blob = gitIn(scratch, ["hash-object", "-w", "--stdin"], { input: pointerText(checked.org, checked.dataBranch, checked.layout) }).trim();
    gitIn(scratch, ["update-index", "--add", "--cacheinfo", `100644,${blob},${POINTER_REL}`], { env });
  } else {
    gitIn(scratch, ["update-index", "--index-info"], { env, input: `0 ${"0".repeat(40)}\t${ORG_MARKER_REL}\n` });
  }
  const tree = gitIn(scratch, ["write-tree"], { env }).trim();
  return gitIn(scratch, ["commit-tree", tree, "-p", checked.mainSha, "-m", COMMIT_MESSAGE[opts.phase]]).trim();
}

function run(opts: Options, clone: string, scratch: string, url: string): void {
  const checked = check(opts, clone, scratch);
  const change = plan(opts, checked);
  if (change === null) {
    out.print(out.line("done", opts.phase === "add" ? "main already has .mattstack.jsonc" : "main already holds only .mattstack.jsonc"));
    return;
  }
  out.print(out.section("Pointer plan", undefined, out.paragraph(change)));
  if (!opts.write) {
    out.print(out.line("off", "Nothing was written", "Review the plan, then run again with --write"));
    return;
  }
  const commit = buildCommit(scratch, opts, checked);
  try {
    gitIn(scratch, ["push", "-q", url, `${commit}:refs/heads/main`]);
    out.print(out.line("done", opts.phase === "add" ? "Added .mattstack.jsonc to main and pushed it" : "Deleted mattstack/mattstack.jsonc from main and pushed it"));
  } catch (pushErr) {
    gitIn(scratch, ["push", "-q", "--force", url, `${commit}:refs/heads/${FALLBACK_BRANCH}`]);
    out.print(
      out.line("needs-you", `main did not take the change, so it is on ${FALLBACK_BRANCH}`, "Land it by the repo's own rules, for example through a merge request into main"),
      out.callout("why", errorText(pushErr).split("\n").slice(-2).join(" ")),
    );
  }
  if (opts.phase === "add") out.print(out.callout("next", "Once every member runs this release, drop the old file with ", out.cmd(`bun scripts/move-pointer-to-root.ts ${shellQuote(opts.clone)} --admin ${opts.admin} --phase drop --members-confirmed --write`)));
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  let clone: string;
  try {
    clone = cloneRoot(opts.clone).path;
  } catch (err) {
    if (err instanceof ConversionRefusal) refuse(err.message, err.why, err.next);
    throw err;
  }
  const url = tryGit(clone, ["remote", "get-url", "origin"])?.trim();
  if (!url) refuse("This copy has no origin to push main to");
  const scratch = scratchFor(clone, url);
  const exit = process.exit.bind(process);
  // A refusal exits from deep inside the checks, so the scratch repo is removed on the way out too.
  process.exit = ((code?: number) => {
    rmSync(scratch, { recursive: true, force: true });
    return exit(code);
  }) as typeof process.exit;
  try {
    run(opts, clone, scratch, url);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  const failure = err instanceof UserActionableError ? err : new UserActionableError("pointer-move-failed", "The pointer move could not continue", {}, { why: errorText(err), log: errorText(err) });
  logFailureDetail(failure);
  out.fail(failureFor(failure));
  process.exit(1);
}
