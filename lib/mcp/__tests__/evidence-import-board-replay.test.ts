/**
 * Replays ship's evidence calls for a case whose BEFORE is a standalone import
 * board: stage-evidence records the saved ticket image with the board composed
 * from its import, then ship draws a BEFORE → AFTER pair from that board's
 * bundle and records it. Real run db, real copy into the run folder, the
 * daemon's real mr:upload guard behind evidence_attach.
 */
import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { createMrUploadHandlers } from "../../daemon/handlers/mr-upload.ts";
import { runStart } from "../../runs/start.ts";
import { closeStateDb } from "../../state/index.ts";
import { evidenceToolDefs, realEvidenceToolDeps, type EvidenceToolDeps } from "../evidence-tools.ts";
import type { TreeGuardDeps } from "../tree-guard.ts";

const REPO = "remote:gitlab.example.com%2Facme%2Fapp";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const png = (s: string) => Buffer.concat([PNG, Buffer.from(s)]);
const TICKET = png("ticket-bytes");
const IMPORTED = png("re-encoded ticket pixels");
const LIVE_BEFORE = png("a live before capture");
const LIVE_AFTER = png("a live after capture");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
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
let shots: string;
let repoPath: string;
let elsewhere: string;
let runDb: string;
let runId: string;
let env: NodeJS.ProcessEnv;
const saved = { HOME: process.env.HOME, RT_RUNS_ROOT: process.env.RT_RUNS_ROOT };

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "evimport-")));
  home = join(base, "home");
  src = join(base, "temp-root");
  shots = join(base, "screenshots");
  repoPath = join(base, "repo");
  elsewhere = join(base, "elsewhere");
  for (const d of [home, src, shots, repoPath, elsewhere]) mkdirSync(d, { recursive: true });
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

const put = (dir: string, name: string, bytes: Buffer | string) => {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
};

const upload = (path: string, runIdArg?: string) => {
  const ctx = { repoIndex: () => ({ [REPO]: repoPath }), log: { warn() {}, info() {}, debug() {}, error() {} } as any };
  const handlers = createMrUploadHandlers(ctx, {
    repoContext: async () => ({ provider: { baseURL: "https://gitlab.example.com" }, projectPath: "acme/app", projectId: 99 }),
    gitlabToken: async () => "tok",
    worktreePaths: () => [],
    uploadRoots: () => [],
    tempRoots: () => [elsewhere],
    requestHook: () => ({ onRequest() {} }),
    fetchFn: (async (_url: string, init: { body: FormData }) => {
      const name = (init.body.get("file") as File).name;
      return new Response(JSON.stringify({ url: `/uploads/x/${name}`, markdown: `![${name}](/uploads/x/${name})` }), { status: 201 });
    }) as unknown as typeof fetch,
  });
  return handlers["mr:upload"]({ repoName: REPO, path, ...(runIdArg && { runId: runIdArg }) });
};

const deps = (): EvidenceToolDeps => ({
  ...realEvidenceToolDeps,
  guard: noGuard,
  home: () => home,
  uid: () => null,
  uploadRoots: () => [src, shots],
  repoRoots: () => [],
  resolveRepo: async () => ({ ok: true, identity: REPO, iid: undefined }),
  command: (async (cmd: string, payload: { path: string; runId?: string }) => {
    if (cmd !== "mr:upload") throw new Error(`unexpected ${cmd}`);
    return upload(payload.path, payload.runId);
  }) as unknown as EvidenceToolDeps["command"],
});

type Recorded = { ok: boolean; error?: string; body?: { written: boolean; value: string } };
type Attached = { ok: boolean; error?: string; body?: { section: string; uploaded: Array<{ path: string }>; refused: Record<string, unknown[]> } };

