import { test, expect } from "bun:test";
import { TREE } from "../command-tree-def.ts";
import type { CommandNode } from "../command-tree.ts";
import {
  conformanceViolations,
  isValidOmitBehavior,
  requiredPositionalLeaves,
} from "../../scripts/lib/picker-conformance.ts";

// The picker convention's leaf half: any command that requires a positional
// argument must, when that argument is omitted in a TTY, offer an interactive
// affordance (a picker, a list, or a prompt) rather than error — or
// declare, in the open, why it cannot. The dispatcher enforces the *subcommand*
// picker for branch nodes structurally; this gate enforces the *argument*
// picker, which lives in each handler and so can only be enforced by making the
// intent an explicit, checked declaration on the tree.
test("every leaf with a required positional, and every branch with its own handler, declares omitBehavior", () => {
  const violations = conformanceViolations(TREE);
  if (violations.length) {
    const lines = violations
      .map((v) => `  rt ${v.path}  ${v.kind === "branch" ? "(branch with its own handler)" : `[${v.positionals.join(", ")}]`}  (${v.reason})`)
      .join("\n");
    throw new Error(
      `\n${violations.length} command(s) lack a valid omitBehavior:\n${lines}\n\n` +
        `Declare omitBehavior on the node in lib/command-tree-def.ts:\n` +
        `  "picker" | "list" | "prompt" | { exempt: "why it cannot be enumerated" }\n` +
        `If the handler errors on a missing positional, add a TTY-guarded picker and tag "picker".\n` +
        `A branch whose handler would be better as a picker drops the handler into a leaf of its own.\n`,
    );
  }
  expect(violations).toEqual([]);
});

test("a branch that runs its own handler instead of the subcommand picker must declare omitBehavior", () => {
  const sub = { status: { description: "s", module: "./x.ts", fn: "status" } };
  const tree: Record<string, CommandNode> = {
    walks: { description: "w", module: "./x.ts", fn: "walk", subcommands: sub },
    declared: { description: "d", module: "./x.ts", fn: "walk", omitBehavior: { exempt: "the walk is the command" }, subcommands: sub },
    plain: { description: "p", subcommands: sub },
    quiet: { description: "q", hidden: true, module: "./x.ts", fn: "walk", subcommands: sub },
  };
  expect(conformanceViolations(tree)).toEqual([{ path: "walks", positionals: [], reason: "missing", kind: "branch" }]);
});

test("omitBehavior validator accepts the four shapes and rejects others", () => {
  expect(isValidOmitBehavior("picker")).toBe(true);
  expect(isValidOmitBehavior("list")).toBe(true);
  expect(isValidOmitBehavior("prompt")).toBe(true);
  expect(isValidOmitBehavior({ exempt: "free-text value" })).toBe(true);
  expect(isValidOmitBehavior({ exempt: "" })).toBe(false);
  expect(isValidOmitBehavior("magic")).toBe(false);
  expect(isValidOmitBehavior(undefined)).toBe(false);
  expect(isValidOmitBehavior({})).toBe(false);
});

test("the in-scope predicate excludes flag-only and optional-positional leaves", () => {
  const paths = new Set(requiredPositionalLeaves(TREE).map((s) => s.path.join(" ")));
  // Flag-only leaves (sync, status) never require a positional.
  expect(paths.has("sync")).toBe(false);
  expect(paths.has("status")).toBe(false);
  // A known required-positional leaf is in scope.
  expect(paths.has("chat")).toBe(true);
  expect(paths.has("cron install")).toBe(true);
});
