/**
 * mr:upload: the guard's roots come from the target repo's index path and
 * worktree registry, the Claude Code temp root, and rt.mcp.uploadRoots read
 * at call time; a passing file goes up as one multipart POST with the same
 * token and base URL the other GitLab verbs use.
 */
import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runStart } from "../../runs/start.ts";
import { fieldSet, openRunDb } from "../../runs/write.ts";
import { setSetting } from "../../settings/write.ts";
import { closeStateDb } from "../../state/index.ts";
import { saveRegistry, type TreeRecord } from "../../worktree/registry.ts";
import { createMrUploadHandlers, type MrUploadSeams } from "../handlers/mr-upload.ts";

const REPO = "remote:gitlab.example.com%2Facme%2Fapp";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const REPLY = { url: "/uploads/abc123/shot.png", full_path: "/-/project/99/uploads/abc123/shot.png", markdown: "![shot](/uploads/abc123/shot.png)" };

type Captured = { url: string; method: string | undefined; token: string | undefined; file: File | null };

function harness(overrides: Partial<MrUploadSeams> & { reply?: () => Promise<Response>; repoPath: string; warns?: unknown[] }) {
  const calls: Captured[] = [];
  const hooks: Array<{ op: string; method: string; path: string; status: number }> = [];
  const warns = overrides.warns ?? [];
  const seams: MrUploadSeams = {
    repoContext: async () => ({ provider: { baseURL: "https://gitlab.example.com" }, projectPath: "acme/app", projectId: 99 }),
    gitlabToken: async () => "tok",
    worktreePaths: () => [],
    uploadRoots: () => [],
    tempRoots: () => [],
    requestHook: () => ({ onRequest: (info) => hooks.push({ op: info.op, method: info.method, path: info.path, status: info.status }) }),
    fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as FormData;
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url: String(url), method: init?.method, token: headers?.["PRIVATE-TOKEN"], file: body ? (body.get("file") as File) : null });
      return overrides.reply ? overrides.reply() : new Response(JSON.stringify(REPLY), { status: 201 });
    }) as typeof fetch,
    ...overrides,
  };
  const ctx = {
    repoIndex: () => ({ [REPO]: overrides.repoPath }),
    log: { warn: (...a: unknown[]) => { warns.push(a); }, info() {}, debug() {}, error() {} } as any,
  };
  return { handlers: createMrUploadHandlers(ctx, seams), calls, hooks, warns };
}