const tool = (name: string) => evidenceToolDefs(deps()).find((t) => t.name === name)!;
const record = async (images: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  (await tool("evidence_record").handler({ runDb, stage: "verify", images, ...extra }, env)) as Recorded;
const attach = async () => (await tool("evidence_attach").handler({ runDb, stage: "ship", heading: "## Evidence", repoName: REPO }, env)) as Attached;
const readValue = async () => (await realEvidenceToolDeps.runTool("run_field_get", { runDb, key: "evidence" }, env)).body as { value: string };
const slotOf = (value: string, slot: "before" | "after") => JSON.parse(value).cases.find((c: { id: string }) => c.id === "t")[slot];

function sidecar(dir: string, name: string, source: "import" | "live") {
  put(dir, name, JSON.stringify({ schemaVersion: "capture/1", source, image: name.replace(/\.capture\.json$/, ".png"), origin: "https://tracker.example/CASE-1", format: "png", scale: 1, digest: "d" }));
}

/** A redacted board over its panels, each with a confirmed crop in the compose-redactions record. */
function board(dir: string, stem: string, panels: string[], bytes: Buffer) {
  put(dir, `${stem}.spec.json`, JSON.stringify({ panels: panels.map((capture) => ({ capture, marks: [{ redact: { x: 0, y: 0, w: 4, h: 4 } }] })) }));
  const redactions = panels.map((_, k) => {
    const crop = png(`${stem} crop ${k + 1}`);
    put(dir, `${stem}.redact-${k + 1}.png`, crop);
    return { crop: `${stem}.redact-${k + 1}.png`, sha256: sha(crop), panel: k, confirmed: true };
  });
  put(dir, `${stem}.redactions.json`, JSON.stringify({ schemaVersion: "compose-redactions/1", board: `${stem}.png`, boardSha256: sha(bytes), redactions }));
  return put(dir, `${stem}.png`, bytes);
}

/** stage-evidence: the saved ticket image, then the standalone board composed from its import. */
async function importBefore(): Promise<{ copy: string; before: string }> {
  const stem = `${runId}-t-before`;
  const original = put(src, `${runId}-t-ticket.png`, TICKET);
  const first = await record([{ case: "t", label: "Broken state", slot: "before", path: original, source: "ticket" }], { url: "https://tracker.example/CASE-1" });
  expect(first.ok).toBe(true);
  const copy = slotOf(first.body!.value, "before").path as string;
  rmSync(original);
  put(shots, `${stem}.c1.png`, IMPORTED);
  sidecar(shots, `${stem}.c1.capture.json`, "import");
  const drawn = board(shots, stem, [`${stem}.c1.capture.json`], png("redacted import board"));
  const res = await record([{ case: "t", label: "Broken state", slot: "before", path: copy, annotated: drawn, caption: "the ticket shows no controls" }]);
  expect(res.error).toBeUndefined();
  expect(res.body!.written).toBe(true);
  return { copy, before: slotOf(res.body!.value, "before").annotated as string };
}

/** stage-evidence: a live before capture with its own board. */
async function liveBefore(): Promise<{ copy: string; before: string }> {
  const stem = `${runId}-t-before`;
  const capture = put(shots, `${stem}.c1.png`, LIVE_BEFORE);
  sidecar(shots, `${stem}.c1.capture.json`, "live");
  const drawn = board(shots, stem, [`${stem}.c1.capture.json`], png("live before board"));
  const res = await record([{ case: "t", label: "Broken state", slot: "before", path: capture, annotated: drawn, caption: "no controls" }]);
  expect(res.body!.written).toBe(true);
  const shot = slotOf(res.body!.value, "before");
  return { copy: shot.path, before: shot.annotated };
}

/** ship: the driver copies the before spec's captures in unchanged and composes the pair from them and the live after. */
function drawPair(before: string): { capture: string; pair: string } {
  const beforeStem = basename(before, ".png");
  for (const ext of [".c1.png", ".c1.capture.json"]) copyFileSync(join(dirname(before), `${beforeStem}${ext}`), join(shots, `${beforeStem}${ext}`));
  const stem = `${runId}-t-after`;
  const capture = put(shots, `${stem}.c1.png`, LIVE_AFTER);
  sidecar(shots, `${stem}.c1.capture.json`, "live");
  const pair = board(shots, stem, [`${beforeStem}.c1.capture.json`, `${stem}.c1.capture.json`], png("pair board"));
  return { capture, pair };
}

const CAPTION = "the map now shows zoom controls; the ticket had none";

describe("ship's pair over a standalone import board", () => {
  test("a pair board offered as the before's cover is refused, and the before keeps its import board", async () => {
    const { copy, before } = await importBefore();
    const { capture, pair } = drawPair(before);
    const res = await record([
      { case: "t", slot: "after", path: capture, annotated: pair, caption: CAPTION },
      { case: "t", slot: "before", path: copy, annotated: pair, caption: CAPTION },
    ]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('case "t" before');
    expect(res.error).toContain("standalone import board");
    expect(slotOf((await readValue()).value, "before").annotated).toBe(before);
  });

  test("a pair whose spec reaches the import capture by path, without copying it, is refused as the before's cover too", async () => {
    const { copy, before } = await importBefore();
    const beforeStem = basename(before, ".png");
    const stem = `${runId}-t-after`;
    const capture = put(shots, `${stem}.c1.png`, LIVE_AFTER);
    sidecar(shots, `${stem}.c1.capture.json`, "live");
    const pair = board(shots, stem, [join(dirname(before), `${beforeStem}.c1.capture.json`), `${stem}.c1.capture.json`], png("pair board"));
    const res = await record([
      { case: "t", slot: "after", path: capture, annotated: pair, caption: CAPTION },
      { case: "t", slot: "before", path: copy, annotated: pair, caption: CAPTION },
    ]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("standalone import board");
  });

  test("a pair whose before sidecar names the import pixels under another file name is refused as the before's cover too", async () => {
    const { copy, before } = await importBefore();
    const stem = `${runId}-t-after`;
    copyFileSync(join(dirname(before), `${basename(before, ".png")}.c1.png`), join(shots, "renamed-pixels.png"));
    put(shots, "renamed.c1.png", png("innocent bytes"));
    put(shots, "renamed.c1.capture.json", JSON.stringify({ schemaVersion: "capture/1", source: "live", image: "renamed-pixels.png" }));
    const capture = put(shots, `${stem}.c1.png`, LIVE_AFTER);
    sidecar(shots, `${stem}.c1.capture.json`, "live");
    const pair = board(shots, stem, ["renamed.c1.capture.json", `${stem}.c1.capture.json`], png("pair board"));
    const res = await record([
      { case: "t", slot: "after", path: capture, annotated: pair, caption: CAPTION },
      { case: "t", slot: "before", path: copy, annotated: pair, caption: CAPTION },
    ]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("standalone import board");
  });

  test("the pair recorded on the after alone: both boards are in the record and in the section", async () => {
    const { before } = await importBefore();
    const { capture, pair } = drawPair(before);
    const res = await record([{ case: "t", slot: "after", path: capture, annotated: pair, caption: CAPTION }]);
    expect(res.error).toBeUndefined();
    expect(res.body!.written).toBe(true);
    expect(slotOf(res.body!.value, "before").annotated).toBe(before);
    const after = slotOf(res.body!.value, "after").annotated as string;
    expect(basename(after)).toBe(basename(pair));
    const attached = await attach();
    expect(attached.error).toBeUndefined();
    expect(Object.values(attached.body!.refused).flat()).toEqual([]);
    expect(attached.body!.uploaded.map((u) => u.path).sort()).toEqual([before, after].sort());
    expect(attached.body!.section).toContain(`/uploads/x/${basename(before)}`);
    expect(attached.body!.section).toContain(`/uploads/x/${basename(after)}`);
  });

  test("the before's import capture is remembered, so a byte copy is refused while the redacted board uploads", async () => {
    const { before } = await importBefore();
    const { capture, pair } = drawPair(before);
    await record([{ case: "t", slot: "after", path: capture, annotated: pair, caption: CAPTION }]);
    expect(await upload(put(elsewhere, "capture-copy.png", IMPORTED))).toEqual(REFUSED("capture-copy.png"));
    expect(await upload(put(elsewhere, "capture-copy-2.png", IMPORTED), runId)).toEqual(REFUSED("capture-copy-2.png"));
    expect(await upload(put(elsewhere, "ticket-copy.png", TICKET))).toEqual(REFUSED("ticket-copy.png"));
    expect((await upload(before, runId)).ok).toBe(true);
  });

  test("a re-rendered import board still replaces the before's cover", async () => {
    const { copy, before } = await importBefore();
    const stem = `${runId}-t-before`;
    for (const ext of [".c1.png", ".c1.capture.json"]) copyFileSync(join(dirname(before), `${stem}${ext}`), join(shots, `${stem}${ext}`));
    const redrawn = board(shots, stem, [`${stem}.c1.capture.json`], png("redacted import board, wider"));
    const res = await record([{ case: "t", slot: "before", path: copy, annotated: redrawn, caption: "c2" }]);
    expect(res.error).toBeUndefined();
    expect(res.body!.written).toBe(true);
    expect(slotOf(res.body!.value, "before").annotated).not.toBe(before);
  });

  test("a live recapture of the before with a board of its own still replaces the import board", async () => {
    const { before } = await importBefore();
    const stem = `${runId}-t-before-live`;
    const capture = put(shots, `${stem}.c1.png`, LIVE_BEFORE);
    sidecar(shots, `${stem}.c1.capture.json`, "live");
    const drawn = board(shots, stem, [`${stem}.c1.capture.json`], png("live before board"));
    const res = await record([{ case: "t", slot: "before", path: capture, annotated: drawn, caption: "no controls" }]);
    expect(res.error).toBeUndefined();
    expect(slotOf(res.body!.value, "before").annotated).not.toBe(before);
  });
});

describe("ship's pair over a live before board", () => {
  test("the pair board covers the before too, as before", async () => {
    const { copy, before } = await liveBefore();
    const { capture, pair } = drawPair(before);
    const res = await record([
      { case: "t", slot: "after", path: capture, annotated: pair, caption: CAPTION },
      { case: "t", slot: "before", path: copy, annotated: pair, caption: CAPTION },
    ]);
    expect(res.error).toBeUndefined();
    expect(res.body!.written).toBe(true);
    const value = res.body!.value;
    expect(slotOf(value, "before").annotated).toBe(slotOf(value, "after").annotated);
    expect(basename(slotOf(value, "before").annotated)).toBe(basename(pair));
  });
});

