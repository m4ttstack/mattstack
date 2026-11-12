/**
 * mr:describe-with-attachments: the daemon stages each checked attachment and
 * the description in one folder and runs `gh pr edit --body-file --attach`
 * there, with the GitHub token only in gh's environment, then reads the PR
 * back to pair each `./<name>` reference with the URL gh put in its place.
 * gh here is a shell script each test writes; nothing reaches a forge.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { bucketFor } from "../../evidence/refusal-buckets.ts";
import { runStart } from "../../runs/start.ts";
import { fieldSet, openRunDb } from "../../runs/write.ts";
import { closeStateDb } from "../../state/index.ts";
import { createMrUploadHandlers, readPrBody, type MrUploadSeams } from "../handlers/mr-upload.ts";

const REPO = "remote:github.com%2Facme%2Fweb";
const TOKEN = "ghs_secret_token_123";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const OLD_BODY = "the PR's earlier description\n";
const url = (n: number) => `https://github.com/user-attachments/assets/${n}`;

type GhScript = {
  version?: string;
  exit?: number;
  stderr?: string;
  /** Each name's `./<name>` destination in the server body becomes url(n). */
  rewrite?: Record<string, number>;
  appendRef?: boolean;
  appendText?: boolean;
  sleep?: boolean;
};

