import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { classifyCommits, CLASSIFY_RULE, isVersionOnly, maskStamps } from "../history-classify.ts";
import { __test__ as warnTest } from "../../ui/warn.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";

const PACK = "teams/acme/plugin";

let repo: string;
let scratch: string;
let cachePath: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: repo }).toString().trim();
}

function put(rel: string, text: string): void {
  const file = join(repo, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function commit(message: string, ...extra: string[]): string {
  git("add", "-A");
  git("commit", "-q", "-m", message, ...extra);
  return git("rev-parse", "HEAD");
}

type Stamps = { mattstack: string; pack: string; base: string; sha: string; dirty: string; packSha: string; body?: string };

function skillMd(s: Stamps): string {
  return [
    "---",
    "name: work",
    "metadata:",
    `  compiled: "mattstack@${s.mattstack} + acme:goal@${s.pack} + acme-base:review@${s.base}"`,
    "---",
    "",
    `Pointers here are \`@keys\`. Resolve them once per run: if you already hold a \`skills_resolve\` map that covers \`acme@${s.pack}:work\`, use it; otherwise call \`skills_resolve {id: "acme@${s.pack}:work"}\` and use the path it returns for each key, in anything you hand a subagent or a tool too. If it fails, stop and say so; never look for the file another way.`,
    "",
    `<!-- part: include:gate source=mattstack:gate version=${s.mattstack} lines=10-11 -->`,
    s.body ?? "Ask the gate before you push.",
    "Wait for the answer.",
    "",
    "```bash",
    `rt run start --repo acme --work-type work --pipeline work --mattstack-sha ${s.sha} --mattstack-dirty ${s.dirty} --pack-sha ${s.packSha}`,
    "```",
    "",
    `<!-- part: prop:review binding=acme-base:review version=${s.base} lines=18-18 -->`,
    `For review, invoke the \`acme-base:review\` skill (acme-base:review@${s.base}) when this flow needs it.`,
    "",
  ].join("\n");
}

function unitMap(pack: string): string {
  return JSON.stringify({ id: `acme@${pack}:work`, dir: "skills/work", covers: [`acme@${pack}:work`, `acme@${pack}:stage-plan`], keys: { "work/SKILL.md": "skills/work/SKILL.md" } }, null, 2) + "\n";
}

function baseCopy(base: string): string {
  return JSON.stringify({ base: "acme-base", version: base, files: ["SKILL.md"] }, null, 2) + "\n";
}

function pluginJson(version: string): string {
  return JSON.stringify({ name: "acme", version, description: "The acme pack" }, null, 2) + "\n";
}

function lock(pack: string, sha: string): string {
  return JSON.stringify({ targets: { "skills/work": { mattstack: "0.32.56", acme: pack } }, bases: { "acme-base": "0.2.3" }, mattstackSha: { "skills/work": sha }, mattstackDirty: {} }, null, 2) + "\n";
}

const V1: Stamps = { mattstack: "0.32.55", pack: "0.4.11", base: "0.2.3", sha: "abc1234", dirty: "0", packSha: "def5678" };

function seed(): string {
  put(`${PACK}/skills/work/SKILL.md`, skillMd(V1));
  put(`${PACK}/skills/work/compiled.json`, unitMap(V1.pack));
  put(`${PACK}/attachments/review/compiled.json`, baseCopy(V1.base));
  put(`${PACK}/.claude-plugin/plugin.json`, pluginJson(V1.pack));
  put(`${PACK}/pack/requires.json`, `{ "minEngine": "0.32.55" }\n`);
  put(`${PACK}/pack/compiled.lock.json`, lock(V1.pack, "abc1234"));
  put(`${PACK}/fills/goal.md`, "Ship the widget.\n");
  put("teams/acme-base/plugin/fills/review.md", "Review every change.\n");
  return commit("seed");
}

const classify = (...shas: string[]) => classifyCommits(repo, shas, cachePath);

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "rt-history-classify-")));
  repo = join(scratch, "org");
  mkdirSync(repo);
  cachePath = join(scratch, "cache", "history-classify", "remote:example.com%2Facme%2Forg.json");
  git("init", "-q", "-b", "main");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("classifyCommits", () => {
  test("a sync commit that only moved versions is version-only", () => {
    seed();
    const v2 = { ...V1, mattstack: "0.32.56", pack: "0.4.12", packSha: "0123abc" };
    put(`${PACK}/skills/work/SKILL.md`, skillMd(v2));
    put(`${PACK}/skills/work/compiled.json`, unitMap(v2.pack));
    put(`${PACK}/.claude-plugin/plugin.json`, pluginJson(v2.pack));
    const sha = commit("skills sync: acme v0.4.12");
    expect(classify(sha)).toEqual([sha]);
  });

  test("a bump-only commit is version-only", () => {
    seed();
    put(`${PACK}/.claude-plugin/plugin.json`, pluginJson("0.4.12"));
    put(`${PACK}/pack/requires.json`, `{ "minEngine": "0.32.56" }\n`);
    const sha = commit("bump");
    expect(classify(sha)).toEqual([sha]);
  });

  test("a compile-only commit that changed only stamps is version-only", () => {
    seed();
    put(`${PACK}/skills/work/SKILL.md`, skillMd({ ...V1, base: "0.2.4", sha: "9999999" }));
    put(`${PACK}/attachments/review/compiled.json`, baseCopy("0.2.4"));
    const sha = commit("compile");
    expect(classify(sha)).toEqual([sha]);
  });

  test("a dirty-bit-only change is version-only", () => {
    seed();
    put(`${PACK}/skills/work/SKILL.md`, skillMd({ ...V1, dirty: "1" }));
    const sha = commit("dirty");
    expect(classify(sha)).toEqual([sha]);
  });

  test("a lock-only commit is version-only", () => {
    seed();
    put(`${PACK}/pack/compiled.lock.json`, lock("0.4.12", "fedcba9"));
    const sha = commit("lock");
    expect(classify(sha)).toEqual([sha]);
  });

  test("a commit that also edits a fill body is not", () => {
    seed();
    const v2 = { ...V1, pack: "0.4.12", body: "Ask the gate before you merge." };
    put(`${PACK}/skills/work/SKILL.md`, skillMd(v2));
    put(`${PACK}/skills/work/compiled.json`, unitMap(v2.pack));
    put(`${PACK}/.claude-plugin/plugin.json`, pluginJson(v2.pack));
    const inlined = commit("sync with an edit");
    put(`${PACK}/.claude-plugin/plugin.json`, pluginJson("0.4.13"));
    put(`${PACK}/fills/goal.md`, "Ship the widget today.\n");
    const fill = commit("fill and bump");
    expect(classify(inlined, fill)).toEqual([]);
  });

  test("a commit that edits only an org base file is not", () => {
    seed();
    put("teams/acme-base/plugin/fills/review.md", "Review every change twice.\n");
    const sha = commit("base edit");
    expect(classify(sha)).toEqual([]);
  });

  test("an added or deleted file is never version-only", () => {
    seed();
    put(`${PACK}/.claude-plugin/plugin.json`, pluginJson("0.4.12"));
    put(`${PACK}/skills/plan/compiled.json`, unitMap("0.4.12"));
    const added = commit("add");
    put(`${PACK}/.claude-plugin/plugin.json`, pluginJson("0.4.13"));
    unlinkSync(join(repo, `${PACK}/skills/plan/compiled.json`));
    const deleted = commit("delete");
    expect(classify(added, deleted)).toEqual([]);
  });

  test("a mode-only change is not version-only", () => {
    seed();
    chmodSync(join(repo, `${PACK}/fills/goal.md`), 0o755);
    const sha = commit("chmod");
    expect(classify(sha)).toEqual([]);
  });

  test("an empty commit is not version-only", () => {
    const root = seed();
    const empty = commit("empty", "--allow-empty");
    expect(classify(root, empty)).toEqual([]);
  });

  test("a merge is not version-only", () => {
    seed();
    git("checkout", "-q", "-b", "side");
    put(`${PACK}/pack/compiled.lock.json`, lock("0.4.12", "fedcba9"));
    commit("side lock");
    git("checkout", "-q", "main");
    put(`${PACK}/.claude-plugin/plugin.json`, pluginJson("0.4.12"));
    commit("main bump");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "merge", "-q", "--no-edit", "side");
    expect(classify(git("rev-parse", "HEAD"))).toEqual([]);
  });

  test("a cached sha is answered without git, and a new rule ignores the cache", () => {
    seed();
    put(`${PACK}/.claude-plugin/plugin.json`, pluginJson("0.4.12"));
    const bump = commit("bump");
    put(`${PACK}/fills/goal.md`, "Ship the widget today.\n");
    const edit = commit("edit");

    expect(classify(bump, edit)).toEqual([bump]);
    expect(JSON.parse(readFileSync(cachePath, "utf8"))).toEqual({ rule: CLASSIFY_RULE, shas: { [bump]: true, [edit]: false } });

    rmSync(join(repo, ".git"), { recursive: true, force: true });
    expect(classify(bump, edit)).toEqual([bump]);

    git("init", "-q", "-b", "main");
    seed();
    put(`${PACK}/.claude-plugin/plugin.json`, pluginJson("0.4.12"));
    const fresh = commit("bump");
    put(`${PACK}/fills/goal.md`, "Ship the widget today.\n");
    const freshEdit = commit("edit");
    writeFileSync(cachePath, JSON.stringify({ rule: CLASSIFY_RULE - 1, shas: { [fresh]: false, [freshEdit]: true } }));
    expect(classify(fresh, freshEdit)).toEqual([fresh]);
    expect(JSON.parse(readFileSync(cachePath, "utf8"))).toEqual({ rule: CLASSIFY_RULE, shas: { [fresh]: true, [freshEdit]: false } });
  });

  test("a short sha answers as given and caches under the full oid", () => {
    seed();
    put(`${PACK}/.claude-plugin/plugin.json`, pluginJson("0.4.12"));
    const full = commit("bump");
    const short = full.slice(0, 7);
    expect(classify(short)).toEqual([short]);
    expect(JSON.parse(readFileSync(cachePath, "utf8")).shas).toEqual({ [full]: true });
  });

  test("a cache that cannot be written still answers, and warns", () => {
    seed();
    put(`${PACK}/.claude-plugin/plugin.json`, pluginJson("0.4.12"));
    const sha = commit("bump");
    writeFileSync(join(scratch, "cache"), "a file where the folder should be");
    warnTest.reset();
    const cap = captureOut();
    try {
      expect(classify(sha)).toEqual([sha]);
      expect(cap.stderr()).toContain("could not save the history classify cache");
    } finally {
      cap.restore();
      warnTest.reset();
    }
  });

  test("a sha git cannot read is not version-only and is not cached", () => {
    seed();
    const missing = "0".repeat(40);
    expect(classify(missing)).toEqual([]);
    expect(existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")).shas : {}).toEqual({});
  });
});

