/**
 * Which registered trees a herd worker may launch in. Only a claimed
 * ephemeral tree is safe: a main or golden tree would be shared, an
 * unmanaged one carries an unvetted .claude/settings.json, and the pool may
 * reset an ephemeral tree in any other state under a running worker.
 */
import type { TreeRecord } from "../worktree/registry.ts";

const RULE = "only a claimed ephemeral tree can host a worker";

export function admitTree(rec: TreeRecord | undefined, name: string): { ok: true; tree: TreeRecord } | { ok: false; error: string } {
  if (!rec) return { ok: false, error: `no registered tree named "${name}"; ${RULE}` };
  if (rec.kind !== "ephemeral") return { ok: false, error: `tree "${name}" is ${rec.kind}; ${RULE}` };
  if (rec.state !== "claimed") return { ok: false, error: `tree "${name}" is ephemeral and ${rec.state ?? "stateless"}; ${RULE}` };
  return { ok: true, tree: rec };
}
