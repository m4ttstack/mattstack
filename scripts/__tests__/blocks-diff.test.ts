import { expect, test } from "bun:test";
import { normalizeCompiled } from "../blocks/lib/normalize.ts";
import { residualDiff } from "../blocks/compiled-diff.ts";

const HEADER = "<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->";
const none = { allowMovedBlocks: [] as string[] };

test("heading levels, seams and dot whitespace do not show", () => {
  const before = `${HEADER}\n\n<!-- part: step source=mattstack:ship version=1 path=a lines=1-2 -->\n## Plan\n\nDo it.\n\n\`\`\`dot\ndigraph g {\n  a [label="A" shape=box];\n  b [label="B" shape=box];\n  a -> b [label="go"];\n}\n\`\`\`\n`;
  const after = `${HEADER}\n\n### Plan\n\n\nDo it.\n\n\`\`\`dot\ndigraph g { b [shape=box label="B"]; a [shape=box label="A"]; a -> b [label="go"]; }\n\`\`\`\n`;
  expect(residualDiff(before, after, none)).toBe("");
});

test("a changed sentence survives", () => {
  const diff = residualDiff("# T\n\nRun the tests.\n", "# T\n\nRun the suite.\n", none);
  expect(diff).toContain("-Run the tests.");
  expect(diff).toContain("+Run the suite.");
});

test("text moved under another heading is clean only when --allow-move names its heading", () => {
  const before = "## Domain rules\n\nNever skip lint.\n\n### Fast checks\n\nRun tsc.\n";
  const after = "## Domain rules\n\n### Fast checks\n\nRun tsc.\n\nNever skip lint.\n";
  expect(residualDiff(before, after, none)).not.toBe("");
  expect(residualDiff(before, after, { allowMovedBlocks: ["Domain rules"] })).toBe("");
});

test("allow-move still compares the heading line and text that did not move", () => {
  const before = "## Domain rules\n\nNever skip lint.\n\nStay calm.\n\n### Fast checks\n\nRun tsc.\n";
  const after = "## Domain rules\n\nStay panicked.\n\n### Fast checks\n\nRun tsc.\n\nNever skip lint.\n";
  const diff = residualDiff(before, after, { allowMovedBlocks: ["Domain rules"] });
  expect(diff).toContain("-Stay calm.");
  expect(diff).toContain("+Stay panicked.");
  expect(diff).not.toContain("Never skip lint.");
  const noHeading = residualDiff(before, "### Fast checks\n\nRun tsc.\n\nNever skip lint.\n", { allowMovedBlocks: ["Domain rules"] });
  expect(noHeading).toContain("-# Domain rules");
});

test("Slot reference compares equal to the Prop reference, an inlined body does not", () => {
  const ref = (noun: string) => `${noun} tiering is bound to \`mattstack:model-tiering\` (mattstack:model-tiering@1.0.0) -- invoke that skill when this flow needs it.`;
  expect(residualDiff(`# A\n\n${ref("Slot")}\n`, `# A\n\n${ref("Prop")}\n`, none)).toBe("");
  expect(residualDiff(`# A\n\n${ref("Slot")}\n`, "# A\n\nPick the cheapest model.\n", none)).not.toBe("");
});

test("a repeated title collapses to one heading", () => {
  const before = "## Gate protocol\n\n# Gate protocol\n\nAsk.\n";
  const after = "## Gate protocol\n\nAsk.\n";
  expect(residualDiff(before, after, none)).toBe("");
});

test("an empty Domain rules heading on one side only is a difference", () => {
  const both = "## Ship\n\nGo.\n\n## Domain rules\n\n";
  expect(residualDiff(both, both, none)).toBe("");
  expect(residualDiff(both, "## Ship\n\nGo.\n", none)).not.toBe("");
});

test("normalizeCompiled is idempotent on a body with a dot fence", () => {
  const md = "## A\n\n```dot\ndigraph g { a -> b; }\n```\n";
  expect(normalizeCompiled(normalizeCompiled(md))).toBe(normalizeCompiled(md));
});
