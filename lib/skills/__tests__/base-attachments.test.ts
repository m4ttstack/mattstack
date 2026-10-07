import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { HEADER_COMMENT } from "../compile.ts";
import { isEmittedAttachmentDir, isEmittedAttachmentText, isSkippedAttachmentPath, listAttachmentFiles, maskProvenanceVersion, planBaseAttachments, plannedAttachmentsOf } from "../base-attachments.ts";

let root: string;
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const baseDir = () => join(root, "mattstack", "org", "packs", "acme-base");
const packDir = () => join(root, "mattstack", "teams", "widgets", "packs", "widgets");
const plan = (verbSides: Record<string, "skills" | "attachments"> = { ship: "skills" }) =>
  planBaseAttachments({ packDir: packDir(), packName: "widgets", verbSides });
const emittedMarker = JSON.stringify({ base: "acme-base", version: null, files: [] });
const clash = "acme-base attachment review-kit has the same name as the widgets verb review-kit; rename one of them";

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-base-attach-")));
  put(join(root, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme" }));
  put(join(baseDir(), "pack", "skills.jsonc"), JSON.stringify({ base: true }));
  put(join(baseDir(), ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme-base", version: "1.4.0" }));
  put(join(packDir(), "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("planBaseAttachments", () => {
  test("emits every non-fill attachment with compiled.json listing its files", () => {
    const kit = join(baseDir(), "attachments", "review-kit");
    put(join(kit, "SKILL.md"), "---\nname: review-kit\n---\nUse {{pack.name}}:ship.\n");
    put(join(kit, "references", "guide.md"), "guide\n");
    put(join(kit, "scripts", "run.sh"), "echo {{pack.name}}\n");
    put(join(kit, "README.md"), "readme\n");
    put(join(kit, ".DS_Store"), "junk");
    const result = plan();
    expect(result.errors).toEqual([]);
    expect(result.emits.map((e) => e.name)).toEqual(["review-kit"]);
    const files = result.emits[0]!.files;
    expect(files.map((f) => f.path)).toEqual(["README.md", "SKILL.md", "compiled.json", "references/guide.md", "scripts/run.sh"]);
    expect((files.find((f) => f.path === "SKILL.md") as { content: string }).content).toContain("Use widgets:ship.");
    expect(files.find((f) => f.path === "scripts/run.sh")).toEqual({ path: "scripts/run.sh", copyFrom: join(kit, "scripts", "run.sh") });
    expect((files.find((f) => f.path === "compiled.json") as { content: string }).content).toBe(
      JSON.stringify({ base: "acme-base", version: "1.4.0", files: ["README.md", "SKILL.md", "references/guide.md", "scripts/run.sh"] }, null, 2) + "\n",
    );
  });

  test("a fill (metadata.provides) is not emitted", () => {
    put(join(baseDir(), "attachments", "watch-ci-domain", "SKILL.md"), "---\nname: watch-ci-domain\nmetadata:\n  provides: watch-ci-domain@1\n---\nbody\n");
    expect(plan().emits).toEqual([]);
  });

  test("no extends emits nothing and marks every emitted folder stale", () => {
    put(join(packDir(), "pack", "skills.jsonc"), "{}");
    put(join(packDir(), "attachments", "review-kit", "compiled.json"), emittedMarker);
    put(join(packDir(), "attachments", "own", "SKILL.md"), "own\n");
    const result = plan();
    expect(result.base).toBeNull();
    expect(result.emits).toEqual([]);
    expect(result.stale).toEqual([{ name: "review-kit", why: "no-base" }]);
  });

  test("an emitted folder whose base attachment is gone is stale", () => {
    put(join(packDir(), "attachments", "old-kit", "compiled.json"), emittedMarker);
    put(join(baseDir(), "attachments", "review-kit", "SKILL.md"), "body\n");
    expect(plan().stale).toEqual([{ name: "old-kit", why: "dropped" }]);
  });

  test("a team's own folder wins", () => {
    put(join(packDir(), "attachments", "review-kit", "SKILL.md"), "mine\n");
    put(join(baseDir(), "attachments", "review-kit", "SKILL.md"), "body\n");
    const result = plan();
    expect(result.emits).toEqual([]);
    expect(result.kept).toEqual(["review-kit"]);
    expect(result.errors).toEqual([]);
  });

  test("a name that is a compile target is an error naming both", () => {
    put(join(baseDir(), "attachments", "review-kit", "SKILL.md"), "body\n");
    expect(plan({ "review-kit": "attachments" }).errors).toEqual([clash]);
  });

  test("a hand-authored skills/<name> is an error naming both, a compiled one is not", () => {
    put(join(baseDir(), "attachments", "review-kit", "SKILL.md"), "body\n");
    const own = join(packDir(), "skills", "review-kit", "SKILL.md");
    put(own, "---\nname: review-kit\n---\nplain\n");
    expect(plan().errors).toEqual(["acme-base attachment review-kit has the same name as the widgets skill skills/review-kit; rename one of them"]);
    put(own, `---\nname: review-kit\n---\n${HEADER_COMMENT}\nbody\n`);
    expect(plan().errors).toEqual([]);
  });

  test("extends a base that is missing, unmarked, or itself extends", () => {
    const extend = (value: unknown) => put(join(packDir(), "pack", "skills.jsonc"), JSON.stringify({ extends: value }));
    extend("nope");
    expect(plan().errors).toEqual(["widgets extends nope, but the org has no base pack called nope"]);
    put(join(baseDir(), "pack", "skills.jsonc"), JSON.stringify({}));
    extend("acme-base");
    expect(plan().errors).toEqual(["widgets extends acme-base, but the org's acme-base pack is not marked as a base pack"]);
    put(join(baseDir(), "pack", "skills.jsonc"), JSON.stringify({ base: true, extends: "other" }));
    expect(plan().errors).toEqual(["widgets extends acme-base, which extends other; a base pack cannot extend another"]);
    extend("Bad Name");
    expect(plan().errors).toEqual(['widgets extends "Bad Name", which is not a base pack name']);
    extend(3);
    expect(plan().errors).toEqual(["widgets's extends is not a string"]);
  });

  test("a pack outside any org repo cannot extend", () => {
    const lone = realpathSync(mkdtempSync(join(tmpdir(), "rt-base-attach-lone-")));
    try {
      put(join(lone, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
      const result = planBaseAttachments({ packDir: lone, packName: "widgets", verbSides: {} });
      expect(result.errors).toEqual(["widgets extends acme-base, but it is not inside an org repo"]);
    } finally {
      rmSync(lone, { recursive: true, force: true });
    }
  });

  test("a base folder carrying its own compiled.json is refused", () => {
    put(join(baseDir(), "attachments", "review-kit", "SKILL.md"), "body\n");
    put(join(baseDir(), "attachments", "review-kit", "compiled.json"), "{}\n");
    expect(plan().errors).toEqual(["acme-base attachment review-kit carries compiled.json, a name compile keeps for itself"]);
  });

  test("pack.path from a base file to its own nested file resolves on a clean plan", () => {
    put(join(baseDir(), "attachments", "review-kit", "SKILL.md"), "see {{pack.path:review-kit/references/guide.md}}\n");
    put(join(baseDir(), "attachments", "review-kit", "references", "guide.md"), "guide\n");
    const result = plan();
    expect(result.errors).toEqual([]);
    const skill = result.emits[0]!.files.find((f) => f.path === "SKILL.md") as { content: string };
    expect(skill.content).toContain("${CLAUDE_SKILL_DIR}/../../attachments/review-kit/references/guide.md");
  });

  test("a placeholder error becomes a plan error", () => {
    put(join(baseDir(), "attachments", "review-kit", "SKILL.md"), "{{verb.path:nope}}\n");
    const result = plan();
    expect(result.errors[0]).toBe("acme-base:attachments/review-kit/SKILL.md: {{verb.path:nope}} -- nope is not a compiled verb of this pack");
    expect(result.emits).toEqual([]);
  });

  test("plannedAttachmentsOf maps emits to their files and stale folders to nothing", () => {
    put(join(baseDir(), "attachments", "review-kit", "SKILL.md"), "body\n");
    put(join(packDir(), "attachments", "old-kit", "compiled.json"), emittedMarker);
    const planned = plannedAttachmentsOf(plan());
    expect([...planned.get("review-kit")!].sort()).toEqual(["SKILL.md", "compiled.json"]);
    expect([...planned.get("old-kit")!]).toEqual([]);
  });

  test("a hand-authored compiled.json is data, not provenance", () => {
    put(join(packDir(), "pack", "skills.jsonc"), "{}");
    put(join(packDir(), "attachments", "data", "compiled.json"), '{"rows": []}\n');
    expect(plan().stale).toEqual([]);
    expect(isEmittedAttachmentDir(join(packDir(), "attachments", "data"))).toBe(false);
    for (const text of ["[]", '{"base": 3}', "not json", null]) expect(isEmittedAttachmentText(text)).toBe(false);
    expect(isEmittedAttachmentText(emittedMarker)).toBe(true);
  });

  test("only compile's full shape is provenance", () => {
    expect(isEmittedAttachmentText('{"base":"x"}')).toBe(false);
    expect(isEmittedAttachmentText('{"base":"https://api.example","rows":[]}')).toBe(false);
    expect(isEmittedAttachmentText('{"base":"x","files":[]}')).toBe(false);
    expect(isEmittedAttachmentText('{"base":"x","version":3,"files":[]}')).toBe(false);
    expect(isEmittedAttachmentText('{"base":"x","version":null,"files":{}}')).toBe(false);
    expect(isEmittedAttachmentText(JSON.stringify({ base: "acme-base", version: null, files: [] }))).toBe(true);
    expect(isEmittedAttachmentText(JSON.stringify({ base: "acme-base", version: "1.4.0", files: ["SKILL.md"] }))).toBe(true);
  });

  test("a clashing name is reported once", () => {
    put(join(baseDir(), "attachments", "review-kit", "SKILL.md"), "{{pack.path:review-kit/x.md}}\n");
    expect(plan({ "review-kit": "attachments" }).errors).toEqual([clash]);
  });
});

describe("plan errors", () => {
  test("a plan error clears an existing stale entry", () => {
    put(join(packDir(), "attachments", "old-kit", "compiled.json"), emittedMarker);
    put(join(baseDir(), "attachments", "review-kit", "SKILL.md"), "body\n");
    const result = plan({ "review-kit": "attachments" });
    expect(result.errors).toEqual([clash]);
    expect(result.stale).toEqual([]);
    expect(result.emits).toEqual([]);
  });

  test("a base folder named like an Object property is not a clash", () => {
    put(join(baseDir(), "attachments", "constructor", "SKILL.md"), "body\n");
    const result = plan();
    expect(result.errors).toEqual([]);
    expect(result.emits.map((e) => e.name)).toEqual(["constructor"]);
  });

  test("a folder named compiled.json is not provenance and does not throw", () => {
    mkdirSync(join(packDir(), "attachments", "odd", "compiled.json"), { recursive: true });
    expect(isEmittedAttachmentDir(join(packDir(), "attachments", "odd"))).toBe(false);
  });
});

describe("helpers", () => {
  test("isEmittedAttachmentDir reads the folder's compiled.json", () => {
    put(join(packDir(), "attachments", "a", "compiled.json"), emittedMarker);
    expect(isEmittedAttachmentDir(join(packDir(), "attachments", "a"))).toBe(true);
    expect(isEmittedAttachmentDir(join(packDir(), "attachments", "missing"))).toBe(false);
  });

  test("maskProvenanceVersion masks a version string and null alike", () => {
    const a = JSON.stringify({ base: "acme-base", version: "1.4.0", files: [] }, null, 2);
    const b = JSON.stringify({ base: "acme-base", version: null, files: [] }, null, 2);
    expect(maskProvenanceVersion(a)).toBe(maskProvenanceVersion(b));
  });

  test("listAttachmentFiles and isSkippedAttachmentPath drop dotfiles and bytecode", () => {
    const dir = join(packDir(), "attachments", "kit");
    put(join(dir, "b.md"), "b");
    put(join(dir, "a", "c.txt"), "c");
    put(join(dir, ".hidden", "d.md"), "d");
    put(join(dir, "__pycache__", "x.pyc"), "x");
    put(join(dir, "m.pyc"), "x");
    expect(listAttachmentFiles(dir)).toEqual(["a/c.txt", "b.md"]);
    expect(isSkippedAttachmentPath("a/.DS_Store")).toBe(true);
    expect(isSkippedAttachmentPath("a/__pycache__/x.py")).toBe(true);
    expect(isSkippedAttachmentPath("a/x.pyc")).toBe(true);
    expect(isSkippedAttachmentPath("a/x.py")).toBe(false);
  });
});
