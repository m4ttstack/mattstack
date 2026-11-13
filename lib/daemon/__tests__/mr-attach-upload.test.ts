/**
 * mr:attach-upload: the daemon stages each checked image and a holder body,
 * runs `gh pr comment --body-file --attach <file>#<name>` with the token only
 * in gh's environment, reads the holder comment back for each image's URL,
 * then deletes the holder. gh here is a shell script each test writes, and
 * the provider is a fake; nothing reaches a forge.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../../state/index.ts";
import { createMrUploadHandlers, type AttachProvider, type MrUploadSeams } from "../handlers/mr-upload.ts";

const REPO = "remote:github.com%2Facme%2Fweb";
const TOKEN = "ghs_secret_token_456";
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const COMMENT_URL = "https://github.com/acme/web/pull/42#issuecomment-123";
const url = (n: number) => `https://github.com/user-attachments/assets/${n}`;

type GhScript = { exit?: number; stderr?: string; stdout?: string; sleep?: boolean; echoToken?: boolean };

describe("mr:attach-upload", () => {
  const origHome = process.env.HOME;
  let home: string;
  let repoPath: string;
  let elsewhere: string;
  let stage: string;
  let logDir: string;
  let binDir: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-attach-home-")));
    process.env.HOME = home;
    closeStateDb();
    repoPath = realpathSync(mkdtempSync(join(tmpdir(), "rt-attach-repo-")));
    elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "rt-attach-else-")));
    stage = mkdtempSync(join(tmpdir(), "rt-attach-stage-"));
    logDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-attach-log-")));
    binDir = realpathSync(mkdtempSync(join(tmpdir(), "rt-attach-bin-")));
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    for (const d of [home, repoPath, elsewhere, stage, logDir, binDir]) rmSync(d, { recursive: true, force: true });
  });

  function gif(dir: string, name: string, tail = name): string {
    const p = join(dir, name);
    writeFileSync(p, Buffer.concat([GIF, Buffer.from(tail)]));
    return p;
  }

  function fakeGh(s: GhScript = {}): string {
    const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
    const lines = [
      "#!/bin/sh",
      `LOG=${q(logDir)}`,
      `if [ "$1" = "--version" ]; then echo 'gh version 2.103.3 (2026-10-26)'; exit 0; fi`,
      `printf '%s\\n' "$@" > "$LOG/argv"`,
      `env > "$LOG/env"`,
      `pwd > "$LOG/pwd"`,
      `prev=""; body=""; n=0`,
      `for a in "$@"; do`,
      `  if [ "$prev" = "--body-file" ]; then body="$a"; fi`,
      `  if [ "$prev" = "--attach" ]; then n=$((n+1)); cp "\${a%%#*}" "$LOG/staged-$n"; fi`,
      `  prev="$a"`,
      `done`,
      `cp "$body" "$LOG/body.md"`,
    ];
    if (s.sleep) lines.push("exec sleep 5");
    if (s.echoToken) lines.push(`printf 'bad credentials %s\\n' "$GH_TOKEN" >&2`);
    if (s.stderr) lines.push(`printf '%s\\n' ${q(s.stderr)} >&2`);
    lines.push(`printf '%s\\n' ${q(s.stdout ?? COMMENT_URL)}`);
    lines.push(`exit ${s.exit ?? 0}`);
    const path = join(binDir, "gh");
    writeFileSync(path, lines.join("\n") + "\n");
    chmodSync(path, 0o755);
    return path;
  }

  type ProviderScript = {
    /** Each name's `./<name>` in the posted body becomes url(n) in the read-back. */
    rewrite?: Record<string, number>;
    readStatus?: number;
    deleteFails?: boolean;
    dropMarker?: boolean;
  };

  function harness(overrides: Partial<MrUploadSeams> & { gh?: GhScript; provider?: ProviderScript } = {}) {
    const reads: string[] = [];
    const deletes: Array<{ projectPath: string; iid: number; note: unknown }> = [];
    const warns: Array<{ context: unknown; message: string }> = [];
    const gh = fakeGh(overrides.gh);
    const ps = overrides.provider ?? {};
    const provider: AttachProvider = {
      restRequest: async (method, path) => {
        reads.push(`${method} ${path}`);
        if (ps.readStatus && ps.readStatus !== 200) return new Response("nope", { status: ps.readStatus });
        let body = readFileSync(join(logDir, "body.md"), "utf8");
        for (const [name, n] of Object.entries(ps.rewrite ?? {})) body = body.split(`](./${name})`).join(`](${url(n)})`);
        if (ps.dropMarker) body = body.replace(/<!-- rt-attach [^>]* -->\n/, "");
        return new Response(JSON.stringify({ id: 123, body }), { status: 200, headers: { "content-type": "application/json" } });
      },
      deleteComment: async (projectPath, iid, note) => {
        deletes.push({ projectPath, iid, note });
        if (ps.deleteFails) throw new Error("GitHub said 502");
      },
    };
    const seams: MrUploadSeams = {
      ghBinary: () => gh,
      githubToken: async () => TOKEN,
      attachContext: async () => ({ projectPath: "acme/web", provider }),
      stagingRoot: () => stage,
      isGitHub: async () => true,
      worktreePaths: () => [],
      uploadRoots: () => [],
      tempRoots: () => [],
      ...overrides,
    };
    const ctx = {
      repoIndex: () => ({ [REPO]: repoPath }),
      log: { warn(context: unknown, message: string) { warns.push({ context, message }); }, info() {}, debug() {}, error() {} } as any,
    };
    return { handlers: createMrUploadHandlers(ctx, seams), reads, deletes, warns };
  }

  function twoFiles(dir = repoPath) {
    const armed = gif(dir, "latch-42-armed.gif");
    const queued = gif(dir, "latch-42-queued.gif");
    return { armed, queued, files: [{ path: armed, name: "latch-42-armed.gif" }, { path: queued, name: "latch-42-queued.gif" }] };
  }
  const BOTH = { rewrite: { "latch-42-armed.gif": 1, "latch-42-queued.gif": 2 } };

  const ran = () => existsSync(join(logDir, "argv"));
  const stagedLeft = () => readdirSync(stage).filter((e) => e.startsWith("rt-gh-attach-"));
  const loggedDir = () => readFileSync(join(logDir, "pwd"), "utf8").trim();

  test("runs gh pr comment with the body file and one --attach <file>#<name> per file, in the staging folder", async () => {
    const { armed, queued, files } = twoFiles();
    const h = harness({ provider: BOTH });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res.ok).toBe(true);
    const dir = loggedDir();
    expect(dir.startsWith(realpathSync(stage) + "/")).toBe(true);
    const argv = readFileSync(join(logDir, "argv"), "utf8").trimEnd().split("\n");
    expect(argv).toEqual([
      "pr", "comment", "42", "--repo", "github.com/acme/web", "--body-file", `${dir}/body.md`,
      "--attach", `${dir}/latch-42-armed.gif#latch-42-armed.gif`, "--attach", `${dir}/latch-42-queued.gif#latch-42-queued.gif`,
    ]);
    const body = readFileSync(join(logDir, "body.md"), "utf8");
    expect(body).toContain("![latch-42-armed.gif](./latch-42-armed.gif)");
    expect(body).toContain("![latch-42-queued.gif](./latch-42-queued.gif)");
    expect(readFileSync(join(logDir, "staged-1")).equals(readFileSync(armed))).toBe(true);
    expect(readFileSync(join(logDir, "staged-2")).equals(readFileSync(queued))).toBe(true);
  });

  test("gives gh only PATH, HOME, GH_TOKEN and GH_PROMPT_DISABLED, and the token never in argv", async () => {
    const { files } = twoFiles();
    const h = harness({ provider: BOTH });
    await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    const env = Object.fromEntries(readFileSync(join(logDir, "env"), "utf8").trimEnd().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    const keys = Object.keys(env).filter((k) => !["PWD", "SHLVL", "_", "OLDPWD"].includes(k)).sort();
    expect(keys).toEqual(["GH_PROMPT_DISABLED", "GH_TOKEN", "HOME", "PATH"]);
    expect(env.GH_TOKEN).toBe(TOKEN);
    expect(env.GH_PROMPT_DISABLED).toBe("1");
    expect(readFileSync(join(logDir, "argv"), "utf8")).not.toContain(TOKEN);
  });

  test("reads the holder back by the id in gh's URL, deletes it as a general comment, and answers each name's URL", async () => {
    const { files } = twoFiles();
    const h = harness({ provider: BOTH });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res).toEqual({ ok: true, data: { urls: { "latch-42-armed.gif": url(1), "latch-42-queued.gif": url(2) } } });
    expect(h.reads).toEqual(["GET /repos/acme/web/issues/comments/123"]);
    expect(h.deletes).toEqual([{ projectPath: "acme/web", iid: 42, note: { id: 123, kind: "general" } }]);
    expect(h.warns).toEqual([]);
    expect(stagedLeft()).toEqual([]);
  });

  test("never fetches an asset URL", async () => {
    const { files } = twoFiles();
    const fetched: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetched.push(String(input));
      return new Response("", { status: 404 });
    }) as typeof fetch;
    try {
      const h = harness({ provider: BOTH, fetchFn: globalThis.fetch });
      const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
      expect(res.ok).toBe(true);
      expect(h.reads.every((r) => r === "GET /repos/acme/web/issues/comments/123")).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
    expect(fetched).toEqual([]);
  });

  test("a failed delete still answers the URLs and logs at warn without the token", async () => {
    const { files } = twoFiles();
    const h = harness({ provider: { ...BOTH, deleteFails: true } });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res).toEqual({ ok: true, data: { urls: { "latch-42-armed.gif": url(1), "latch-42-queued.gif": url(2) } } });
    expect(h.deletes.length).toBe(1);
    expect(h.warns.length).toBe(1);
    expect(h.warns[0]!.message).toContain("holder comment");
    expect((h.warns[0]!.context as { err?: unknown }).err).toBeInstanceOf(Error);
    expect(JSON.stringify(h.warns)).not.toContain(TOKEN);
  });

  test("a name missing from the read-back fails the verb after the delete", async () => {
    const { files } = twoFiles();
    const h = harness({ provider: { rewrite: { "latch-42-armed.gif": 1 } } });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("latch-42-queued.gif");
      expect(res.error).not.toContain("latch-42-armed.gif");
    }
    expect(h.deletes).toEqual([{ projectPath: "acme/web", iid: 42, note: { id: 123, kind: "general" } }]);
    expect(stagedLeft()).toEqual([]);
  });

  test("a read-back GitHub refuses fails the verb after the delete", async () => {
    const { files } = twoFiles();
    const h = harness({ provider: { ...BOTH, readStatus: 502 } });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res).toEqual({ ok: false, error: "could not read the holder comment back: GitHub answered 502" });
    expect(h.deletes.length).toBe(1);
  });

  test("a read-back that hangs is cut off and the holder still deleted", async () => {
    const { files } = twoFiles();
    const deletes: unknown[] = [];
    const h = harness({
      readBackTimeoutMs: 100,
      attachContext: async () => ({
        projectPath: "acme/web",
        provider: { restRequest: () => new Promise<Response>(() => {}), deleteComment: async (_p, _i, note) => { deletes.push(note); } },
      }),
    });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res).toEqual({ ok: false, error: "could not read the holder comment back: reading comment 123 did not finish in 0.1s" });
    expect(deletes).toEqual([{ id: 123, kind: "general" }]);
  });

  test("gh that fails without posting answers its error with no staging path or token, and deletes nothing", async () => {
    const { files } = twoFiles();
    const h = harness({ gh: { exit: 1, stdout: "", stderr: "HTTP 422: Validation Failed", echoToken: true } });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("HTTP 422: Validation Failed");
      expect(res.error).not.toContain(TOKEN);
      expect(res.error).not.toContain("rt-gh-attach-");
    }
    expect(h.reads).toEqual([]);
    expect(h.deletes).toEqual([]);
    expect(stagedLeft()).toEqual([]);
  });

  test("gh that posted and then failed still has its holder deleted", async () => {
    const { files } = twoFiles();
    const h = harness({ gh: { exit: 1, stderr: "could not finish" }, provider: BOTH });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("could not finish");
    expect(h.deletes).toEqual([{ projectPath: "acme/web", iid: 42, note: { id: 123, kind: "general" } }]);
  });

  test("an exit 0 with no comment URL fails, since there is no holder to read", async () => {
    const { files } = twoFiles();
    const h = harness({ gh: { stdout: "done" } });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res).toEqual({ ok: false, error: "gh pr comment printed no comment URL for this PR, so the image URLs could not be read" });
    expect(h.deletes).toEqual([]);
  });

  for (const [label, stdout] of [
    ["another PR", "https://github.com/acme/web/pull/43#issuecomment-999"],
    ["another repo", "https://github.com/acme/other/pull/42#issuecomment-999"],
    ["a URL inside other text", "see https://github.com/acme/web/pull/42#issuecomment-999 there"],
  ] as const) {
    test(`a comment URL for ${label} yields no id: no read, no delete, and the verb fails`, async () => {
      const { files } = twoFiles();
      const h = harness({ gh: { stdout }, provider: BOTH });
      const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
      expect(res).toEqual({ ok: false, error: "gh pr comment printed no comment URL for this PR, so the image URLs could not be read" });
      expect(h.reads).toEqual([]);
      expect(h.deletes).toEqual([]);
    });
  }

  test("the PR URL matches its repo path ignoring case", async () => {
    const { files } = twoFiles();
    const h = harness({ gh: { stdout: "https://github.com/Acme/Web/pull/42#issuecomment-123" }, provider: BOTH });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res.ok).toBe(true);
    expect(h.deletes).toEqual([{ projectPath: "acme/web", iid: 42, note: { id: 123, kind: "general" } }]);
  });

  test("a read-back without this call's marker is not deleted, warns once without the token, and fails", async () => {
    const { files } = twoFiles();
    const h = harness({ provider: { ...BOTH, dropMarker: true } });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res).toEqual({ ok: false, error: "comment 123 is not this upload's holder comment, so it was left alone" });
    expect(h.deletes).toEqual([]);
    expect(h.warns.length).toBe(1);
    expect(h.warns[0]!.message).toContain("not this upload's holder");
    expect(JSON.stringify(h.warns)).not.toContain(TOKEN);
  });

  test("each call's holder carries its own marker", async () => {
    const { files } = twoFiles();
    const markers: string[] = [];
    for (let i = 0; i < 2; i++) {
      await harness({ provider: BOTH }).handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
      const m = /<!-- rt-attach (\S+) -->/.exec(readFileSync(join(logDir, "body.md"), "utf8"));
      expect(m).not.toBeNull();
      markers.push(m![1]!);
    }
    expect(markers[0]).not.toBe(markers[1]);
  });

  test("a URL that is not a GitHub user attachment is not taken", async () => {
    const { files } = twoFiles();
    const h = harness({
      attachContext: async () => ({
        projectPath: "acme/web",
        provider: {
          restRequest: async () => {
            const body = readFileSync(join(logDir, "body.md"), "utf8").split("](./latch-42-armed.gif)").join("](https://example.com/x.gif)").split("](./latch-42-queued.gif)").join(`](${url(2)})`);
            return new Response(JSON.stringify({ body }), { status: 200 });
          },
          deleteComment: async () => {},
        },
      }),
    });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res).toEqual({ ok: false, error: "the holder comment came back without an upload URL for latch-42-armed.gif" });
  });

  test("gh past the deadline is stopped and the staging folder removed", async () => {
    const { files } = twoFiles();
    const h = harness({ gh: { sleep: true }, ghTimeoutMs: 200 });
    const started = performance.now();
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(performance.now() - started).toBeLessThan(3000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("was stopped");
    expect(stagedLeft()).toEqual([]);
  });

  test("a file the board staged under rt's evidence folder passes the guard with no other roots", async () => {
    const latch = join(home, ".mattstack", "evidence", "board-latch", "stage-abc");
    mkdirSync(latch, { recursive: true, mode: 0o700 });
    const { files } = twoFiles(latch);
    const h = harness({ provider: BOTH });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files });
    expect(res).toEqual({ ok: true, data: { urls: { "latch-42-armed.gif": url(1), "latch-42-queued.gif": url(2) } } });
  });

  test("refuses a GitLab repo before anything runs", async () => {
    const { files } = twoFiles();
    const h = harness({ isGitHub: async () => false });
    expect(await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files }))
      .toEqual({ ok: false, error: "unsupported: mr:attach-upload needs a GitHub repo" });
    expect(ran()).toBe(false);
  });

  test("a path outside every root and bytes that are not a GIF are refused with mr:upload's own strings, and gh never runs", async () => {
    const outside = gif(elsewhere, "outside.gif");
    const fake = join(repoPath, "fake.gif");
    writeFileSync(fake, PNG);
    const upload = harness({ isGitHub: async () => false });
    const uploadError = async (path: string) => {
      const r = await upload.handlers["mr:upload"]({ repoName: REPO, path });
      if (r.ok) throw new Error("mr:upload accepted");
      return r.error;
    };
    const outsideError = await uploadError(outside);
    const fakeError = await uploadError(fake);
    expect(outsideError).toContain("outside the allowed upload roots");
    expect(fakeError).toBe("file bytes do not match a .gif signature");
    const h = harness();
    expect(await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files: [{ path: outside, name: "latch-42-armed.gif" }] }))
      .toEqual({ ok: false, error: outsideError });
    expect(await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files: [{ path: fake, name: "latch-42-armed.gif" }] }))
      .toEqual({ ok: false, error: fakeError });
    expect(ran()).toBe(false);
    expect(stagedLeft()).toEqual([]);
  });

  test("checks every file before gh is looked up", async () => {
    const outside = gif(elsewhere, "outside.gif");
    let looked = 0;
    const h = harness({ ghBinary: () => { looked++; return null; } });
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files: [{ path: outside, name: "latch-42-armed.gif" }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("outside the allowed upload roots");
    expect(looked).toBe(0);
  });

  test("refuses a bad payload", async () => {
    const { armed, files } = twoFiles();
    const h = harness();
    const call = (over: Record<string, unknown>) => h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files, ...over });
    const refusedWith = async (over: Record<string, unknown>, text: string) => {
      const res = await call(over);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain(text);
    };
    const eleven = Array.from({ length: 11 }, (_, i) => ({ path: armed, name: `latch-${i}.gif` }));
    await refusedWith({ files: [] }, "1 to 10");
    await refusedWith({ files: eleven }, "1 to 10");
    await refusedWith({ files: [{ path: armed, name: "Latch.gif" }, { path: armed, name: "latch.gif" }] }, "unique");
    await refusedWith({ files: [{ path: "latch.gif", name: "latch.gif" }] }, "absolute");
    await refusedWith({ files: [{ path: armed, name: "../x.gif" }] }, "../x.gif");
    await refusedWith({ files: [{ path: armed, name: "latch.png" }] }, `latch.png must keep the extension of ${armed}`);
    await refusedWith({ iid: 0 }, "iid");
    expect(await call({ repoName: "not-an-identity" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(ran()).toBe(false);
  });

  test("a video is refused, since it comes back with no image link to read", async () => {
    const clip = join(repoPath, "clip.mp4");
    writeFileSync(clip, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(16)]));
    const h = harness();
    const res = await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files: [{ path: clip, name: "clip.mp4" }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("must be an image");
    expect(ran()).toBe(false);
  });

  test("refuses with no token before running gh", async () => {
    const { files } = twoFiles();
    const h = harness({ githubToken: async () => null });
    expect(await h.handlers["mr:attach-upload"]({ repoName: REPO, iid: 42, files }))
      .toEqual({ ok: false, error: "missing GitHub token (run: rt setup github connect)" });
    expect(ran()).toBe(false);
  });
});
