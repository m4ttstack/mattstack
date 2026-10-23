/**
 * `rt skills blocks --json` is frozen byte for byte: console's block view
 * reads it, and its route maps the not-a-block-tree code to a 404. Run with
 * RT_UPDATE_SKILLS_BLOCKS_FIXTURES=1 only to add a case, never to make a
 * diff go away.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureSkills } from "../../lib/skills/__tests__/helpers.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import * as out from "../../lib/ui/out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { skillsBlocks } from "../skills.ts";

const BLOCKS_FIX = join(import.meta.dir, "..", "..", "lib", "skills", "__tests__", "fixtures", "blocks");
const FIXTURES = join(import.meta.dir, "fixtures", "skills-blocks-json");
const UPDATE = process.env.RT_UPDATE_SKILLS_BLOCKS_FIXTURES === "1";

let io: CapturedOut;
let root: string;
const origHome = process.env.HOME;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-blocks-")));
  process.env.HOME = join(root, "home");
  mkdirSync(process.env.HOME, { recursive: true });
  cpSync(join(BLOCKS_FIX, "pack"), join(root, "pack"), { recursive: true });
  cpSync(join(BLOCKS_FIX, "mattstack-home"), join(root, "mattstack-home"), { recursive: true });
  cpSync(join(BLOCKS_FIX, "plugins"), join(root, "mattstack-home", "plugins"), { recursive: true });
  io = captureSkills();
});

afterEach(() => {
  io.restore();
  process.env.HOME = origHome;
  process.exitCode = 0;
  rmSync(root, { recursive: true, force: true });
});

function args(...extra: string[]): string[] {
  const ms = join(root, "mattstack-home");
  return ["--pack-dir", join(root, "pack"), "--mattstack-dir", ms, "--manifest", join(ms, "repos", "my-repo", "skills.jsonc"), ...extra];
}

/** The temp root and the envelope clock differ per run; everything else is the contract. */
function normalize(text: string): string {
  return text.replaceAll(root, "<ROOT>").replace(/"at":"[^"]+"/g, '"at":"<AT>"');
}

function frozen(name: string): void {
  const file = join(FIXTURES, `${name}.txt`);
  const got = normalize(io.stdout());
  if (UPDATE) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, got);
  }
  expect(existsSync(file)).toBe(true);
  expect(got).toBe(readFileSync(file, "utf8"));
  expect(io.stderr()).toBe("");
}

/** A slot engine beside the block one: a SKILL.md typed pipeline-step, and a verb that compiles it. */
function addSlotEngine(body = "Do the plain thing."): void {
  const engine = join(root, "mattstack-home", "plugins", "mattstack", "attachments", "pipeline", "plain");
  mkdirSync(engine, { recursive: true });
  writeFileSync(join(engine, "SKILL.md"), `---\nname: plain\ndescription: "A plain step"\ntype: pipeline-step\n---\n\n# plain\n\n${body}\n`);
  writeFileSync(
    join(root, "pack", "pack", "stubs.jsonc"),
    JSON.stringify({ verbs: { mini: { engine: "mini", description: "Run the mini widget step" }, plain: { engine: "plain", description: "Run the plain step" } } }),
  );
}

test("skills blocks --json on the mini block tree is frozen", async () => {
  await skillsBlocks(args("--skill", "mini", "--json"));
  frozen("mini");
  const payload = JSON.parse(io.stdout());
  expect(Object.keys(payload)).toEqual(["pack", "skill", "kind", "engineRef", "dir", "layers", "blocks", "graphs", "includes", "lines"]);
  expect(process.exitCode ?? 0).toBe(0);
});

test("skills blocks --json on a skill that is not a block tree is the failure envelope, exit 1", async () => {
  addSlotEngine();
  await skillsBlocks(args("--skill", "plain", "--json"));
  frozen("not-a-block-tree");
  expect(JSON.parse(io.stdout()).error.code).toBe("not-a-block-tree");
  expect(process.exitCode).toBe(1);
});

test("skills blocks without --json prints the tree of labels with a kind glyph per row", async () => {
  await skillsBlocks(args("--skill", "mini"));
  expect(io.stdout()).toBe(renderPlain([
    out.tree("mini", [["○ Run"], ["  ▤ Guard"], ["  ▤ Check"], ["⚑ Gate"], ["▤ Notes"]]),
  ]));
});

test("skills blocks --json on a slot engine that would not compile is still not-a-block-tree", async () => {
  addSlotEngine("{{include:missing-include}}");
  await skillsBlocks(args("--skill", "plain", "--json"));
  expect(JSON.parse(io.stdout()).error.code).toBe("not-a-block-tree");
  expect(io.stderr()).toBe("");
  expect(process.exitCode).toBe(1);
});

test("skills blocks --json on a hand-written pack skill is the same failure envelope", async () => {
  mkdirSync(join(root, "pack", "skills", "hand"), { recursive: true });
  writeFileSync(join(root, "pack", "skills", "hand", "SKILL.md"), '---\nname: hand\ndescription: "Written by hand"\n---\n\nDo it by hand.\n');
  await skillsBlocks(args("--skill", "hand", "--json"));
  expect(JSON.parse(io.stdout()).error).toEqual({ code: "not-a-block-tree", message: "The hand skill is not built from blocks" });
  expect(io.stderr()).toBe("");
  expect(process.exitCode).toBe(1);
});

test("skills blocks on a skill that is not a block tree says so on stderr, exit 1", async () => {
  addSlotEngine();
  await skillsBlocks(args("--skill", "plain"));
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toStartWith("The plain skill is not built from blocks");
  expect(process.exitCode).toBe(1);
});
