#!/usr/bin/env bun
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { UserActionableError, failureFor, logFailureDetail } from "../lib/errors.ts";
import { ORG_CLONE_FOLDERS } from "../lib/team/org-clone.ts";
import { nestedTeamPackRel, teamPackRel } from "../lib/team/team-pack-path.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { MoveRefusal, ORG_STORE_REL, planMove, teamStoreRel, type MoveInput } from "./lib/move-team-packs.ts";
import { ConversionRefusal, assertNoLink, cloneRoot, preflight } from "./lib/org-conversion.ts";

const USAGE = "bun scripts/move-team-packs-to-plugin.ts <clone-dir> --admin <username> [--write]";

function refuse(title: string, why?: string, next?: string | string[]): never {
  const commands = next === undefined ? [] : Array.isArray(next) ? next : [next];
  out.note(out.line("refused", title), ...(why ? [out.callout("why", why)] : []), ...(commands.length ? [out.callout("next", ...commands.map(out.cmd))] : []));
  process.exit(2);
}

function guarded<T>(check: () => T): T {
  try {
    return check();
  } catch (err) {
    if (err instanceof ConversionRefusal) refuse(err.message, err.why, err.next);
    throw err;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const cloneArg = args.shift();
  if (!cloneArg || cloneArg.startsWith("--")) {
    out.fail(usageFailure("Name the org clone whose team packs you want to move", USAGE));
    process.exit(2);
  }
  let admin: string | undefined;
  let write = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--write") write = true;
    else if (arg === "--admin" && args[i + 1] && !args[i + 1]!.startsWith("--") && admin === undefined) admin = args[++i]!;
    else {
      out.fail(usageFailure("Check the arguments", USAGE));
      process.exit(2);
    }
  }
  if (!admin) {
    out.fail(usageFailure("Name the org admin who will publish the move", USAGE));
    process.exit(2);
  }
  const repo = guarded(() => cloneRoot(cloneArg));
  const { path: clone, git } = repo;
  const noLink = (rel: string): void => guarded(() => assertNoLink(clone, rel));
  const read = (rel: string) => {
    noLink(rel);
    return existsSync(join(clone, rel)) ? readFileSync(join(clone, rel), "utf8") : undefined;
  };
  const dirs = (rel: string) => {
    noLink(rel);
    return existsSync(join(clone, rel)) ? readdirSync(join(clone, rel), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
  };
  const teams = dirs("mattstack/teams");
  const input: MoveInput = { files: {}, teams, nested: {}, hasPlugin: {} };
  const wanted = ["mattstack/mattstack.jsonc", ".claude-plugin/marketplace.json", ORG_STORE_REL, ...teams.map(teamStoreRel)];
  for (const team of teams) {
    input.nested[team] = dirs(dirname(nestedTeamPackRel(team)));
    input.hasPlugin[team] = existsSync(join(clone, teamPackRel(team)));
    if (input.nested[team]!.includes(team)) wanted.push(`${nestedTeamPackRel(team)}/.claude-plugin/plugin.json`, `${nestedTeamPackRel(team)}/pack/skills.jsonc`);
  }
  for (const rel of wanted) {
    const text = read(rel);
    if (text !== undefined) input.files[rel] = text;
  }
  let plan;
  try {
    plan = planMove(input);
  } catch (err) {
    if (err instanceof MoveRefusal) refuse(err.message, err.why);
    throw err;
  }
  for (const rel of [...plan.moves.flat(), ...Object.keys(plan.writes)]) noLink(rel);
  out.print(out.section("Move plan", undefined, ...plan.report.map((line) => out.paragraph(line))), out.section("Moves", undefined, out.table(plan.moves.map(([from, to]) => [from, to]))));
  if (!write) {
    out.print(out.line("off", "Nothing was written", "Review the plan, then run again with --write"), out.callout("next", out.cmd(USAGE)));
    return;
  }
  const { start } = guarded(() => preflight(repo, admin, { managedFolders: ORG_CLONE_FOLDERS, usage: USAGE }));
  const newTargets = new Set([...plan.moves.map(([, to]) => to), ...Object.keys(plan.writes).filter((rel) => input.files[rel] === undefined && !plan.moves.some(([, to]) => rel.startsWith(`${to}/`)))]);
  const createdRoots = new Set<string>();
  const existingDirectories = new Set<string>();
  for (const rel of [...plan.moves.map(([, to]) => to), ...Object.keys(plan.writes)]) {
    if (newTargets.has(rel) && existsSync(join(clone, rel))) refuse("A move destination already exists", "Move the existing destination aside before moving so its content is preserved.");
    const parts = rel.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = join(clone, ...parts.slice(0, i));
      if (!existsSync(path)) {
        // Only an absent path can be removed on rollback, including ignored output.
        createdRoots.add(path);
        break;
      }
      if (i < parts.length) {
        if (!lstatSync(path).isDirectory()) refuse("A file blocks a move destination", "Move it aside before moving so its content is preserved.");
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
  try {
    for (const [from, to] of plan.moves) {
      mkdirSync(dirname(join(clone, to)), { recursive: true });
      git("mv", "--", from, to);
      // git mv leaves the emptied packs/ folder on disk; git itself never tracks it.
      const parent = dirname(join(clone, from));
      if (readdirSync(parent).length === 0) rmdirSync(parent);
    }
    for (const [rel, text] of Object.entries(plan.writes)) {
      mkdirSync(dirname(join(clone, rel)), { recursive: true });
      writeFileSync(join(clone, rel), text);
    }
    git("add", "--", ...Object.keys(plan.writes));
    git("commit", "-q", "-m", "org: move team packs to plugin/");
  } catch (err) {
    git("reset", "-q", "--hard", start);
    for (const path of createdRoots) rmSync(path, { recursive: true, force: true });
    // Git restores tracked files, but can prune their preexisting empty parents.
    for (const path of existingDirectories) mkdirSync(path, { recursive: true });
    throw new UserActionableError("move-stopped", "The move stopped partway, and the clone is back as it was", {}, { log: err instanceof Error ? err.message : String(err) });
  }
  out.print(out.line("done", "Moved this clone's team packs in one commit", "Review the commit before publishing, then turn team sync back on"), out.callout("next", out.cmd("git show"), out.cmd("rt team publish")));
}

try {
  main();
} catch (err) {
  const failure = err instanceof UserActionableError ? err : new UserActionableError("move-failed", "The move could not continue", {}, { log: err instanceof Error ? err.message : String(err) });
  logFailureDetail(failure);
  out.fail(failureFor(failure));
  process.exit(1);
}
