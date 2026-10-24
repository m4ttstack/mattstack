#!/usr/bin/env bun
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { rolesFrom } from "../packages/rt-client/src/settings/active-team.ts";
import { isOrgAdmin, roleOf } from "../packages/rt-client/src/settings/org-roles.ts";
import { ORG_STORE_REL } from "../packages/rt-client/src/settings/paths.ts";
import { parseStoreText } from "../packages/rt-client/src/settings/stores.ts";
import { UserActionableError, failureFor, logFailureDetail } from "../lib/errors.ts";
import { ORG_CLONE_FOLDERS } from "../lib/team/org-clone.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { BLOCK_PACKS_LAYOUT, applyBlockPacksMove, planBlockPacksMove } from "./lib/block-packs-move.ts";
import { ConversionRefusal, cloneRoot, preflight } from "./lib/org-conversion.ts";

const USAGE = "bun scripts/move-to-block-packs.ts <clone-dir> --admin <username> [--write]";

function refuse(title: string, why?: string, next?: string | string[]): never {
  const commands = next === undefined ? [] : Array.isArray(next) ? next : [next];
  out.note(out.line("refused", title), ...(why ? [out.callout("why", why)] : []), ...(commands.length ? [out.callout("next", ...commands.map(out.cmd))] : []));
  process.exit(2);
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

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
    out.fail(usageFailure("Name the org clone whose packs are now block packs", USAGE));
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
    out.fail(usageFailure("Name the org admin who will publish the change", USAGE));
    process.exit(2);
  }
  const adminName = admin;
  const plan = guarded(() => planBlockPacksMove(cloneArg, adminName));
  const storePath = join(guarded(() => cloneRoot(cloneArg)).path, ORG_STORE_REL);
  const roles = rolesFrom(parseStoreText(ORG_STORE_REL, existsSync(storePath) ? readFileSync(storePath, "utf8") : ""));
  if (!isOrgAdmin(roleOf(adminName, roles))) refuse(`${adminName} is not an admin of this org`);

  const packLines = plan.packs.map((pack) => (pack.ok ? `${pack.name}: block form` : `${pack.name}: old slot keys`));
  out.print(out.section("Move plan", undefined, ...[...packLines, `marker: layout ${BLOCK_PACKS_LAYOUT} on ${plan.branch}`].map((line) => out.paragraph(line))));
  const old = plan.packs.filter((pack) => !pack.ok);
  if (old.length > 0) {
    refuse(
      old.length === 1 ? `The ${old[0]!.name} pack still uses old slot keys` : `These packs still use old slot keys: ${old.map((pack) => pack.name).join(", ")}`,
      `${old.flatMap((pack) => pack.oldBindings.map((entry) => `${pack.name}: ${entry}.`)).join(" ")} Convert each pack to block form on this branch, publish it, then run this again.`,
      USAGE,
    );
  }
  if (!write) {
    out.print(out.line("off", "Nothing was written", "Review the plan, then run again with --write"), out.callout("next", out.cmd(USAGE)));
    return;
  }
  const repo = guarded(() => cloneRoot(cloneArg));
  const { start } = guarded(() => preflight(repo, adminName, { managedFolders: ORG_CLONE_FOLDERS, usage: USAGE }));
  try {
    applyBlockPacksMove(plan);
  } catch (err) {
    try {
      repo.git("reset", "-q", "--hard", start);
    } catch (resetErr) {
      throw new UserActionableError(
        "move-rollback-failed",
        "The move stopped partway, and the clone could not be put back",
        {},
        { log: `move: ${errorText(err)}\nreset: ${errorText(resetErr)}`, next: `git -C ${repo.path} status` },
      );
    }
    throw new UserActionableError("move-stopped", "The move stopped partway, and the clone is back as it was", {}, { log: errorText(err) });
  }
  out.print(
    out.line("done", `Marked this org as layout ${BLOCK_PACKS_LAYOUT} on ${plan.branch} in one commit`, "Review the commit before publishing, then turn team sync back on"),
    out.callout("next", out.cmd("git show"), out.cmd("rt team publish")),
  );
}

try {
  main();
} catch (err) {
  const failure = err instanceof UserActionableError ? err : new UserActionableError("move-failed", "The move could not continue", {}, { log: errorText(err) });
  logFailureDetail(failure);
  out.fail(failureFor(failure));
  process.exit(1);
}
