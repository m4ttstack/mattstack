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
    const props = (tool.inputSchema as { properties: { id: { pattern: string }; dir: { type: string } } }).properties;
    expect(new RegExp(props.id.pattern).test("skills:board:respond")).toBe(true);
    expect(new RegExp(props.id.pattern).test("acme:work")).toBe(true);
    expect(new RegExp(props.id.pattern).test("../x")).toBe(false);
    expect(props.dir.type).toBe("string");
  });

  test("dir is passed through and confined", async () => {
    const root = `${HOME}/.claude/plugins/cache/acme/acme`;
    const acme = (version: string): Record<string, string> => ({
      [`${root}/${version}/skills/work/compiled.json`]: JSON.stringify({ id: "acme:work", dir: "skills/work", covers: ["acme:work"], keys: { "work/x.sh": "skills/work/x.sh" } }),
      [`${root}/${version}/skills/work/x.sh`]: "",
    });
    const installed = { ...acme("0.4.11"), ...acme("0.4.12"), "/outside/acme/0.4.11/skills/work/x.sh": "" };
    const call = (fs: ReturnType<typeof fakeFs>, dir: unknown) => skillsResolveToolDefs({ fs })[0]!.handler({ id: "acme:work", dir }, { HOME } as NodeJS.ProcessEnv);

    const pinned = await call(fakeFs(installed), `${root}/0.4.11/skills/work`);
    expect(pinned.ok).toBe(true);
    expect(pinned.body).toMatchObject({ folder: `${root}/0.4.11/skills/work`, pinned: true });

    const escaping = fakeFs(installed);
    const climbed = await call(escaping, `${root}/0.4.11/../../../../../../../outside/acme/0.4.11/skills/work`);
    expect(climbed.ok).toBe(false);
    expect(climbed.error).toContain("dir");
    expect(escaping.reads).toEqual([]);

    const unpinned = await call(fakeFs(installed), "/src/acme/skills/work");
    expect(unpinned.ok).toBe(true);
    expect(unpinned.body).toMatchObject({ folder: `${root}/0.4.12/skills/work`, pinned: false, warning: "No skill folder was passed, so this run is not pinned to the version it loaded." });

    const fs = fakeFs(installed);
    const other = await call(fs, `${root}/0.4.11/../../acme-base/0.1.0/skills/work`);
    expect(other.ok).toBe(false);
    expect(other.error).toContain("acme-base");
    expectInsideRoots(fs.reads);

    const notText = await call(fakeFs(installed), 7);
    expect(notText.ok).toBe(false);
  });
});
