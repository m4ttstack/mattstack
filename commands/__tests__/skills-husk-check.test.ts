import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, relative } from "path";
import { stripJsonc } from "../../lib/jsonc.ts";
import { captureSkills } from "../../lib/skills/__tests__/helpers.ts";
import { renderWorld, writeFile } from "../../lib/skills/__tests__/render-world.ts";
import { materializeRepo } from "../../lib/skills/materialize.ts";
import { resolvePluginRootsFromDir } from "../../lib/skills/sources.ts";
import { createRealProbes } from "../../lib/setup/probes.ts";
import { renderedTreeErrors } from "../../lib/skills/unit-maps.ts";
import { ORG_LAYOUT } from "../../lib/team/org-marker.ts";
import { huskCheckBindings, renderPackInto, skillsAnatomy, skillsCheck, skillsCompile } from "../skills.ts";

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

  /** A verbless husk pack whose org base unit dev-servers is public, so its only committed skill is a door husk. */
  function seedDoorPack() {
    const ms = tmp("rt-husk-door-");
    put(join(ms, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "1.0.0" }));
    const orgRoot = join(ms, "orgs", "acme");
    put(join(orgRoot, ".git", "config"), "");
    put(join(orgRoot, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme", layout: ORG_LAYOUT }));
    const baseDir = join(orgRoot, "mattstack", "org", "packs", "acme-base");
    put(join(baseDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme-base", version: "0.1.0" }));
    put(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true }));
    put(join(baseDir, "attachments", "dev-servers", "SKILL.md"), "---\nname: dev-servers\ndescription: Servers\n---\nServers.\n");
    const pack = join(orgRoot, "mattstack", "teams", "widgets", "plugin");
    put(join(pack, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.4.11" }));
    put(join(pack, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base", husks: true }));
    put(join(pack, "pack", "surface.jsonc"), JSON.stringify({ public: ["dev-servers"] }));
    return { pack, ms, flags: ["--team", "widgets", "--pack-dir", pack, "--mattstack-dir", ms] };
  }

  test("a render writes the base unit a door husk loads, and no door", async () => {
    const s = seedDoorPack();
    await compile(s.flags);
    const out = tmp("rt-husk-render-");
    const rendered = await renderPackInto({ packDir: s.pack, manifestText: "", repoKey: "", outRoot: out, mattstackDir: s.ms });
    expect(rendered).toEqual({ ok: true, mattstack: "1.0.0" });
    const files = [...treeOf(out).keys()].sort();
    expect(files).toEqual(["attachments/dev-servers/SKILL.md", "attachments/dev-servers/compiled.json"]);
  });

  test("check passes a husk pack whose only skill is a door", async () => {
    const s = seedDoorPack();
    await compile(s.flags);
    const { exitCode, json } = await check(s.flags);
    expect(json.compileErrors).toEqual([]);
    expect(json.renderErrors).toBeUndefined();
    expect(exitCode).toBe(0);
  });

  test("the rendered scan skips only a unit's own scripts folder", () => {
    const root = tmp("rt-husk-scan-");
    const token = "Run ${CLAUDE_SKILL_DIR}/x first.\n";
    put(join(root, "skills", "a", "SKILL.md"), "---\nname: a\n---\nA.\n");
    put(join(root, "skills", "a", "scripts", "run.sh"), `# ${token}`);
    put(join(root, "skills", "a", "references", "scripts", "x.md"), token);
    put(join(root, "attachments", "g", "u", "SKILL.md"), "---\nname: u\n---\nU.\n");
    put(join(root, "attachments", "g", "u", "scripts", "y.sh"), `# ${token}`);
    put(join(root, "attachments", "g", "u", "parts", "include-n", "scripts", "z.md"), token);
    expect(renderedTreeErrors(root).map((d) => d.file)).toEqual(["attachments/g/u/parts/include-n/scripts/z.md", "skills/a/references/scripts/x.md"]);
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

describe("check's husk render in an org clone", () => {
  const savedHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = savedHome;
  });
  const bindingsOf = (text: string) => (JSON.parse(stripJsonc(text)) as { bindings: Record<string, unknown> }).bindings;

  test("renders with the team's bindings, never this Mac's overrides.jsonc", () => {
    const w = renderWorld(made, { husks: true });
    process.env.HOME = w.home;
    writeFile(join(w.mattstackRoot, "user", "skills", "overrides.jsonc"), JSON.stringify({ bindings: { "mattstack:stage-ship": { rules: "acme:plan-policy" } } }));
    const roots = resolvePluginRootsFromDir(w.mattstackDir);
    const materialized = materializeRepo({ fs: createRealProbes(), mattstackRoot: w.mattstackRoot, enginePackDir: roots.byName.mattstack!.dir }, "https://gitlab.example.com/acme/widgets");
    if (materialized.kind !== "written") throw new Error(materialized.kind);
    const written = materialized.packs.find((p) => p.ok);
    if (!written || !written.ok) throw new Error(JSON.stringify(materialized.packs));
    const manifestText = readFileSync(written.path, "utf8");
    expect(bindingsOf(manifestText)["mattstack:stage-ship"]).toBeDefined();

    const chosen = huskCheckBindings({ packDir: w.packDir, manifestText, repoKey: "acme-widgets", pluginRoots: roots });
    if ("error" in chosen) throw new Error(chosen.error);
    expect(bindingsOf(chosen.text)["mattstack:stage-ship"]).toBeUndefined();
    expect(bindingsOf(chosen.text)["mattstack:stage-plan"]).toBeDefined();
  });

  test("a pack outside any org clone renders with the manifest it resolved", () => {
    const s = seedHuskPack();
    const manifestText = readFileSync(s.manifest, "utf8");
    expect(huskCheckBindings({ packDir: s.pack, manifestText, repoKey: "my-repo", pluginRoots: resolvePluginRootsFromDir(s.ms) })).toEqual({ text: manifestText, repoKey: "my-repo" });
  });
});
