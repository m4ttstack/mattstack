import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, truncateSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import type { RtResponse } from "../../../packages/rt-client/src/index.ts";
import { UPLOAD_MAX_BYTES } from "../../daemon/upload-guard.ts";
import { runStart } from "../../runs/start.ts";
import { valueSha256 } from "../../runs/write.ts";
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
        if (typeof input.ifSha256 === "string" && input.ifSha256 !== valueSha256(fields.get(String(input.key)) ?? "")) {
          return err(`field ${String(input.key)} changed since it was read: ifSha256 does not match`);
        }
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

  test("a pair board refreshed through one slot moves only that slot, and the shared copy keeps its bytes", async () => {
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
    expect(readFileSync(board, "utf8")).toBe("old board");
    const written = JSON.parse(fields.get("evidence")!);
    expect(written.cases[0].before.annotated).toBe(board);
    expect(written.cases[0].after.annotated).not.toBe(board);
    expect(readFileSync(written.cases[0].after.annotated, "utf8")).toBe("new board");
  });

  test("a recapture named like another image's capture never touches it, even when that image is resent cover-only", async () => {
    const dir = evidenceDir("retry-badge");
    const beforeShot = put("shot.png", "before bytes", dir);
    const beforeBoard = put("shot-board.png", "before board", dir);
    const afterShot = put("other.png", "after bytes", dir);
    const afterBoard = put("other-board.png", "after board", dir);
    const evidence = v2([{ id: "retry-badge", label: "Retry badge", before: { path: beforeShot, annotated: beforeBoard, caption: "b1" }, after: { path: afterShot, annotated: afterBoard, caption: "a1" } }]);
    const recapture = put("shot.png", "new after bytes");
    const board = put("after-board.png", "new after board");
    const after = { case: "retry-badge", slot: "after", path: recapture, annotated: board, caption: "a2" };
    for (const images of [[{ case: "retry-badge", slot: "before", caption: "b2" }, after], [after]]) {
      const { deps, fields } = makeDeps({ fields: { evidence } });
      const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images }, env);
      expect((res.body as { written: boolean }).written).toBe(true);
      expect(readFileSync(beforeShot, "utf8")).toBe("before bytes");
      const c = JSON.parse(fields.get("evidence")!).cases[0];
      expect(c.before.path).toBe(beforeShot);
      expect(c.before.annotated).toBe(beforeBoard);
      expect(c.after.path).not.toBe(c.before.path);
      expect(readFileSync(c.after.path, "utf8")).toBe("new after bytes");
    }
  });

  test("an uncovered unthemed recapture over a themed slot never overwrites a theme's recorded capture", async () => {
    const dir = evidenceDir("c");
    const files = { lc: "light capture", lb: "light board", dc: "dark capture", db: "dark board" };
    const lc = put("l.c1.png", files.lc, dir);
    const lb = put("l.png", files.lb, dir);
    const dc = put("d.c1.png", files.dc, dir);
    const db = put("d.png", files.db, dir);
    const evidence = v2([{ id: "c", label: "C", after: { light: { path: lc, annotated: lb, caption: "l" }, dark: { path: dc, annotated: db, caption: "d" } } }]);
    const recapture = put("d.c1.png", "new dark capture");
    put("d.png", "new dark board");
    const { deps, fields, runCalls } = makeDeps({ fields: { evidence } });
    const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "c", slot: "after", path: recapture }] }, env);
    expect(res.ok).toBe(true);
    const body = res.body as { written: boolean; uncovered: Array<{ why: string }>; copied: Array<{ to: string }> };
    expect(body.written).toBe(false);
    expect(body.uncovered.map((u) => u.why)).toEqual(["no-cover"]);
    expect(body.copied.every((c) => !Object.values({ lc, lb, dc, db }).includes(c.to))).toBe(true);
    for (const [p, bytes] of [[lc, files.lc], [lb, files.lb], [dc, files.dc], [db, files.db]] as const) expect(readFileSync(p, "utf8")).toBe(bytes);
    expect(fields.get("evidence")).toBe(evidence);
    expect(runCalls.some((c) => c.name === "run_field_set")).toBe(false);
  });

  test("a recapture to the same file name drops the old cover instead of keeping it", async () => {
    const { deps, fields } = makeDeps();
    const shot = put("badge-after.c1.png", "capture v1");
    const board = put("badge-after.png", "board v1");
    const first = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "retry-badge", label: "Retry", slot: "after", path: shot, annotated: board, caption: "v1 marks" }] }, env);
    expect((first.body as { written: boolean }).written).toBe(true);
    const recorded = JSON.parse(fields.get("evidence")!).cases[0].after;
    writeFileSync(shot, "capture v2");
    const second = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "retry-badge", slot: "after", path: shot }] }, env);
    expect(second.ok).toBe(true);
    expect((second.body as { written: boolean; uncovered: unknown[] }).written).toBe(false);
    expect(readFileSync(recorded.path, "utf8")).toBe("capture v1");
    expect(JSON.parse(fields.get("evidence")!).cases[0].after).toEqual(recorded);
    writeFileSync(board, "board v2");
    const third = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "retry-badge", slot: "after", path: shot, annotated: board, caption: "v2 marks" }] }, env);
    expect((third.body as { written: boolean }).written).toBe(true);
    const after = JSON.parse(fields.get("evidence")!).cases[0].after;
    expect(after.caption).toBe("v2 marks");
    expect(readFileSync(after.path, "utf8")).toBe("capture v2");
    expect(readFileSync(after.annotated, "utf8")).toBe("board v2");
    expect(readFileSync(recorded.path, "utf8")).toBe("capture v1");
  });

  test("an unchanged capture sent again with a new board is a cover update", async () => {
    const { deps, fields } = makeDeps();
    const shot = put("badge-after.c1.png", "capture");
    const board = put("badge-after.png", "board v1");
    await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "retry-badge", label: "Retry", slot: "after", path: shot, annotated: board, caption: "v1" }] }, env);
    const first = JSON.parse(fields.get("evidence")!).cases[0].after;
    writeFileSync(board, "board v2");
    const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "retry-badge", slot: "after", path: shot, annotated: board, caption: "v2" }] }, env);
    expect((res.body as { written: boolean }).written).toBe(true);
    const after = JSON.parse(fields.get("evidence")!).cases[0].after;
    expect(after.caption).toBe("v2");
    expect(readFileSync(after.annotated, "utf8")).toBe("board v2");
    expect(readFileSync(first.annotated, "utf8")).toBe("board v1");
  });

  test("passes the sha256 of the value it read, so a write from another process in between is refused", async () => {
    const { deps, fields, runCalls } = makeDeps();
    const peer = v2([{ id: "peer", label: "Peer", before: { path: "/p.png", waiver: "w" } }]);
    const runTool = deps.runTool;
    deps.runTool = async (name, input, e) => {
      if (name === "run_field_set" && input.key === "evidence") fields.set("evidence", peer);
      return runTool(name, input, e);
    };
    const shot = put("one.png");
    const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "one", label: "One", slot: "before", path: shot, waiver: "no ui" }] }, env);
    expect(runCalls.find((c) => c.name === "run_field_set")!.input.ifSha256).toBe(valueSha256(""));
    expect(res.ok).toBe(false);
    expect(res.error).toContain("the evidence field changed during this call; call again");
    expect(fields.get("evidence")).toBe(peer);
  });

  test("two concurrent calls on one run both land their cases", async () => {
    const { deps, fields } = makeDeps();
    const one = put("one.png");
    const two = put("two.png");
    const call = (id: string, path: string) =>
      tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: id, label: id, slot: "before", path, waiver: "no ui" }] }, env);
    const [a, b] = await Promise.all([call("one", one), call("two", two)]);
    expect((a.body as { written: boolean }).written).toBe(true);
    expect((b.body as { written: boolean }).written).toBe(true);
    expect(JSON.parse(fields.get("evidence")!).cases.map((c: { id: string }) => c.id).sort()).toEqual(["one", "two"]);
  });

  test("a field another process changed during the call is not overwritten", async () => {
    const { deps, fields, runCalls } = makeDeps();
    const peer = v2([{ id: "peer", label: "Peer", before: { path: "/p.png", waiver: "w" } }]);
    const runTool = deps.runTool;
    let reads = 0;
    deps.runTool = async (name, input, e) => {
      if (name === "run_field_get" && input.key === "evidence" && ++reads === 2) fields.set("evidence", peer);
      return runTool(name, input, e);
    };
    const shot = put("one.png");
    const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", images: [{ case: "one", label: "One", slot: "before", path: shot, waiver: "no ui" }] }, env);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("the evidence field changed during this call; call again");
    expect(res.error).toContain(join(evidenceDir("one"), "one.png"));
    expect(fields.get("evidence")).toBe(peer);
    expect(runCalls.some((c) => c.name === "run_field_set")).toBe(false);
  });

  test("no file already in the run folder ever changes bytes, across recaptures, board refreshes and a new transcript", async () => {
    const { deps } = makeDeps();
    const runFolder = join(home, ".mattstack", "work", RUN_ID);
    const snapshot = () => {
      const out = new Map<string, string>();
      const walk = (d: string) => {
        if (!existsSync(d)) return;
        for (const n of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, n.name);
          if (n.isDirectory()) walk(p);
          else out.set(p, readFileSync(p, "utf8"));
        }
      };
      walk(runFolder);
      return out;
    };
    const shot = put("s.c1.png", "capture 1");
    const board = put("s.png", "board 1");
    put("s.spec.json", "spec 1");
    const transcript = put("t.txt", "transcript 1");
    const calls: Array<() => Record<string, unknown>> = [
      () => ({ images: [{ case: "k", label: "K", slot: "after", path: shot, annotated: board, caption: "c1" }], transcript }),
      () => { writeFileSync(shot, "capture 2"); return { images: [{ case: "k", slot: "after", path: shot }] }; },
      () => { writeFileSync(board, "board 2"); writeFileSync(join(src, "s.spec.json"), "spec 2"); return { images: [{ case: "k", slot: "after", path: shot, annotated: board, caption: "c2" }] }; },
      () => { writeFileSync(transcript, "transcript 2"); return { transcript }; },
      () => { writeFileSync(board, "board 3"); return { images: [{ case: "k", slot: "after", annotated: board, caption: "c3" }] }; },
    ];
    for (const next of calls) {
      const before = snapshot();
      const res = await tool(deps, "evidence_record").handler({ runDb, stage: "verify", ...next() }, env);
      expect(res.ok).toBe(true);
      const after = snapshot();
      for (const [p, bytes] of before) expect(after.get(p)).toBe(bytes);
    }
    expect(snapshot().size).toBeGreaterThan(4);
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
  refused: Record<string, Array<{ path: string; error: string }>>; timedOutTwice: string[]; linked: Array<{ path: string; error: string }>; section: string;
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

  test("linkRefused names the refused file without its path, writes, and remembers it as linked", async () => {
    const { one, evidence: base } = twoWaived();
    const local = join(evidenceDir(), "transcript.md");
    const evidence = JSON.stringify({ ...JSON.parse(base), transcript: local, attach: `older notes: ${join(evidenceDir(), "notes.txt")}` });
    const respond: Responder = (cmd, p) => (cmd === "mr:upload" && p.path === one ? errRes("path is outside the allowed upload roots (...)") : undefined);
    const { deps, calls, fields, state } = makeDeps({ fields: { evidence }, respond });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL, linkRefused: true }, env)).body as AttachBody;
    expect(body.section).toContain("- Before: one.png (attached separately)");
    expect(body.section).toContain("Transcript: transcript.md (kept locally)");
    expect(body.section).toContain("older notes: notes.txt (attached separately)");
    for (const text of [body.section, state.live]) {
      expect(text).not.toContain(home);
      expect(text).not.toContain(realpathSync(home));
      expect(text).not.toMatch(/(^|[\s(])\/(Users|home|private|tmp|var)\//m);
    }
    expect(fields.get("evidence")).toBe(evidence);
    expect(body.descriptionWritten).toBe(true);
    expect(calls.some((c) => c.cmd === "mr:update")).toBe(true);
    expect(parseUploads(fields.get("evidence-uploads")!)[realpathSync(one)]).toEqual({ linked: true, at: 1_700_000_000_000 });
  });

  test("a resumed call re-sends a remembered linked file and, refused again, keeps it linked without blocking", async () => {
    const { one, evidence } = twoWaived();
    const refusal = "path is outside the allowed upload roots (...)";
    const respond: Responder = (cmd, p) => (cmd === "mr:upload" && p.path === one ? errRes(refusal) : undefined);
    const { deps, calls } = makeDeps({ fields: { evidence }, respond });
    await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL, linkRefused: true }, env);
    const before = calls.length;
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    expect(uploads(calls.slice(before)).some((c) => c.payload.path === one)).toBe(true);
    expect(Object.values(body.refused).flat()).toEqual([]);
    expect(body.linked).toEqual([{ path: one, error: refusal }]);
    expect(body.section).toContain("- Before: one.png (attached separately)");
    expect(body.notWritten).toBe("unchanged");
  });

  test("uploads remembered by another process during the call are kept, not overwritten", async () => {
    const { one, evidence } = twoWaived();
    const peerEntry = { sha256: "f".repeat(64), project: IDENT, url: "https://gitlab.com/acme/web/uploads/peer/x.png", markdown: "![x](/uploads/peer/x.png)", at: 5 };
    const box: { fields?: Map<string, string> } = {};
    const respond: Responder = (cmd, p) => {
      if (cmd === "mr:upload" && p.path === one) box.fields!.set("evidence-uploads", serializeUploads({ "/elsewhere/x.png": peerEntry }));
      return undefined;
    };
    const { deps, fields } = makeDeps({ fields: { evidence }, respond });
    box.fields = fields;
    await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env);
    const remembered = parseUploads(fields.get("evidence-uploads")!);
    expect(remembered["/elsewhere/x.png"]).toEqual(peerEntry);
    expect(remembered[realpathSync(one)]).toMatchObject({ sha256: sha256Of(one), project: IDENT });
  });

  test("uploads another process remembers between the re-read and the write are merged in on one retry", async () => {
    const { one, evidence } = twoWaived();
    const peerEntry = { sha256: "f".repeat(64), project: IDENT, url: "https://gitlab.com/acme/web/uploads/peer/x.png", markdown: "![x](/uploads/peer/x.png)", at: 5 };
    const { deps, fields, runCalls } = makeDeps({ fields: { evidence } });
    const runTool = deps.runTool;
    let raced = false;
    deps.runTool = async (name, input, e) => {
      if (name === "run_field_set" && input.key === "evidence-uploads" && !raced) {
        raced = true;
        fields.set("evidence-uploads", serializeUploads({ "/elsewhere/x.png": peerEntry }));
      }
      return runTool(name, input, e);
    };
    const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env);
    expect(runCalls.filter((c) => c.name === "run_field_set" && c.input.key === "evidence-uploads")).toHaveLength(2);
    const remembered = parseUploads(fields.get("evidence-uploads")!);
    expect(remembered["/elsewhere/x.png"]).toEqual(peerEntry);
    expect(remembered[realpathSync(one)]).toMatchObject({ sha256: sha256Of(one), project: IDENT });
    expect(JSON.stringify(res.body)).not.toContain("remembering the uploads");
  });

  test("a second miss on the evidence-uploads write is reported, never forced", async () => {
    const { evidence } = twoWaived();
    const { deps, fields, runCalls } = makeDeps({ fields: { evidence } });
    const runTool = deps.runTool;
    let n = 0;
    deps.runTool = async (name, input, e) => {
      if (name === "run_field_set" && input.key === "evidence-uploads") fields.set("evidence-uploads", serializeUploads({ [`/peer/${++n}.png`]: { linked: true, at: n } }));
      return runTool(name, input, e);
    };
    const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env);
    expect(runCalls.filter((c) => c.name === "run_field_set" && c.input.key === "evidence-uploads")).toHaveLength(2);
    expect(JSON.stringify(res)).toContain("remembering the uploads in evidence-uploads failed");
    expect(Object.keys(parseUploads(fields.get("evidence-uploads")!))).toEqual(["/peer/2.png"]);
  });

  test("a remembered linked file that times out twice on the resend lands in timedOutTwice and blocks", async () => {
    const { one, evidence } = twoWaived();
    const respond: Responder = (cmd, p, nth) => {
      if (cmd !== "mr:upload" || p.path !== one) return undefined;
      return nth === 1 ? errRes("path is outside the allowed upload roots (...)") : errRes("request timed out");
    };
    const { deps } = makeDeps({ fields: { evidence }, respond });
    await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL, linkRefused: true }, env);
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    expect(body.timedOutTwice).toEqual([one]);
    expect(body.linked).toEqual([]);
    expect(body.descriptionWritten).toBe(false);
  });

  test("a remembered linked file uploads once its cause is fixed and is no longer remembered as linked", async () => {
    const { one, evidence } = twoWaived();
    const respond: Responder = (cmd, p, nth) => (cmd === "mr:upload" && p.path === one && nth === 1 ? errRes("path is outside the allowed upload roots (...)") : undefined);
    const { deps, fields } = makeDeps({ fields: { evidence }, respond });
    await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL, linkRefused: true }, env);
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    expect(body.linked).toEqual([]);
    expect(body.uploaded.find((u) => u.path === one)?.reused).toBe(false);
    expect(body.section).not.toContain(`- Before: ${one}`);
    expect(body.descriptionWritten).toBe(true);
    expect(parseUploads(fields.get("evidence-uploads")!)[realpathSync(one)]).toMatchObject({ sha256: sha256Of(one), project: IDENT });
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

  test("reuse: a board the redaction check would refuse is sent to the daemon, never reused", async () => {
    const { board, evidence } = boardRecord();
    const dir = evidenceDir("retry-badge");
    put("badge.spec.json", JSON.stringify({ panels: [{ capture: "badge.c1.capture.json", marks: [{ redact: {} }] }] }), dir);
    put("badge.c1.capture.json", JSON.stringify({ source: "import" }), dir);
    const prior = serializeUploads({ [realpathSync(board)]: { sha256: sha256Of(board), project: IDENT, url: "https://gitlab.com/acme/web/uploads/old/badge.png", markdown: "![badge](/uploads/old/badge.png)", at: 1 } });
    const { deps, calls } = makeDeps({ fields: { evidence, "evidence-uploads": prior } });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody;
    expect(uploads(calls).map((c) => c.payload.path)).toEqual([board]);
    expect(body.uploaded.every((u) => !u.reused)).toBe(true);
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

  test("an iid alone must match the run's mr field: a match proceeds, a mismatch is refused before any upload", async () => {
    const { evidence } = boardRecord();
    const same = makeDeps({ fields: { evidence, mr: MR_URL } });
    const body = (await tool(same.deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, iid: 7 }, env)).body as AttachBody;
    expect(body.descriptionWritten).toBe(true);
    expect(same.calls.find((c) => c.cmd === "mr:update")!.payload).toMatchObject({ repoName: IDENT, iid: 7 });

    const other = makeDeps({ fields: { evidence, mr: MR_URL } });
    const res = await tool(other.deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, iid: 8 }, env);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(`iid 8 does not match the run's mr field ${MR_URL}; pass mrUrl, or repoName with iid`);
    expect(other.calls.length).toBe(0);
  });

  test("an iid alone that does not match a GitHub mr field is refused", async () => {
    const { evidence } = boardRecord();
    const gh = "https://github.com/acme/web/pull/5";
    const { deps } = makeDeps({ fields: { evidence, mr: gh } });
    const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, iid: 6 }, env);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(`iid 6 does not match the run's mr field ${gh}; pass mrUrl, or repoName with iid`);
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

  test("a github.com target uploads nothing, names the local files without their paths and names the gh move", async () => {
    const { board, evidence } = boardRecord();
    const { deps, calls } = makeDeps({ fields: { evidence } });
    const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: "https://github.com/acme/web/pull/12" }, env);
    expect(res.ok).toBe(true);
    const body = res.body as AttachBody;
    expect(calls.length).toBe(0);
    expect(body.forge).toBe("github");
    expect(body.notWritten).toBe("github");
    expect(body.section).toContain("- Before and after: badge.png (attached separately)");
    expect(body.section).not.toContain(board);
    expect(JSON.stringify(res.body)).toContain("gh pr edit 12");
  });

  test("a caption naming the home directory refuses the description write and says why", async () => {
    const { board, evidence: base } = boardRecord();
    const rec = JSON.parse(base);
    rec.cases[0].before.caption = `captured from ${join(home, "Desktop", "shot.png")}`;
    const { deps, calls, state } = makeDeps({ fields: { evidence: JSON.stringify(rec) }, live: "## Verification Evidence\n\nold\n" });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody & { writeErrors?: string[] };
    expect(uploads(calls).some((c) => c.payload.path === board)).toBe(true);
    expect(calls.some((c) => c.cmd === "mr:update")).toBe(false);
    expect(body.descriptionWritten).toBe(false);
    expect(body.notWritten).toBe("refused");
    expect(body.writeErrors?.join(" ")).toContain("home directory");
    expect(state.live).not.toContain(home);
  });

  test("a home given with a trailing slash still finds a bare home path in a caption", async () => {
    const { evidence: base } = boardRecord();
    const rec = JSON.parse(base);
    const unresolvable = "/nonexistent-home/someone";
    rec.cases[0].before.caption = `captured in ${unresolvable}.`;
    const { deps, calls } = makeDeps({ fields: { evidence: JSON.stringify(rec) }, live: "## Verification Evidence\n\nold\n" });
    const withSlash = { ...deps, home: () => `${unresolvable}/` };
    const body = (await tool(withSlash, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: MR_URL }, env)).body as AttachBody & { writeErrors?: string[] };
    expect(calls.some((c) => c.cmd === "mr:update")).toBe(false);
    expect(body.writeErrors?.join(" ")).toContain("home directory");
  });

  test("on GitHub a section naming the home directory comes back with the reason and no spliced description", async () => {
    const { evidence: base } = boardRecord();
    const rec = JSON.parse(base);
    rec.cases[0].waiver = `see ${join(home, "notes.txt")}`;
    const { deps } = makeDeps({ fields: { evidence: JSON.stringify(rec) } });
    const res = await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, mrUrl: "https://github.com/acme/web/pull/12", description: "body" }, env);
    const body = res.body as AttachBody & { writeErrors?: string[]; description?: string; next?: string };
    expect(body.writeErrors?.join(" ")).toContain("home directory");
    expect(body.description).toBeUndefined();
    expect(body.next).toBeUndefined();
  });

  test("a plan:text record uploads nothing and prints only the transcript line", async () => {
    const { deps, calls } = makeDeps({ fields: { evidence: JSON.stringify({ plan: "text", transcript: "/t.txt" }) } });
    const body = (await tool(deps, "evidence_attach").handler({ runDb, stage: "ship", heading: HEADING, repoName: "web" }, env)).body as AttachBody;
    expect(uploads(calls).length).toBe(0);
    expect(body.section).toBe("Transcript: t.txt (kept locally)");
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
