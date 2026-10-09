import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { STATUS_TOOL_NAME, STATUS_VERBS } from "../../../plugins/mattstack-mods/src/blocks/board-names.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const WRAPPERS = ["review", "respond", "doctor"];

function markdown(dir: string): string {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

describe("board status writes in a mod session", () => {
  test("no status-bin call in a mod session", () => {
    for (const wrapper of WRAPPERS) {
      const dir = join(ROOT, "apps/board/skills", wrapper);
      const text = markdown(dir);
      const used = new Set([...text.matchAll(/<status-bin> ([a-z]+-status)\b/g)].map((m) => m[1]!));
      expect(used.size).toBeGreaterThan(0);
      // Every status verb the Claude wrapper writes is one the mod's tool runs, and the wrapper names the tool.
      for (const verb of used) expect(STATUS_VERBS as readonly string[]).toContain(verb);
      expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain(STATUS_TOOL_NAME);
    }
  });

  test("the Codex wrappers keep status-bin and never name the Claude mod's tool", () => {
    for (const wrapper of WRAPPERS) {
      const text = markdown(join(ROOT, "apps/board/skills-targets/codex", wrapper));
      expect(text).not.toContain(STATUS_TOOL_NAME);
      expect(text).toMatch(/<status-bin> [a-z]+-status /);
    }
  });

  test("the mod reads the status writer from the env key the board sets", () => {
    const board = readFileSync(join(ROOT, "apps/board/src/herdr.ts"), "utf8");
    const key = /export const BOARD_STATUS_BIN_ENV = '([A-Z_]+)'/.exec(board)?.[1];
    expect(key).toBeDefined();
    const hub = readFileSync(join(ROOT, "plugins/mattstack-mods/src/core/hub.ts"), "utf8");
    expect(hub).toContain(`$.env.get('${key}')`);
  });
});
