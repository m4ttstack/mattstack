import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ORG_LAYOUT } from "../../team/org-marker.ts";
import { LOCK_REL, serializeLock } from "../compiled-lock.ts";
import { readZonesFrom, type ZoneInfo } from "../init.ts";
import type { MaterializeDeps, MaterializeFs } from "../materialize.ts";
import { ensureTree, pruneTrees, treeDir, type RenderStamp } from "../render-cache.ts";
import { seedTwoVerbPack, setTwoVerbPackVersion } from "./helpers.ts";

const realFs: MaterializeFs = {
  exists: existsSync,
  readFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  writeFile: (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); },
  mkdirp: (p) => mkdirSync(p, { recursive: true }),
  readDir: (p) => (existsSync(p) ? readdirSync(p) : []),
  rename: renameSync,
};

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** An acme org clone whose widgets team carries the two-verb pack, bound by its own fragment. */
function world() {
  const { packDir: seeded, flags } = seedTwoVerbPack(made);
  const mattstackDir = flags[flags.indexOf("--mattstack-dir") + 1]!;
  const manifest = flags[flags.indexOf("--manifest") + 1]!;
  const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-render-cache-")));
  made.push(home);
  const mattstackRoot = join(home, ".mattstack");
  const orgDir = join(mattstackRoot, "orgs", "acme");
  write(join(orgDir, ".git", "config"), "");
  write(join(orgDir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme", layout: ORG_LAYOUT }));
  write(join(orgDir, "mattstack", "org", "settings.org.jsonc"), JSON.stringify({ "board.gitlabHost": "https://gitlab.example.com", "board.projects": ["acme/widgets"] }));
  const teamDir = join(orgDir, "mattstack", "teams", "widgets");
  write(join(teamDir, "settings.team.jsonc"), "{}");
  const packDir = join(teamDir, "plugin");
  cpSync(seeded, packDir, { recursive: true });
  write(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ bindings: JSON.parse(readFileSync(manifest, "utf8")).bindings }));
  const enginePackDir = join(home, "engine");
  mkdirSync(enginePackDir, { recursive: true });
  const deps: MaterializeDeps = { fs: realFs, mattstackRoot, enginePackDir };
  const zone: ZoneInfo = readZonesFrom(realFs, join(mattstackRoot, "orgs")).find((z) => z.team === "widgets")!;
  const root = join(mattstackRoot, "rt", "rendered");
  const opts = { root, zone, pack: "widgets", installedVersion: "0.4.11", mattstack: "1.0.0", rtBuild: "rt-1", deps, mattstackDir };
  return { packDir, root, opts };
}

const stampOf = (dir: string): RenderStamp => JSON.parse(readFileSync(join(dir, "render.json"), "utf8"));
const siblingsOf = (dir: string) => readdirSync(dirname(dir));

