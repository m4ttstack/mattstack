/**
 * Replays the evidence skills' own evidence_record calls for a saved ticket
 * image (stage-evidence's Record the evidence, then evidence-record's
 * annotate-or-waive pass), against a real run db, the real copy into the run
 * folder and the daemon's real mr:upload guard. Only the first call carries
 * source: "ticket"; every later one names the run-folder copy from the
 * returned value, as the skill says.
 */
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, truncateSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { createMrUploadHandlers } from "../../daemon/handlers/mr-upload.ts";
import { UPLOAD_MAX_BYTES } from "../../daemon/upload-guard.ts";
import { runStart } from "../../runs/start.ts";
import { closeStateDb } from "../../state/index.ts";
import { evidenceToolDefs, realEvidenceToolDeps, type EvidenceToolDeps } from "../evidence-tools.ts";
import type { TreeGuardDeps } from "../tree-guard.ts";

const REPO = "remote:gitlab.example.com%2Facme%2Fapp";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const TICKET = Buffer.concat([PNG, Buffer.from("ticket-bytes")]);
const TICKET_SHA = createHash("sha256").update(TICKET).digest("hex");
const REFUSED = (name: string) => ({ ok: false as const, error: `${name} is the unredacted original of an imported ticket image; upload the composed board instead` });

const noGuard: TreeGuardDeps = {
  repoIndex: () => ({}),
  treeByPath: () => null,
  realpath: (p) => realpathSync(p),
  worktreeRoots: () => [],
  hasGitEntry: () => false,
  ignoredBy: () => false,
};

let base: string;
let home: string;
let src: string;
let repoPath: string;
let elsewhere: string;
let runDb: string;
let runId: string;
let env: NodeJS.ProcessEnv;
const saved = { HOME: process.env.HOME, RT_RUNS_ROOT: process.env.RT_RUNS_ROOT };

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "evreplay-")));
  home = join(base, "home");
  src = join(base, "temp-root");
  repoPath = join(base, "repo");
  elsewhere = join(base, "elsewhere");
  for (const d of [home, src, repoPath, elsewhere]) mkdirSync(d, { recursive: true });
  const runsRoot = join(base, "runs");
  process.env.HOME = home;
  process.env.RT_RUNS_ROOT = runsRoot;
  closeStateDb();
  const started = runStart(runsRoot, { repo: "app", workType: "fix", pipeline: "default", env: { RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv });
  if (!started.ok) throw new Error(started.error);
  runDb = started.runDb;
  runId = started.runId;
  env = { ...process.env, RT_RUNS_ROOT: runsRoot, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  closeStateDb();
  rmSync(base, { recursive: true, force: true });
});

const deps = (): EvidenceToolDeps => ({
  ...realEvidenceToolDeps,
  guard: noGuard,
  home: () => home,
  uid: () => null,
  uploadRoots: () => [src],
  repoRoots: () => [],
});

const put = (dir: string, name: string, bytes: Buffer | string) => {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
};

type Recorded = { ok: boolean; error?: string; body?: { written: boolean; value: string; uncovered: Array<{ case: string; slot: string; path: string; why: string }> } };

async function record(images: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): Promise<Recorded> {
  const def = evidenceToolDefs(deps()).find((t) => t.name === "evidence_record")!;
  return (await def.handler({ runDb, stage: "verify", images, ...extra }, env)) as Recorded;
}

const shotIn = (value: string, caseId = "t") => JSON.parse(value).cases.find((c: { id: string }) => c.id === caseId).before;

/** stage-evidence's first call: the saved ticket image with its mark, then the temp-root original deleted. */
async function firstCall(extra: Record<string, unknown> = {}): Promise<{ copy: string; body: NonNullable<Recorded["body"]> }> {
  const original = put(src, `${runId}-t-ticket.png`, TICKET);
  const res = await record([{ case: "t", label: "Broken state", slot: "before", path: original, source: "ticket", ...extra }], { url: "https://tracker.example/CASE-1" });
  expect(res.ok).toBe(true);
  const copy = shotIn(res.body!.value).path as string;
  rmSync(original);
  return { copy, body: res.body! };
}