describe("mr:upload", () => {
  const origHome = process.env.HOME;
  let home: string;
  let repoPath: string;
  let elsewhere: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-upload-home-")));
    process.env.HOME = home;
    closeStateDb();
    repoPath = realpathSync(mkdtempSync(join(tmpdir(), "rt-upload-repo-")));
    elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "rt-upload-else-")));
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    for (const d of [home, repoPath, elsewhere]) rmSync(d, { recursive: true, force: true });
  });

  function pngWith(dir: string, name: string, tail: string): string {
    const p = join(dir, name);
    writeFileSync(p, Buffer.concat([Buffer.from(PNG), Buffer.from(tail)]));
    return p;
  }

  function png(dir: string, name = "shot.png"): string {
    const p = join(dir, name);
    writeFileSync(p, PNG);
    return p;
  }

  test("a png under the repo's index path uploads as one multipart POST and returns url and markdown", async () => {
    const h = harness({ repoPath });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) });
    expect(res).toEqual({ ok: true, data: { url: "https://gitlab.example.com/-/project/99/uploads/abc123/shot.png", markdown: REPLY.markdown } });
    expect(h.calls.length).toBe(1);
    expect(h.calls[0]).toMatchObject({ url: "https://gitlab.example.com/api/v4/projects/99/uploads", method: "POST", token: "tok" });
    expect(h.calls[0]!.file?.name).toBe("shot.png");
    expect(h.calls[0]!.file?.type).toBe("image/png");
    expect(h.calls[0]!.file?.size).toBe(PNG.length);
    expect(h.hooks).toEqual([{ op: "mr:upload", method: "POST", path: "/projects/99/uploads", status: 201 }]);
  });

  test("a file under a registered worktree of the target repo is allowed through the default registry seam", async () => {
    const tree: TreeRecord = { name: "wt1", path: elsewhere, kind: "ephemeral", state: "claimed", branch: "feat", createdAt: new Date().toISOString() };
    saveRegistry(REPO, [tree]);
    const h = harness({ repoPath, worktreePaths: undefined });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(elsewhere) });
    expect(res.ok).toBe(true);
  });

  test("a file under a Claude temp root is allowed", async () => {
    const h = harness({ repoPath, tempRoots: () => [elsewhere] });
    expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(elsewhere) })).ok).toBe(true);
  });

  test("rt.mcp.uploadRoots is read at call time through the resolver", async () => {
    const h = harness({ repoPath, uploadRoots: undefined });
    const p = png(elsewhere);
    expect((await h.handlers["mr:upload"]({ repoName: REPO, path: p })).ok).toBe(false);
    setSetting("rt.mcp.uploadRoots", [elsewhere], "machine");
    expect((await h.handlers["mr:upload"]({ repoName: REPO, path: p })).ok).toBe(true);
    setSetting("rt.mcp.uploadRoots", [], "machine");
    expect((await h.handlers["mr:upload"]({ repoName: REPO, path: p })).ok).toBe(false);
    expect(h.calls.length).toBe(1);
  });

  test("a non-absolute rt.mcp.uploadRoots entry is ignored with a warning", async () => {
    const h = harness({ repoPath, uploadRoots: undefined });
    setSetting("rt.mcp.uploadRoots", ["relative/dir", elsewhere], "machine");
    expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(elsewhere) })).ok).toBe(true);
    expect(JSON.stringify(h.warns)).toContain("relative/dir");
  });

  test("a file outside every root is refused with no network call", async () => {
    const h = harness({ repoPath });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(elsewhere) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("outside the allowed upload roots");
    expect(h.calls).toEqual([]);
  });

  test("a missing path, a non-identity repo and an unindexed repo are refused", async () => {
    const h = harness({ repoPath });
    expect(await h.handlers["mr:upload"]({ repoName: REPO })).toEqual({ ok: false, error: "missing repoName/path" });
    expect(await h.handlers["mr:upload"]({ repoName: REPO, path: "  " })).toEqual({ ok: false, error: "missing repoName/path" });
    expect(await h.handlers["mr:upload"]({ repoName: "not-an-identity", path: "/x.png" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(await h.handlers["mr:upload"]({ repoName: "remote:gitlab.example.com%2Facme%2Fother", path: "/x.png" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(h.calls).toEqual([]);
  });

  test("a missing token is refused after the guard passes", async () => {
    const h = harness({ repoPath, gitlabToken: async () => undefined });
    expect(await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) })).toEqual({ ok: false, error: "no gitlabToken in secrets" });
    expect(h.calls).toEqual([]);
  });

  test("a non-2xx reply is ok:false naming the status; a fetch throw is ok:false with its message", async () => {
    const denied = harness({ repoPath, reply: async () => new Response("forbidden", { status: 403, statusText: "Forbidden" }) });
    const res = await denied.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("403");
    expect(denied.hooks[0]?.status).toBe(403);

    const threw = harness({ repoPath, reply: async () => { throw new Error("socket hang up"); } });
    const res2 = await threw.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) });
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.error).toContain("socket hang up");
  });

  test("a reply without full_path falls back to the project-relative url", async () => {
    const h = harness({ repoPath, reply: async () => new Response(JSON.stringify({ url: "/uploads/abc/shot.png", markdown: "m" }), { status: 201 }) });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) });
    expect(res).toEqual({ ok: true, data: { url: "https://gitlab.example.com/acme/app/uploads/abc/shot.png", markdown: "m" } });
  });

  test("a reply with no markdown is ok:false, never a half result", async () => {
    const h = harness({ repoPath, reply: async () => new Response(JSON.stringify({ url: "/uploads/abc/shot.png" }), { status: 201 }) });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("markdown");
  });

  test("an imported raw capture uploads nothing without a runId", async () => {
    writeFileSync(join(repoPath, "shot.c1.capture.json"), JSON.stringify({ source: "import" }));
    const h = harness({ repoPath });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, "shot.c1.png") });
    expect(res).toEqual({ ok: false, error: "shot.c1.png is the unredacted original of an imported ticket image; upload the composed board instead" });
    expect(h.calls.length).toBe(0);
  });

  test("an unconfirmed gated board is refused before any request", async () => {
    writeFileSync(join(repoPath, "board.spec.json"), JSON.stringify({ panels: [{ capture: "board.c1.capture.json", marks: [{ redact: "email" }] }] }));
    writeFileSync(join(repoPath, "board.c1.capture.json"), JSON.stringify({ source: "import" }));
    const board = png(repoPath, "board.png");
    const hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const crop = new Uint8Array([4, 5]);
    writeFileSync(join(repoPath, "board.redact-1.png"), crop);
    writeFileSync(join(repoPath, "board.redactions.json"), JSON.stringify({
      schemaVersion: "compose-redactions/1", board: "board.png", boardSha256: hex(PNG),
      redactions: [{ crop: "board.redact-1.png", sha256: hex(crop), panel: 0, confirmed: false }],
    }));
    const h = harness({ repoPath });
    const res = await h.handlers["mr:upload"]({ repoName: REPO, path: board });
    expect(res).toEqual({ ok: false, error: "board.png has a redaction not yet confirmed; show each crop at the redaction gate, run fast-browser compose --confirm after a yes, and copy the confirmed record beside the board" });
    expect(h.calls.length).toBe(0);
  });

  describe("with runId", () => {
    function record(value: object | string | null) {
      return { runEvidence: (id: string) => (id === "run-1" ? { found: true as const, evidence: value === null || typeof value === "string" ? value : JSON.stringify(value) } : { found: false as const }) };
    }
    function scanned(value: object) {
      return { runRecords: () => [{ runId: "run-1", evidence: JSON.stringify(value) }] };
    }
    function v2(dir: string) {
      return {
        v: 2,
        cases: [
          { id: "c1", label: "C", before: { path: join(dir, "raw.png"), annotated: join(dir, "raw-ann.png"), caption: "box" } },
          { id: "c2", label: "D", after: { dark: { path: join(dir, "waived.png") } }, waiver: "identical" },
        ],
      };
    }

    test("an annotated image the record lists uploads", async () => {
      png(repoPath, "raw.png");
      const h = harness({ repoPath, ...record(v2(repoPath)) });
      const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, "raw-ann.png"), runId: "run-1" });
      expect(res.ok).toBe(true);
      expect(h.calls.length).toBe(1);
    });

    test("a waived case uploads its base image", async () => {
      const h = harness({ repoPath, ...record(v2(repoPath)) });
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, "waived.png"), runId: "run-1" })).ok).toBe(true);
    });

    test("a raw capture with an annotated copy is refused, naming the file and its annotated copy", async () => {
      const h = harness({ repoPath, ...record(v2(repoPath)) });
      const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, "raw.png"), runId: "run-1" });
      expect(res).toEqual({ ok: false, error: 'raw.png is the raw capture for case "c1" before; upload its annotated image raw-ann.png instead' });
      expect(h.calls.length).toBe(0);
    });

    test("an image missing from the record is refused, naming the file", async () => {
      const h = harness({ repoPath, ...record(v2(repoPath)) });
      const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, "stray.png"), runId: "run-1" });
      expect(res).toEqual({ ok: false, error: "stray.png is not in run run-1's evidence record as an annotated image or a waived capture; record it with evidence_record first" });
      expect(h.calls.length).toBe(0);
    });

    test("a record path reached through a symlink matches by realpath", async () => {
      const real = png(repoPath, "waived.png");
      const linkDir = join(elsewhere, "link");
      symlinkSync(repoPath, linkDir);
      const h = harness({ repoPath, ...record({ v: 2, cases: [{ id: "c", label: "C", after: { path: join(linkDir, "waived.png"), waiver: "w" } }] }) });
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: real, runId: "run-1" })).ok).toBe(true);
    });

    test("an unknown run, a run with no record, and a bad runId are refused", async () => {
      const file = png(repoPath, "x.png");
      expect(await harness({ repoPath, ...record(null) }).handlers["mr:upload"]({ repoName: REPO, path: file, runId: "run-2" }))
        .toEqual({ ok: false, error: "run run-2 not found" });
      expect(await harness({ repoPath, ...record(null) }).handlers["mr:upload"]({ repoName: REPO, path: file, runId: "run-1" }))
        .toEqual({ ok: false, error: "run run-1 has no evidence record; record it with evidence_record first" });
      expect(await harness({ repoPath, ...record("see /tmp/x.png") }).handlers["mr:upload"]({ repoName: REPO, path: file, runId: "run-1" }))
        .toEqual({ ok: false, error: "run run-1 has no evidence record; record it with evidence_record first" });
      expect(await harness({ repoPath, ...record(null) }).handlers["mr:upload"]({ repoName: REPO, path: file, runId: 7 }))
        .toEqual({ ok: false, error: "runId must be a non-empty string" });
    });

    test("a v1 record admits its annotated image only", async () => {
      const value = { v: 1, before: join(repoPath, "b.png"), beforeAnnotated: join(repoPath, "ba.png") };
      const h = harness({ repoPath, ...record(value) });
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, "ba.png"), runId: "run-1" })).ok).toBe(true);
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, "b.png"), runId: "run-1" })).ok).toBe(false);
    });

    test("a pair board uploads and both raw captures are refused", async () => {
      const value = {
        v: 2,
        cases: [{
          id: "c", label: "C",
          before: { path: join(repoPath, "before.c1.png"), annotated: join(repoPath, "pair.png"), caption: "before" },
          after: { path: join(repoPath, "after.c1.png"), annotated: join(repoPath, "pair.png"), caption: "after" },
        }],
      };
      const h = harness({ repoPath, ...record(value) });
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, "pair.png"), runId: "run-1" })).ok).toBe(true);
      expect(h.calls.length).toBe(1);
      for (const [raw, side] of [["before.c1.png", "before"], ["after.c1.png", "after"]] as const) {
        const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, raw), runId: "run-1" });
        expect(res).toEqual({ ok: false, error: `${raw} is the raw capture for case "c" ${side}; upload its annotated image pair.png instead` });
      }
      expect(h.calls.length).toBe(1);
    });

    test("a ticket image's own path is refused whatever it is named, waived or not; its board uploads", async () => {
      const ticket = (extra: object) => ({ v: 2, cases: [{ id: "t", label: "T", before: { path: join(repoPath, "shot-0412.png"), source: "ticket", ...extra } }] });
      for (const value of [ticket({ waiver: "nothing to mark" }), { ...ticket({}), cases: [{ ...ticket({}).cases[0], waiver: "whole case" }] }]) {
        const h = harness({ repoPath, ...record(value) });
        const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, "shot-0412.png"), runId: "run-1" });
        expect(res).toEqual({ ok: false, error: "shot-0412.png is the unredacted original of an imported ticket image; upload the composed board instead" });
        expect(h.calls.length).toBe(0);
      }
      const h = harness({ repoPath, ...record(ticket({ annotated: join(repoPath, "t-board.png"), caption: "c" })) });
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(repoPath, "t-board.png", "board"), runId: "run-1" })).ok).toBe(true);
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, "shot-0412.png"), runId: "run-1" })).ok).toBe(false);
    });

    test("a byte copy of a ticket image at another path is refused, even recorded as a waived image", async () => {
      const value = {
        v: 2,
        cases: [
          { id: "t", label: "T", before: { path: join(repoPath, "ticket.png"), source: "ticket", annotated: join(repoPath, "board.png"), caption: "c" } },
          { id: "u", label: "U", after: { path: join(repoPath, "copy-of-it.png"), waiver: "nothing to mark" } },
        ],
      };
      png(repoPath, "ticket.png");
      const h = harness({ repoPath, ...record(value) });
      const res = await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath, "copy-of-it.png"), runId: "run-1" });
      expect(res).toEqual({ ok: false, error: "copy-of-it.png is the unredacted original of an imported ticket image; upload the composed board instead" });
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(repoPath, "board.png", "board"), runId: "run-1" })).ok).toBe(true);
      expect(h.calls.length).toBe(1);
    });

    test("a file in a run's evidence folder is checked against that run's record even without runId", async () => {
      const dir = join(home, ".mattstack", "work", "run-1", "evidence", "t");
      mkdirSync(dir, { recursive: true });
      const value = { v: 2, cases: [{ id: "t", label: "T", before: { path: join(dir, "shot-0412.png"), source: "ticket", annotated: join(dir, "board.png"), caption: "c" } }] };
      const h = harness({ repoPath, uploadRoots: () => [dir], ...record(value) });
      expect(await h.handlers["mr:upload"]({ repoName: REPO, path: png(dir, "shot-0412.png") }))
        .toEqual({ ok: false, error: "shot-0412.png is the unredacted original of an imported ticket image; upload the composed board instead" });
      expect(await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(dir, "stray.png", "stray") }))
        .toEqual({ ok: false, error: "stray.png is in run run-1's evidence folder and not in run run-1's evidence record; record it with evidence_record first" });
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(dir, "board.png", "board") })).ok).toBe(true);
      expect(h.calls.length).toBe(1);
    });

    test("a ticket image the check cannot read fails closed; a FIFO is never read; a moved ticket file is a known limit", async () => {
      const ticketAt = (path: string) => ({ v: 2, cases: [
        { id: "t", label: "T", before: { path, source: "ticket", annotated: join(repoPath, "board.png"), caption: "c" } },
        { id: "u", label: "U", after: { path: join(repoPath, "other.png"), waiver: "w" } },
      ] });
      const locked = pngWith(repoPath, "locked.png", "lockd");
      chmodSync(locked, 0o000);
      const h1 = harness({ repoPath, ...record(ticketAt(locked)) });
      const r1 = await h1.handlers["mr:upload"]({ repoName: REPO, path: pngWith(repoPath, "other.png", "other"), runId: "run-1" });
      chmodSync(locked, 0o600);
      expect(r1.ok).toBe(false);
      expect((r1 as { error: string }).error).toContain("could not be read to rule out a copy");
      const fifo = join(repoPath, "pipe.png");
      expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
      const h2 = harness({ repoPath, ...record(ticketAt(fifo)) });
      const r2 = await h2.handlers["mr:upload"]({ repoName: REPO, path: pngWith(repoPath, "other.png", "other"), runId: "run-1" });
      expect((r2 as { error: string }).error).toContain("could not be read to rule out a copy");
      const h3 = harness({ repoPath, ...record(ticketAt(join(repoPath, "moved-away.png"))) });
      expect((await h3.handlers["mr:upload"]({ repoName: REPO, path: pngWith(repoPath, "other.png", "other"), runId: "run-1" })).ok).toBe(true);
    }, 5000);

    test("a file in run B's folder uploaded with runId A is held to both records", async () => {
      const dir = join(home, ".mattstack", "work", "run-b", "evidence", "c");
      mkdirSync(dir, { recursive: true });
      const file = pngWith(dir, "shot.png", "b");
      const both = { runEvidence: (id: string) => id === "run-1"
        ? { found: true as const, evidence: JSON.stringify({ v: 2, cases: [{ id: "c", label: "C", after: { path: file, waiver: "w" } }] }) }
        : { found: true as const, evidence: JSON.stringify({ v: 2, cases: [{ id: "c", label: "C", after: { path: join(dir, "else.png"), waiver: "w" } }] }) } };
      const h = harness({ repoPath, uploadRoots: () => [dir], ...both });
      const res = await h.handlers["mr:upload"]({ repoName: REPO, path: file, runId: "run-1" });
      expect(res).toEqual({ ok: false, error: "shot.png is in run run-b's evidence folder and not in run run-b's evidence record; record it with evidence_record first" });
    });

    test("an owner-derived run with no database is refused by location, naming the folder", async () => {
      const dir = join(home, ".mattstack", "work", "ghost", "evidence", "c");
      mkdirSync(dir, { recursive: true });
      const h = harness({ repoPath, uploadRoots: () => [dir], ...record(null) });
      expect(await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(dir, "shot.png", "g") }))
        .toEqual({ ok: false, error: "shot.png is in run ghost's evidence folder and not in run ghost's evidence record; record it with evidence_record first" });
    });

    test("a symlink from a worktree into a run's folder is held to that run's record", async () => {
      const dir = join(home, ".mattstack", "work", "run-1", "evidence", "t");
      mkdirSync(dir, { recursive: true });
      const value = { v: 2, cases: [{ id: "t", label: "T", before: { path: join(dir, "shot-0412.png"), source: "ticket", annotated: join(dir, "board.png"), caption: "c" } }] };
      png(dir, "shot-0412.png");
      symlinkSync(join(dir, "shot-0412.png"), join(repoPath, "link.png"));
      const h = harness({ repoPath, uploadRoots: () => [dir], ...record(value) });
      expect(await h.handlers["mr:upload"]({ repoName: REPO, path: join(repoPath, "link.png") }))
        .toEqual({ ok: false, error: "shot-0412.png is the unredacted original of an imported ticket image; upload the composed board instead" });
    });

    test("with no run in scope, a run's ticket original left in the temp root is refused; an ordinary file is not", async () => {
      const dir = join(home, ".mattstack", "work", "run-1", "evidence", "t");
      mkdirSync(dir, { recursive: true });
      const copy = pngWith(dir, "r-t-ticket.png", "ticket-bytes");
      const value = { v: 2, cases: [{ id: "t", label: "T", before: { path: copy, source: "ticket", annotated: join(dir, "board.png"), caption: "c" } }] };
      const original = pngWith(elsewhere, "r-t-ticket.png", "ticket-bytes");
      const h = harness({ repoPath, tempRoots: () => [elsewhere], ...scanned(value) });
      expect(await h.handlers["mr:upload"]({ repoName: REPO, path: original }))
        .toEqual({ ok: false, error: "r-t-ticket.png is the unredacted original of an imported ticket image; upload the composed board instead" });
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(elsewhere, "notes.png", "ordinary") })).ok).toBe(true);
      expect(h.calls.length).toBe(1);
    });

    describe("a ticket image with a recorded size and sha256", () => {
      const TICKET_BYTES = Buffer.concat([Buffer.from(PNG), Buffer.from("ticket-bytes")]);
      const hashedValue = (path: string) => ({ v: 2, cases: [{ id: "t", label: "T", before: {
        path, source: "ticket", size: TICKET_BYTES.length, sha256: createHash("sha256").update(TICKET_BYTES).digest("hex"), annotated: join(path, "..", "board.png"), caption: "c",
      } }] });
      const REFUSED = { ok: false as const, error: "r-t-ticket.png is the unredacted original of an imported ticket image; upload the composed board instead" };

      test("with no runId, its original is refused after the run-folder copy is deleted", async () => {
        const dir = join(home, ".mattstack", "work", "run-1", "evidence", "t");
        mkdirSync(dir, { recursive: true });
        const copy = pngWith(dir, "r-t-ticket.png", "ticket-bytes");
        rmSync(copy);
        const h = harness({ repoPath, tempRoots: () => [elsewhere], ...scanned(hashedValue(copy)) });
        expect(await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(elsewhere, "r-t-ticket.png", "ticket-bytes") })).toEqual(REFUSED);
        expect(h.calls.length).toBe(0);
      });

      test("with no runId, its original is refused after the run's whole work folder is deleted, while the run's record remains", async () => {
        const gone = join(home, ".mattstack", "work", "run-1", "evidence", "t", "r-t-ticket.png");
        const h = harness({ repoPath, tempRoots: () => [elsewhere], ...scanned(hashedValue(gone)) });
        expect(await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(elsewhere, "r-t-ticket.png", "ticket-bytes") })).toEqual(REFUSED);
      });

      test("with the run's record gone too, nothing remembers the image: the stated limit", async () => {
        const h = harness({ repoPath, tempRoots: () => [elsewhere], runRecords: () => [] });
        expect((await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(elsewhere, "r-t-ticket.png", "ticket-bytes") })).ok).toBe(true);
      });

      test("with a runId, a copy is refused though the ticket file is gone", async () => {
        const gone = join(repoPath, "deleted-ticket.png");
        const h = harness({ repoPath, ...record({ ...hashedValue(gone), cases: [...hashedValue(gone).cases, { id: "u", label: "U", after: { path: join(repoPath, "r-t-ticket.png"), waiver: "w" } }] }) });
        expect(await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(repoPath, "r-t-ticket.png", "ticket-bytes"), runId: "run-1" })).toEqual(REFUSED);
      });

      test("the default scan reads each run's record from the runs root", async () => {
        const runs = join(home, ".mattstack", "runs");
        const started = runStart(runs, { repo: "app", workType: "fix", pipeline: "default", env: { RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv });
        if (!started.ok) throw new Error(started.error);
        const db = openRunDb(started.runDb);
        try {
          expect(fieldSet(db, "evidence", JSON.stringify(hashedValue(join(home, ".mattstack", "work", started.runId, "evidence", "t", "r-t-ticket.png"))), "verify").ok).toBe(true);
        } finally {
          db.close();
        }
        const savedRuns = process.env.RT_RUNS_ROOT;
        process.env.RT_RUNS_ROOT = runs;
        try {
          const h = harness({ repoPath, tempRoots: () => [elsewhere], runEvidence: () => { throw new Error("looked up by id"); } });
          expect(await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(elsewhere, "r-t-ticket.png", "ticket-bytes") })).toEqual(REFUSED);
          expect((await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(elsewhere, "notes.png", "ordinary") })).ok).toBe(true);
        } finally {
          if (savedRuns === undefined) delete process.env.RT_RUNS_ROOT; else process.env.RT_RUNS_ROOT = savedRuns;
        }
      });
    });

    test("with no run in scope, a plan:ticket record passes the ticket pre-filter and is skipped without a warning", async () => {
      const warns: unknown[] = [];
      const h = harness({ repoPath, warns, runRecords: () => [{ runId: "run-1", evidence: JSON.stringify({ plan: "ticket", url: "https://tracker.example.com/T-1" }) }] });
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) })).ok).toBe(true);
      expect(warns).toEqual([]);
    });

    test("with no run in scope, a run whose db cannot be read is skipped with a warning naming the run", async () => {
      mkdirSync(join(home, ".mattstack", "runs", "app", "r-bad"), { recursive: true });
      writeFileSync(join(home, ".mattstack", "runs", "app", "r-bad", "state.db"), "not a db");
      const warns: unknown[] = [];
      const savedRuns = process.env.RT_RUNS_ROOT;
      process.env.RT_RUNS_ROOT = join(home, ".mattstack", "runs");
      try {
        const h = harness({ repoPath, warns, runEvidence: () => ({ found: false as const }) });
        expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) })).ok).toBe(true);
        expect(JSON.stringify(warns)).toContain("ticket copy check: run r-bad's db could not be read; skipped");
      } finally {
        if (savedRuns === undefined) delete process.env.RT_RUNS_ROOT; else process.env.RT_RUNS_ROOT = savedRuns;
      }
    });

    test("without runId, no run is looked up by id: an ordinary file passes the all-runs scan, a ticket copy it lists does not", async () => {
      const value = { v: 2, cases: [{ id: "t", label: "T", before: { path: pngWith(elsewhere, "kept-ticket.png", "kept"), source: "ticket", annotated: join(elsewhere, "b.png"), caption: "c" } }] };
      const h = harness({ repoPath, runEvidence: () => { throw new Error("read"); }, ...scanned(value) });
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: png(repoPath) })).ok).toBe(true);
      expect((await h.handlers["mr:upload"]({ repoName: REPO, path: pngWith(repoPath, "again.png", "kept") })).ok).toBe(false);
    });
  });
});