describe("maskStamps", () => {
  test("masks every old stamp shape in compiled markdown", () => {
    const a = maskStamps(`${PACK}/skills/work/SKILL.md`, skillMd(V1));
    const b = maskStamps(`${PACK}/skills/work/SKILL.md`, skillMd({ mattstack: "1.0.0", pack: "2.0.0", base: "3.0.0", sha: "aaaaaaa", dirty: "1", packSha: "bbbbbbb" }));
    expect(a).toBe(b);
  });

  test("leaves a body edit visible", () => {
    const path = `${PACK}/skills/work/SKILL.md`;
    expect(maskStamps(path, skillMd(V1))).not.toBe(maskStamps(path, skillMd({ ...V1, body: "Something else." })));
  });

  test("a changed lines= span, source= or binding= stays real", () => {
    const path = `${PACK}/skills/work/SKILL.md`;
    const md = skillMd(V1);
    for (const edited of [
      md.replace("lines=10-11", "lines=10-12"),
      md.replace("source=mattstack:gate", "source=mattstack:gate-v2"),
      md.replace("binding=acme-base:review", "binding=acme-base:review-lite"),
    ]) expect(maskStamps(path, edited)).not.toBe(maskStamps(path, md));
  });

  test("a reference parenthetical that is not <binding>@<version> stays real", () => {
    const path = `${PACK}/skills/work/SKILL.md`;
    const line = (paren: string) => `For review, invoke the \`acme-base:review\` skill (${paren}) when this flow needs it.\n`;
    expect(maskStamps(path, line("acme-base:review@0.2.3"))).toBe(maskStamps(path, line("acme-base:review@0.2.4")));
    expect(maskStamps(path, line("optional"))).not.toBe(maskStamps(path, line("required")));
    expect(maskStamps(path, line("acme-base:other@0.2.3"))).not.toBe(maskStamps(path, line("acme-base:review@0.2.3")));
  });

  test("a covers entry added or removed in compiled.json stays real", () => {
    const path = `${PACK}/skills/work/compiled.json`;
    const map = unitMap("0.4.11");
    const added = map.replace(`"acme@0.4.11:stage-plan"`, `"acme@0.4.12:stage-plan",\n    "acme@0.4.12:stage-ship"`);
    const removed = map.replace(`,\n    "acme@0.4.11:stage-plan"`, "");
    expect(maskStamps(path, map)).toBe(maskStamps(path, unitMap("0.4.12")));
    expect(maskStamps(path, added)).not.toBe(maskStamps(path, map));
    expect(maskStamps(path, removed)).not.toBe(maskStamps(path, map));
  });

  test("a requires.json field other than minEngine stays real", () => {
    const path = `${PACK}/pack/requires.json`;
    expect(maskStamps(path, `{ "minEngine": "1.0.0", "maxEngine": "2.0.0" }\n`)).not.toBe(maskStamps(path, `{ "minEngine": "1.0.0", "maxEngine": "3.0.0" }\n`));
  });

  test("a nested version inside plugin.json stays real", () => {
    const path = `${PACK}/.claude-plugin/plugin.json`;
    const manifest = (nested: string) => JSON.stringify({ name: "acme", version: "0.4.11", engines: { version: nested } }, null, 2) + "\n";
    expect(maskStamps(path, manifest("1.0.0"))).not.toBe(maskStamps(path, manifest("2.0.0")));
    const reordered = JSON.stringify({ version: "0.4.12", name: "acme", engines: { version: "1.0.0" } }, null, 2) + "\n";
    expect(maskStamps(path, reordered)).not.toBe(maskStamps(path, manifest("1.0.0")));
  });

  test("masks the lock to a constant", () => {
    expect(maskStamps(`${PACK}/pack/compiled.lock.json`, lock("1", "a"))).toBe(maskStamps(`${PACK}/pack/compiled.lock.json`, "{}"));
  });

  test("masks only the version of plugin.json and only minEngine of requires.json", () => {
    const manifest = `${PACK}/.claude-plugin/plugin.json`;
    expect(maskStamps(manifest, pluginJson("1.0.0"))).toBe(maskStamps(manifest, pluginJson("2.0.0")));
    expect(maskStamps(manifest, pluginJson("1.0.0"))).not.toBe(maskStamps(manifest, pluginJson("1.0.0").replace("The acme pack", "Another")));
    const requires = `${PACK}/pack/requires.json`;
    expect(maskStamps(requires, `{ "minEngine": "1.0.0" }\n`)).toBe(maskStamps(requires, `{ "minEngine": "2.0.0" }\n`));
  });

  test("a version line in a fill body is not a stamp", () => {
    const fill = `${PACK}/fills/goal.md`;
    expect(maskStamps(fill, `"version": "1.0.0"\n`)).not.toBe(maskStamps(fill, `"version": "2.0.0"\n`));
    expect(maskStamps(fill, "use acme@1.0.0:work\n")).not.toBe(maskStamps(fill, "use acme@2.0.0:work\n"));
  });
});

describe("isVersionOnly", () => {
  test("needs at least one change, each present on both sides", () => {
    expect(isVersionOnly([])).toBe(false);
    expect(isVersionOnly([{ path: "a", before: null, after: "x" }])).toBe(false);
    expect(isVersionOnly([{ path: "a", before: "x", after: null }])).toBe(false);
    expect(isVersionOnly([{ path: `${PACK}/pack/compiled.lock.json`, before: "{}", after: "{ }" }])).toBe(true);
  });
});
