import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, truncateSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import type { RtResponse } from "../../../packages/rt-client/src/index.ts";
import { UPLOAD_MAX_BYTES } from "../../daemon/upload-guard.ts";
import { runStart } from "../../runs/start.ts";
import { spliceSection } from "../../evidence/section.ts";
import { parseUploads, serializeUploads, sha256Of } from "../../evidence/uploads-field.ts";
import { evidenceToolDefs, MR_UPLOAD_TIMEOUT_MS, realEvidenceToolDeps, uploadEach, type EvidenceToolDeps } from "../evidence-tools.ts";
import { err, ok, type ToolResult } from "../shared.ts";
import type { TreeGuardDeps } from "../tree-guard.ts";

const RUN_ID = "20261016-120000-abcd-1";
const IDENT = "remote:gitlab.com%2Facme%2Fweb";
const MR_URL = "https://gitlab.com/acme/web/-/merge_requests/7";
const HEADING = "## Verification Evidence";

let base: string;
let home: string;
let src: string;
let runsRoot: string;
let runDb: string;
const savedEnv = { HOME: process.env.HOME, RT_RUNS_ROOT: process.env.RT_RUNS_ROOT };

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "evtools-")));
  home = join(base, "home");
  src = join(base, "src");
  runsRoot = join(base, "runs");
  mkdirSync(home, { recursive: true });
  mkdirSync(src, { recursive: true });
  mkdirSync(join(runsRoot, "web", RUN_ID), { recursive: true });
  runDb = join(runsRoot, "web", RUN_ID, "state.db");
  writeFileSync(runDb, "");
  process.env.HOME = home;
  process.env.RT_RUNS_ROOT = runsRoot;
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(base, { recursive: true, force: true });
});

const put = (name: string, body = name, dir = src) => {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};
const evidenceDir = (c?: string) => join(home, ".mattstack", "work", RUN_ID, "evidence", ...(c ? [c] : []));

type Call = { cmd: string; payload: Record<string, unknown> };
type Responder = (cmd: string, payload: Record<string, unknown>, nth: number) => RtResponse<unknown> | undefined;

const okRes = (data: unknown): RtResponse<unknown> => ({ ok: true, data }) as RtResponse<unknown>;
const errRes = (error: string): RtResponse<unknown> => ({ ok: false, error }) as RtResponse<unknown>;

const noGuard: TreeGuardDeps = {
  repoIndex: () => ({}),
  treeByPath: () => null,
  realpath: (p) => realpathSync(p),
  worktreeRoots: () => [],
  hasGitEntry: () => false,
  ignoredBy: () => false,
};

function makeDeps(o: { fields?: Record<string, string>; respond?: Responder; fieldSetError?: string; guard?: TreeGuardDeps; repoRoots?: (id: string) => string[]; live?: string } = {}) {
  const fields = new Map(Object.entries(o.fields ?? {}));
  const calls: Call[] = [];
  const runCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const perPath = new Map<string, number>();
  const state = { live: o.live ?? "" };
  const command = (async (cmd: string, payload: Record<string, unknown>) => {
    calls.push({ cmd, payload });
    const key = `${cmd}\0${String(payload.path ?? "")}`;
    const nth = (perPath.get(key) ?? 0) + 1;
    perPath.set(key, nth);
    const scripted = o.respond?.(cmd, payload, nth);
    if (scripted) return scripted;
    if (cmd === "mr:upload") {
      const name = basename(String(payload.path));
      return okRes({ url: `https://gitlab.com/acme/web/uploads/h${nth}/${name}`, markdown: `![${name}](/uploads/h${nth}/${name})` });
    }
    if (cmd === "mr:get") return okRes({ mr: { iid: payload.iid, description: state.live, webUrl: MR_URL }, fetchedAt: 0 });
    if (cmd === "mr:update") {
      state.live = String(payload.description);
      return okRes({ iid: payload.iid, url: MR_URL, applied: ["description"] });
    }
    return errRes(`unscripted ${cmd}`);
  }) as unknown as EvidenceToolDeps["command"];
  const deps: EvidenceToolDeps = {
    command,
    async runTool(name, input): Promise<ToolResult> {
      runCalls.push({ name, input });
      if (name === "run_field_get") {
        const v = fields.get(String(input.key));
        return v === undefined ? err(`field "${String(input.key)}" is not set on this run`) : ok({ value: v });
      }
      if (name === "run_field_set") {
        if (o.fieldSetError && input.key === "evidence") return err(o.fieldSetError);
        fields.set(String(input.key), String(input.value));
        return ok({ ok: true });
      }
      return ok({ ok: true, run: { id: RUN_ID, repo: "web" }, stages: [], fields: [...fields].map(([key, value]) => ({ key, value })), decisions: [] });
    },
    guard: o.guard ?? noGuard,
    async resolveRepo(input) {
      if (typeof input.mrUrl === "string") {
        const m = /^https:\/\/gitlab\.com\/acme\/(\w+)\/-\/merge_requests\/(\d+)$/.exec(input.mrUrl);
        return m ? { ok: true, identity: `remote:gitlab.com%2Facme%2F${m[1]}`, iid: Number(m[2]) } : { ok: false, error: "mrUrl must look like an MR URL" };
      }
      if (typeof input.repoName === "string") return { ok: true, identity: IDENT, iid: typeof input.iid === "number" ? input.iid : undefined };
      return { ok: false, error: 'pass "repoName" or "mrUrl"' };
    },
    home: () => home,
    uid: () => null,
    uploadRoots: () => [src],
    repoRoots: o.repoRoots ?? (() => []),
    fetch: (() => Promise.reject(new Error("no fetch in tests"))) as unknown as typeof fetch,
    sleep: async () => {},
    now: () => 1_700_000_000_000,
  };
  return { deps, calls, runCalls, fields, state };
}

