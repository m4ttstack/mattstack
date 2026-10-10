import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { floorWrite } from "../skills.ts";

function setup(engineFloor: string | null) {
  const root = mkdtempSync(join(tmpdir(), "floor-"));
  const engine = join(root, "engine");
  const team = join(root, "team");
  mkdirSync(join(engine, "pack"), { recursive: true });
  mkdirSync(join(team, "pack"), { recursive: true });
  if (engineFloor) writeFileSync(join(engine, "pack", "requires.json"), JSON.stringify({ minEngine: engineFloor }));
  const resolved = { packDir: team, pluginRoots: { byName: { mattstack: { dir: engine } }, list: [] } } as never;
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  return { engine, team, resolved, read };
}

test("compile copies the engine's floor into the team pack", () => {
  const { team, resolved, read } = setup("0.31.0");
  const out = floorWrite(resolved, read, true);
  expect(out.written).toEqual(["pack/requires.json"]);
  expect(JSON.parse(readFileSync(join(team, "pack", "requires.json"), "utf8"))).toEqual({ minEngine: "0.31.0" });
});

test("an engine with no floor removes a stale team floor", () => {
  const { team, resolved, read } = setup(null);
  writeFileSync(join(team, "pack", "requires.json"), JSON.stringify({ minEngine: "0.31.0" }));
  const out = floorWrite(resolved, read, true);
  expect(out.removed).toEqual(["pack/requires.json"]);
  expect(existsSync(join(team, "pack", "requires.json"))).toBe(false);
});

test("an up-to-date floor writes nothing and is not stale", () => {
  const { team, resolved, read } = setup("0.31.0");
  writeFileSync(join(team, "pack", "requires.json"), JSON.stringify({ minEngine: "0.31.0" }) + "\n");
  expect(floorWrite(resolved, read, false)).toEqual({ written: [], removed: [], stale: false });
});

test("check (write false) reports a differing floor as stale without writing", () => {
  const { team, resolved, read } = setup("0.31.0");
  writeFileSync(join(team, "pack", "requires.json"), JSON.stringify({ minEngine: "0.30.0" }));
  expect(floorWrite(resolved, read, false).stale).toBe(true);
  expect(JSON.parse(readFileSync(join(team, "pack", "requires.json"), "utf8")).minEngine).toBe("0.30.0");
});

test("compiling the mattstack pack itself never touches its own floor", () => {
  const { engine, read } = setup("0.31.0");
  const self = { packDir: engine, pluginRoots: { byName: { mattstack: { dir: engine } }, list: [] } } as never;
  expect(floorWrite(self, read, true)).toEqual({ written: [], removed: [], stale: false });
  expect(JSON.parse(readFileSync(join(engine, "pack", "requires.json"), "utf8")).minEngine).toBe("0.31.0");
});