const upload = (path: string, runIdArg?: string) => {
  const ctx = { repoIndex: () => ({ [REPO]: repoPath }), log: { warn() {}, info() {}, debug() {}, error() {} } as any };
  const handlers = createMrUploadHandlers(ctx, {
    repoContext: async () => ({ provider: { baseURL: "https://gitlab.example.com" }, projectPath: "acme/app", projectId: 99 }),
    gitlabToken: async () => "tok",
    worktreePaths: () => [],
    uploadRoots: () => [],
    tempRoots: () => [elsewhere],
    requestHook: () => ({ onRequest() {} }),
    fetchFn: (async () => new Response(JSON.stringify({ url: "/uploads/x/f.png", markdown: "![f](/uploads/x/f.png)" }), { status: 201 })) as unknown as typeof fetch,
  });
  return handlers["mr:upload"]({ repoName: REPO, path, ...(runIdArg && { runId: runIdArg }) });
};

function expectMarked(value: string, caseId = "t") {
  expect(shotIn(value, caseId)).toMatchObject({ source: "ticket", size: TICKET.length, sha256: TICKET_SHA });
}

async function expectByteCopyRefused() {
  const copy = put(elsewhere, "copy-of-it.png", TICKET);
  expect(await upload(copy)).toEqual(REFUSED("copy-of-it.png"));
  expect(await upload(copy, runId)).toEqual(REFUSED("copy-of-it.png"));
}

