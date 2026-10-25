import { describe, expect, test } from "bun:test";
import { fakeFs } from "../../skills/__tests__/resolve-fs.ts";
import { resolvePointers } from "../../skills/resolve.ts";
import { skillsResolveToolDefs } from "../skills-resolve-tool.ts";

const HOME = "/home/acme";
const V = `${HOME}/.claude/plugins/cache/acme/widgets/0.4.2`;
const ROOTS = [`${HOME}/.claude/plugins/cache`, `${HOME}/.claude/skills`];

function files(): Record<string, string> {
  return {
    [`${V}/skills/work/compiled.json`]: JSON.stringify({
      id: "widgets@0.4.2:work",
      dir: "skills/work",
      covers: ["widgets@0.4.2:work"],
      keys: { "work/scripts/x.sh": "skills/work/scripts/x.sh", "recipes/r.md": { skill: "board:recipes", path: "r.md" } },
    }),
    [`${V}/skills/work/scripts/x.sh`]: "",
    "/src/acme/recipes/r.md": "",
    "/outside/secret": "",
  };
}

const LINKS = { [`${HOME}/.claude/skills/board:recipes`]: "/src/acme/recipes" };

describe("skills_resolve", () => {
  test("returns resolvePointers's result for a valid id, reading only under the two roots", async () => {
    const fs = fakeFs(files(), LINKS);
    const tool = skillsResolveToolDefs({ fs })[0]!;
    const res = await tool.handler({ id: "widgets@0.4.2:work" }, { HOME } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect(res.body).toEqual(resolvePointers("widgets@0.4.2:work", { fs: fakeFs(files(), LINKS), home: HOME }));
    expect(fs.reads.length).toBeGreaterThan(0);
    for (const p of fs.reads) expect(ROOTS.some((r) => p === r || p.startsWith(`${r}/`)), p).toBe(true);
  });

  test("refuses an id that is not a skill id without touching the fs", async () => {
    const fs = fakeFs(files());
    const tool = skillsResolveToolDefs({ fs })[0]!;
    const res = await tool.handler({ id: "../x" }, { HOME } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(fs.reads).toEqual([]);
  });

  test("a refusal comes back as an error carrying its reason", async () => {
    const tool = skillsResolveToolDefs({ fs: fakeFs({}) })[0]!;
    const res = await tool.handler({ id: "widgets@0.4.2:work" }, { HOME } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("0.4.2");
  });

  test("declares its schema pattern and the verb it replaces", () => {
    const tool = skillsResolveToolDefs()[0]!;
    expect(tool.name).toBe("skills_resolve");
    const props = (tool.inputSchema as { properties: { id: { pattern: string } } }).properties;
    expect(new RegExp(props.id.pattern).test("skills:board:respond")).toBe(true);
    expect(new RegExp(props.id.pattern).test("../x")).toBe(false);
  });
});
