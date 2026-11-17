import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, relative } from "path";
import { captureSkills } from "../../lib/skills/__tests__/helpers.ts";
import { renderPackInto, skillsAnatomy, skillsCheck, skillsCompile } from "../skills.ts";

const FIX = join(import.meta.dir, "..", "..", "lib", "skills", "__tests__", "fixtures", "compile-native");

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  process.exitCode = 0;
});

const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

function tmp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

/** The compile-native pack opted into husks: a work verb, three stages and a plan-policy fill. */
function seedHuskPack() {
  const root = tmp("rt-husk-check-");
  cpSync(FIX, root, { recursive: true });
  const pack = join(root, "pack");
  const ms = join(root, "mattstack-home");
  const manifest = join(ms, "repos", "my-repo", "skills.jsonc");
  put(join(pack, "pack", "skills.jsonc"), JSON.stringify({ husks: true }));
  return { pack, ms, manifest, flags: ["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", manifest] };
}

async function run(fn: () => Promise<void>): Promise<{ exitCode: number; stdout: string }> {
  const io = captureSkills();
  process.exitCode = 0;
  try {
    await fn();
    return { exitCode: Number(process.exitCode ?? 0), stdout: io.stdout() };
  } finally {
    io.restore();
    process.exitCode = 0;
  }
}

type Diagnostic = { file: string; line: number; code: string; message: string };
type CheckJson = { verbs: { name: string; status: string }[]; compileErrors: string[]; renderErrors?: Diagnostic[]; pointerErrors?: Diagnostic[] };

async function check(flags: string[]): Promise<{ exitCode: number; json: CheckJson }> {
  const { exitCode, stdout } = await run(() => skillsCheck([...flags, "--json"]));
  return { exitCode, json: JSON.parse(stdout) as CheckJson };
}

async function compile(flags: string[]): Promise<void> {
  const { exitCode } = await run(() => skillsCompile(flags));
  expect(exitCode).toBe(0);
}

function treeOf(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else files.set(relative(root, abs), readFileSync(abs, "utf8"));
    }
  };
  if (existsSync(root)) walk(root);
  return files;
}

async function renderOf(s: ReturnType<typeof seedHuskPack>): Promise<Map<string, string>> {
  const out = tmp("rt-husk-render-");
  const rendered = await renderPackInto({ packDir: s.pack, manifestText: readFileSync(s.manifest, "utf8"), repoKey: "my-repo", outRoot: out, mattstackDir: s.ms });
  expect(rendered).toEqual({ ok: true, mattstack: "1.0.0" });
  return treeOf(out);
}

