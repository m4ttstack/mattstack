import { describe, test, expect, beforeEach } from "bun:test";
import { join } from "path";
import { fits, readFloor, runnableEngine, heldCopy, refusalCopy, FLOOR_REL, __resetEngineWarning } from "../engine-floor.ts";

const files = (map: Record<string, string>) => (p: string) => map[p] ?? null;

beforeEach(() => __resetEngineWarning());

describe("runnableEngine", () => {
  test("a baked constant wins", () => {
    expect(runnableEngine({ baked: "0.31.0", sourceRoot: "/src", readFile: files({}) })).toBe("0.31.0");
  });
  test("a source run reads its own tree's plugin.json", () => {
    const pj = join("/src", "plugins", "mattstack", ".claude-plugin", "plugin.json");
    expect(runnableEngine({ baked: undefined, sourceRoot: "/src", readFile: files({ [pj]: '{ "version": "0.30.28" }' }) })).toBe("0.30.28");
  });
  test("no bake and no readable plugin.json is unknown", () => {
    expect(runnableEngine({ baked: undefined, sourceRoot: "/src", readFile: files({}) })).toBeNull();
    expect(runnableEngine({ baked: undefined, sourceRoot: null, readFile: files({}) })).toBeNull();
    const pj = join("/src", "plugins", "mattstack", ".claude-plugin", "plugin.json");
    expect(runnableEngine({ baked: undefined, sourceRoot: "/src", readFile: files({ [pj]: "{ broken" }) })).toBeNull();
  });
});

describe("fits", () => {
  test("no floor fits", () => expect(fits(null, "0.1.0")).toBe(true));
  test("an unknown engine fails open", () => expect(fits("0.31.0", null)).toBe(true));
  test("equal and higher fit, lower does not", () => {
    expect(fits("0.31.0", "0.31.0")).toBe(true);
    expect(fits("0.31.0", "0.32.1")).toBe(true);
    expect(fits("0.31.0", "0.30.28")).toBe(false);
  });
});

describe("readFloor", () => {
  test("reads minEngine", () => {
    expect(readFloor(files({ [join("/p", FLOOR_REL)]: '{ "minEngine": "0.31.0" }' }), "/p")).toBe("0.31.0");
  });
  test("missing file is no floor", () => expect(readFloor(files({}), "/p")).toBeNull());
  test("unparsable or wrong-shaped file is no floor", () => {
    expect(readFloor(files({ [join("/p", FLOOR_REL)]: "{ nope" }), "/p")).toBeNull();
    expect(readFloor(files({ [join("/p", FLOOR_REL)]: '{ "minEngine": 3 }' }), "/p")).toBeNull();
  });
});

describe("copy", () => {
  test("held and refusal copy", () => {
    expect(heldCopy("acme-skills", "0.11.0", "0.31.0")).toBe("acme-skills 0.11.0 needs a newer mattstack app (engine 0.31.0 or later). Update the app when it's offered.");
    expect(refusalCopy("0.30.28", "the engine on main", "0.31.0")).toBe("This app runs engine 0.30.28; the engine on main needs engine 0.31.0. Update the app first.");
  });
});
