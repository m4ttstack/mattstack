import { describe, expect, test } from "bun:test";
import { posix } from "path";
import { UserActionableError } from "../../errors.ts";
import { findPluginVersionDirs } from "../installed-plugins.ts";
import { resolvePointers } from "../resolve.ts";
import { fakeFs } from "./resolve-fs.ts";

const HOME = "/home/acme";
const CACHE = `${HOME}/.claude/plugins/cache`;
const SKILLS = `${HOME}/.claude/skills`;

function map(id: string, dir: string, keys: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...extra, id, dir, covers: [id], keys });
}

const V = `${CACHE}/acme/widgets/0.4.2`;

function widgetsFiles(root = V): Record<string, string> {
  return {
    [`${root}/skills/work/compiled.json`]: JSON.stringify({
      id: "widgets@0.4.2:work",
      dir: "skills/work",
      covers: ["widgets@0.4.2:work", "widgets@0.4.2:stage-x"],
      keys: {
        "work/scripts/x.sh": "skills/work/scripts/x.sh",
        "stage-x/parts/d/y.sh": "skills/stage-x/parts/d/y.sh",
      },
    }),
    [`${root}/skills/work/SKILL.md`]: "",
    [`${root}/skills/work/scripts/x.sh`]: "",
    [`${root}/skills/stage-x/parts/d/y.sh`]: "",
  };
}

function refusal(run: () => unknown): UserActionableError {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(UserActionableError);
    return e as UserActionableError;
  }
  throw new Error("expected a refusal");
}

function said(e: UserActionableError): string {
  return [e.message, e.why ?? "", e.next ?? ""].join(" ");
}

