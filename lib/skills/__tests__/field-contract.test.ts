import { afterEach, describe, expect, test } from "bun:test";
import { FIELD_CONTRACT_SEVERITY, fieldContractErrors, routeFieldContract, scanFieldUses, setFieldContractSeverityForTest, sourceOf } from "../field-contract.ts";
import type { StageEntry } from "../types.ts";

const entry = (produces: string[]): StageEntry => ({ name: "s", engine: "s", stage: "s", dir: "d", consumes: [], produces });

describe("scanFieldUses", () => {
  test("scans a dot-label read", () => {
    const { reads } = scanFieldUses(`"run_field_get {key: extra.plan-verdict} (hobgoblin gates)" [shape=plaintext];`);
    expect(reads).toEqual([{ key: "extra.plan-verdict", line: 1, template: false }]);
  });

  test("scans quoted, comma-ended and multi-key forms", () => {
    const { reads, writes } = scanFieldUses(
      [
        `run_field_get {key: "mr"}`,
        `run_field_set {key: shipTarget, value: -, stage: ship}`,
        `run_field_get {runDb, key: approach}`,
      ].join("\n"),
    );
    expect(reads.map((r) => r.key)).toEqual(["mr", "approach"]);
    expect(writes.map((w) => w.key)).toEqual(["shipTarget"]);
  });

  test("scans the shell forms", () => {
    const { reads, writes } = scanFieldUses("rt runs field get mode\nrt runs field set ci green --stage watch-ci");
    expect(reads.map((r) => r.key)).toEqual(["mode"]);
    expect(writes.map((w) => w.key)).toEqual(["ci"]);
  });

  test("a key ending a sentence loses the trailing dot or dash", () => {
    const { reads, writes } = scanFieldUses("run_field_get {key: mr-}\nrun_field_get {key: ci.}\nrun_field_set {key: plan.-, value: x}\nrt runs field get mode.");
    expect(reads.map((r) => r.key)).toEqual(["mr", "ci", "mode"]);
    expect(writes.map((w) => w.key)).toEqual(["plan"]);
  });

  test("marks templates", () => {
    const a = scanFieldUses("run_field_set {key: extra.context-dropped.<scope>, value: x}");
    expect(a.writes).toEqual([{ key: "extra.context-dropped.", line: 1, template: true }]);
    const b = scanFieldUses("run_field_set {key: <each produce>}");
    expect(b.writes).toEqual([]);
  });
});

const slotDoc = [
  "---",
  "name: x",
  "---",
  "<!-- part: step source=mattstack:stage-gates version=1 path=attachments/pipeline/stage-gates/SKILL.md lines=14-64 -->",
  "body",
  "<!-- part: slot:domain binding=ip:hobgoblin-gates version=0.3.1 path=attachments/hobgoblin-gates/SKILL.md lines=9-160 -->",
  "a",
  "b",
  "run_field_get {key: extra.plan-verdict}",
].join("\n");

describe("sourceOf", () => {
  test("attributes a line inside a slot part to its fill", () => {
    expect(sourceOf(slotDoc, 9)).toEqual({ label: "ip:hobgoblin-gates", path: "attachments/hobgoblin-gates/SKILL.md", line: 11 });
  });
  test("returns null with no marker above", () => {
    expect(sourceOf("a\nb", 2)).toBeNull();
  });
});

describe("fieldContractErrors", () => {
  const docs = (...texts: string[]) => texts.map((text, i) => ({ path: `d${i}/SKILL.md`, text }));

  test("errors on a read nothing writes", () => {
    const errs = fieldContractErrors([{ path: "attachments/stage-gates/SKILL.md", text: slotDoc }], {});
    expect(errs).toEqual([
      `field contract: attachments/stage-gates/SKILL.md:9 (from ip:hobgoblin-gates attachments/hobgoblin-gates/SKILL.md:11) reads "extra.plan-verdict", which nothing in this pack writes`,
    ]);
  });

  test("drops the parenthesised part without a marker", () => {
    const errs = fieldContractErrors(docs("run_field_get {key: foo}"), {});
    expect(errs).toEqual([`field contract: d0/SKILL.md:1 reads "foo", which nothing in this pack writes`]);
  });

  test("passes a read a stage produces", () => {
    expect(fieldContractErrors(docs("run_field_get {key: plan}"), { p: [entry(["plan"])] })).toEqual([]);
  });
  test("passes a read another doc writes", () => {
    expect(fieldContractErrors(docs("run_field_get {key: plan}", "run_field_set {key: plan, value: 1}"), {})).toEqual([]);
  });
  test("passes a read of an rt-written key", () => {
    expect(fieldContractErrors(docs("run_field_get {key: hold}\nrt runs field get ticket"), {})).toEqual([]);
  });
  test("passes a read under a tool-written prefix", () => {
    expect(fieldContractErrors(docs("run_field_get {key: extra.gate-source.respond-plan}"), {})).toEqual([]);
  });
  test("passes a read under a templated write's prefix", () => {
    const d = docs("run_field_get {key: extra.foo.bar}", "run_field_set {key: extra.foo.<x>, value: 1}");
    expect(fieldContractErrors(d, {})).toEqual([]);
  });
  test("one error per doc and key", () => {
    const errs = fieldContractErrors(docs("run_field_get {key: foo}\nx\nrun_field_get {key: foo}\nrun_field_get {key: bar}"), {});
    expect(errs).toHaveLength(2);
    expect(errs[0]).toContain("d0/SKILL.md:1 ");
    expect(errs[1]).toContain("d0/SKILL.md:4 ");
  });
});

describe("routeFieldContract", () => {
  afterEach(() => setFieldContractSeverityForTest(null));

  test("warn severity routes every line to warnings", () => {
    setFieldContractSeverityForTest("warn");
    expect(routeFieldContract(["a", "b"])).toEqual({ warnings: ["a", "b"], errors: [] });
  });

  test("error severity routes every line to errors", () => {
    setFieldContractSeverityForTest("error");
    expect(routeFieldContract(["a", "b"])).toEqual({ warnings: [], errors: ["a", "b"] });
  });

  test("the default follows the exported constant", () => {
    expect(routeFieldContract(["a"])).toEqual(FIELD_CONTRACT_SEVERITY === "warn" ? { warnings: ["a"], errors: [] } : { warnings: [], errors: ["a"] });
  });
});