describe("check on a husk pack", () => {
  test("a render of a pack holding committed husks matches one from before them", async () => {
    const s = seedHuskPack();
    const before = await renderOf(s);
    await compile(s.flags);
    expect(readFileSync(join(s.pack, "skills", "work", "SKILL.md"), "utf8")).toContain("mcp__mattstack__load_skill");
    const after = await renderOf(s);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [rel, text] of before) expect(after.get(rel)).toBe(text);
    expect(after.get("skills/work/SKILL.md")).toContain('"read": "@stage-plan/SKILL.md"');
  });

  test("check passes a clean husk pack", async () => {
    const s = seedHuskPack();
    await compile(s.flags);
    const { exitCode, json } = await check(s.flags);
    expect(json.compileErrors).toEqual([]);
    expect(json.verbs.map((v) => v.status)).toEqual(["in-sync", "in-sync", "in-sync", "in-sync"]);
    expect(json.renderErrors).toBeUndefined();
    expect(json.pointerErrors).toBeUndefined();
    expect(exitCode).toBe(0);
  });

  test("check reports a husk that drifted and a lock behind the sources", async () => {
    const s = seedHuskPack();
    await compile(s.flags);
    const work = join(s.pack, "skills", "work", "SKILL.md");
    writeFileSync(work, `${readFileSync(work, "utf8")}tampered\n`);
    const policy = join(s.pack, "attachments", "plan-policy", "SKILL.md");
    writeFileSync(policy, readFileSync(policy, "utf8").replace("policy text", "new policy text"));
    const { exitCode, json } = await check(s.flags);
    expect(json.verbs.find((v) => v.name === "work")?.status).toBe("stale");
    expect(json.compileErrors).toEqual(["pack/compiled.lock.json is out of date with the pack's sources"]);
    expect(exitCode).toBe(1);
  });

  test("check fails a rendered body over 200,000 characters", async () => {
    const s = seedHuskPack();
    const policy = join(s.pack, "attachments", "plan-policy", "SKILL.md");
    writeFileSync(policy, readFileSync(policy, "utf8").replace("policy text", `${"long policy line\n".repeat(12_000)}`));
    await compile(s.flags);
    const { exitCode, json } = await check(s.flags);
    expect(json.renderErrors?.map((d) => [d.file, d.code])).toEqual([["attachments/stage-plan/SKILL.md", "body-too-large"]]);
    expect(json.renderErrors?.[0]?.message).toMatch(/^this skill renders to \d+ characters, over the 200,000 a load_skill call keeps whole$/);
    expect(exitCode).toBe(1);
  });

  test("check fails a leftover token in a rendered references file", async () => {
    const s = seedHuskPack();
    put(join(s.pack, "attachments", "helper", "SKILL.md"), "---\nname: helper\ndescription: helper\n---\nHelper.\n");
    put(join(s.pack, "attachments", "helper", "notes.txt"), "Work from ${CLAUDE_SKILL_DIR}/notes first.\n");
    const policy = join(s.pack, "attachments", "plan-policy", "SKILL.md");
    writeFileSync(policy, readFileSync(policy, "utf8").replace("policy text", "policy text; see {{pack.path:helper/notes.txt}}"));
    await compile(s.flags);
    const { exitCode, json } = await check(s.flags);
    expect(json.renderErrors?.map((d) => [d.file, d.line, d.code])).toEqual([["attachments/stage-plan/references/helper/notes.txt", 1, "leftover-token"]]);
    expect(exitCode).toBe(1);
  });

  test("check fails a husk rule naming ${CLAUDE_SKILL_DIR}/scripts/", async () => {
    const s = seedHuskPack();
    const engine = join(s.ms, "plugins", "mattstack", "attachments", "pipeline", "stage-ship");
    const index = join(engine, "index.block.md");
    writeFileSync(index, readFileSync(index, "utf8").replace("type: pipeline-step\n", 'type: pipeline-step\nallowed-tools:\n  - "Bash(${CLAUDE_SKILL_DIR}/scripts/ship.sh:*)"\n'));
    put(join(engine, "scripts", "ship.sh"), "#!/bin/sh\necho ship\n");
    await compile(s.flags);
    const { exitCode, json } = await check(s.flags);
    expect(json.renderErrors?.map((d) => [d.file, d.code])).toEqual([["attachments/stage-ship/SKILL.md", "husk-tool-path"]]);
    expect(json.renderErrors?.[0]?.message).toContain("${CLAUDE_SKILL_DIR}/scripts/");
    expect(exitCode).toBe(1);
  });

  test("anatomy shows uncommitted edits in a husk pack", async () => {
    const s = seedHuskPack();
    await compile(s.flags);
    type Anatomy = { status: string; parts: { kind: string; renderedLines: [number, number] | null }[]; rendered: { lines: number } };
    const anatomy = async () => JSON.parse((await run(() => skillsAnatomy([...s.flags, "--skill", "stage-plan", "--json"]))).stdout) as Anatomy;
    const propSpan = (a: Anatomy) => {
      const lines = a.parts.find((p) => p.kind === "prop")!.renderedLines!;
      return lines[1] - lines[0];
    };
    const before = await anatomy();
    expect(before.status).toBe("in-sync");
    const policy = join(s.pack, "attachments", "plan-policy", "SKILL.md");
    writeFileSync(policy, readFileSync(policy, "utf8").replace("policy text", "policy text\nuncommitted one\nuncommitted two\nuncommitted three"));
    const after = await anatomy();
    expect(propSpan(after)).toBe(propSpan(before) + 3);
    expect(after.rendered.lines).toBe(before.rendered.lines + 3);
  });
});