const tool = (deps: EvidenceToolDeps, name: string) => evidenceToolDefs(deps).find((t) => t.name === name)!;
const env = {} as NodeJS.ProcessEnv;
const uploads = (calls: Call[]) => calls.filter((c) => c.cmd === "mr:upload");
const v2 = (cases: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ v: 2, cases, ...extra });

describe("tool defs", () => {
  test("both schemas are closed and the descriptions say what each writes or when it runs", () => {
    const defs = evidenceToolDefs(makeDeps().deps);
    const record = defs.find((t) => t.name === "evidence_record")!;
    const attach = defs.find((t) => t.name === "evidence_attach")!;
    for (const t of [record, attach]) expect((t.inputSchema as { additionalProperties?: unknown }).additionalProperties).toBe(false);
    expect(record.description).toContain("evidence field");
    expect(attach.description).toContain("attach gate's proceed");
    expect(MR_UPLOAD_TIMEOUT_MS).toBe(120_000);
  });
});

describe("evidence_record", () => {
  test("missing stage is an error", async () => {
    const { deps } = makeDeps();
    const res = await tool(deps, "evidence_record").handler({ runDb, images: [] }, env);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("stage");
  });

  test("an annotated, captioned temp-root image copies its bundle into the run folder and writes the copied paths", async () => {
    const shot = put("badge-after.c1.png");
    const board = put("badge-after.png");
    put("badge-after.spec.json");
    put("unrelated.png");
    const { deps, fields } = makeDeps();
    const res = await tool(deps, "evidence_record").handler(
      { runDb, stage: "verify", images: [{ case: "retry-badge", label: "Retry badge", slot: "after", path: shot, annotated: board, caption: "the badge" }] },
      env,
    );
    expect(res.ok).toBe(true);
    const body = res.body as { written: boolean; encoding: string; value: string; copied: Array<{ from: string; to: string }>; uncovered: unknown[] };
    expect(body.written).toBe(true);
    expect(body.encoding).toBe("evidence@2");
    expect(body.uncovered).toEqual([]);
    const dest = evidenceDir("retry-badge");
    expect(body.copied.map((c) => c.to).sort()).toEqual([join(dest, "badge-after.c1.png"), join(dest, "badge-after.png"), join(dest, "badge-after.spec.json")]);
    expect(existsSync(join(dest, "unrelated.png"))).toBe(false);
    const written = JSON.parse(fields.get("evidence")!);
    expect(written.cases[0].after).toEqual({ path: join(dest, "badge-after.c1.png"), annotated: join(dest, "badge-after.png"), caption: "the badge" });
    expect(body.value).toBe(fields.get("evidence")!);
  });

  test("an uncovered image copies but writes nothing", async () => {
    const shot = put("bare.png");
    const { deps, runCalls } = makeDeps();
    const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "retry-badge", label: "Retry badge", slot: "before", path: shot }] }, env);
    expect(res.ok).toBe(true);
    const body = res.body as { written: boolean; uncovered: Array<{ why: string; case: string; slot: string; path: string }>; copied: unknown[] };
    expect(body.written).toBe(false);
    expect(body.uncovered[0]!.why).toBe("no-cover");
    expect(body.uncovered[0]!.path).toBe(join(evidenceDir("retry-badge"), "bare.png"));
    expect(body.copied.length).toBeGreaterThan(0);
    expect(runCalls.some((c) => c.name === "run_field_set")).toBe(false);
  });

  test("a source outside the allowed roots is refused by name; nothing copied or written", async () => {
    const outside = put("stray.png", "x", join(base, "elsewhere"));
    const { deps, runCalls } = makeDeps();
    const res = await tool(deps, "evidence_record").handler(
      { runDb, stage: "verify", images: [{ case: "retry-badge", label: "Retry badge", slot: "before", path: outside, waiver: "no ui" }] },
      env,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain(outside);
    expect(existsSync(evidenceDir())).toBe(false);
    expect(runCalls.some((c) => c.name === "run_field_set")).toBe(false);
  });

  const slugRunDb = () => {
    mkdirSync(join(runsRoot, "gitlab.com-acme-web", RUN_ID), { recursive: true });
    const db = join(runsRoot, "gitlab.com-acme-web", RUN_ID, "state.db");
    writeFileSync(db, "");
    return db;
  };

  test("a checkout source is admitted only when tree names that repo", async () => {
    const checkout = join(base, "web");
    const shot = put("shot.png", "s", checkout);
    const guard: TreeGuardDeps = { ...noGuard, repoIndex: () => ({ [IDENT]: checkout }) };
    const input = { runDb: slugRunDb(), stage: "verify", images: [{ case: "retry-badge", label: "Retry badge", slot: "before", path: shot, waiver: "no ui" }] };
    const without = await tool(makeDeps({ guard, repoRoots: () => [checkout] }).deps, "evidence_record").handler(input, env);
    expect(without.ok).toBe(false);
    const withTree = await tool(makeDeps({ guard, repoRoots: (id) => (id === IDENT ? [checkout] : []) }).deps, "evidence_record").handler({ ...input, tree: checkout }, env);
    expect(withTree.ok).toBe(true);
    expect((withTree.body as { written: boolean }).written).toBe(true);
  });

  test("a tree from another repo than the run's is refused before any copy, naming both", async () => {
    const checkout = join(base, "api");
    const shot = put("shot.png", "s", checkout);
    const other = "remote:gitlab.com%2Facme%2Fapi";
    const guard: TreeGuardDeps = { ...noGuard, repoIndex: () => ({ [other]: checkout }) };
    const { deps, runCalls } = makeDeps({ guard, repoRoots: () => [checkout] });
    const res = await tool(deps, "evidence_record").handler(
      { runDb: slugRunDb(), stage: "verify", tree: checkout, images: [{ case: "retry-badge", label: "Retry badge", slot: "before", path: shot, waiver: "no ui" }] },
      env,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain(other);
    expect(res.error).toContain("gitlab.com-acme-web");
    expect(existsSync(evidenceDir())).toBe(false);
    expect(runCalls.some((c) => c.name === "run_field_set")).toBe(false);
  });

  test("a case id that is not a plain slug is refused before any copy", async () => {
    const shot = put("a.png");
    const { deps } = makeDeps();
    const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "../escape", label: "x", slot: "before", path: shot, waiver: "w" }] }, env);
    expect(res.ok).toBe(false);
    expect(existsSync(join(home, ".mattstack"))).toBe(false);
  });

  test("plan none alongside anything else is refused before any read", async () => {
    const others: Array<Record<string, unknown>> = [
      { url: "https://example.com/t/1" },
      { transcript: "/t.txt" },
      { images: [{ case: "a", slot: "before", waiver: "w" }] },
      { cases: [{ id: "a", label: "A" }] },
      { remove: [{ case: "a" }] },
    ];
    for (const extra of others) {
      const { deps, runCalls } = makeDeps();
      const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", plan: "none", ...extra }, env);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('plan "none" clears the record; pass nothing else');
      expect(runCalls).toEqual([]);
    }
  });

  test("a pair board refreshed through one slot overwrites the shared copy", async () => {
    const dir = evidenceDir("retry-badge");
    const board = put("badge.png", "old board", dir);
    const before = put("badge.c1.png", "b", dir);
    const after = put("badge.c2.png", "a", dir);
    const evidence = v2([{ id: "retry-badge", label: "Retry badge", before: { path: before, annotated: board, caption: "pair" }, after: { path: after, annotated: board, caption: "pair" } }]);
    const fresh = put("badge.png", "new board");
    const { deps, fields } = makeDeps({ fields: { evidence } });
    const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "retry-badge", slot: "after", annotated: fresh, caption: "pair" }] }, env);
    expect(res.ok).toBe(true);
    expect((res.body as { written: boolean }).written).toBe(true);
    expect(readFileSync(board, "utf8")).toBe("new board");
    const written = JSON.parse(fields.get("evidence")!);
    expect(written.cases[0].before.annotated).toBe(board);
    expect(written.cases[0].after.annotated).toBe(board);
  });

  test("a recapture to the same file name drops the old cover instead of keeping it", async () => {
    const { deps, fields } = makeDeps();
    const shot = put("badge-after.c1.png", "capture v1");
    const board = put("badge-after.png", "board v1");
    const first = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "retry-badge", label: "Retry", slot: "after", path: shot, annotated: board, caption: "v1 marks" }] }, env);
    expect((first.body as { written: boolean }).written).toBe(true);
    writeFileSync(shot, "capture v2");
    const second = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "retry-badge", slot: "after", path: shot }] }, env);
    const body = second.body as { written: boolean; uncovered: Array<{ why: string }> };
    expect(body.written).toBe(false);
    expect(body.uncovered.map((u) => u.why)).toEqual(["no-cover"]);
    expect(JSON.parse(fields.get("evidence")!).cases[0].after.caption).toBe("v1 marks");
  });

  test("an unchanged capture sent again with a new board is a cover update", async () => {
    const { deps, fields } = makeDeps();
    const shot = put("badge-after.c1.png", "capture");
    const board = put("badge-after.png", "board v1");
    await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "retry-badge", label: "Retry", slot: "after", path: shot, annotated: board, caption: "v1" }] }, env);
    writeFileSync(board, "board v2");
    const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "retry-badge", slot: "after", path: shot, annotated: board, caption: "v2" }] }, env);
    expect((res.body as { written: boolean }).written).toBe(true);
    expect(JSON.parse(fields.get("evidence")!).cases[0].after.caption).toBe("v2");
    expect(readFileSync(join(evidenceDir("retry-badge"), "badge-after.png"), "utf8")).toBe("board v2");
  });

  test("a themed refresh with one theme's capture resent and the other cover-only succeeds", async () => {
    const { deps, fields } = makeDeps();
    for (const n of ["l.c1.png", "l.png", "d.c1.png", "d.png"]) put(n);
    const im = (theme: string, p: string) => ({ case: "c", label: "C", slot: "after", theme, path: join(src, `${p}.c1.png`), annotated: join(src, `${p}.png`), caption: "x" });
    const first = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [im("light", "l"), im("dark", "d")] }, env);
    expect(first.ok).toBe(true);
    writeFileSync(join(src, "l.png"), "l board v2");
    const second = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [im("light", "l"), { case: "c", slot: "after", theme: "dark", annotated: join(src, "d.png"), caption: "y" }] }, env);
    expect(second.ok).toBe(true);
    expect((second.body as { written: boolean }).written).toBe(true);
    const after = JSON.parse(fields.get("evidence")!).cases[0].after;
    expect(after.dark.caption).toBe("y");
    expect(after.light.caption).toBe("x");
  });

  test("one source used by two cases points each case into its own folder", async () => {
    const shot = put("shared.png");
    const { deps, fields } = makeDeps();
    const res = await tool(deps, "evidence_record").handler({
      runDb, stage: "verify",
      images: [{ case: "one", label: "One", slot: "before", path: shot, waiver: "w" }, { case: "two", label: "Two", slot: "before", path: shot, waiver: "w" }],
    }, env);
    expect((res.body as { written: boolean }).written).toBe(true);
    const cases = JSON.parse(fields.get("evidence")!).cases;
    expect(cases[0].before.path).toBe(join(evidenceDir("one"), "shared.png"));
    expect(cases[1].before.path).toBe(join(evidenceDir("two"), "shared.png"));
  });

  test("a fieldSet refusal comes back verbatim, still naming what was copied", async () => {
    const shot = put("a.png");
    const refusal = 'evidence@2: case "a" has no annotated image and no waiver; annotate it or add a waiver with a reason';
    const { deps } = makeDeps({ fieldSetError: refusal });
    const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "a", label: "A", slot: "before", path: shot, waiver: "w" }] }, env);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(`${refusal} (the files were copied: ${join(evidenceDir("a"), "a.png")})`);
  });

  test("against a real run db through the run tools' handlers", async () => {
    const started = runStart(runsRoot, { repo: "web", workType: "fix", pipeline: "default", env: { RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv });
    if (!started.ok) throw new Error(started.error);
    const realEnv = { ...process.env, RT_RUNS_ROOT: runsRoot, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv;
    const { deps: fake } = makeDeps();
    const deps = { ...fake, runTool: realEvidenceToolDeps.runTool };
    const board = put("pair.png");
    const res = await tool(deps, "evidence_record").handler(
      { runDb: started.runDb, stage: "verify", images: [{ case: "retry-badge", label: "Retry badge", slot: "before", path: board, waiver: "nothing to show" }] },
      realEnv,
    );
    expect(res.ok).toBe(true);
    expect((res.body as { written: boolean }).written).toBe(true);
    const read = await realEvidenceToolDeps.runTool("run_field_get", { runDb: started.runDb, key: "evidence" }, realEnv);
    const dest = join(home, ".mattstack", "work", started.runId, "evidence", "retry-badge", "pair.png");
    expect(JSON.parse((read.body as { value: string }).value).cases[0].before.path).toBe(dest);

    const attach = await tool(deps, "evidence_attach").handler({ runDb: started.runDb, stage: "ship", heading: HEADING, repoName: "web" }, realEnv);
    expect(attach.ok).toBe(true);
    expect((attach.body as { notWritten: string }).notWritten).toBe("no-mr");
    const remembered = await realEvidenceToolDeps.runTool("run_field_get", { runDb: started.runDb, key: "evidence-uploads" }, realEnv);
    expect(Object.keys(parseUploads((remembered.body as { value: string }).value))).toEqual([dest]);
  });
});

