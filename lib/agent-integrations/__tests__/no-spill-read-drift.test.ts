/**
 * The mod's spill-read prompt section and the mattstack plugin's SessionStart
 * note say the same words. Named `no-*` so a PR that changes only the shell
 * note (or only the section) still runs it.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { join, resolve } from "path";
import { SPILL_READ_SECTION } from "../../../plugins/mattstack-mods/src/blocks/sections.ts";

const HOOK = join(resolve(import.meta.dir, "..", "..", ".."), "plugins", "mattstack", "hooks", "spill-read-note.sh");

describe("no spill-read drift", () => {
  test("the spill-read section is the mattstack plugin's SessionStart note, word for word", () => {
    const out = spawnSync("sh", [HOOK], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
    expect(out.status).toBe(0);
    expect(JSON.parse(out.stdout).hookSpecificOutput.additionalContext).toBe(SPILL_READ_SECTION);
  });
});
