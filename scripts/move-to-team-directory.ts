#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { UserActionableError, failureFor, logFailureDetail } from "../lib/errors.ts";
import { orgDir } from "../lib/rt-paths.ts";
import { setSetting } from "../lib/settings/write.ts";
import { ORG_CLONE_FOLDERS } from "../lib/team/org-clone.ts";
import { ORG_MARKER_REL, parseMarker } from "../lib/team/org-marker.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { readOrgRoles, sameUser } from "../packages/rt-client/src/index.ts";
import { currentOrg, readStore } from "../packages/rt-client/src/settings/stores.ts";
import { ORG_STORE_REL, markerWithLayout, teamStoreRel } from "./lib/move-team-packs.ts";
import { ConversionRefusal, assertNoLink, cloneRoot, preflight } from "./lib/org-conversion.ts";
import { DirectoryRefusal, apply, planDirectoryMove } from "./lib/team-directory-move.ts";

const USAGE = "bun scripts/move-to-team-directory.ts <clone-dir> --admin <username> [--write]";
const DIRECTORY_LAYOUT = 3;

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
    out.fail(usageFailure("Name the org clone you want to move onto the team directory", USAGE));
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
  const adminName = admin;
  const repo = guarded(() => cloneRoot(cloneArg));
  const { path: clone, git } = repo;
  const noLink = (rel: string): void => guarded(() => assertNoLink(clone, rel));

  noLink(ORG_MARKER_REL);
  const markerPath = join(clone, ORG_MARKER_REL);
  const markerText = existsSync(markerPath) ? readFileSync(markerPath, "utf8") : null;
  const marker = parseMarker(markerText);
  if (marker.kind !== "org") refuse("This is not a mattstack org repo", "mattstack/mattstack.jsonc does not name an org.");
  if (marker.layout >= DIRECTORY_LAYOUT) refuse("This org is already on the team directory layout");
  if (marker.layout < 2) refuse(`This org is on layout ${marker.layout}`, "Convert it to layout 2 first.");
  const slug = marker.org;
  // setSetting writes to currentOrg()'s stores, so any other path would plan one clone and write another.
  if (clone !== orgDir(slug) || currentOrg() !== slug) {
    refuse("Run this on the org clone rt reads", undefined, `bun scripts/move-to-team-directory.ts ~/.mattstack/orgs/${slug} --admin ${admin}`);
  }

  noLink(ORG_STORE_REL);
  if (!readOrgRoles(slug).admins.some((name) => sameUser(name, adminName))) refuse(`${admin} is not an admin of this org`);

  const teamsRel = "mattstack/teams";
  noLink(teamsRel);
  const teams = existsSync(join(clone, teamsRel)) ? readdirSync(join(clone, teamsRel)).sort() : [];
  const values = (rel: string) => readStore(join(clone, rel)).global;
  const teamValues: Record<string, Record<string, unknown>> = {};
  for (const team of teams) {
    noLink(teamStoreRel(team));
    if (existsSync(join(clone, teamStoreRel(team)))) teamValues[team] = values(teamStoreRel(team));
  }
  let plan;
  try {
    plan = planDirectoryMove(values(ORG_STORE_REL), teamValues);
  } catch (err) {
    if (err instanceof DirectoryRefusal) refuse(err.message, err.why);
    throw err;
  }

  out.print(out.section("Move plan", undefined, ...[...plan.report, `marker: layout ${DIRECTORY_LAYOUT}`].map((line) => out.paragraph(line))));
  if (!write) {
    out.print(out.line("off", "Nothing was written", "Review the plan, then run again with --write"), out.callout("next", out.cmd(USAGE)));
    return;
  }
  const { start } = guarded(() => preflight(repo, adminName, { managedFolders: ORG_CLONE_FOLDERS, usage: USAGE }));
  try {
    if (plan.directory !== null) setSetting("mattstack.directory", plan.directory, "org");
    for (const [team, writes] of Object.entries(plan.teamWrites)) apply(slug, writes, "team", { team });
    apply(slug, plan.orgWrites, "org");
    writeFileSync(markerPath, markerWithLayout(markerText!, DIRECTORY_LAYOUT));
    git("add", "-A", "--", "mattstack");
    git("commit", "-q", "-m", "org: move team channels and Linear keys into the team directory");
  } catch (err) {
    git("reset", "-q", "--hard", start);
    throw new UserActionableError("move-stopped", "The move stopped partway, and the clone is back as it was", {}, { log: err instanceof Error ? err.message : String(err) });
  }
  out.print(out.line("done", "Moved this org onto the team directory in one commit", "Review the commit before publishing, then turn team sync back on"), out.callout("next", out.cmd("git show"), out.cmd("rt team publish")));
}

try {
  main();
} catch (err) {
  const failure = err instanceof UserActionableError ? err : new UserActionableError("move-failed", "The move could not continue", {}, { log: err instanceof Error ? err.message : String(err) });
  logFailureDetail(failure);
  out.fail(failureFor(failure));
  process.exit(1);
}
