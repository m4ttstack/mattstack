import { describe, expect, test } from "bun:test";
import { parseMermaid } from "../../../lib/skills/blocks/mermaid.ts";
import { checkHoldEdges, unaskedHolds } from "../hold-edges.ts";

const graph = (body: string) => parseMermaid(`flowchart TB\n%% name: demo\n${body}`, "demo", 1);
const keys = (body: string) => unaskedHolds(graph(body)).map((f) => f.key);

const HOLD = `run_hold[/"run_hold {stage, reason}"/]\nheld_end(((Held: end the turn)))\nrun_hold --> held_end\n`;

describe("unaskedHolds", () => {
  test("a check that goes straight to a hold asks nothing", () => {
    expect(keys(`${HOLD}owed_left{Anything owed?}\nowed_left -->|yes: hold, naming each item| run_hold`)).toEqual(["demo: owed_left -> run_hold"]);
  });

  test("a gate's hold answer is asked, straight from the gate or through its answer diamond", () => {
    expect(keys(`${HOLD}gate_ship[Gate ship]\ngate_ship -->|hold| run_hold`)).toEqual([]);
    expect(keys(`${HOLD}gate_fix\nfix_answer{Fix answer?}\ngate_fix --> fix_answer\nfix_answer -->|hold| run_hold`)).toEqual([]);
  });

  test("another answer of the same gate does not count as a hold", () => {
    expect(keys(`${HOLD}gate_ship[Gate ship]\ngate_ship -->|proceed| run_hold`)).toEqual(["demo: gate_ship -> run_hold"]);
  });

  test("a step between the answer and the hold carries the answer, and a step with a second way in does not", () => {
    const relay = `${HOLD}gate_ship[Gate ship]\nclear[/"run_field_set {key: target, value: -}"/]\ngate_ship -->|hold| clear\nclear --> run_hold\n`;
    expect(keys(relay)).toEqual([]);
    expect(keys(`${relay}errored{Read errored?}\nerrored -->|yes| clear`)).toEqual(["demo: clear -> run_hold"]);
  });

  test("a diamond fed by anything but gates is not an answer", () => {
    expect(keys(`${HOLD}gate_a\nmr_view[/"mr_view {mrUrl}"/]\nresult{Result?}\ngate_a --> result\nmr_view --> result\nresult -->|hold| run_hold`)).toEqual(["demo: result -> run_hold"]);
  });

  test("a tool call named after a gate is not a gate", () => {
    expect(keys(`${HOLD}gate_record[/"gate_record {runDb}"/]\ngate_record -->|hold| run_hold`)).toEqual(["demo: gate_record -> run_hold"]);
  });

  test("the hold field and a held outcome count as holds", () => {
    expect(keys(`read_ok{Read ok?}\nset_held[/"run_field_set {runDb, key: hold, value: held}"/]\nread_ok -->|no| set_held`)).toEqual(["demo: read_ok -> set_held"]);
    expect(keys(`spent{Openings spent?}\nattach_held(((Attach held)))\nspent -->|yes| attach_held`)).toEqual(["demo: spent -> attach_held"]);
  });
});

describe("checkHoldEdges", () => {
  const bad = graph(`${HOLD}owed_left{Anything owed?}\nowed_left -->|yes| run_hold`);

  test("an allowed edge passes and an unlisted one fails", () => {
    expect(checkHoldEdges([bad], { "demo: owed_left -> run_hold": "why" })).toEqual([]);
    expect(checkHoldEdges([bad], {})).toHaveLength(1);
  });

  test("an allowance no graph draws fails", () => {
    expect(checkHoldEdges([bad], { "demo: owed_left -> run_hold": "why", "demo: gone -> run_hold": "why" })[0]).toContain("demo: gone -> run_hold");
  });
});
