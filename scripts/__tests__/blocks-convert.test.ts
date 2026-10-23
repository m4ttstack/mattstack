import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { toDot, parseDot } from "../../lib/skills/blocks/dot.ts";
import { parseMermaid } from "../../lib/skills/blocks/mermaid.ts";
import { loadBlockTree } from "../../lib/skills/blocks/tree.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { dotToMermaid } from "../blocks/lib/dot-to-mermaid.ts";
import { splitSkill, type SlotMap } from "../blocks/lib/split.ts";

const FIXTURE = readFileSync(join(import.meta.dir, "fixtures", "blocks-convert", "ship-slice.md"), "utf8");
const SCRIPT = join(import.meta.dir, "..", "blocks", "convert-skill.ts");
const DOMAIN: SlotMap = { domain: { prop: "rules", merge: "add" } };

function writeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "blocks-convert-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

function frontmatter(text: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return m ? (parseDocument(m[1]!).toJS() as Record<string, unknown>) : {};
}

test("splits the ship slice into one block per section and node", () => {
  const { files } = splitSkill(FIXTURE, { engine: "ship", slots: DOMAIN });
  expect(Object.keys(files).sort()).toEqual([
    "browser-evidence.block.md",
    "domain-rules.block.md",
    "evidence-record.block.md",
    "gate-protocol.block.md",
    "index.block.md",
    "run/find-shipped-run.block.md",
    "run/index.block.md",
    "run/recapture-asked.block.md",
    "wrap-up-form-contract.block.md",
  ]);
});

test("the root keeps the engine frontmatter minus slots, with no props, and names the replaced slots", () => {
  const { files } = splitSkill(FIXTURE, { engine: "ship", slots: DOMAIN });
  const fm = frontmatter(files["index.block.md"]!);
  expect(fm.name).toBe("ship");
  expect(fm.type).toBe("pipeline-step");
  expect(fm.description).toContain("ship this");
  expect(fm.slots).toBeUndefined();
  expect(fm.props).toBeUndefined();
  expect(fm["replaced-slots"]).toEqual(["domain"]);
  expect(files["index.block.md"]).toContain("# ship\n\nThe pipeline's ship stage");
});

test("the slot becomes a prop declared beside its marker", () => {
  const { files } = splitSkill(FIXTURE, { engine: "ship", slots: DOMAIN });
  const text = files["domain-rules.block.md"]!;
  expect(frontmatter(text).props).toEqual({ rules: { merge: "add", default: "" } });
  expect(text).toContain("bundle.\n\n{{props.rules}}\n\nWhen nothing is inlined above");
  expect(text).not.toContain("{{slot:");
});

test("an include-only section becomes a block holding the include line", () => {
  const { files } = splitSkill(FIXTURE, { engine: "ship", slots: DOMAIN });
  expect(files["browser-evidence.block.md"]).toBe("---\norder: 3\n---\n\n# Browser evidence\n\n{{include:browser-evidence}}\n");
});

test("sections keep today's order through order:, and node blocks take node:", () => {
  const { files } = splitSkill(FIXTURE, { engine: "ship", slots: DOMAIN });
  const orders = ["run/index", "domain-rules", "browser-evidence", "evidence-record", "gate-protocol", "wrap-up-form-contract"].map(
    (f) => frontmatter(files[`${f}.block.md`]!).order,
  );
  expect(orders).toEqual([1, 2, 3, 4, 5, 6]);
  expect(frontmatter(files["run/recapture-asked.block.md"]!)).toEqual({ node: "recapture_asked" });
});

test("a heading that equals a node label ties to that node, with its title as the label", () => {
  const { files } = splitSkill(FIXTURE, { engine: "ship", slots: DOMAIN });
  const text = files["run/find-shipped-run.block.md"]!;
  expect(frontmatter(text)).toEqual({ node: "find_shipped_run" });
  expect(text).toContain("---\n\n# Find the shipped run (ship)\n\nThe operator asks");
  expect(text).not.toContain("label:");
});

