import { describe, expect, test } from "bun:test";
import { parseMermaid } from "../../../lib/skills/blocks/mermaid.ts";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkHoldEdges, graphsIn, unaskedHolds } from "../hold-edges.ts";

const graph = (body: string) => parseMermaid(`flowchart TB\n%% name: demo\n${body}`, "demo", 1);
const keys = (body: string) => unaskedHolds(graph(body)).map((f) => f.key);

const HOLD = `run_hold[/"run_hold {stage, reason}"/]\nheld_end(((Held: end the turn)))\nrun_hold --> held_end\n`;

describe("unaskedHolds", () => {
  test("a check that goes straight to a hold asks nothing", () => {
    expect(keys(`${HOLD}owed_left{Anything owed?}\nowed_left -->|yes: hold, naming each item| run_hold`)).toEqual(["demo: owed_left -> run_hold |yes: hold, naming each item|"]);
  });

  test("a gate's hold answer is asked, straight from the gate or through its answer diamond", () => {
    expect(keys(`${HOLD}gate_ship[Gate ship]\ngate_ship -->|hold| run_hold`)).toEqual([]);
    expect(keys(`${HOLD}gate_fix\nfix_answer{Fix answer?}\ngate_fix --> fix_answer\nfix_answer -->|hold| run_hold`)).toEqual([]);
  });

  test("another answer of the same gate does not count as a hold", () => {
    expect(keys(`${HOLD}gate_ship[Gate ship]\ngate_ship -->|proceed| run_hold`)).toEqual(["demo: gate_ship -> run_hold |proceed|"]);
  });

  test("a step between the answer and the hold carries the answer, and a step with a second way in does not", () => {
    const relay = `${HOLD}gate_ship[Gate ship]\nclear[/"run_field_set {key: target, value: -}"/]\ngate_ship -->|hold| clear\nclear --> run_hold\n`;
    expect(keys(relay)).toEqual([]);
    expect(keys(`${relay}errored{Read errored?}\nerrored -->|yes| clear`)).toEqual(["demo: clear -> run_hold"]);
  });

  test("a diamond fed by anything but gates is not an answer", () => {
    expect(keys(`${HOLD}gate_a\nmr_view[/"mr_view {mrUrl}"/]\nresult{Result?}\ngate_a --> result\nmr_view --> result\nresult -->|hold| run_hold`)).toEqual(["demo: result -> run_hold |hold|"]);
  });

  test("a check reached through a gate's other answer is not an answer", () => {
    expect(keys(`${HOLD}gate_ship[Gate ship]\nchecks{Checks pass?}\ngate_ship -->|proceed| checks\nchecks -->|hold| run_hold`)).toEqual(["demo: checks -> run_hold |hold|"]);
  });

  test("a tool call named after a gate is not a gate", () => {
    expect(keys(`${HOLD}gate_record[/"gate_record {runDb}"/]\ngate_record -->|hold| run_hold`)).toEqual(["demo: gate_record -> run_hold |hold|"]);
  });

  test("the hold field and a held outcome count as holds", () => {
    expect(keys(`read_ok{Read ok?}\nset_held[/"run_field_set {runDb, key: hold, value: held}"/]\nread_ok -->|no| set_held`)).toEqual(["demo: read_ok -> set_held |no|"]);
    expect(keys(`spent{Openings spent?}\nattach_held(((Attach held)))\nspent -->|yes| attach_held`)).toEqual(["demo: spent -> attach_held |yes|"]);
  });
});

describe("graphsIn", () => {
  test("reads a graph in a file with CRLF line ends", () => {
    const dir = mkdtempSync(join(tmpdir(), "hold-edges-"));
    writeFileSync(join(dir, "demo.block.md"), "# Demo\n\n```mermaid\nflowchart TB\n    a --> b\n```\n".replaceAll("\n", "\r\n"));
    expect(graphsIn(dir).map((g) => g.file)).toEqual(["demo"]);
  });
});

describe("checkHoldEdges", () => {
  const bad = graph(`${HOLD}owed_left{Anything owed?}\nowed_left -->|yes| run_hold`);

  test("an allowed edge passes and an unlisted one fails", () => {
    expect(checkHoldEdges([bad], { "demo: owed_left -> run_hold |yes|": "why" })).toEqual([]);
    expect(checkHoldEdges([bad], {})).toHaveLength(1);
  });

  test("an allowance covers its own label, not another edge between the same nodes", () => {
    const two = graph(`${HOLD}result{Result?}\nresult -->|Attach held| run_hold\nresult -->|Attach failed| run_hold`);
    const errors = checkHoldEdges([two], { "demo: result -> run_hold |Attach held|": "why" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("|Attach failed|");
  });

  test("an edge labelled hold into an allowed exit is checked itself", () => {
    const exit = graph(`${HOLD}gate_a\nchecks_pass{Checks pass?}\nwhich_exit{Which exit?}\ngate_a -->|hold| which_exit\nchecks_pass -->|no: hold| which_exit\nwhich_exit -->|hold| run_hold`);
    const errors = checkHoldEdges([exit], { "demo: which_exit -> run_hold |hold|": "why" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("checks_pass -> which_exit");
  });

  test("an allowance no graph draws fails", () => {
    expect(checkHoldEdges([bad], { "demo: owed_left -> run_hold |yes|": "why", "demo: gone -> run_hold": "why" })[0]).toContain("demo: gone -> run_hold");
  });
});
