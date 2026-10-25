import { expect, test } from "bun:test";
import { normalizeCompiled } from "../blocks/lib/normalize.ts";
import { residualDiff } from "../blocks/compiled-diff.ts";
import { openingLine } from "../../lib/skills/pointers.ts";

const HEADER = "<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->";
const none = { allowMovedBlocks: [] as string[] };

test("heading levels, seams and dot whitespace do not show", () => {
  const before = `${HEADER}\n\n<!-- part: step source=mattstack:ship version=1 path=a lines=1-2 -->\n## Plan\n\nDo it.\n\n\`\`\`dot\ndigraph g {\n  a [label="A" shape=box];\n  b [label="B" shape=box];\n  a -> b [label="go"];\n}\n\`\`\`\n`;
  const after = `${HEADER}\n\n### Plan\n\n\nDo it.\n\n\`\`\`dot\ndigraph g { b [shape=box label="B"]; a [shape=box label="A"]; a -> b [label="go"]; }\n\`\`\`\n`;
  expect(residualDiff(before, after, none)).toBe("");
});

test("the pointer opening line under the header does not show", () => {
  const before = `${HEADER}\n\n## Plan\n\nDo it.\n`;
  const after = `${HEADER}\n\n${openingLine("widgets@0.4.2:work")}\n\n## Plan\n\nDo it.\n`;
  expect(residualDiff(before, after, none)).toBe("");
  expect(normalizeCompiled(`${openingLine("widgets@0.4.2:widget")}\n\nThen go.\n`)).toBe("Then go.\n");
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

test("today's reference line compares equal to the Prop and Slot lines older compiles wrote", () => {
  const today = "For tiering, invoke the `mattstack:model-tiering` skill (mattstack:model-tiering@1.0.0) when this flow needs it.";
  for (const noun of ["Prop", "Slot"]) {
    const older = `${noun} tiering is bound to \`mattstack:model-tiering\` (mattstack:model-tiering@1.0.0) -- invoke that skill when this flow needs it.`;
    expect(residualDiff(`# A\n\n${older}\n`, `# A\n\n${today}\n`, none)).toBe("");
  }
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

const dot = (body: string) => `# A\n\n\`\`\`dot\ndigraph g {\n${body}\n}\n\`\`\`\n`;
const base = `a [label="A" shape=box];\nb [label="B" shape=box];\na -> b [label="go"];`;

test.each([
  ["a changed edge label", base.replace("go", "stop")],
  ["a removed edge", base.replace(/a -> b.*/, "")],
  ["an edge style", base.replace(`[label="go"]`, `[label="go" style=dashed]`)],
  ["a node shape", base.replace(`"A" shape=box`, `"A" shape=diamond`)],
  ["a fillcolor", base.replace(`"A" shape=box`, `"A" shape=box fillcolor=red`)],
  ["a fontcolor", base.replace(`"A" shape=box`, `"A" shape=box fontcolor=white`)],
  ["a graph attribute", `rankdir=LR;\n${base}`],
  ["a node default", `node [shape=circle];\n${base}`],
])("a dot graph with %s differs", (_name, changed) => {
  expect(residualDiff(dot(base), dot(changed), none)).not.toBe("");
});

test("rankdir=TB compares equal to no rankdir, any other rankdir does not", () => {
  expect(residualDiff(dot(base), dot(`rankdir=TB;\n${base}`), none)).toBe("");
  expect(residualDiff(dot(`rankdir = TB;\n${base}`), dot(base), none)).toBe("");
  expect(residualDiff(dot(base), dot(`rankdir=LR;\n${base}`), none)).not.toBe("");
  expect(residualDiff(dot(`rankdir=TB;\n${base}`), dot(`rankdir=LR;\n${base}`), none)).not.toBe("");
});

test("blank lines and whitespace inside a fence are compared", () => {
  const fenced = (body: string) => `# A\n\n\`\`\`sh\n${body}\n\`\`\`\n`;
  expect(residualDiff(fenced("a\n\n\nb"), fenced("a\n\nb"), none)).not.toBe("");
  expect(residualDiff(fenced("a\n  \nb"), fenced("a\n\nb"), none)).not.toBe("");
});

test("fence indentation is compared", () => {
  expect(residualDiff("# A\n\n  ```sh\n  x\n  ```\n", "# A\n\n```sh\n  x\n```\n", none)).not.toBe("");
});

test("moved text that vanishes under --allow-move still differs", () => {
  const before = "## Domain rules\n\nNever skip lint.\n\n### Fast checks\n\nRun tsc.\n";
  const after = "## Domain rules\n\n### Fast checks\n\nRun tsc.\n";
  expect(residualDiff(before, after, { allowMovedBlocks: ["Domain rules"] })).toContain("-Never skip lint.");
});

test("a deeper same-titled heading is not a repeat, a shallower or equal one is", () => {
  expect(residualDiff("# A\n\n## A\n\ntext\n", "# A\n\ntext\n", none)).not.toBe("");
  expect(residualDiff("## A\n\n# A\n\ntext\n", "## A\n\ntext\n", none)).toBe("");
  expect(residualDiff("## A\n\n## A\n\ntext\n", "## A\n\ntext\n", none)).toBe("");
});