test("the dot fence becomes a mermaid fence, a box node block dropping its label", () => {
  const { files } = splitSkill(FIXTURE, { engine: "ship", slots: DOMAIN });
  const run = files["run/index.block.md"]!;
  expect(run).not.toContain("```dot");
  expect(run).toContain("```mermaid\nflowchart TB\n%% name: ship_run\n");
  expect(run).toContain("\n    find_shipped_run\n");
  expect(run).toContain('\n    recapture_asked{Asked for a new AFTER capture on a run that already shipped?}\n');
  expect(run).toContain("```\n\nAn own run is a fresh");
});

test("the split loads with plan 1's loadBlockTree with no diagnostics", () => {
  const { files } = splitSkill(FIXTURE, { engine: "ship", slots: DOMAIN });
  const tree = loadBlockTree(writeTree(files), { idPrefix: "ship", relRoot: "ship" });
  expect(tree.root.children.map((c) => c.id)).toEqual([
    "ship/run",
    "ship/domain-rules",
    "ship/browser-evidence",
    "ship/evidence-record",
    "ship/gate-protocol",
    "ship/wrap-up-form-contract",
  ]);
  expect(tree.byId.get("ship/run")!.children.map((c) => c.node)).toEqual(["recapture_asked", "find_shipped_run"]);
  expect(tree.byId.get("ship/domain-rules")!.props.map((p) => p.name)).toEqual(["rules"]);
});

const TINY = `---
name: tiny
slots:
  domain: { contract: tiny-domain@1, required: false }
  tiering: { contract: model-tiering@1, required: true }
  forge: { contract: forge@1, required: true }
---

# tiny

## Flow

\`\`\`dot
digraph tiny_flow {
    find_run [label="Find the shipped run (ship)" shape=box];
    fast_checks [label="Run the domain's fast checks (none when unbound)" shape=box];
    find_run -> fast_checks;
}
\`\`\`

### Find the shipped run

Look it up.

### Run the domain's fast checks (none when unbound)

Only the checks the domain names.

### Reading a GitLab fact no read tool returns

Read it with gitlab_get.

## Tiering

{{slot:tiering}}

## Forge

{{slot:forge}}

## Domain rules

{{slot:domain}}
`;

const TINY_SLOTS: SlotMap = {
  domain: { prop: "rules", merge: "add", targets: ["tiny/flow/fast-checks"] },
  tiering: { prop: "tiering", merge: "replace" },
  forge: { prop: "forge", merge: "replace" },
};

test("a heading that matches a label minus its trailing parenthetical ties to the node, the title taking the full label", () => {
  const { files, notes } = splitSkill(TINY, { engine: "tiny", slots: TINY_SLOTS });
  const text = files["flow/find-run.block.md"]!;
  expect(frontmatter(text)).toEqual({ node: "find_run" });
  expect(text).toContain("# Find the shipped run (ship)\n");
  expect(notes.some((n) => n.includes("Find the shipped run") && n.includes("rewritten"))).toBe(true);
});

test("a node-less ### after a node section folds into it, below an add target's marker", () => {
  const { files, notes } = splitSkill(TINY, { engine: "tiny", slots: TINY_SLOTS });
  expect(Object.keys(files)).not.toContain("flow/reading-a-gitlab-fact-no-read-tool-returns.block.md");
  const text = files["flow/fast-checks.block.md"]!;
  expect(frontmatter(text).props).toEqual({ rules: { merge: "add", default: "" } });
  expect(text).toContain("Only the checks the domain names.\n\n{{props.rules}}\n\n## Reading a GitLab fact no read tool returns\n\nRead it with gitlab_get.\n");
  expect(notes.some((n) => n.startsWith("tiny/flow/fast-checks: folded"))).toBe(true);
  loadBlockTree(writeTree(files), { idPrefix: "tiny", relRoot: "tiny" });
});

test("a replace prop takes mattstack's binding as default, else none when required, and keeps the contract", () => {
  const { files } = splitSkill(TINY, { engine: "tiny", slots: TINY_SLOTS, bindings: { tiering: "mattstack:model-tiering" } });
  expect(frontmatter(files["tiering.block.md"]!).props).toEqual({
    tiering: { merge: "replace", default: "mattstack:model-tiering", contract: "model-tiering@1" },
  });
  expect(frontmatter(files["forge.block.md"]!).props).toEqual({ forge: { merge: "replace", contract: "forge@1" } });
  expect(frontmatter(files["index.block.md"]!)["replaced-slots"]).toEqual(["domain", "tiering", "forge"]);
});

