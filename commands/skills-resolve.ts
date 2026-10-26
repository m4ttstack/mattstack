import { homedir } from "os";
import { exitUserError, UserActionableError } from "../lib/errors.ts";
import { realResolveFs, resolvePointers, type ResolveResult } from "../lib/skills/resolve.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

const USAGE = "rt skills resolve <id>";

export function resolveBlocks(result: ResolveResult): Block[] {
  const rows = Object.entries(result.keys).map(([key, path]) => [`@${key}`, path]);
  return [
    out.kv("Folder", result.folder),
    ...(rows.length > 0 ? [out.table(rows, ["Key", "Path"])] : [out.line("off", "This skill points at no other files.")]),
  ];
}

export async function skillsResolve(args: string[]): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) {
    if (json) exitUserError(new UserActionableError("usage", `usage: ${USAGE} [--json]`), true);
    out.fail(usageFailure("Which skill id should this resolve?", USAGE));
    process.exit(2);
  }
  let result: ResolveResult;
  try {
    result = resolvePointers(id, { fs: realResolveFs, home: process.env.HOME || homedir() });
  } catch (e) {
    if (e instanceof UserActionableError && json) exitUserError(e, true);
    throw e;
  }
  if (json) {
    out.json(result);
    return;
  }
  out.print(...resolveBlocks(result));
}
