import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { RunResult } from "../../subprocess.ts";
import { readPending } from "../team-pending.ts";

const TEAM_STORE = "mattstack/teams/widgets/settings.team.jsonc";
const ORG_STORE = "mattstack/org/settings.org.jsonc";
const ORIGIN = "refs/remotes/origin/mattstack";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Clone {
  /** Working-tree files, written to disk. */
  files?: Record<string, string>;
  /** `git status --porcelain=v1 -uall -z` output. */
  status?: string;
  /** Paths changed in commits ahead of origin. */
  ahead?: string[];
  /** Files at origin's tip. */
  origin?: Record<string, string>;
  /** False when origin has no copy of the branch. */
  hasOrigin?: boolean;
  /** Files at the merge-base with origin; origin's tip when left out. */
  base?: Record<string, string>;
}

function clone(opts: Clone) {
  const repoDir = mkdtempSync(join(tmpdir(), "rt-team-pending-"));
  dirs.push(repoDir);
  for (const [path, text] of Object.entries(opts.files ?? {})) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  const calls: string[][] = [];
  const ok = (stdout: string): RunResult => ({ stdout, stderr: "", exitCode: 0 });
  const exec = async (argv: [string, ...string[]]): Promise<RunResult> => {
    calls.push([...argv]);
    const [, verb, ...rest] = argv;
    if (verb === "symbolic-ref") return ok("mattstack\n");
    if (verb === "rev-parse") return opts.hasOrigin === false ? { stdout: "", stderr: "", exitCode: 1 } : ok("abc\n");
    if (verb === "status") return ok(opts.status ?? "");
    if (verb === "diff") return ok((opts.ahead ?? []).map((p) => `${p}\0`).join(""));
    if (verb === "merge-base") return ok("base\n");
    if (verb === "show") {
      const ref = rest[0]!.slice(0, rest[0]!.indexOf(":"));
      const path = rest[0]!.slice(rest[0]!.indexOf(":") + 1);
      const text = (ref === "base" ? (opts.base ?? opts.origin) : opts.origin)?.[path];
      return text === undefined ? { stdout: "", stderr: `fatal: path '${path}' does not exist`, exitCode: 128 } : ok(text);
    }
    return ok("");
  };
  return { repoDir, exec, calls };
}

const none = { unowned: [], heldBack: [], packZones: [] };

describe("readPending", () => {
  test("maps a changed team store to its keys", async () => {
    const c = clone({
      files: { [TEAM_STORE]: `{"board.slack": {"channel": "#new"}}` },
      origin: { [TEAM_STORE]: `{"board.slack": {"channel": "#old"}}` },
      status: ` M ${TEAM_STORE}\0`,
    });
    expect(await readPending(c.repoDir, c.exec, none)).toEqual([
      { store: "team:widgets", key: "board.slack", change: "changed" },
    ]);
  });

  test("maps an org store change", async () => {
    const c = clone({
      files: { [ORG_STORE]: `{"a": 1, "repos": {"gh/acme/web": {"x": 2}}}` },
      origin: { [ORG_STORE]: `{"repos": {"gh/acme/web": {"x": 1}}}` },
      status: ` M ${ORG_STORE}\0`,
    });
    expect(await readPending(c.repoDir, c.exec, none)).toEqual([
      { store: "org", key: "a", change: "added" },
      { store: "org", repo: "gh/acme/web", key: "x", change: "changed" },
    ]);
  });

  test("counts commits ahead of origin, not just the working tree", async () => {
    const c = clone({
      files: { [TEAM_STORE]: `{"k": 2}` },
      origin: { [TEAM_STORE]: `{"k": 1}` },
      ahead: [TEAM_STORE],
    });
    expect(await readPending(c.repoDir, c.exec, none)).toEqual([{ store: "team:widgets", key: "k", change: "changed" }]);
    expect(c.calls.some((a) => a[1] === "diff" && a.includes(`${ORIGIN}...HEAD`))).toBe(true);
  });

  test("leaves out paths this Mac may not push", async () => {
    const c = clone({
      files: { [ORG_STORE]: `{"a": 2}`, ".sops.yaml": "x" },
      origin: { [ORG_STORE]: `{"a": 1}` },
      status: ` M ${ORG_STORE}\0?? .sops.yaml\0`,
    });
    expect(await readPending(c.repoDir, c.exec, { unowned: [ORG_STORE], heldBack: [], packZones: [] })).toEqual([{ path: ".sops.yaml" }]);
  });

  test("marks a held-back marketplace path", async () => {
    const c = clone({ status: " M .claude-plugin/marketplace.json\0" });
    expect(await readPending(c.repoDir, c.exec, { unowned: [], heldBack: [".claude-plugin/marketplace.json"], packZones: [] })).toEqual([
      { path: ".claude-plugin/marketplace.json", heldBack: true },
    ]);
  });

  test("leaves out pack folders, which publish only through skills sync", async () => {
    const c = clone({
      status: "?? mattstack/teams/widgets/plugin/skills/a/SKILL.md\0 M mattstack/org/packs/base/x.md\0 M .sops.yaml\0",
      ahead: ["mattstack/teams/widgets/plugin/compiled.json"],
    });
    const opts = { unowned: [], heldBack: [], packZones: ["mattstack/teams/widgets/plugin/", "mattstack/org/packs/"] };
    expect(await readPending(c.repoDir, c.exec, opts)).toEqual([{ path: ".sops.yaml" }]);
  });

  test("a key origin changed after this clone forked is not waiting", async () => {
    const c = clone({
      files: { [TEAM_STORE]: `{"k": 2}` },
      base: { [TEAM_STORE]: `{"k": 1}` },
      origin: { [TEAM_STORE]: `{"k": 1, "upstream": true}` },
      status: ` M ${TEAM_STORE}\0`,
    });
    expect(await readPending(c.repoDir, c.exec, none)).toEqual([{ store: "team:widgets", key: "k", change: "changed" }]);
  });

  test("nothing waiting reads as an empty list", async () => {
    const c = clone({});
    expect(await readPending(c.repoDir, c.exec, none)).toEqual([]);
  });

  test("a path outside the managed roots is not waiting", async () => {
    const c = clone({ status: "?? notes.txt\0" });
    expect(await readPending(c.repoDir, c.exec, none)).toEqual([]);
  });

  test("a branch origin does not have compares against nothing", async () => {
    const c = clone({ files: { [TEAM_STORE]: `{"k": 1}` }, hasOrigin: false, ahead: [TEAM_STORE] });
    expect(await readPending(c.repoDir, c.exec, none)).toEqual([{ store: "team:widgets", key: "k", change: "added" }]);
    expect(c.calls.some((a) => a[1] === "show")).toBe(false);
  });

  test("a git failure throws", async () => {
    const c = clone({});
    const failing = async (argv: [string, ...string[]]): Promise<RunResult> =>
      argv[1] === "status" ? { stdout: "", stderr: "fatal: index locked", exitCode: 128 } : c.exec(argv);
    await expect(readPending(c.repoDir, failing, none)).rejects.toThrow();
  });
});
