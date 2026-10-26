import { describe, expect, test } from "bun:test";
import { posix } from "path";
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

function mapWith(over: Record<string, unknown>): string {
  return JSON.stringify({ id: "widgets@0.4.2:work", dir: "skills/work", covers: ["widgets@0.4.2:work"], keys: {}, ...over });
}

function expectInsideRoots(reads: string[]): void {
  expect(reads.length).toBeGreaterThan(0);
  for (const raw of reads) {
    const p = posix.normalize(raw);
    expect(ROOTS.some((r) => p === r || p.startsWith(`${r}/`)), raw).toBe(true);
  }
}

describe("skills_resolve", () => {
  test("returns resolvePointers's result for a valid id, reading only under the two roots", async () => {
    const fs = fakeFs(files(), LINKS);
    const tool = skillsResolveToolDefs({ fs })[0]!;
    const res = await tool.handler({ id: "widgets@0.4.2:work" }, { HOME } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect(res.body).toEqual(resolvePointers("widgets@0.4.2:work", { fs: fakeFs(files(), LINKS), home: HOME }));
    expect(fs.reads.length).toBeGreaterThan(0);
    expectInsideRoots(fs.reads);
  });

  test("refuses a map whose dir climbs out of the plugin, reading nothing outside the roots", async () => {
    const fs = fakeFs({ ...files(), [`${V}/skills/work/compiled.json`]: mapWith({ dir: "../../../../../../../outside", keys: { "work/secret": "../../../../../../../outside/secret" } }) });
    const res = await skillsResolveToolDefs({ fs })[0]!.handler({ id: "widgets@0.4.2:work" }, { HOME } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("outside");
    expectInsideRoots(fs.reads);
  });

  test("refuses a sibling target that climbs out of its link, reading nothing outside the roots", async () => {
    for (const sibling of [{ skill: "../../../../outside", path: "secret" }, { skill: "board:recipes", path: "../../../../../outside/secret" }]) {
      const fs = fakeFs({ ...files(), [`${V}/skills/work/compiled.json`]: mapWith({ keys: { "recipes/r.md": sibling } }) }, LINKS);
      const res = await skillsResolveToolDefs({ fs })[0]!.handler({ id: "widgets@0.4.2:work" }, { HOME } as NodeJS.ProcessEnv);
      expect(res.ok, JSON.stringify(sibling)).toBe(false);
      expect(res.error).toContain("@recipes/r.md");
      expectInsideRoots(fs.reads);
    }
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