function boardRecord(dir = evidenceDir("retry-badge")) {
  const before = put("badge.c1.png", "before", dir);
  const after = put("badge.c2.png", "after", dir);
  const board = put("badge.png", "board", dir);
  const evidence = v2([{ id: "retry-badge", label: "Retry badge", before: { path: before, annotated: board, caption: "pair" }, after: { path: after, annotated: board, caption: "pair" } }]);
  return { before, after, board, evidence };
}

function twoWaived() {
  const dir = evidenceDir("retry-badge");
  const one = put("one.png", "1", dir);
  const two = put("two.png", "2", dir);
  const evidence = v2([{ id: "retry-badge", label: "Retry badge", before: { path: one, waiver: "w1" }, after: { path: two, waiver: "w2" } }]);
  return { one, two, evidence };
}

type AttachBody = {
  forge: string; mr: string | null; uploaded: Array<{ path: string; url: string; markdown: string; reused: boolean }>;
  refused: Record<string, Array<{ path: string; error: string }>>; timedOutTwice: string[]; section: string;
  description?: string; descriptionWritten: boolean; notWritten?: string; writeErrors?: string[];
};

describe("evidence_attach", () => {
  test("a pair board shared by before and after uploads once, carrying runId", async () => {
    const { board, evidence } = boardRecord();
    const { deps, calls } = makeDeps({ fields: { evidence } });
    const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env);
    expect(res.ok).toBe(true);
    const ups = uploads(calls);
    expect(ups.length).toBe(1);
    expect(ups[0]!.payload).toMatchObject({ repoName: IDENT, path: board, runId: RUN_ID });
    const body = res.body as AttachBody;
    expect(body.section).toContain("- Before and after: ![before and after](/uploads/h1/badge.png)");
    expect(body.descriptionWritten).toBe(true);
  });

  test("a timeout then success uploads after one retry", async () => {
    const { one, evidence } = twoWaived();
    const respond: Responder = (cmd, p, nth) => (cmd === "mr:upload" && p.path === one && nth === 1 ? errRes("request timed out") : undefined);
    const { deps, calls } = makeDeps({ fields: { evidence }, respond });
    const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env);
    const body = res.body as AttachBody;
    expect(uploads(calls).filter((c) => c.payload.path === one).length).toBe(2);
    expect(body.uploaded.map((u) => u.path)).toEqual([one, expect.any(String)]);
    expect(body.timedOutTwice).toEqual([]);
  });

  test("two timeouts land in timedOutTwice, the next file still uploads, and nothing is written", async () => {
    const { one, two, evidence } = twoWaived();
    const respond: Responder = (cmd, p) => (cmd === "mr:upload" && p.path === one ? errRes("request timed out") : undefined);
    const { deps, calls } = makeDeps({ fields: { evidence }, respond });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    expect(body.timedOutTwice).toEqual([one]);
    expect(body.uploaded.map((u) => u.path)).toEqual([two]);
    expect(body.notWritten).toBe("refused");
    expect(calls.some((c) => c.cmd === "mr:update")).toBe(false);
  });

  test("a raw-capture refusal is bucketed and blocks the description write", async () => {
    const { one, evidence } = twoWaived();
    const respond: Responder = (cmd, p) => (cmd === "mr:upload" && p.path === one ? errRes(`${one} is the raw capture for case "retry-badge"; upload its annotated image`) : undefined);
    const { deps, calls } = makeDeps({ fields: { evidence }, respond });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    expect(body.refused["raw-capture"]!.map((r) => r.path)).toEqual([one]);
    expect(body.section).not.toContain(one);
    expect(body.refused.record).toEqual([]);
    expect(body.notWritten).toBe("refused");
    expect(calls.some((c) => c.cmd === "mr:update")).toBe(false);
  });

  test("a refusal whose text says timeout is a refusal, not a timeout: no retry, bucketed", async () => {
    const { one, evidence } = twoWaived();
    const refusal = `${one} is the raw capture for case "session-timeout"; upload its annotated image`;
    const respond: Responder = (cmd, p) => (cmd === "mr:upload" && p.path === one ? errRes(refusal) : undefined);
    const { deps, calls } = makeDeps({ fields: { evidence }, respond });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    expect(uploads(calls).filter((c) => c.payload.path === one).length).toBe(1);
    expect(body.timedOutTwice).toEqual([]);
    expect(body.refused["raw-capture"]).toEqual([{ path: one, error: refusal }]);
  });

  test("linkRefused prints the refused file's local path, writes, and remembers it as linked", async () => {
    const { one, evidence } = twoWaived();
    const respond: Responder = (cmd, p) => (cmd === "mr:upload" && p.path === one ? errRes("path is outside the allowed upload roots (...)") : undefined);
    const { deps, calls, fields } = makeDeps({ fields: { evidence }, respond });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL, linkRefused: true }, env)).body as AttachBody;
    expect(body.section).toContain(`- Before: ${one}`);
    expect(body.descriptionWritten).toBe(true);
    expect(calls.some((c) => c.cmd === "mr:update")).toBe(true);
    expect(parseUploads(fields.get("evidence-uploads")!)[realpathSync(one)]).toEqual({ linked: true, at: 1_700_000_000_000 });
  });

  test("a resumed call without linkRefused keeps a remembered linked file linked: no re-upload, no refusal", async () => {
    const { one, evidence } = twoWaived();
    const respond: Responder = (cmd, p) => (cmd === "mr:upload" && p.path === one ? errRes("path is outside the allowed upload roots (...)") : undefined);
    const { deps, calls } = makeDeps({ fields: { evidence }, respond });
    await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL, linkRefused: true }, env);
    const before = calls.length;
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    expect(uploads(calls.slice(before)).some((c) => c.payload.path === one)).toBe(false);
    expect(Object.values(body.refused).flat()).toEqual([]);
    expect(body.section).toContain(`- Before: ${one}`);
    expect(body.notWritten).toBe("unchanged");
  });

  test("reuse: a matching sha256 and project skips the upload; new bytes or a redaction record re-upload", async () => {
    const { board, evidence } = boardRecord();
    const prior = serializeUploads({ [realpathSync(board)]: { sha256: sha256Of(board), project: IDENT, url: "https://gitlab.com/acme/web/uploads/old/badge.png", markdown: "![badge](/uploads/old/badge.png)", at: 1 } });
    const run = async () => {
      const { deps, calls } = makeDeps({ fields: { evidence, "evidence-uploads": prior } });
      const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
      return { body, ups: uploads(calls).length };
    };
    const reused = await run();
    expect(reused.ups).toBe(0);
    expect(reused.body.uploaded).toEqual([{ path: board, url: "https://gitlab.com/acme/web/uploads/old/badge.png", markdown: "![badge](/uploads/old/badge.png)", reused: true }]);

    writeFileSync(board, "revised board");
    expect((await run()).ups).toBe(1);

    writeFileSync(board, "board");
    expect((await run()).ups).toBe(0);
    put("badge.redactions.json", "{}", evidenceDir("retry-badge"));
    expect((await run()).ups).toBe(1);
  });

  test("a FIFO or an oversize file in the record is never read: it goes to the daemon unhashed and is not remembered", async () => {
    const dir = evidenceDir("retry-badge");
    mkdirSync(dir, { recursive: true });
    const fifo = join(dir, "pipe.png");
    expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
    const big = put("big.png", "", dir);
    truncateSync(big, UPLOAD_MAX_BYTES + 1);
    const evidence = v2([{ id: "retry-badge", label: "Retry badge", before: { path: fifo, waiver: "w1" }, after: { path: big, waiver: "w2" } }]);
    const prior = serializeUploads({ [realpathSync(fifo)]: { sha256: "x", project: IDENT, url: "u", markdown: "![p](u)", at: 1 } });
    const { deps, calls, fields } = makeDeps({ fields: { evidence, "evidence-uploads": prior } });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    expect(uploads(calls).map((c) => c.payload.path)).toEqual([fifo, big]);
    expect(body.uploaded.every((u) => !u.reused)).toBe(true);
    expect(Object.keys(parseUploads(fields.get("evidence-uploads")!))).toEqual([realpathSync(fifo)]);
  }, 5000);

  test("description: the live text is spliced and written; a second all-reused call leaves it unchanged", async () => {
    const { evidence } = boardRecord();
    const live = "## What\n\nAdds a badge.\n\n## Verification Evidence\n\n_Show it working_\n\nold text\n";
    const { deps, calls } = makeDeps({ fields: { evidence }, live });
    const first = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    const update = calls.find((c) => c.cmd === "mr:update")!;
    expect(update.payload.description).toBe(spliceSection(live, HEADING, first.section));
    expect(String(update.payload.description)).not.toContain("old text");
    expect(String(update.payload.description)).toContain("_Show it working_");

    const before = calls.length;
    const second = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    const later = calls.slice(before);
    expect(later.some((c) => c.cmd === "mr:upload" || c.cmd === "mr:update")).toBe(false);
    expect(second.uploaded.every((u) => u.reused)).toBe(true);
    expect(second.notWritten).toBe("unchanged");
    expect(second.descriptionWritten).toBe(false);
  });

  test("an appendix that would break the next splice is refused before anything outward", async () => {
    const { evidence } = boardRecord();
    for (const [appendix, says] of [["<details>\n\n## Log\n\nline\n\n</details>", "## Log"], ["```\nlog without close", "fence"]] as const) {
      const { deps, calls, runCalls } = makeDeps({ fields: { evidence } });
      const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL, appendix }, env);
      expect(res.ok).toBe(false);
      expect(res.error).toContain(says);
      expect(calls.length).toBe(0);
      expect(runCalls.length).toBe(0);
    }
    const { deps } = makeDeps({ fields: { evidence } });
    const fine = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL, appendix: "### Log\n\n```\nline\n```" }, env);
    expect(fine.ok).toBe(true);
  });

  test("no MR anywhere and no repoName is an error", async () => {
    const { evidence } = boardRecord();
    const { deps, calls } = makeDeps({ fields: { evidence } });
    const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING }, env);
    expect(res.ok).toBe(false);
    expect(calls.length).toBe(0);
  });

  test("repoName only uploads and hands back the section, splicing a passed description", async () => {
    const { evidence } = boardRecord();
    const { deps, calls } = makeDeps({ fields: { evidence } });
    const draft = "## What\n\nAdds a badge.\n";
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, repoName: "web", description: draft }, env)).body as AttachBody;
    expect(uploads(calls).length).toBe(1);
    expect(calls.some((c) => c.cmd === "mr:get" || c.cmd === "mr:update")).toBe(false);
    expect(body.notWritten).toBe("no-mr");
    expect(body.mr).toBeNull();
    expect(body.description).toBe(spliceSection(draft, HEADING, body.section));
  });

  test("the run's mr field is the target when none is passed", async () => {
    const { evidence } = boardRecord();
    const { deps, calls } = makeDeps({ fields: { evidence, mr: MR_URL } });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING }, env)).body as AttachBody;
    expect(body.mr).toBe(MR_URL);
    expect(calls.find((c) => c.cmd === "mr:update")!.payload).toMatchObject({ repoName: IDENT, iid: 7 });
  });

  test("repoName alone takes the run's mr field when it names the same repo", async () => {
    const { evidence } = boardRecord();
    const { deps, calls } = makeDeps({ fields: { evidence, mr: MR_URL } });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, repoName: "web" }, env)).body as AttachBody;
    expect(body.mr).toBe(MR_URL);
    expect(calls.some((c) => c.cmd === "mr:get")).toBe(true);
    expect(calls.find((c) => c.cmd === "mr:update")!.payload).toMatchObject({ repoName: IDENT, iid: 7 });
    expect(body.descriptionWritten).toBe(true);
  });

  test("repoName alone with a run mr field in another repo is refused before any upload", async () => {
    const { evidence } = boardRecord();
    const { deps, calls } = makeDeps({ fields: { evidence, mr: "https://gitlab.com/acme/api/-/merge_requests/3" } });
    const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, repoName: "web" }, env);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("remote:gitlab.com%2Facme%2Fapi");
    expect(calls.length).toBe(0);
  });

  test("an abort mid-run remembers only real uploads and skips the description write", async () => {
    const { one, two, evidence } = twoWaived();
    const ctl = new AbortController();
    const respond: Responder = (cmd, p) => {
      if (cmd === "mr:upload" && p.path === one) ctl.abort();
      return undefined;
    };
    const { deps, calls, fields } = makeDeps({ fields: { evidence }, respond });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL, linkRefused: true }, env, ctl.signal)).body as AttachBody;
    expect(uploads(calls).map((c) => c.payload.path)).toEqual([one]);
    expect(body.uploaded.map((u) => u.path)).toEqual([one]);
    expect(Object.values(body.refused).flat()).toEqual([]);
    expect(Object.keys(parseUploads(fields.get("evidence-uploads")!))).toEqual([realpathSync(one)]);
    expect(calls.some((c) => c.cmd === "mr:get" || c.cmd === "mr:update")).toBe(false);
    expect(body.writeErrors![0]).toContain("cancelled");
    expect(body.writeErrors![0]).toContain(two);
    expect(body.notWritten).toBeUndefined();
    expect(body.section).not.toContain(two);
  });

  test("an http github.com mrUrl is still GitHub, with its PR number", async () => {
    const { evidence } = boardRecord();
    const { deps } = makeDeps({ fields: { evidence } });
    const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: "http://github.com/acme/web/pull/3" }, env);
    expect((res.body as AttachBody).mr).toBe("http://github.com/acme/web/pull/3");
    expect(JSON.stringify(res.body)).toContain("gh pr edit 3");
  });

  test("a github.com target uploads nothing, links local paths and names the gh move", async () => {
    const { board, evidence } = boardRecord();
    const { deps, calls } = makeDeps({ fields: { evidence } });
    const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: "https://github.com/acme/web/pull/12" }, env);
    expect(res.ok).toBe(true);
    const body = res.body as AttachBody;
    expect(calls.length).toBe(0);
    expect(body.forge).toBe("github");
    expect(body.notWritten).toBe("github");
    expect(body.section).toContain(`- Before and after: ${board}`);
    expect(JSON.stringify(res.body)).toContain("gh pr edit 12");
  });

  test("a plan:text record uploads nothing and prints only the transcript line", async () => {
    const { deps, calls } = makeDeps({ fields: { evidence: JSON.stringify({ plan: "text", transcript: "/t.txt" }) } });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, repoName: "web" }, env)).body as AttachBody;
    expect(uploads(calls).length).toBe(0);
    expect(body.section).toBe("Transcript: /t.txt");
  });

  test("an mr:update failure lands in writeErrors and keeps the uploads", async () => {
    const { board, evidence } = boardRecord();
    const respond: Responder = (cmd) => (cmd === "mr:update" ? errRes("GitLab 500") : undefined);
    const { deps, fields } = makeDeps({ fields: { evidence }, respond });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    expect(body.writeErrors!.length).toBeGreaterThan(0);
    expect(body.descriptionWritten).toBe(false);
    expect(body.uploaded.map((u) => u.path)).toEqual([board]);
    expect(Object.keys(parseUploads(fields.get("evidence-uploads")!))).toEqual([realpathSync(board)]);
  });

  test("the section and description carry no tool marker", async () => {
    const { evidence } = boardRecord();
    const { deps, state } = makeDeps({ fields: { evidence } });
    await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env);
    expect(state.live).not.toMatch(/mattstack|evidence_attach|<!--/);
  });
});

