/**
 * The picker-convention gate: every leaf that requires a positional argument
 * must declare what it does when that argument is omitted in a TTY (its
 * `omitBehavior`). The dispatcher guarantees the *subcommand* picker only for
 * a branch with no handler of its own: a branch that also has a handler runs
 * it instead, so that branch must declare the same thing. The per-handler
 * *argument* picker lives in each command and so cannot be enforced
 * structurally. Making the intent an explicit, checked declaration is what
 * keeps a new command (or a regressed one) from silently erroring, or running
 * something, where a picker was expected.
 *
 * Consumed by lib/__tests__/picker-conformance.test.ts (the CI gate) and
 * printable standalone: `bun scripts/lib/picker-conformance.ts`.
 */
import type { CommandNode, OmitBehavior } from "../../lib/command-tree.ts";

export interface LeafSpec {
  path: string[];
  node: CommandNode;
  /** Names of the required (flagless, non-optional) positional args. */
  positionals: string[];
}

/** Every visible leaf that requires at least one positional argument. */
export function requiredPositionalLeaves(
  tree: Record<string, CommandNode>,
): LeafSpec[] {
  const out: LeafSpec[] = [];
  const seen = new Set<CommandNode>();

  function visit(entries: Record<string, CommandNode>, prefix: string[]): void {
    for (const [name, node] of Object.entries(entries)) {
      if (!node || node.hidden || node.devOnly) continue;
      // A node object shared across two paths is one command;
      // classify it once, under the path it is first reached by.
      if (seen.has(node)) continue;
      seen.add(node);

      const path = [...prefix, name];
      // A module with no fn still resolves (resolveHandler defaults fn to "run").
      const hasHandler = !!(node.handler || node.module);
      const positionals = (node.args ?? [])
        .filter((a) => !a.flag && !a.optional && (a.type === "text" || a.type === "select"))
        .map((a) => a.name);

      if (hasHandler && positionals.length > 0) out.push({ path, node, positionals });
      if (node.subcommands) visit(node.subcommands, path);
    }
  }

  visit(tree, []);
  return out;
}

export function isValidOmitBehavior(v: unknown): v is OmitBehavior {
  if (v === "picker" || v === "list" || v === "prompt") return true;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { exempt?: unknown }).exempt === "string" &&
    (v as { exempt: string }).exempt.trim().length > 0
  );
}

/** Every visible branch that runs its own handler in place of the subcommand picker. */
export function handlerBranches(
  tree: Record<string, CommandNode>,
): { path: string[]; node: CommandNode }[] {
  const out: { path: string[]; node: CommandNode }[] = [];
  const seen = new Set<CommandNode>();

  function visit(entries: Record<string, CommandNode>, prefix: string[]): void {
    for (const [name, node] of Object.entries(entries)) {
      if (!node || node.hidden || node.devOnly || seen.has(node)) continue;
      seen.add(node);
      if (!node.subcommands) continue;
      const path = [...prefix, name];
      if (node.handler || node.module) out.push({ path, node });
      visit(node.subcommands, path);
    }
  }

  visit(tree, []);
  return out;
}

export interface Violation {
  path: string;
  positionals: string[];
  reason: "missing" | "invalid";
  kind: "leaf" | "branch";
}

function check(path: string[], node: CommandNode, positionals: string[], kind: Violation["kind"]): Violation | null {
  const ob = node.omitBehavior;
  if (ob === undefined) return { path: path.join(" "), positionals, reason: "missing", kind };
  if (!isValidOmitBehavior(ob)) return { path: path.join(" "), positionals, reason: "invalid", kind };
  return null;
}

export function conformanceViolations(
  tree: Record<string, CommandNode>,
): Violation[] {
  const out: Violation[] = [];
  const leafPaths = new Set<string>();
  for (const { path, node, positionals } of requiredPositionalLeaves(tree)) {
    leafPaths.add(path.join(" "));
    const v = check(path, node, positionals, "leaf");
    if (v) out.push(v);
  }
  for (const { path, node } of handlerBranches(tree)) {
    if (leafPaths.has(path.join(" "))) continue;
    const v = check(path, node, [], "branch");
    if (v) out.push(v);
  }
  return out;
}

// Standalone print: the current in-scope set and each leaf's declared behavior.
if (import.meta.main) {
  const { TREE } = await import("../../lib/command-tree-def.ts");
  const tagOf = (ob: OmitBehavior | undefined) =>
    ob === undefined ? "— UNDECLARED —" : typeof ob === "string" ? ob : `exempt: ${ob.exempt}`;
  const leaves = requiredPositionalLeaves(TREE);
  for (const { path, node, positionals } of leaves) {
    console.log(`${`rt ${path.join(" ")}`.padEnd(28)} [${positionals.join(", ")}]  ${tagOf(node.omitBehavior)}`);
  }
  const leafPaths = new Set(leaves.map((l) => l.path.join(" ")));
  const branches = handlerBranches(TREE).filter((b) => !leafPaths.has(b.path.join(" ")));
  for (const { path, node } of branches) {
    console.log(`${`rt ${path.join(" ")}`.padEnd(28)} (branch)  ${tagOf(node.omitBehavior)}`);
  }
  const v = conformanceViolations(TREE);
  console.log(`\n${leaves.length} in-scope leaf/leaves, ${branches.length} handler branch(es), ${v.length} violation(s)`);
  process.exit(v.length ? 1 : 0);
}