test("a slot the map does not name is an error", () => {
  expect(() => splitSkill(TINY, { engine: "tiny", slots: { domain: TINY_SLOTS.domain! } })).toThrow(/slot:tiering/);
});

const ROUND_TRIP = `digraph rt_flow {
    rankdir=TB;
    start [label="Trigger: go" shape=ellipse];
    ask [label="Ready (now)?" shape=diamond];
    rt_verb_daemon_status [label="rt_verb {args: [\\"daemon\\", \\"status\\"]}" shape=plaintext];
    step [label="Do the | thing" shape=box];
    stop_push [label="STOP: never push" shape=octagon style=filled fillcolor=red fontcolor=white];
    done [label="Done" shape=doublecircle style=filled fillcolor=lightgreen];
    ended [label="Ended" shape=doublecircle];
    start -> ask;
    ask -> rt_verb_daemon_status [label="yes"];
    ask -> stop_push [label="no (push)"];
    rt_verb_daemon_status -> step;
    step -> done [style=dashed];
    step -> ended [label="say \\"hi\\""];
}`;

test("dotToMermaid round-trips through parseMermaid and toDot to the same nodes, shapes and edges", () => {
  const { mermaid, nodeIds } = dotToMermaid(ROUND_TRIP);
  const back = parseDot(toDot(parseMermaid(mermaid, "x.block.md", 1), new Map()));
  const before = parseDot(ROUND_TRIP);
  const shape = (n: { id: string; label: string; shape: string }) => ({ id: n.id, label: n.label, shape: n.shape });
  expect(nodeIds).toEqual(before.nodes.map((n) => n.id));
  expect(back.nodes.map(shape)).toEqual(before.nodes.map(shape));
  expect(back.edges).toEqual(before.edges);
  expect(before.nodes.find((n) => n.id === "rt_verb_daemon_status")!.label).toBe('rt_verb {args: ["daemon", "status"]}');
});

test("dotToMermaid drops the label of a box node a block titles, and refuses a line break in a label", () => {
  const { mermaid } = dotToMermaid(ROUND_TRIP, { omitLabels: new Set(["step", "stop_push", "ask"]) });
  expect(mermaid).toContain("\n    step\n");
  expect(mermaid).toContain("\n    stop_push:::stop\n");
  expect(mermaid).toContain('\n    ask{"Ready (now)?"}\n');
  expect(() => dotToMermaid('digraph g { a [label="one\\ntwo" shape=box]; }')).toThrow(/line break/);
});

test("the CLI writes the split to --out, resolving --target by section heading", () => {
  const skill = writeTree({ "SKILL.md": TINY });
  const out = join(mkdtempSync(join(tmpdir(), "blocks-convert-out-")), "tiny");
  const r = Bun.spawnSync(
    ["bun", SCRIPT, skill, "--out", out, "--target", "domain=Run the domain's fast checks (none when unbound)"],
    { env: childEnv(), stdout: "pipe", stderr: "pipe" },
  );
  expect(r.stderr.toString()).not.toContain("error");
  expect(r.exitCode).toBe(0);
  expect(readFileSync(join(out, "flow", "fast-checks.block.md"), "utf8")).toContain("{{props.rules}}");
  expect(existsSync(join(skill, "SKILL.md"))).toBe(true);
  expect(r.stdout.toString()).toContain("folded");
});