describe("a saved ticket image through the evidence skills' call sequence", () => {
  test("annotate pass: the follow-up call names the run-folder copy, without source, and the mark stays", async () => {
    const { copy, body } = await firstCall();
    expect(body.written).toBe(false);
    expect(body.uncovered).toEqual([{ case: "t", slot: "before", path: copy, why: "no-cover" }]);
    const board = put(src, "t-board.png", Buffer.concat([PNG, Buffer.from("board")]));
    const res = await record([{ case: "t", label: "Broken state", slot: "before", path: copy, annotated: board, caption: "the badge overflows" }]);
    expect(res.error).toBeUndefined();
    expect(res.body!.written).toBe(true);
    expectMarked(res.body!.value);
    await expectByteCopyRefused();
  });

  test("caption added later: an annotated first call, then the caption on the copy's path", async () => {
    const board = put(src, "t-board.png", Buffer.concat([PNG, Buffer.from("board")]));
    const { copy, body } = await firstCall({ annotated: board });
    expect(body.uncovered).toEqual([{ case: "t", slot: "before", path: copy, why: "no-caption" }]);
    const boardCopy = shotIn(body.value).annotated as string;
    const res = await record([{ case: "t", label: "Broken state", slot: "before", path: copy, annotated: boardCopy, caption: "c" }]);
    expect(res.body?.written).toBe(true);
    expectMarked(res.body!.value);
    await expectByteCopyRefused();
  });

  test("a waiver attempt on the copy's path, without source, is refused at the write", async () => {
    const { copy } = await firstCall();
    const res = await record([{ case: "t", label: "Broken state", slot: "before", path: copy, waiver: "nothing to mark" }]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("is a ticket image and cannot be waived");
  });

  test("annotate later and re-render: a written record re-annotated on the copy's path keeps the mark", async () => {
    const { copy } = await firstCall();
    const board = put(src, "t-board.png", Buffer.concat([PNG, Buffer.from("board")]));
    await record([{ case: "t", label: "Broken state", slot: "before", path: copy, annotated: board, caption: "c" }]);
    const rerendered = put(src, "t-board-2.png", Buffer.concat([PNG, Buffer.from("board-2")]));
    const res = await record([{ case: "t", slot: "before", path: copy, annotated: rerendered, caption: "c2" }]);
    expect(res.body?.written).toBe(true);
    expectMarked(res.body!.value);
    await expectByteCopyRefused();
  });

  test("the same ticket bytes saved again under another name, without source, are still the ticket image", async () => {
    const { copy } = await firstCall();
    const board = put(src, "t-board.png", Buffer.concat([PNG, Buffer.from("board")]));
    await record([{ case: "t", label: "Broken state", slot: "before", path: copy, annotated: board, caption: "c" }]);
    const resaved = put(src, "screenshot-again.png", TICKET);
    const res = await record([{ case: "t", slot: "before", path: resaved, annotated: board, caption: "c" }]);
    expect(res.body?.written).toBe(true);
    expectMarked(res.body!.value);
    await expectByteCopyRefused();
  });

  test("removed, then recorded again from the copy without source, it is still the ticket image", async () => {
    const { copy } = await firstCall();
    const board = put(src, "t-board.png", Buffer.concat([PNG, Buffer.from("board")]));
    const other = put(src, "other.png", Buffer.concat([PNG, Buffer.from("other")]));
    await record([
      { case: "t", label: "Broken state", slot: "before", path: copy, annotated: board, caption: "c" },
      { case: "o", label: "Other", slot: "before", path: other, waiver: "no ui" },
    ]);
    const removed = await record([], { remove: [{ case: "t" }] });
    expect(removed.body?.written).toBe(true);
    await expectByteCopyRefused();
    const res = await record([{ case: "t", label: "Broken state", slot: "before", path: copy, annotated: board, caption: "c" }]);
    expect(res.body?.written).toBe(true);
    expectMarked(res.body!.value);
  });

  test("a first call that is never followed up still leaves the bytes refused", async () => {
    const { copy } = await firstCall();
    expect(existsSync(copy)).toBe(true);
    await expectByteCopyRefused();
  });

  test("clearing evidence-tickets through run_field_set or rt runs field set is refused, so the bytes stay refused", async () => {
    await firstCall();
    const cleared = JSON.stringify({ v: 1, tickets: [] });
    const viaTool = await realEvidenceToolDeps.runTool("run_field_set", { runDb, key: "evidence-tickets", value: cleared, stage: "verify" }, env);
    expect(viaTool.ok).toBe(false);
    expect(viaTool.error).toStartWith("evidence-tickets ");
    const cli = spawnSync("bun", [resolve(import.meta.dir, "../../../cli.ts"), "runs", "field", "set", "evidence-tickets", "{}", "--stage", "verify"], {
      env: { PATH: process.env.PATH, HOME: home, RT_RUNS_ROOT: env.RT_RUNS_ROOT, RT_RUN_DB: runDb, RT_RUN_EMIT: "0" },
      encoding: "utf8",
    });
    expect(cli.status).toBe(2);
    expect(cli.stdout + cli.stderr).toContain("evidence-tickets ");
    await expectByteCopyRefused();
  });

  test("a genuinely different image recorded at a new path still replaces the slot, unmarked", async () => {
    const { copy } = await firstCall();
    const board = put(src, "t-board.png", Buffer.concat([PNG, Buffer.from("board")]));
    await record([{ case: "t", label: "Broken state", slot: "before", path: copy, annotated: board, caption: "c" }]);
    const fresh = put(src, "fresh.png", Buffer.concat([PNG, Buffer.from("a different capture")]));
    const res = await record([{ case: "t", slot: "before", path: fresh, waiver: "the ui is unchanged" }]);
    expect(res.body?.written).toBe(true);
    const shot = shotIn(res.body!.value);
    expect(shot.source).toBeUndefined();
    expect(shot.sha256).toBeUndefined();
  });
});

/**
 * browser-evidence's import flow: the driver imports the saved ticket image as
 * <stem>.c1 (re-encoded, so other bytes than the ticket image) beside its
 * capture sidecar, composes the board <stem>.png from it with its redaction
 * record and crop, and the board is recorded as the ticket image's cover.
 */
const IMPORTED = Buffer.concat([PNG, Buffer.from("re-encoded ticket pixels")]);
const IMPORTED_2 = Buffer.concat([PNG, Buffer.from("another re-encoded import")]);
const BOARD = Buffer.concat([PNG, Buffer.from("redacted board")]);
const CROP = Buffer.concat([PNG, Buffer.from("crop")]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function importBundle(stem: string, o: { source?: "import" | "live"; capture?: Buffer } = {}) {
  const dir = join(base, "screenshots");
  put(dir, `${stem}.c1.png`, o.capture ?? IMPORTED);
  put(dir, `${stem}.c1.capture.json`, JSON.stringify({ schemaVersion: "capture/1", source: o.source ?? "import", image: `${stem}.c1.png`, origin: "https://tracker.example/CASE-1", format: "png", scale: 1, digest: "d" }));
  put(dir, `${stem}.spec.json`, JSON.stringify({ panels: [{ capture: `${stem}.c1.capture.json`, marks: [{ redact: { x: 0, y: 0, w: 4, h: 4 } }] }] }));
  put(dir, `${stem}.redact-1.png`, CROP);
  put(dir, `${stem}.redactions.json`, JSON.stringify({ schemaVersion: "compose-redactions/1", board: `${stem}.png`, boardSha256: sha(BOARD), redactions: [{ crop: `${stem}.redact-1.png`, sha256: sha(CROP), confirmed: true }] }));
  return put(dir, `${stem}.png`, BOARD);
}

const OK_UPLOAD = { ok: true as const, data: { url: "https://gitlab.example.com/acme/app/uploads/x/f.png", markdown: "![f](/uploads/x/f.png)" } };

describe("the import capture of a saved ticket image", () => {
  const deps2 = () => ({ ...deps(), uploadRoots: () => [src, join(base, "screenshots")] });
  async function recordWith(images: Array<Record<string, unknown>>): Promise<Recorded> {
    const def = evidenceToolDefs(deps2()).find((t) => t.name === "evidence_record")!;
    return (await def.handler({ runDb, stage: "verify", images }, env)) as Recorded;
  }
  async function ticketBoard(stem: string) {
    const original = put(src, `${stem}-ticket.png`, TICKET);
    const first = await recordWith([{ case: "t", label: "Broken state", slot: "before", path: original, source: "ticket" }]);
    expect(first.ok).toBe(true);
    const copy = shotIn(first.body!.value).path as string;
    rmSync(original);
    const res = await recordWith([{ case: "t", label: "Broken state", slot: "before", path: copy, annotated: importBundle(stem), caption: "the badge overflows" }]);
    expect(res.error).toBeUndefined();
    expect(res.body!.written).toBe(true);
    return { board: shotIn(res.body!.value).annotated as string, copy };
  }

  test("a byte copy of the import capture is refused like the ticket image, with and without runId", async () => {
    const stem = `${runId}-t-before`;
    await ticketBoard(stem);
    const copy = put(elsewhere, "capture-copy.png", IMPORTED);
    expect(await upload(copy)).toEqual(REFUSED("capture-copy.png"));
    expect(await upload(copy, runId)).toEqual(REFUSED("capture-copy.png"));
  });

  test("the redacted board composed from it still uploads", async () => {
    const { board } = await ticketBoard(`${runId}-t-before`);
    expect(await upload(board, runId)).toEqual(OK_UPLOAD);
    expect(await upload(board)).toEqual(OK_UPLOAD);
  });

  test("a byte copy of the import capture recorded later, without source, is a ticket image and cannot be waived", async () => {
    await ticketBoard(`${runId}-t-before`);
    const copy = put(src, "capture-again.png", IMPORTED);
    const res = await recordWith([{ case: "o", label: "Other", slot: "before", path: copy, waiver: "no ui" }]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("is a ticket image and cannot be waived");
  });

  test("a byte copy of the import capture waived in the same call as the board is a ticket image and cannot be waived", async () => {
    const stem = `${runId}-t-before`;
    const original = put(src, `${stem}-ticket.png`, TICKET);
    const copy = put(src, "capture-again.png", IMPORTED);
    const res = await recordWith([
      { case: "t", label: "Broken state", slot: "before", path: original, source: "ticket", annotated: importBundle(stem), caption: "c" },
      { case: "o", label: "Other", slot: "before", path: copy, waiver: "no ui" },
    ]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("is a ticket image and cannot be waived");
  });

  test("a byte copy of the import capture recorded with its own import board in the same call marks that board's capture too", async () => {
    const original = put(src, `${runId}-t-ticket.png`, TICKET);
    const copy = put(src, "capture-again.png", IMPORTED);
    const res = await recordWith([
      { case: "t", label: "Broken state", slot: "before", path: original, source: "ticket", annotated: importBundle(`${runId}-t-before`), caption: "c" },
      { case: "o", label: "Other", slot: "before", path: copy, annotated: importBundle(`${runId}-o-before`, { capture: IMPORTED_2 }), caption: "c" },
    ]);
    expect(res.body?.written).toBe(true);
    expect(shotIn(res.body!.value, "o").source).toBe("ticket");
    expect(await upload(put(elsewhere, "second-copy.png", IMPORTED_2))).toEqual(REFUSED("second-copy.png"));
  });

  test("a re-rendered board landing in a content folder has its new import capture remembered there", async () => {
    const stem = `${runId}-t-before`;
    const { board, copy } = await ticketBoard(stem);
    const res = await recordWith([{ case: "t", slot: "before", path: copy, annotated: importBundle(stem, { capture: IMPORTED_2 }), caption: "c2" }]);
    expect(res.body?.written).toBe(true);
    const moved = shotIn(res.body!.value).annotated as string;
    expect(moved).not.toBe(board);
    expect(moved).toMatch(/\/[0-9a-f]{12}\//);
    expect(await upload(put(elsewhere, "rerender-copy.png", IMPORTED_2))).toEqual(REFUSED("rerender-copy.png"));
  });

  test("an import capture over the upload cap never uploads, so it is not measured and the call goes through", async () => {
    const stem = `${runId}-t-before`;
    const original = put(src, `${stem}-ticket.png`, TICKET);
    const board = importBundle(stem);
    truncateSync(join(base, "screenshots", `${stem}.c1.png`), UPLOAD_MAX_BYTES + 1);
    const res = await recordWith([{ case: "t", label: "Broken state", slot: "before", path: original, source: "ticket", annotated: board, caption: "c" }]);
    expect(res.error).toBeUndefined();
    expect(res.body?.written).toBe(true);
  });

  test("an import whose source is not a ticket image is unaffected", async () => {
    const stem = `${runId}-n-before`;
    const plain = put(src, "plain.png", Buffer.concat([PNG, Buffer.from("a saved design mock")]));
    const res = await recordWith([{ case: "n", label: "Mock", slot: "before", path: plain, annotated: importBundle(stem), caption: "c" }]);
    expect(res.body?.written).toBe(true);
    const copy = put(elsewhere, "capture-copy.png", IMPORTED);
    expect(await upload(copy)).toEqual(OK_UPLOAD);
  });

  test("a ticket image annotated directly, with no import, leaves its board's live capture uploadable", async () => {
    const stem = `${runId}-t-before`;
    const original = put(src, `${stem}-ticket.png`, TICKET);
    const live = Buffer.concat([PNG, Buffer.from("a live capture")]);
    const res = await recordWith([{ case: "t", label: "Broken state", slot: "before", path: original, source: "ticket", annotated: importBundle(stem, { source: "live", capture: live }), caption: "c" }]);
    expect(res.body?.written).toBe(true);
    expect(await upload(put(elsewhere, "live-copy.png", live))).toEqual(OK_UPLOAD);
    await expectByteCopyRefused();
  });
});