describe("ensureTree", () => {
  test("renders a missing tree when the clone holds the installed version", async () => {
    const w = world();
    const result = await ensureTree(w.opts);
    if (!result.ok) throw new Error(result.message);
    expect(result.rendered).toBe(true);
    expect(result.dir).toBe(treeDir(w.root, "acme", "acme", "0.4.11", "1.0.0"));
    expect(readFileSync(join(result.dir, "skills", "alpha", "SKILL.md"), "utf8")).toContain("Do alpha.");
    expect(stampOf(result.dir)).toEqual(result.stamp);
    expect(result.stamp).toMatchObject({ rtBuild: "rt-1", mattstack: "1.0.0" });

    const again = await ensureTree(w.opts);
    expect(again.ok && again.rendered).toBe(false);
  });

  test("re-renders when inputHash differs", async () => {
    const w = world();
    const first = await ensureTree(w.opts);
    if (!first.ok) throw new Error(first.message);
    const fill = join(w.packDir, "attachments", "policy", "SKILL.md");
    writeFileSync(fill, readFileSync(fill, "utf8") + "\nOne more rule.\n");
    const second = await ensureTree(w.opts);
    if (!second.ok) throw new Error(second.message);
    expect(second.rendered).toBe(true);
    expect(second.stamp.inputHash).not.toBe(first.stamp.inputHash);
    expect(readFileSync(join(second.dir, "skills", "alpha", "SKILL.md"), "utf8")).toContain("One more rule.");
  });

  test("re-renders when rtBuild differs", async () => {
    const w = world();
    await ensureTree(w.opts);
    const second = await ensureTree({ ...w.opts, rtBuild: "rt-2" });
    if (!second.ok) throw new Error(second.message);
    expect(second.rendered).toBe(true);
    expect(stampOf(second.dir).rtBuild).toBe("rt-2");
  });

  test("uses an existing tree as is when the clone is ahead", async () => {
    const w = world();
    const first = await ensureTree(w.opts);
    if (!first.ok) throw new Error(first.message);
    setTwoVerbPackVersion(w.packDir, "0.4.12");
    const fill = join(w.packDir, "attachments", "policy", "SKILL.md");
    writeFileSync(fill, readFileSync(fill, "utf8") + "\nOne more rule.\n");
    const second = await ensureTree({ ...w.opts, rtBuild: "rt-2" });
    if (!second.ok) throw new Error(second.message);
    expect(second.rendered).toBe(false);
    expect(second.dir).toBe(first.dir);
    expect(second.stamp).toEqual(first.stamp);
  });

  test("reports missing when the clone is ahead and no tree exists", async () => {
    const w = world();
    setTwoVerbPackVersion(w.packDir, "0.4.12");
    const result = await ensureTree(w.opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing");
  });

  test("two concurrent ensureTree calls both return a whole tree and leave no temp folder", async () => {
    const w = world();
    const [a, b] = await Promise.all([ensureTree(w.opts), ensureTree(w.opts)]);
    if (!a.ok || !b.ok) throw new Error("a render failed");
    expect([a.rendered, b.rendered].filter(Boolean)).toHaveLength(1);
    expect(a.dir).toBe(b.dir);
    expect(a.stamp).toEqual(b.stamp);
    expect(existsSync(join(a.dir, "skills", "beta", "SKILL.md"))).toBe(true);
    expect(siblingsOf(a.dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });

  test("render-failed carries builtWith from the pack lock", async () => {
    const w = world();
    write(join(w.packDir, LOCK_REL), serializeLock({ targets: {}, bases: {}, mattstackSha: {}, mattstackDirty: {}, builtWith: "0.40.0" }));
    write(join(w.packDir, "pack", "skills.jsonc"), JSON.stringify({ bindings: { "mattstack:alpha": { domain: "acme:nope" } } }));
    const result = await ensureTree(w.opts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("render-failed");
    expect(result.builtWith).toBe("0.40.0");
    expect(existsSync(treeDir(w.root, "acme", "acme", "0.4.11", "1.0.0"))).toBe(false);
    expect(readdirSync(join(w.root, "acme", "acme", "0.4.11")).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });
});

describe("pruneTrees", () => {
  test("pruneTrees keeps 3 pack versions × 2 mattstack versions and the installed pair", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-render-prune-")));
    made.push(root);
    const packVersions = ["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.10"];
    const mattstacks = ["0.32.1", "0.32.2", "0.32.10"];
    for (const pv of packVersions) for (const ms of mattstacks) write(join(treeDir(root, "acme", "widgets", pv, ms), "render.json"), "{}");

    pruneTrees(root, "acme", "widgets", { installedVersion: "1.0.0", mattstack: "0.32.1" });

    const left = Object.fromEntries(readdirSync(join(root, "acme", "widgets")).sort().map((pv) => [pv, readdirSync(join(root, "acme", "widgets", pv)).sort()]));
    expect(left).toEqual({
      "1.0.0": ["0.32.1"],
      "1.0.10": ["0.32.10", "0.32.2"],
      "1.0.2": ["0.32.10", "0.32.2"],
      "1.0.3": ["0.32.10", "0.32.2"],
    });
  });
});
