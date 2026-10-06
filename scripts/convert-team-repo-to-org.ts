#!/usr/bin/env bun
import { execFileSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { parse } from "jsonc-parser";
import { UserActionableError, failureFor, logFailureDetail } from "../lib/errors.ts";
import { shellQuote } from "../lib/herdr-launch.ts";
import { getSetting } from "../lib/settings/resolve.ts";
import { childEnv } from "../lib/subprocess.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { readForgeUsername, sameUser } from "../packages/rt-client/src/index.ts";
import { planConversion, type ConvertInput } from "./lib/convert-team-repo.ts";

const USAGE = "bun scripts/convert-team-repo-to-org.ts <clone-dir> --admin <username> [--team <name>] [--team-repo <identity>]... [--write --roster-confirmed]";

function refuse(title: string, why?: string, next?: string | string[]): never {
  const commands = next === undefined ? [] : Array.isArray(next) ? next : [next];
  out.note(out.line("refused", title), ...(why ? [out.callout("why", why)] : []), ...(commands.length ? [out.callout("next", ...commands.map(out.cmd))] : []));
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  const cloneArg = args.shift();
  const values: Record<string, string[]> = {};
  const switches = new Set<string>();
  if (!cloneArg || cloneArg.startsWith("--")) {
    out.fail(usageFailure("Name the clone you want to convert", USAGE));
    process.exit(2);
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--write", "--roster-confirmed"].includes(arg)) switches.add(arg);
    else if (["--admin", "--team", "--team-repo"].includes(arg) && args[i + 1] && !args[i + 1]!.startsWith("--")) {
      (values[arg] ??= []).push(args[++i]!);
    } else {
      out.fail(usageFailure("Check the conversion arguments", USAGE));
      process.exit(2);
    }
  }
  const admin = values["--admin"]?.[0];
  if (!admin || values["--admin"]!.length !== 1 || (values["--team"]?.length ?? 0) > 1) {
    out.fail(usageFailure("Name the admin who will own this org", USAGE));
    process.exit(2);
  }
  const clone = resolve(cloneArg);
  const git = (...argv: string[]) => execFileSync("git", ["-C", clone, ...argv], { encoding: "utf8", env: childEnv(), stdio: "pipe" });
  if (resolve(git("rev-parse", "--show-toplevel").trim()) !== clone) throw new UserActionableError("not-clone-root", "Choose the root of the clone you want to convert");
  const assertNoLink = (rel: string): void => {
    let path = clone;
    for (const part of rel.split("/")) {
      path = join(path, part);
      let stat;
      try { stat = lstatSync(path); } catch (err) {
        if (["ENOENT", "ENOTDIR"].includes((err as NodeJS.ErrnoException).code ?? "")) break;
        throw err;
      }
      if (stat.isSymbolicLink()) refuse("The conversion paths contain a symbolic link", "Use ordinary files and folders so the conversion stays inside this clone.");
    }
  };
  const read = (rel: string) => {
    assertNoLink(rel);
    return existsSync(join(clone, rel)) ? readFileSync(join(clone, rel), "utf8") : undefined;
  };
  const packsDir = join(clone, "mattstack", "packs");
  assertNoLink("mattstack/packs");
  const packs = existsSync(packsDir) ? readdirSync(packsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : [];
  const wanted = ["mattstack/mattstack.jsonc", "mattstack/team.jsonc", "mattstack/settings.team.jsonc", ".sops.yaml", ".gitignore", ".claude-plugin/marketplace.json", ...packs.flatMap((pack) => [`mattstack/packs/${pack}/.claude-plugin/plugin.json`, `mattstack/packs/${pack}/pack/skills.jsonc`])];
  const files: ConvertInput["files"] = {};
  for (const rel of wanted) {
    const text = read(rel);
    if (text !== undefined) files[rel] = text;
  }
  let plan;
  try {
    plan = planConversion({ files, packs, hasSecrets: git("ls-files", "--", "mattstack/secrets").trim() !== "" }, { org: basename(clone), admin, team: values["--team"]?.[0], teamRepos: values["--team-repo"] });
  } catch (err) {
    throw new UserActionableError("invalid-conversion", "This clone cannot be converted", {}, { why: err instanceof Error ? err.message : String(err) });
  }
  for (const rel of [...plan.moves.flat(), ...plan.deletes, ...Object.keys(plan.writes)]) assertNoLink(rel);
  out.print(out.section("Conversion plan", undefined, ...plan.report.map((line) => out.paragraph(line))), out.section("Moves", undefined, out.table(plan.moves.map(([from, to]) => [from, to]))), out.section("Deletes", undefined, ...plan.deletes.map((rel) => out.paragraph(rel))));
  if (!switches.has("--write")) {
    out.print(out.line("off", "Nothing was written", "Review the split and confirm each roster username before writing"), out.callout("next", out.cmd(USAGE)));
    return;
  }
  if (!switches.has("--roster-confirmed")) refuse("Confirm each member's forge username before converting", plan.rosterUsernames.join(", "), USAGE);
  if (getSetting<{ enabled?: boolean }>("rt.teamSnapshot").value?.enabled !== false) {
    refuse("Team sync is on for this Mac", "It could push the conversion before you review it. Turn sync off, restart the daemon, and turn it back on after you publish.", ["rt settings set rt.teamSnapshot '{\"enabled\": false}' --scope machine", "rt daemon restart"]);
  }
  const recorded = readForgeUsername(basename(clone));
  if (recorded === null || !sameUser(recorded, admin)) {
    const forge = parse(files["mattstack/settings.team.jsonc"] ?? "{}")["mattstack.integrations"]?.forge;
    const connect = forge?.provider === "gitlab" && typeof forge.host === "string" ? `rt setup gitlab connect --host ${forge.host}` : forge?.provider === "github" ? "rt setup github connect" : "rt setup apply --only team.identity";
    refuse(recorded === null ? "This Mac has no recorded forge username" : `This Mac is recorded as ${recorded}`, `The recorded username must match ${admin} so you can publish as this org's admin.`, recorded === null ? connect : USAGE);
  }
  if (git("status", "--porcelain", "--untracked-files=all").trim() !== "") refuse("The clone has uncommitted changes", "Commit or discard them before converting.");
  if (git("status", "--porcelain", "--untracked-files=all", "--ignored", "--", "mattstack", ".claude-plugin", ".sops.yaml", ".gitignore").trim() !== "") refuse("The clone has ignored files in its managed folders", "Move them aside before converting so a failed conversion can restore the clean start.");
  let branch: string | null;
  try {
    branch = git("symbolic-ref", "-q", "--short", "HEAD").trim() || null;
  } catch {
    branch = null;
  }
  if (branch === null) {
    refuse("The clone has no branch checked out", "The conversion commits to the branch you are on, and rt publishes that branch.", `git -C ${shellQuote(clone)} switch main`);
  }
  const targets = [...plan.moves.map(([, to]) => to), ...Object.keys(plan.writes)];
  const newTargets = new Set([...plan.moves.map(([, to]) => to), ...Object.keys(plan.writes).filter((rel) => files[rel] === undefined)]);
  const createdRoots = new Set<string>();
  const existingDirectories = new Set<string>();
  for (const rel of targets) {
    if (newTargets.has(rel) && existsSync(join(clone, rel))) refuse("A conversion destination already exists", "Move the existing destination aside before converting so its content is preserved.");
    const parts = rel.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = join(clone, ...parts.slice(0, i));
      if (!existsSync(path)) {
        // Only an absent path can be removed on rollback, including ignored output.
        createdRoots.add(path);
        break;
      }
      if (i < parts.length) {
        if (!lstatSync(path).isDirectory()) refuse("A file blocks a conversion destination", "Move it aside before converting so its content is preserved.");
        existingDirectories.add(path);
      }
    }
  }
  const rememberDirectories = (path: string): void => {
    if (!lstatSync(path).isDirectory()) return;
    existingDirectories.add(path);
    for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) rememberDirectories(join(path, entry.name));
  };
  for (const [from] of plan.moves) rememberDirectories(join(clone, from));
  const quoted = shellQuote(clone);
  try {
    execFileSync("git", ["-C", clone, "fetch", "-q", "origin"], { encoding: "utf8", env: { ...childEnv(), GIT_TERMINAL_PROMPT: "0" }, stdio: "pipe" });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    throw new UserActionableError("fetch-failed", "Could not fetch origin to check that the clone is current", {}, { next: `git -C ${quoted} fetch origin`, log: stderr || (err instanceof Error ? err.message : String(err)) });
  }
  let originBranch: string;
  try {
    originBranch = git("rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`).trim();
  } catch {
    refuse(`Origin has no ${branch} branch`, "rt publishes the branch you are on, so origin needs it before converting. Push it once.", `git -C ${quoted} push -u origin ${shellQuote(branch)}`);
  }
  const [ahead, behind] = git("rev-list", "--left-right", "--count", `HEAD...${originBranch}`).trim().split(/\s+/).map(Number);
  if (ahead === 0 && behind! > 0) {
    refuse("The clone is behind origin", `Origin has ${behind} commit${behind === 1 ? "" : "s"} this clone does not. Converting now would leave them out, and the publish would be refused.`, `git -C ${quoted} pull --ff-only`);
  }
  if (ahead! > 0) refuse("The clone has commits origin does not have", "Publish or drop them first, so the conversion is the only change you publish.", `git -C ${quoted} log --oneline ${shellQuote(`origin/${branch}..HEAD`)}`);
  const start = git("rev-parse", "HEAD").trim();
  try {
    for (const [from, to] of plan.moves) {
      mkdirSync(dirname(join(clone, to)), { recursive: true });
      git("mv", "--", from, to);
    }
    for (const rel of plan.deletes) git("rm", "-q", "--", rel);
    for (const [rel, text] of Object.entries(plan.writes)) {
      mkdirSync(dirname(join(clone, rel)), { recursive: true });
      writeFileSync(join(clone, rel), text);
    }
    git("add", "--", ...Object.keys(plan.writes));
    git("commit", "-q", "-m", "org: convert to the org layout");
  } catch (err) {
    git("reset", "-q", "--hard", start);
    for (const path of createdRoots) rmSync(path, { recursive: true, force: true });
    // Git restores tracked files, but can prune their preexisting empty parents.
    for (const path of existingDirectories) mkdirSync(path, { recursive: true });
    throw new UserActionableError("conversion-stopped", "The conversion stopped partway, and the clone is back as it was", {}, { log: err instanceof Error ? err.message : String(err) });
  }
  out.print(out.line("done", "Converted this clone in one commit", "Review the commit before publishing, then turn team sync back on"), out.callout("next", out.cmd("git show"), out.cmd("rt team publish")));
}

try {
  main();
} catch (err) {
  const failure = err instanceof UserActionableError ? err : new UserActionableError("conversion-failed", "The conversion could not continue", {}, { log: err instanceof Error ? err.message : String(err) });
  logFailureDetail(failure);
  out.fail(failureFor(failure));
  process.exit(1);
}