test("the CLI refuses a --target heading no section has", () => {
  const skill = writeTree({ "SKILL.md": TINY });
  const r = Bun.spawnSync(["bun", SCRIPT, skill, "--target", "domain=No such step"], { env: childEnv(), stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode).toBe(2);
  expect(r.stderr.toString()).toContain("No such step");
});

const ROOT_GRAPH = `---
name: rgraph
slots:
  criteria: { contract: criteria@1, required: false }
---

# rgraph

\`\`\`dot
digraph rgraph {
    read_diff [label="Read the diff" shape=box];
    post_findings [label="Post the findings" shape=box];
    read_diff -> post_findings;
}
\`\`\`

## Criteria

{{slot:criteria}}

## Steps

### Read the diff

Read it all.

### Post the findings

Post them.

## Reply rules

Reply briefly.
`;

test("a ## under a root graph with no node section after it becomes its own ordered block, even before any node block", () => {
  const { files } = splitSkill(ROOT_GRAPH, { engine: "rgraph", slots: { criteria: { prop: "criteria", merge: "replace" } } });
  expect(Object.keys(files).sort()).toEqual(["criteria.block.md", "index.block.md", "reply-rules.block.md", "steps.block.md"]);
  expect(frontmatter(files["index.block.md"]!).props).toBeUndefined();
  expect(frontmatter(files["criteria.block.md"]!)).toEqual({ order: 1, props: { criteria: { merge: "replace", default: "", contract: "criteria@1" } } });
  loadBlockTree(writeTree(files), { idPrefix: "rgraph", relRoot: "rgraph" });
});

test("a section holding node-matching sections one level too deep says so in a note", () => {
  const { notes } = splitSkill(ROOT_GRAPH, { engine: "rgraph", slots: { criteria: { prop: "criteria", merge: "replace" } } });
  const note = notes.find((n) => n.includes('"Steps"'));
  expect(note).toContain("holds 2 sections matching nodes of the graph");
  expect(note).not.toContain("ties to no node");
});

test("a body with no # title becomes one headless index.block.md that loads", () => {
  const raw = "---\nname: frag\n---\n\nLead text.\n\n## Part one\n\nOne.\n\n### Deeper\n\nTwo.\n";
  const { files, notes } = splitSkill(raw, { engine: "frag", slots: {} });
  expect(files).toEqual({ "index.block.md": "---\nname: frag\n---\n\nLead text.\n\n## Part one\n\nOne.\n\n### Deeper\n\nTwo.\n" });
  expect(notes.some((n) => n.includes("headless"))).toBe(true);
  const tree = loadBlockTree(writeTree(files), { idPrefix: "frag", relRoot: "frag" });
  expect(tree.root.title).toBeNull();
});

test("--write on a tree that does not load writes nothing, keeps SKILL.md and exits non-zero", () => {
  const skill = writeTree({ "SKILL.md": "---\nname: bad\n---\n\n# bad\n\n## Part\n\nA stray {{props.oops}} marker.\n" });
  const r = Bun.spawnSync(["bun", SCRIPT, skill, "--write"], { env: childEnv(), stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toContain("does not load");
  expect(existsSync(join(skill, "SKILL.md"))).toBe(true);
  expect(existsSync(join(skill, "index.block.md"))).toBe(false);
});

test("a section slugged index does not overwrite its parent's index.block.md", () => {
  const raw = "# idx\n\nRoot text.\n\n## Index\n\nThe index section.\n";
  const { files, notes } = splitSkill(raw, { engine: "idx", slots: {} });
  expect(Object.keys(files).sort()).toEqual(["index-2.block.md", "index.block.md"]);
  expect(files["index.block.md"]).toContain("Root text.");
  expect(notes.some((n) => n.includes("idx/index-2"))).toBe(true);
});

test("two add slots targeting one block keep both markers", () => {
  const raw = `---
name: two
slots:
  domain: { contract: d@1, required: false }
  extra: { contract: e@1, required: false }
---

# two

## Flow

\`\`\`dot
digraph two {
    step_one [label="Do the step" shape=box];
}
\`\`\`

### Do the step

Step text.

## Domain rules

{{slot:domain}}

## Extra rules

{{slot:extra}}
`;
  const slots: SlotMap = {
    domain: { prop: "rules", merge: "add", targets: ["two/flow/step-one"] },
    extra: { prop: "extra", merge: "add", targets: ["two/flow/step-one"] },
  };
  const { files } = splitSkill(raw, { engine: "two", slots });
  expect(files["flow/step-one.block.md"]).toContain("Step text.\n\n{{props.rules}}\n\n{{props.extra}}\n");
  loadBlockTree(writeTree(files), { idPrefix: "two", relRoot: "two" });
});

test("a dot fence left inside an inlined sub-heading is named in a note", () => {
  const raw = '# side\n\n## Part\n\nText.\n\n### Picture\n\n```dot\ndigraph pic {\n    a [label="A" shape=box];\n}\n```\n';
  const { files, notes } = splitSkill(raw, { engine: "side", slots: {} });
  expect(files["part.block.md"]).toContain("```dot");
  expect(notes.some((n) => n.startsWith("side/part: a dot graph stays a dot fence"))).toBe(true);
});
