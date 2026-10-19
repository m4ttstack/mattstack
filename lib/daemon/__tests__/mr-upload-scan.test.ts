/**
 * mr:upload's all-runs ticket-copy scan, with no runId and a file in no run
 * folder: it reads only each run's evidence fields, matches a hashed ticket
 * shot by its recorded path, size and sha256 without touching the file, and
 * keeps a legacy shot's file fallback.
 */
import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runStart } from "../../runs/start.ts";
import { fieldSet, openRunDb } from "../../runs/write.ts";
import { closeStateDb } from "../../state/index.ts";
import { TICKETS_FIELD } from "../../evidence/tickets-field.ts";
import { createMrUploadHandlers, readRunFields, type MrUploadSeams } from "../handlers/mr-upload.ts";

const REPO = "remote:gitlab.example.com%2Facme%2Fwidgets";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const REPLY = { url: "/uploads/abc/shot.png", full_path: "/-/project/9/uploads/abc/shot.png", markdown: "![shot](/uploads/abc/shot.png)" };
const RUNS = 300;
/** The steady-state scan of a few hundred unchanged runs, once the daemon has read each run's fields. */
const WARM_SCAN_BUDGET_MS = 250;

const bytesOf = (tail: string) => Buffer.concat([PNG, Buffer.from(tail)]);
const hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("mr:upload all-runs ticket scan", () => {
  const saved = { home: process.env.HOME, runs: process.env.RT_RUNS_ROOT };
  let home: string;
  let repoPath: string;
  let elsewhere: string;
  let runs: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-scan-home-")));
    process.env.HOME = home;
    runs = join(home, ".mattstack", "runs");
    process.env.RT_RUNS_ROOT = runs;
    closeStateDb();
    repoPath = realpathSync(mkdtempSync(join(tmpdir(), "rt-scan-repo-")));
    elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "rt-scan-else-")));
  });
  afterEach(() => {
    process.env.HOME = saved.home;
    if (saved.runs === undefined) delete process.env.RT_RUNS_ROOT; else process.env.RT_RUNS_ROOT = saved.runs;
    closeStateDb();
    for (const d of [home, repoPath, elsewhere]) rmSync(d, { recursive: true, force: true });
  });

  function file(dir: string, name: string, tail: string): string {
    const p = join(dir, name);
    writeFileSync(p, bytesOf(tail));
    return p;
  }

  function harness(overrides: Partial<MrUploadSeams> = {}) {
    const warns: unknown[] = [];
    const fileCalls: string[] = [];
    const keysRead = new Set<string>();
    const dbsRead: string[] = [];
    const seams: MrUploadSeams = {
      repoContext: async () => ({ provider: { baseURL: "https://gitlab.example.com" }, projectPath: "acme/widgets", projectId: 9 }),
      gitlabToken: async () => "tok",
      worktreePaths: () => [],
      uploadRoots: () => [],
      tempRoots: () => [elsewhere],
      requestHook: () => ({ onRequest() {} }),
      fetchFn: (async () => new Response(JSON.stringify(REPLY), { status: 201 })) as unknown as typeof fetch,
      runEvidence: () => { throw new Error("looked up by id"); },
      runFields: (path, keys) => {
        for (const k of keys) keysRead.add(k);
        dbsRead.push(path);
        return readRunFields(path, keys);
      },
      ticketFiles: {
        resolve: (p) => { fileCalls.push(`resolve ${p}`); return null; },
        probe: (p) => { fileCalls.push(`probe ${p}`); return { kind: "gone" }; },
      },
      ...overrides,
    };
    const ctx = {
      repoIndex: () => ({ [REPO]: repoPath }),
      log: { warn: (...a: unknown[]) => { warns.push(a); }, info() {}, debug() {}, error() {} } as any,
    };
    return { upload: createMrUploadHandlers(ctx, seams)["mr:upload"], warns, fileCalls, keysRead, dbsRead };
  }

  /** One real run db, its fields set, copied to `count` run folders: the scan names each run by its folder. */
  function setFields(dbPath: string, fields: Record<string, string>): void {
    const db = openRunDb(dbPath);
    try {
      for (const [k, v] of Object.entries(fields)) {
        const res = fieldSet(db, k, v, "verify");
        if (!res.ok) throw new Error(res.error);
      }
    } finally {
      db.close();
    }
  }

  function seedRuns(count: number, fields: (i: number) => Record<string, string>): void {
    const started = runStart(join(home, "template"), { repo: "widgets", workType: "fix", pipeline: "default", env: { RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv });
    if (!started.ok) throw new Error(started.error);
    for (let i = 0; i < count; i++) {
      const dir = join(runs, "widgets", `r-${i}`);
      mkdirSync(dir, { recursive: true });
      copyFileSync(started.runDb, join(dir, "state.db"));
      setFields(join(dir, "state.db"), fields(i));
    }
  }

  function hashedRun(i: number): Record<string, string> {
    const ticket = bytesOf(`ticket-${i}`);
    const path = join(home, ".mattstack", "work", `r-${i}`, "evidence", "t", "ticket.png");
    const shot = { path, source: "ticket", size: ticket.length, sha256: hex(ticket), annotated: join(path, "..", "board.png"), caption: "c" };
    return {
      evidence: JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before: shot }] }),
      [TICKETS_FIELD]: JSON.stringify({ v: 1, tickets: [{ path: join(path, "..", "earlier.png"), size: bytesOf(`earlier-${i}`).length, sha256: hex(bytesOf(`earlier-${i}`)) }] }),
      summary: "x".repeat(64 * 1024),
    };
  }

  test("a few hundred runs with recorded hashes: only evidence fields read, no ticket file touched, a warm scan opens no db", async () => {
    seedRuns(RUNS, hashedRun);
    const h = harness();
    expect((await h.upload({ repoName: REPO, path: file(elsewhere, "notes.png", "ordinary") })).ok).toBe(true);
    expect([...h.keysRead].sort()).toEqual(["evidence", TICKETS_FIELD]);
    expect(h.dbsRead.length).toBe(RUNS);
    expect(h.fileCalls).toEqual([]);
    expect(h.warns).toEqual([]);

    const started = performance.now();
    expect((await h.upload({ repoName: REPO, path: file(elsewhere, "notes-2.png", "ordinary-2") })).ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(WARM_SCAN_BUDGET_MS);
    expect(h.dbsRead.length).toBe(RUNS);

    for (const tail of [`ticket-${RUNS - 7}`, `earlier-${RUNS - 3}`]) {
      const res = await h.upload({ repoName: REPO, path: file(elsewhere, "copy.png", tail) });
      expect(res).toEqual({ ok: false, error: "copy.png is the unredacted original of an imported ticket image; upload the composed board instead" });
    }
    expect(h.fileCalls).toEqual([]);
    expect(h.dbsRead.length).toBe(RUNS);
  }, 60_000);

  test("a warm scan re-reads only a run whose db changed, and forgets a run that is gone", async () => {
    seedRuns(3, hashedRun);
    const h = harness();
    expect((await h.upload({ repoName: REPO, path: file(elsewhere, "notes.png", "ordinary") })).ok).toBe(true);
    expect(h.dbsRead.length).toBe(3);

    const later = bytesOf("later-ticket");
    const r1 = join(runs, "widgets", "r-1", "state.db");
    const stored = JSON.parse(hashedRun(1)[TICKETS_FIELD]!) as { v: 1; tickets: unknown[] };
    setFields(r1, { [TICKETS_FIELD]: JSON.stringify({ v: 1, tickets: [...stored.tickets, { path: join(home, "later.png"), size: later.length, sha256: hex(later) }] }) });
    rmSync(join(runs, "widgets", "r-2"), { recursive: true, force: true });

    expect((await h.upload({ repoName: REPO, path: file(elsewhere, "copy.png", "later-ticket") })).ok).toBe(false);
    expect(h.dbsRead.slice(3)).toEqual([r1]);
    expect((await h.upload({ repoName: REPO, path: file(elsewhere, "copy-2.png", "ticket-2") })).ok).toBe(true);
    expect(h.dbsRead.length).toBe(4);
  });

  test("a hashed ticket shot whose recorded path is the file itself is refused without resolving it", async () => {
    const ticketPath = file(elsewhere, "ticket.png", "edited-in-place");
    const tickets = JSON.stringify({ v: 1, tickets: [{ path: ticketPath, size: 3, sha256: hex(Buffer.from("old")) }] });
    const h = harness({ runRecords: () => [{ runId: "r-1", evidence: null, tickets }] });
    expect(await h.upload({ repoName: REPO, path: ticketPath }))
      .toEqual({ ok: false, error: "ticket.png is the unredacted original of an imported ticket image; upload the composed board instead" });
    expect(h.fileCalls).toEqual([]);
  });

  test("a legacy ticket shot with no recorded hash still falls back to the file: resolved, then probed", async () => {
    const legacy = join(repoPath, "legacy-ticket.png");
    const evidence = JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before: { path: legacy, source: "ticket", annotated: join(repoPath, "b.png"), caption: "c" } }] });
    const h = harness({ runRecords: () => [{ runId: "r-1", evidence }] });
    expect((await h.upload({ repoName: REPO, path: file(elsewhere, "notes.png", "ordinary") })).ok).toBe(true);
    expect(h.fileCalls).toEqual([`resolve ${legacy}`, `probe ${legacy}`]);
  });

  test("a run with a corrupt evidence or evidence-tickets field warns naming the run and does not block an unrelated upload", async () => {
    const ticket = bytesOf("good-ticket");
    const good = JSON.stringify({ v: 1, tickets: [{ path: join(home, "gone.png"), size: ticket.length, sha256: hex(ticket) }] });
    const h = harness({
      runRecords: () => [
        { runId: "r-torn", evidence: '{"v":2,"cases":[{"id":"t","before":{"source":"ticket","pa' },
        { runId: "r-mangled", evidence: null, tickets: "{not json" },
        { runId: "r-good", evidence: null, tickets: good },
      ],
    });
    expect((await h.upload({ repoName: REPO, path: file(elsewhere, "notes.png", "ordinary") })).ok).toBe(true);
    const warned = JSON.stringify(h.warns);
    expect(warned).toContain("ticket copy check: run r-torn's evidence field is not valid JSON; its ticket images are unchecked");
    expect(warned).toContain(`ticket copy check: run r-mangled's ${TICKETS_FIELD} field is not valid; its remembered ticket images are unchecked`);
    expect((await h.upload({ repoName: REPO, path: file(elsewhere, "copy.png", "good-ticket") })).ok).toBe(false);
  });

  test("an evidence-tickets field with one bad entry warns naming the run, and its good entries still refuse a copy", async () => {
    const ticket = bytesOf("half-good");
    const tickets = JSON.stringify({ v: 1, tickets: [{ path: join(home, "gone.png"), size: ticket.length, sha256: hex(ticket) }, { path: "", size: -1 }] });
    const h = harness({ runRecords: () => [{ runId: "r-half", evidence: null, tickets }] });
    expect(await h.upload({ repoName: REPO, path: file(elsewhere, "copy.png", "half-good") }))
      .toEqual({ ok: false, error: "copy.png is the unredacted original of an imported ticket image; upload the composed board instead" });
    expect(JSON.stringify(h.warns)).toContain(`ticket copy check: run r-half's ${TICKETS_FIELD} field is not valid; its remembered ticket images are unchecked`);
  });

  test("a ticket shot whose source is written with a JSON escape is still checked", async () => {
    const ticket = bytesOf("escaped-ticket");
    const shot = { path: join(home, "gone.png"), source: "ticket", size: ticket.length, sha256: hex(ticket), annotated: join(home, "b.png"), caption: "c" };
    const escape = String.fromCharCode(92) + "u0069";
    const evidence = JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before: shot }] }).replace('"source":"ticket"', `"source":"t${escape}cket"`);
    expect(evidence).not.toContain('"ticket"');
    const h = harness({ runRecords: () => [{ runId: "r-esc", evidence }] });
    expect(await h.upload({ repoName: REPO, path: file(elsewhere, "copy.png", "escaped-ticket") }))
      .toEqual({ ok: false, error: "copy.png is the unredacted original of an imported ticket image; upload the composed board instead" });
  });

  test("readRunFields returns only the keys asked, and throws for a file that is not a database", () => {
    seedRuns(1, (i) => hashedRun(i));
    const db = join(runs, "widgets", "r-0", "state.db");
    const got = readRunFields(db, ["evidence"]);
    expect(Object.keys(got)).toEqual(["evidence"]);
    expect(got.evidence).toContain('"ticket"');
    const bad = join(home, "bad.db");
    writeFileSync(bad, "not a db");
    expect(() => readRunFields(bad, ["evidence"])).toThrow();
  });
});