/** `Bash(*\/parts/d/y.sh:*)`'s path part as a whole-string match. */
function wildcard(rule: string): RegExp {
  const core = rule.replace(/^Bash\(/, "").replace(/:\*\)$/, "");
  return new RegExp(`^${core.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

describe("findPluginVersionDirs", () => {
  test("lists every marketplace's copy of the exact version, skipping temp_git_ clones, sorted", () => {
    const fs = fakeFs({
      [`${CACHE}/zeta/widgets/0.4.2/x`]: "",
      [`${CACHE}/acme/widgets/0.4.2/x`]: "",
      [`${CACHE}/acme/widgets/0.4.1/x`]: "",
      [`${CACHE}/temp_git_123_ab/widgets/0.4.2/x`]: "",
      [`${CACHE}/gadgets/other/0.4.2/x`]: "",
    });
    expect(findPluginVersionDirs(fs, HOME, "widgets", "0.4.2")).toEqual([`${CACHE}/acme/widgets/0.4.2`, `${CACHE}/zeta/widgets/0.4.2`]);
  });
});

describe("resolvePointers: plugin ids", () => {
  test("resolves a verb from its compiled.json, keeping the ../ in a stage's path", () => {
    const r = resolvePointers("widgets@0.4.2:work", { fs: fakeFs(widgetsFiles()), home: HOME });
    expect(r.id).toBe("widgets@0.4.2:work");
    expect(r.folder).toBe(`${V}/skills/work`);
    expect(r.covers).toEqual(["widgets@0.4.2:work", "widgets@0.4.2:stage-x"]);
    expect(r.keys["stage-x/parts/d/y.sh"]).toBe(`${V}/skills/work/../../skills/stage-x/parts/d/y.sh`);
  });

  test("the unit's own script path is the allowed-tools text with the folder filled in", () => {
    const r = resolvePointers("widgets@0.4.2:work", { fs: fakeFs(widgetsFiles()), home: HOME });
    const allowed = "Bash(${CLAUDE_SKILL_DIR}/scripts/x.sh:*)".replace("${CLAUDE_SKILL_DIR}", r.folder);
    expect(`Bash(${r.keys["work/scripts/x.sh"]}:*)`).toBe(allowed);
  });

  test("a stage's script path matches the orchestrator's wildcard rule", () => {
    const r = resolvePointers("widgets@0.4.2:work", { fs: fakeFs(widgetsFiles()), home: HOME });
    expect(r.keys["stage-x/parts/d/y.sh"]).toMatch(wildcard("Bash(*/parts/d/y.sh:*)"));
  });

  test("resolves an attachments unit and a grouped one by matching the id", () => {
    const fs = fakeFs({
      [`${V}/attachments/board-respond/compiled.json`]: map("widgets@0.4.2:board-respond", "attachments/board-respond", { "board-respond/run.sh": "attachments/board-respond/run.sh" }, { base: "board-respond", version: "1", files: [] }),
      [`${V}/attachments/board-respond/run.sh`]: "",
      [`${V}/attachments/tools/widget/compiled.json`]: map("widgets@0.4.2:widget", "attachments/tools/widget", { "widget/w.sh": "attachments/tools/widget/w.sh" }),
      [`${V}/attachments/tools/widget/w.sh`]: "",
    });
    const respond = resolvePointers("widgets@0.4.2:board-respond", { fs, home: HOME });
    expect(respond.folder).toBe(`${V}/attachments/board-respond`);
    expect(respond.keys).toEqual({ "board-respond/run.sh": `${V}/attachments/board-respond/run.sh` });
    const widget = resolvePointers("widgets@0.4.2:widget", { fs, home: HOME });
    expect(widget.folder).toBe(`${V}/attachments/tools/widget`);
    expect(widget.keys).toEqual({ "widget/w.sh": `${V}/attachments/tools/widget/w.sh` });
  });

  test("refuses when only another version is installed, naming it", () => {
    const fs = fakeFs(widgetsFiles(`${CACHE}/acme/widgets/0.4.1`));
    const e = refusal(() => resolvePointers("widgets@0.4.2:work", { fs, home: HOME }));
    expect(said(e)).toContain("0.4.1");
    expect(e.message).toContain("0.4.2");
  });

  test("ignores a temp_git_ marketplace holding the same version", () => {
    const fs = fakeFs({ ...widgetsFiles(), ...widgetsFiles(`${CACHE}/temp_git_123_ab/widgets/0.4.2`) });
    expect(resolvePointers("widgets@0.4.2:work", { fs, home: HOME }).folder).toBe(`${V}/skills/work`);
  });

  test("refuses two marketplaces holding the version, naming both", () => {
    const fs = fakeFs({ ...widgetsFiles(), ...widgetsFiles(`${CACHE}/gadgets/widgets/0.4.2`) });
    const e = refusal(() => resolvePointers("widgets@0.4.2:work", { fs, home: HOME }));
    expect(said(e)).toContain(`${CACHE}/acme/widgets/0.4.2`);
    expect(said(e)).toContain(`${CACHE}/gadgets/widgets/0.4.2`);
    expect(e.next).toBe("claude plugin uninstall widgets@gadgets");
  });

  test("refuses two unit folders that both carry the id, naming each", () => {
    const fs = fakeFs({
      ...widgetsFiles(),
      [`${V}/attachments/work/compiled.json`]: map("widgets@0.4.2:work", "attachments/work", {}),
    });
    const e = refusal(() => resolvePointers("widgets@0.4.2:work", { fs, home: HOME }));
    expect(said(e)).toContain(`${V}/skills/work`);
    expect(said(e)).toContain(`${V}/attachments/work`);
    expect(e.next).toBe("claude plugin update widgets@acme");
    expect(e.why).toContain("its owner recompiles it with rt skills sync --pack widgets");
  });

  test("refuses a unit folder with no compiled.json", () => {
    const fs = fakeFs({ [`${V}/skills/work/SKILL.md`]: "" });
    const e = refusal(() => resolvePointers("widgets@0.4.2:work", { fs, home: HOME }));
    expect(said(e)).toContain("compiled.json");
    expect(e.next).toBe("claude plugin update widgets@acme");
    expect(e.why).toContain("its owner recompiles it with rt skills sync --pack widgets");
  });

  test("a folder whose map is for another id says which id it found", () => {
    const fs = fakeFs({ [`${V}/skills/work/compiled.json`]: map("widgets@0.4.1:work", "skills/work", {}) });
    const e = refusal(() => resolvePointers("widgets@0.4.2:work", { fs, home: HOME }));
    expect(e.why).toStartWith(`The map in ${V}/skills/work is for widgets@0.4.1:work. `);
  });

  test("refuses an id no folder carries, pointing at a sync", () => {
    const fs = fakeFs(widgetsFiles());
    const e = refusal(() => resolvePointers("widgets@0.4.2:gadget", { fs, home: HOME }));
    expect(e.message).toContain("gadget");
    expect(e.next).toBe("claude plugin update widgets@acme");
    expect(e.why).toContain("its owner recompiles it with rt skills sync --pack widgets");
  });

  test("refuses a map whose dir or key climbs out of the version dir, before reading that path", () => {
    for (const bad of [
      map("widgets@0.4.2:work", "../../../../../../../outside", { "work/x": "../../../../../../../outside/x" }),
      map("widgets@0.4.2:work", "skills/work", { "work/x": "../../../outside/x" }),
    ]) {
      const fs = fakeFs({ [`${V}/skills/work/compiled.json`]: bad, "/outside/x": "" });
      const e = refusal(() => resolvePointers("widgets@0.4.2:work", { fs, home: HOME }));
      expect(e.message).toContain("outside");
      expect(fs.reads.filter((p) => !posix.normalize(p).startsWith(`${HOME}/.claude/`))).toEqual([]);
    }
  });

  test("refuses a sibling whose skill name or path climbs out of its link, naming the key", () => {
    for (const sibling of [{ skill: "../../.ssh", path: "id_rsa" }, { skill: "board:recipes", path: "../../../.ssh/id_rsa" }]) {
      const fs = fakeFs({ [`${V}/skills/work/compiled.json`]: map("widgets@0.4.2:work", "skills/work", { "recipes/r": sibling }), [`${HOME}/.ssh/id_rsa`]: "" });
      const e = refusal(() => resolvePointers("widgets@0.4.2:work", { fs, home: HOME }));
      expect(e.message).toContain("@recipes/r");
      expect(fs.reads.some((p) => p.includes(".ssh"))).toBe(false);
    }
  });

  test("refuses a key whose file is missing, naming the key", () => {
    const files = widgetsFiles();
    delete files[`${V}/skills/stage-x/parts/d/y.sh`];
    const e = refusal(() => resolvePointers("widgets@0.4.2:work", { fs: fakeFs(files), home: HOME }));
    expect(said(e)).toContain("@stage-x/parts/d/y.sh");
    expect(e.next).toBe("claude plugin update widgets@acme");
    expect(e.why).toContain("its owner recompiles it with rt skills sync --pack widgets");
  });

  test("refuses a malformed id before reading anything", () => {
    const fs = fakeFs(widgetsFiles());
    refusal(() => resolvePointers("../x", { fs, home: HOME }));
    expect(fs.reads).toEqual([]);
  });
});

describe("resolvePointers: skills ids", () => {
  const REPO = "/src/acme/apps/board/skills";
  const RESPOND = `${SKILLS}/board:respond`;
  const RECIPES = `${SKILLS}/board:gate-cli-recipes`;

  function boardFiles(): Record<string, string> {
    return {
      [`${REPO}/respond/compiled.json`]: map("skills:board:respond", "skills/board:respond", {
        "board:respond/scripts/r.sh": "skills/board:respond/scripts/r.sh",
        "board:gate-cli-recipes/recipes.md": { skill: "board:gate-cli-recipes", path: "recipes.md" },
      }),
      [`${REPO}/respond/scripts/r.sh`]: "",
      [`${REPO}/gate-cli-recipes/recipes.md`]: "",
    };
  }

  test("uses the link path as the folder, never its target, and a sibling resolves under its own link", () => {
    const fs = fakeFs(boardFiles(), { [RESPOND]: `${REPO}/respond`, [RECIPES]: `${REPO}/gate-cli-recipes` });
    const r = resolvePointers("skills:board:respond", { fs, home: HOME });
    expect(r.folder).toBe(RESPOND);
    expect(r.keys).toEqual({
      "board:respond/scripts/r.sh": `${RESPOND}/scripts/r.sh`,
      "board:gate-cli-recipes/recipes.md": `${RECIPES}/recipes.md`,
    });
    expect(JSON.stringify(r)).not.toContain(REPO);
  });

  test("refuses a dead link, naming it", () => {
    const fs = fakeFs(boardFiles(), { [RESPOND]: null });
    const e = refusal(() => resolvePointers("skills:board:respond", { fs, home: HOME }));
    expect(said(e)).toContain(RESPOND);
    expect(said(e)).not.toContain("compiled.json");
    expect(e.why).toBe("Its target was moved or deleted.");
    expect(e.next).toBe("rt setup update");
  });

  test("refuses an own target that climbs back out through the link, where the OS would leave the skills folder", () => {
    const files = { ...boardFiles(), [`${REPO}/respond/compiled.json`]: map("skills:board:respond", "skills/board:respond", { "board:respond/x": "skills/board:other/x" }), [`${REPO}/other/x`]: "" };
    const fs = fakeFs(files, { [RESPOND]: `${REPO}/respond` });
    const e = refusal(() => resolvePointers("skills:board:respond", { fs, home: HOME }));
    expect(e.code).toBe("skills-resolve-outside");
    expect(e.message).toContain("@board:respond/x");
  });

  test("refuses a dead sibling link, naming it", () => {
    const fs = fakeFs(boardFiles(), { [RESPOND]: `${REPO}/respond`, [RECIPES]: null });
    const e = refusal(() => resolvePointers("skills:board:respond", { fs, home: HOME }));
    expect(said(e)).toContain(RECIPES);
  });

  test("refuses a live skill folder with no compiled.json", () => {
    const fs = fakeFs({ [`${REPO}/respond/SKILL.md`]: "" }, { [RESPOND]: `${REPO}/respond` });
    const e = refusal(() => resolvePointers("skills:board:respond", { fs, home: HOME }));
    expect(said(e)).toContain("compiled.json");
    expect(e.why).toContain("relinking");
    expect(e.next).toBe("rt setup update");
  });
});