describe("uploadEach", () => {
  test("without retry, one call per path, and a timed-out item says so", async () => {
    const a = put("a.png");
    const b = put("b.png");
    const respond: Responder = (cmd, p) => (cmd === "mr:upload" && p.path === a ? errRes("request timed out") : undefined);
    const { deps, calls } = makeDeps({ respond });
    const out = await uploadEach(deps, { identity: IDENT, paths: [a, b], retryTimeoutOnce: false });
    expect(uploads(calls).map((c) => c.payload.path)).toEqual([a, b]);
    expect(out[0]).toMatchObject({ path: a, ok: false, timedOut: true });
    expect(out[1]).toMatchObject({ path: b, ok: true });
  });
});

describe("dev_endpoints", () => {
  const TREE = "/trees/web-1";
  const registered: TreeGuardDeps = { ...noGuard, realpath: (p) => p, repoIndex: () => ({ [IDENT]: TREE }) };
  type Lookup = Record<string, { claimed: boolean; port: number | null; url: string | null; running?: boolean } | string>;

  function setup(lookups: Lookup, answers: (url: string) => number | null) {
    const { deps, calls } = makeDeps({
      guard: registered,
      respond: (cmd, payload) => {
        if (cmd !== "endpoint:lookup") return undefined;
        const hit = lookups[String(payload.role)];
        if (hit === undefined) return errRes(`role "${String(payload.role)}" is not declared`);
        if (typeof hit === "string") return errRes(hit);
        return okRes({ running: false, listener: null, worktree: { path: TREE, name: "web-1" }, ...hit });
      },
    });
    let clock = 0;
    const fetched: string[] = [];
    const wired: EvidenceToolDeps = {
      ...deps,
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      fetch: (async (url: string) => {
        fetched.push(url);
        const status = answers(url);
        if (status === null) throw new Error("ECONNREFUSED");
        return { status } as Response;
      }) as unknown as typeof fetch,
    };
    return { def: tool(wired, "dev_endpoints"), calls, fetched };
  }
  const claimed = (port: number) => ({ claimed: true, port, url: `http://localhost:${port}` });
  const data = (r: ToolResult) => r.body as { tree: string; waitedMs: number; roles: Record<string, Record<string, unknown>>; waiting: string[] };

  test("an unregistered tree returns the guard's error verbatim", async () => {
    const { def } = setup({}, () => 200);
    const res = await def.handler({ tree: "/nowhere", roles: ["web"] }, env);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("is not in a checkout or worktree of a repo registered with rt");
  });

  test("bad roles and waitSeconds are refused", async () => {
    const { def } = setup({}, () => 200);
    expect((await def.handler({ tree: TREE, roles: [] }, env)).ok).toBe(false);
    expect((await def.handler({ tree: TREE, roles: Array.from({ length: 9 }, (_, i) => `r${i}`) }, env)).ok).toBe(false);
    expect((await def.handler({ tree: TREE, roles: ["web"], waitSeconds: 301 }, env)).ok).toBe(false);
    expect((await def.handler({ tree: TREE, roles: ["web"], probePath: "x" }, env)).ok).toBe(false);
  });

  test("one role answers 302, the other is refused: waits the full deadline and lists the laggard", async () => {
    const { def, calls } = setup({ web: claimed(3000), api: claimed(4000) }, (u) => (u.includes(":3000") ? 302 : null));
    const res = await def.handler({ tree: TREE, roles: ["web", "api"], waitSeconds: 4 }, env);
    expect(res.ok).toBe(true);
    const d = data(res);
    expect(d.tree).toBe(TREE);
    expect(d.roles.web).toMatchObject({ claimed: true, answered: true, status: 302 });
    expect(d.roles.api).toMatchObject({ claimed: true, answered: false, status: null });
    expect(d.waiting).toEqual(["api"]);
    expect(d.waitedMs).toBeGreaterThanOrEqual(4000);
    const lookup = calls.find((c) => c.cmd === "endpoint:lookup")!;
    expect(lookup.payload).toMatchObject({ repo: IDENT, worktree: TREE });
  });

  test("an unclaimed role is never probed and not waited on", async () => {
    const { def, fetched } = setup({ web: claimed(3000), api: { claimed: false, port: null, url: null } }, () => 200);
    const d = data(await def.handler({ tree: TREE, roles: ["web", "api"] }, env));
    expect(d.roles.api).toMatchObject({ claimed: false });
    expect(d.waiting).toEqual([]);
    expect(fetched).toEqual(["http://localhost:3000/"]);
  });

  test("a lookup error is reported on the role and the call succeeds", async () => {
    const { def } = setup({ web: claimed(3000) }, () => 200);
    const res = await def.handler({ tree: TREE, roles: ["web", "x"] }, env);
    expect(res.ok).toBe(true);
    const d = data(res);
    expect(String(d.roles.x!.error)).toContain("not declared");
    expect(d.roles.x).toMatchObject({ claimed: false, answered: false });
    expect(d.waiting).toEqual([]);
  });

  test("waitSeconds defaults to 90 and 0 probes once", async () => {
    const never = setup({ web: claimed(3000) }, () => null);
    const slow = data(await never.def.handler({ tree: TREE, roles: ["web"] }, env));
    expect(slow.waitedMs).toBeGreaterThanOrEqual(90_000);
    expect(slow.waitedMs).toBeLessThan(94_000);
    const once = setup({ web: claimed(3000) }, () => null);
    const quick = data(await once.def.handler({ tree: TREE, roles: ["web"], waitSeconds: 0 }, env));
    expect(quick.waitedMs).toBe(0);
    expect(once.fetched.length).toBe(1);
  });

  test("the probe url is the lookup url plus probePath", async () => {
    const { def, fetched } = setup({ web: claimed(3000) }, () => 200);
    await def.handler({ tree: TREE, roles: ["web"], probePath: "/healthz" }, env);
    expect(fetched).toEqual(["http://localhost:3000/healthz"]);
  });
});