describe("mr:describe-with-attachments", () => {
  const origHome = process.env.HOME;
  let home: string;
  let repoPath: string;
  let elsewhere: string;
  let stage: string;
  let logDir: string;
  let binDir: string;
  let server: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-describe-home-")));
    process.env.HOME = home;
    closeStateDb();
    repoPath = realpathSync(mkdtempSync(join(tmpdir(), "rt-describe-repo-")));
    elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "rt-describe-else-")));
    stage = mkdtempSync(join(tmpdir(), "rt-describe-stage-"));
    logDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-describe-log-")));
    binDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-describe-bin-")));
    server = join(logDir, "server.md");
    writeFileSync(server, OLD_BODY);
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    for (const d of [home, repoPath, elsewhere, stage, logDir, binDir]) rmSync(d, { recursive: true, force: true });
  });

  function png(dir: string, name: string, tail = name): string {
    const p = join(dir, name);
    writeFileSync(p, Buffer.concat([PNG, Buffer.from(tail)]));
    return p;
  }

  function fakeGh(s: GhScript = {}): string {
    const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
    const seds = Object.entries(s.rewrite ?? {})
      .map(([name, n]) => `-e ${q(`s#](\\./${name.replace(/\./g, "\\.")})#](${url(n)})#g`)}`)
      .join(" ");
    const lines = [
      "#!/bin/sh",
      `LOG=${q(logDir)}`,
      `if [ "$1" = "--version" ]; then echo ${q(`gh version ${s.version ?? "2.103.3"} (2026-10-01)`)}; exit 0; fi`,
      `printf '%s\\n' "$@" > "$LOG/argv"`,
      `env > "$LOG/env"`,
      `pwd > "$LOG/pwd"`,
      `prev=""; body=""; n=0`,
      `for a in "$@"; do`,
      `  if [ "$prev" = "--body-file" ]; then body="$a"; fi`,
      `  if [ "$prev" = "--attach" ]; then n=$((n+1)); cp "$a" "$LOG/staged-$n"; fi`,
      `  prev="$a"`,
      `done`,
      `cp "$body" "$LOG/body.md"`,
      `DIR=$(dirname "$body")`,
    ];
    if (s.sleep) lines.push("exec sleep 5");
    if (s.rewrite) lines.push(`sed ${seds} "$body" > "$LOG/server.md"`);
    if (s.appendText) lines.push(`printf '%s\n' 'a plain line with no link' >> "$LOG/server.md"`);
    if (s.appendRef) lines.push(`printf '%s\\n' '- Extra: ![x](https://example.com/x.png)' >> "$LOG/server.md"`);
    if (s.stderr) lines.push(`printf '%s\\n' "${s.stderr}" >&2`);
    lines.push(`exit ${s.exit ?? 0}`);
    const path = join(binDir, "gh");
    writeFileSync(path, lines.join("\n") + "\n");
    chmodSync(path, 0o755);
    return path;
  }

  function harness(overrides: Partial<MrUploadSeams> & { gh?: GhScript } = {}) {
    const reads: number[] = [];
    const gh = fakeGh(overrides.gh);
    const seams: MrUploadSeams = {
      ghBinary: () => gh,
      githubToken: async () => TOKEN,
      githubContext: async () => ({
        projectPath: "acme/web",
        readBody: async (iid: number) => {
          reads.push(iid);
          return readFileSync(server, "utf8");
        },
      }),
      stagingRoot: () => stage,
      isGitHub: async () => true,
      worktreePaths: () => [],
      uploadRoots: () => [],
      tempRoots: () => [],
      ...overrides,
    };
    const ctx = {
      repoIndex: () => ({ [REPO]: repoPath }),
      log: { warn() {}, info() {}, debug() {}, error() {} } as any,
    };
    return { handlers: createMrUploadHandlers(ctx, seams), reads };
  }

  const DESC = "## Evidence\n\n- Board: ![board](./1-board.png)\n- Shot: ![shot](./2-shot.png)\n";

  function twoFiles() {
    const board = png(repoPath, "board.png");
    const shot = png(repoPath, "shot.png");
    return { board, shot, attachments: [{ path: board, name: "1-board.png" }, { path: shot, name: "2-shot.png" }] };
  }

  const ran = () => existsSync(join(logDir, "argv"));
  const stagedLeft = () => readdirSync(stage).filter((e) => e.startsWith("rt-gh-attach-"));
  const loggedDir = () => readFileSync(join(logDir, "pwd"), "utf8").trim();

  test("runs gh pr edit with the body file and one --attach per file, in the staging folder", async () => {
    const { board, shot, attachments } = twoFiles();
    const h = harness({ gh: { rewrite: { "1-board.png": 1, "2-shot.png": 2 } } });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    expect(res.ok).toBe(true);
    const dir = loggedDir();
    expect(dir.startsWith(realpathSync(stage) + "/")).toBe(true);
    const argv = readFileSync(join(logDir, "argv"), "utf8").trimEnd().split("\n");
    expect(argv).toEqual(["pr", "edit", "7", "--repo", "github.com/acme/web", "--body-file", `${dir}/body.md`, "--attach", `${dir}/1-board.png`, "--attach", `${dir}/2-shot.png`]);
    expect(readFileSync(join(logDir, "body.md"), "utf8")).toBe(DESC);
    expect(readFileSync(join(logDir, "staged-1")).equals(readFileSync(board))).toBe(true);
    expect(readFileSync(join(logDir, "staged-2")).equals(readFileSync(shot))).toBe(true);
  });

  test("gives gh only PATH, HOME, GH_TOKEN and GH_PROMPT_DISABLED, and the token never in argv", async () => {
    const { attachments } = twoFiles();
    const h = harness({ gh: { rewrite: { "1-board.png": 1, "2-shot.png": 2 } } });
    await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    const env = Object.fromEntries(readFileSync(join(logDir, "env"), "utf8").trimEnd().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    const keys = Object.keys(env).filter((k) => !["PWD", "SHLVL", "_", "OLDPWD"].includes(k)).sort();
    expect(keys).toEqual(["GH_PROMPT_DISABLED", "GH_TOKEN", "HOME", "PATH"]);
    expect(env.GH_TOKEN).toBe(TOKEN);
    expect(env.GH_PROMPT_DISABLED).toBe("1");
    expect(readFileSync(join(logDir, "argv"), "utf8")).not.toContain(TOKEN);
  });

  test("answers written with each file's URL when gh exits 0", async () => {
    const { board, shot, attachments } = twoFiles();
    const h = harness({ gh: { rewrite: { "1-board.png": 1, "2-shot.png": 2 } } });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    expect(res).toEqual({ ok: true, data: { outcome: "ran", written: true, urls: { [board]: url(1), [shot]: url(2) } } });
    expect(h.reads).toEqual([7, 7]);
  });

  test("two files with the same basename get their own names and their own URLs", async () => {
    mkdirSync(join(repoPath, "case-a"));
    mkdirSync(join(repoPath, "case-b"));
    const a = png(join(repoPath, "case-a"), "board.png", "a");
    const b = png(join(repoPath, "case-b"), "board.png", "b");
    const description = "- A: ![a](./1-board.png)\n- B: ![b](./2-board.png)\n";
    const h = harness({ gh: { rewrite: { "1-board.png": 11, "2-board.png": 22 } } });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description, attachments: [{ path: a, name: "1-board.png" }, { path: b, name: "2-board.png" }] });
    expect(res).toEqual({ ok: true, data: { outcome: "ran", written: true, urls: { [a]: url(11), [b]: url(22) } } });
  });

  test("a partial upload returns the uploaded URL, written, and a ghError naming the file without the staging folder", async () => {
    const { board, attachments } = twoFiles();
    const h = harness({ gh: { rewrite: { "1-board.png": 1 }, stderr: "could not upload $DIR/2-shot.png: rate limited; wait and try again", exit: 1 } });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    if (!res.ok || res.data.outcome !== "ran") throw new Error(JSON.stringify(res));
    expect(res.data.written).toBe(true);
    expect(res.data.urls).toEqual({ [board]: url(1) });
    expect(res.data.ghError).toContain("could not upload shot.png");
    expect(res.data.ghError).not.toContain("rt-gh-attach-");
    expect(res.data.uploadRejected ?? false).toBe(false);
  });

  test("a rejected upload is uploadRejected, unwritten, with no URLs", async () => {
    const { attachments } = twoFiles();
    const h = harness({ gh: { stderr: "could not upload $DIR/1-board.png: attaching files requires write access to the repository", exit: 1 } });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    if (!res.ok || res.data.outcome !== "ran") throw new Error(JSON.stringify(res));
    expect(res.data.written).toBe(false);
    expect(res.data.urls).toEqual({});
    expect(res.data.uploadRejected).toBe(true);
    expect(res.data.readBackError).toBeUndefined();
    expect(res.data.ghError).toContain("could not upload board.png: attaching files requires write access");
    expect(res.data.ghError).not.toContain("rt-gh-attach-");
  });

  test("uploads that land before a failed PR write are not written and not rejected", async () => {
    const { attachments } = twoFiles();
    const h = harness({ gh: { stderr: "HTTP 422: Validation Failed", exit: 1 } });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    if (!res.ok || res.data.outcome !== "ran") throw new Error(JSON.stringify(res));
    expect(res.data.written).toBe(false);
    expect(res.data.urls).toEqual({});
    expect(res.data.uploadRejected ?? false).toBe(false);
    expect(res.data.ghError).toBe("HTTP 422: Validation Failed");
    expect(res.data.readBackError).toBeUndefined();
  });

  test("a failed write over an earlier evidence section records no URL", async () => {
    const { attachments } = twoFiles();
    writeFileSync(server, DESC.replace("./1-board.png", "https://github.com/user-attachments/assets/old-1").replace("./2-shot.png", "https://github.com/user-attachments/assets/old-2"));
    const h = harness({ gh: { stderr: "HTTP 422: Validation Failed", exit: 1 } });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    if (!res.ok || res.data.outcome !== "ran") throw new Error(JSON.stringify(res));
    expect(res.data.written).toBe(false);
    expect(res.data.urls).toEqual({});
    expect(res.data.readBackError).toBeUndefined();
    expect(res.data.uploadRejected ?? false).toBe(false);
  });

  test("a PR that cannot be read before the write refuses before gh", async () => {
    const { attachments } = twoFiles();
    const h = harness({ githubContext: async () => ({ projectPath: "acme/web", readBody: async () => { throw new Error("GitHub said 502"); } }) });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("could not read PR #7 before the write: GitHub said 502");
    expect(ran()).toBe(false);
    expect(stagedLeft()).toEqual([]);
  });

  test("a body edited after the write records no URL", async () => {
    const { attachments } = twoFiles();
    const h = harness({ gh: { rewrite: { "1-board.png": 1, "2-shot.png": 2 }, appendRef: true } });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    if (!res.ok || res.data.outcome !== "ran") throw new Error(JSON.stringify(res));
    expect(res.data.written).toBe(true);
    expect(res.data.urls).toEqual({});
    expect(res.data.readBackError).toBe("the PR body changed after the write, so the image URLs were not recorded");
  });

  test("an exit 0 whose read-back equals the body before the write says why no URL was recorded", async () => {
    const { attachments } = twoFiles();
    const h = harness({ gh: {} });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    expect(res).toEqual({ ok: true, data: { outcome: "ran", written: true, urls: {}, readBackError: "the PR body came back without a hosted URL for 2 of 2 images, so those were not recorded" } });
  });

  test("an exit 0 that left one ./<name> in place records the other and says one is missing", async () => {
    const { board, attachments } = twoFiles();
    const h = harness({ gh: { rewrite: { "1-board.png": 1 } } });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    expect(res).toEqual({ ok: true, data: { outcome: "ran", written: true, urls: { [board]: url(1) }, readBackError: "the PR body came back without a hosted URL for 1 of 2 images, so those were not recorded" } });
  });

  test("a URL already in the body before the write is never recorded, even when the body changed", async () => {
    const { attachments } = twoFiles();
    writeFileSync(server, DESC.replace("./1-board.png", "https://github.com/user-attachments/assets/old-1").replace("./2-shot.png", "https://github.com/user-attachments/assets/old-2"));
    const h = harness({ gh: { appendText: true, stderr: "HTTP 422: Validation Failed", exit: 1 } });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    if (!res.ok || res.data.outcome !== "ran") throw new Error(JSON.stringify(res));
    expect(res.data.urls).toEqual({});
    expect(res.data.written).toBe(false);
  });

  test("a .png link to an .mp4 is refused as a change of extension, and gh never runs", async () => {
    const clip = join(repoPath, "clip.mp4");
    writeFileSync(clip, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(16)]));
    const link = join(repoPath, "shot.png");
    symlinkSync(clip, link);
    const h = harness();
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: "![s](./1-shot.png)", attachments: [{ path: link, name: "1-shot.png" }] });
    expect(res).toEqual({ ok: true, data: { outcome: "refused", refused: [{ path: link, error: `attachment 1-shot.png must keep the extension of ${clip}` }] } });
    expect(ran()).toBe(false);
  });

  // The write fails only past the host's path limit: 1024 bytes on macOS, 4096 on Linux.
  test("a staging write that fails is ok:false with no staging path, and the folder is removed", async () => {
    const target = process.platform === "darwin" ? 900 : 3960;
    let deep = stage;
    for (let len = realpathSync(stage).length; len < target; len = realpathSync(stage).length + (deep.length - stage.length)) {
      deep = join(deep, "d".repeat(Math.min(200, target - len - 1)));
    }
    mkdirSync(deep, { recursive: true });
    const board = png(repoPath, "board.png");
    const name = `1-${"a".repeat(122)}.png`;
    const h = harness({ stagingRoot: () => deep });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: `![b](./${name})`, attachments: [{ path: board, name }] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toStartWith("could not stage the attachments: ");
      expect(res.error).not.toContain("rt-gh-attach-");
      expect(res.error).not.toContain("ddd");
    }
    expect(readdirSync(deep).filter((e) => e.startsWith("rt-gh-attach-"))).toEqual([]);
    expect(ran()).toBe(false);
  });

  test("gh past the deadline is stopped and the staging folder removed", async () => {
    const { attachments } = twoFiles();
    const h = harness({ gh: { sleep: true }, ghTimeoutMs: 200 });
    const started = performance.now();
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    expect(performance.now() - started).toBeLessThan(3000);
    if (!res.ok || res.data.outcome !== "ran") throw new Error(JSON.stringify(res));
    expect(res.data.ghError).toContain("was stopped");
    expect(res.data.written).toBe(false);
    expect(stagedLeft()).toEqual([]);
    expect(h.reads).toEqual([7, 7]);
  });

  test("the staging folder is removed after success and after a refusal from gh", async () => {
    const { attachments } = twoFiles();
    await harness({ gh: { rewrite: { "1-board.png": 1, "2-shot.png": 2 } } }).handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    expect(ran()).toBe(true);
    expect(stagedLeft()).toEqual([]);
    rmSync(join(logDir, "argv"));
    await harness({ gh: { stderr: "HTTP 422: Validation Failed", exit: 1 } }).handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    expect(ran()).toBe(true);
    expect(stagedLeft()).toEqual([]);
  });

  test("refuses gh older than 2.99 and a missing gh, before any pr edit", async () => {
    const { attachments } = twoFiles();
    const old = harness({ gh: { version: "2.98.1" } });
    expect(await old.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments }))
      .toEqual({ ok: false, error: "gh 2.98.1 cannot attach images; it needs gh 2.99 or newer (run: brew upgrade gh)" });
    const none = harness({ ghBinary: () => null });
    expect(await none.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments }))
      .toEqual({ ok: false, error: "gh is not installed; attaching images on GitHub needs gh 2.99 or newer (run: brew install gh)" });
    expect(ran()).toBe(false);
    expect(stagedLeft()).toEqual([]);
  });

  test("refuses with no token, and on a GitLab repo, before running gh", async () => {
    const { attachments } = twoFiles();
    const tokenless = harness({ githubToken: async () => null });
    expect(await tokenless.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments }))
      .toEqual({ ok: false, error: "missing GitHub token (run: rt setup github connect)" });
    const gitlab = harness({ isGitHub: async () => false });
    expect(await gitlab.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments }))
      .toEqual({ ok: false, error: "unsupported: describe-with-attachments needs a GitHub repo" });
    expect(ran()).toBe(false);
  });

  test("an image over 10 MB is refused in the size bucket and gh never runs", async () => {
    const big = join(repoPath, "big.png");
    writeFileSync(big, Buffer.concat([PNG, Buffer.alloc(Math.round(10.5 * 1024 * 1024) - PNG.length)]));
    const shot = png(repoPath, "shot.png");
    const h = harness();
    const res = await h.handlers["mr:describe-with-attachments"]({
      repoName: REPO, iid: 7, description: "![a](./1-big.png) ![b](./2-shot.png)", attachments: [{ path: big, name: "1-big.png" }, { path: shot, name: "2-shot.png" }],
    });
    expect(res).toEqual({ ok: true, data: { outcome: "refused", refused: [{ path: big, error: "file is 10.5 MB; the upload cap is 10 MB for an image on GitHub" }] } });
    expect(bucketFor("file is 10.5 MB; the upload cap is 10 MB for an image on GitHub")).toBe("size");
    expect(ran()).toBe(false);
  });

  test("a file outside the roots, and a file not in the run's record, are refused with mr:upload's own strings, and gh never runs", async () => {
    const runs = join(home, ".mattstack", "runs");
    const started = runStart(runs, { repo: "web", workType: "fix", pipeline: "default", env: { RT_RUNS_ROOT: runs, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv });
    if (!started.ok) throw new Error(started.error);
    const recorded = png(repoPath, "recorded.png");
    const db = openRunDb(started.runDb);
    try {
      expect(fieldSet(db, "evidence", JSON.stringify({ v: 2, cases: [{ id: "c", label: "C", after: { path: recorded, waiver: "w" } }] }), "verify").ok).toBe(true);
    } finally {
      db.close();
    }
    const savedRuns = process.env.RT_RUNS_ROOT;
    process.env.RT_RUNS_ROOT = runs;
    try {
      const outside = png(elsewhere, "outside.png");
      const stray = png(repoPath, "stray.png");
      const upload = harness({ isGitHub: async () => false });
      const expected = async (path: string) => {
        const r = await upload.handlers["mr:upload"]({ repoName: REPO, path, runId: started.runId });
        if (r.ok) throw new Error("mr:upload accepted");
        return r.error;
      };
      const outsideError = await expected(outside);
      const strayError = await expected(stray);
      expect(outsideError).toContain("outside the allowed upload roots");
      expect(strayError).toContain("not in run");
      const h = harness();
      const res = await h.handlers["mr:describe-with-attachments"]({
        repoName: REPO, iid: 7, runId: started.runId,
        description: "![a](./1-outside.png) ![b](./2-stray.png) ![c](./3-recorded.png)",
        attachments: [{ path: outside, name: "1-outside.png" }, { path: stray, name: "2-stray.png" }, { path: recorded, name: "3-recorded.png" }],
      });
      expect(res).toEqual({ ok: true, data: { outcome: "refused", refused: [{ path: outside, error: outsideError }, { path: stray, error: strayError }] } });
      expect(ran()).toBe(false);
    } finally {
      if (savedRuns === undefined) delete process.env.RT_RUNS_ROOT; else process.env.RT_RUNS_ROOT = savedRuns;
    }
  });

  test("refuses a bad payload", async () => {
    const { board, attachments } = twoFiles();
    const h = harness();
    const call = (over: Record<string, unknown>) => h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments, ...over });
    const refusedWith = async (over: Record<string, unknown>, text: string) => {
      const res = await call(over);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain(text);
    };
    const many = Array.from({ length: 51 }, (_, i) => ({ path: board, name: `${i}-board.png` }));
    await refusedWith({ attachments: [] }, "1 to 50");
    await refusedWith({ attachments: many, description: many.map((a) => `![x](./${a.name})`).join(" ") }, "1 to 50");
    await refusedWith({ attachments: [{ path: "board.png", name: "1-board.png" }], description: "![x](./1-board.png)" }, "absolute");
    await refusedWith({ attachments: [{ path: board, name: "../x.png" }], description: "![x](./../x.png)" }, "../x.png");
    await refusedWith({ attachments: [{ path: board, name: "a.txt" }], description: "![x](./a.txt)" }, "attachment a.txt must end in one of");
    await refusedWith({ attachments: [{ path: board, name: "1-A.png" }, { path: board, name: "1-a.png" }], description: "![x](./1-A.png) ![y](./1-a.png)" }, "unique");
    await refusedWith({ attachments: [{ path: board, name: "1-shot.jpg" }], description: "![x](./1-shot.jpg)" }, `attachment 1-shot.jpg must keep the extension of ${board}`);
    await refusedWith({ description: "![x](./1-board.png) only" }, "2-shot.png");
    await refusedWith({ iid: 0 }, "iid");
    await refusedWith({ description: 5 }, "description");
    await refusedWith({ runId: " " }, "runId");
    expect(await call({ repoName: "not-an-identity" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(ran()).toBe(false);
  });

  test("a read-back that hangs is cut off", async () => {
    const { attachments } = twoFiles();
    const h = harness({
      gh: { rewrite: { "1-board.png": 1, "2-shot.png": 2 } },
      readBackTimeoutMs: 100,
      githubContext: async () => {
        let calls = 0;
        return { projectPath: "acme/web", readBody: () => (++calls === 1 ? Promise.resolve(OLD_BODY) : new Promise<string>(() => {})) };
      },
    });
    const res = await h.handlers["mr:describe-with-attachments"]({ repoName: REPO, iid: 7, description: DESC, attachments });
    if (!res.ok || res.data.outcome !== "ran") throw new Error(JSON.stringify(res));
    expect(res.data.written).toBe(true);
    expect(res.data.urls).toEqual({});
    expect(res.data.readBackError).toBe("reading PR #7 did not finish in 0.1s");
  });
});

describe("readPrBody", () => {
  test("a PR read that comes back empty names the warning when there is one", async () => {
    const warned = { fetchSingleMR: async (_p: string, _i: number, _u: null, onWarning: (w: { message: string }) => void) => { onWarning({ message: "HTTP 403: API rate limit exceeded" }); return null; } };
    const silent = { fetchSingleMR: async () => null };
    const found = { fetchSingleMR: async () => ({ description: "body" }) };
    await expect(readPrBody(warned, "acme/web", 7)).rejects.toThrow(new Error("PR #7 could not be read: HTTP 403: API rate limit exceeded"));
    await expect(readPrBody(silent, "acme/web", 7)).rejects.toThrow(new Error("PR #7 could not be read"));
    expect(await readPrBody(found, "acme/web", 7)).toBe("body");
  });
});
