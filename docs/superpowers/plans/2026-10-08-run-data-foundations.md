# Run Data Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the console runs redesign the data it needs (full gate history per run, a stage on every run gate, richer run summaries, a defined evidence shape served as images) plus tested pure selectors, with no UI change.

**Architecture:** Daemon-side changes live in `lib/` (gates store, gate and runs handlers, runs store) and travel to the console through `packages/rt-client` types and wrappers. The console server only relays: it never reads rt's files itself, so the evidence image check is a daemon verb reusing `checkUploadPath`. Selectors are pure functions in `apps/console/src/app/runs/derive/`.

**Tech Stack:** Bun + bun:sqlite + bun:test (rt), Hono + vitest (console), Markdown skills (plugins/mattstack).

**Spec:** `docs/superpowers/specs/2026-10-08-run-data-foundations-design.md`

## Global Constraints

- Run `bun test` from the repo root only (bunfig preload isolates HOME). Console tests: `cd apps/console && bunx vitest run <file>`.
- After any change under `packages/rt-client/src`, run `bun run build` in `packages/rt-client` before console tests or typecheck (stale `dist/` is a known trap; `packages/rt-client/test/dist-freshness.test.ts` guards it).
- Never print through `console.*` or `process.stdout` under `lib/` (`lib/__tests__/no-raw-output.test.ts`).
- Comments only state a constraint the code cannot show.
- No `--json` envelope, store key, or wire field is renamed; only additive changes.
- Plugin edits bump `plugins/mattstack/.claude-plugin/plugin.json` `version` (0.30.21 → 0.30.22) and go through `superpowers:writing-skills` and `mattstack:editing-skills`.
- Evidence keys served as images: exactly `before`, `beforeAnnotated`, `after`, `afterAnnotated`.
- `runs:evidence` caps a file at 15 MB (base64 over the socket).
- Only targeted tests locally; CI runs the full suite.

## Review Focus

1. A run id that is a prefix of another (`run:20261008-1` vs `run:20261008-12`): the exact `subject` filter must not return the longer one. Test in Task 2.
2. A legacy `evidence` value that is not JSON, or JSON without `v`: `parseEvidence` returns links, `evidence_count` is 0, the image route answers 404, nothing throws. Tests in Tasks 1, 5, 6.
3. An evidence path that is a symlink to a file outside the roots: refused. Test in Task 6.
4. A gate opened with a caller-supplied `meta.stage`: the caller's value wins over `current_stage`. Test in Task 4.
5. Two gates open at the same time on one run: `waitingOnYou` counts the overlap once. Test in Task 8.

---

### Task 1: `parseEvidence` in rt-client (`./evidence` subpath)

**Files:**
- Create: `packages/rt-client/src/evidence.ts`
- Create: `packages/rt-client/test/evidence.test.ts`
- Modify: `packages/rt-client/package.json` (exports + build script)
- Modify: `packages/rt-client/src/index.ts` (re-export)

**Interfaces:**
- Produces:
  ```ts
  export const EVIDENCE_IMAGE_KEYS = ["before", "beforeAnnotated", "after", "afterAnnotated"] as const;
  export type EvidenceImageKey = (typeof EVIDENCE_IMAGE_KEYS)[number];
  export interface EvidenceV1 { v: 1; before: string; beforeAnnotated?: string; after?: string; afterAnnotated?: string; transcript?: string; case?: string; url?: string; attach?: string }
  export type ParsedEvidence =
    | { version: 1; evidence: EvidenceV1; images: { key: EvidenceImageKey; path: string }[] }
    | { version: 0; links: string[] }
    | { version: null };
  export function parseEvidence(value: string | null | undefined): ParsedEvidence;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { parseEvidence } from "../src/evidence.ts";

describe("parseEvidence", () => {
  test("v1 lists image keys in fixed order, skipping absent ones", () => {
    const r = parseEvidence(JSON.stringify({ v: 1, before: "/e/b.png", after: "/e/a.png", case: "hail" }));
    expect(r.version).toBe(1);
    if (r.version !== 1) throw new Error("unreachable");
    expect(r.images).toEqual([{ key: "before", path: "/e/b.png" }, { key: "after", path: "/e/a.png" }]);
    expect(r.evidence.case).toBe("hail");
  });
  test("v1 without before falls back to links", () => {
    expect(parseEvidence(JSON.stringify({ v: 1, after: "/e/a.png" }))).toEqual({ version: 0, links: ["/e/a.png"] });
  });
  test("legacy JSON without v yields every absolute path and url", () => {
    const legacy = JSON.stringify({ before: "/Users/x/b.png", url: "http://localhost:4001/c/1", note: "plain" });
    expect(parseEvidence(legacy)).toEqual({ version: 0, links: ["/Users/x/b.png", "http://localhost:4001/c/1"] });
  });
  test("free text yields embedded paths and urls", () => {
    expect(parseEvidence("before at /tmp/b.png and https://x.dev/y")).toEqual({ version: 0, links: ["/tmp/b.png", "https://x.dev/y"] });
  });
  test("empty, '-', null and {plan: none} are no evidence", () => {
    for (const v of [null, undefined, "", "-", JSON.stringify({ plan: "none" })]) {
      expect(parseEvidence(v)).toEqual({ version: null });
    }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module`)

Run: `bun test packages/rt-client/test/evidence.test.ts`

- [ ] **Step 3: Implement**

```ts
export const EVIDENCE_IMAGE_KEYS = ["before", "beforeAnnotated", "after", "afterAnnotated"] as const;
export type EvidenceImageKey = (typeof EVIDENCE_IMAGE_KEYS)[number];
export interface EvidenceV1 {
  v: 1; before: string; beforeAnnotated?: string; after?: string; afterAnnotated?: string;
  transcript?: string; case?: string; url?: string; attach?: string;
}
export type ParsedEvidence =
  | { version: 1; evidence: EvidenceV1; images: { key: EvidenceImageKey; path: string }[] }
  | { version: 0; links: string[] }
  | { version: null };

const LINK = /(https?:\/\/[^\s"',)]+|\/[^\s"',)]+)/g;

function linksIn(text: string): string[] {
  return [...new Set(text.match(LINK) ?? [])];
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

export function parseEvidence(value: string | null | undefined): ParsedEvidence {
  const raw = value?.trim() ?? "";
  if (raw === "" || raw === "-") return { version: null };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { json = undefined; }
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    if (o.plan === "none" && Object.keys(o).length === 1) return { version: null };
    if (o.v === 1 && typeof o.before === "string" && o.before) {
      const evidence = o as unknown as EvidenceV1;
      const images = EVIDENCE_IMAGE_KEYS
        .filter((k) => typeof o[k] === "string" && (o[k] as string).length > 0)
        .map((key) => ({ key, path: o[key] as string }));
      return { version: 1, evidence, images };
    }
    const links = [...new Set(stringsIn(o).flatMap(linksIn))];
    return links.length ? { version: 0, links } : { version: null };
  }
  const links = linksIn(raw);
  return links.length ? { version: 0, links } : { version: null };
}
```

Add to `packages/rt-client/src/index.ts`: `export * from "./evidence.ts";`

In `packages/rt-client/package.json` add the export beside `./gate`:

```json
"./evidence": {
  "types": "./dist/evidence.d.ts",
  "bun": "./src/evidence.ts",
  "import": "./dist/evidence.js",
  "default": "./dist/evidence.js"
},
```

and append to the `build` script, before `&& tsc -p tsconfig.json`:
` && bun build src/evidence.ts --outfile dist/evidence.js --target browser --format esm`

- [ ] **Step 4: Run tests, expect PASS; build**

Run: `bun test packages/rt-client/test/evidence.test.ts && (cd packages/rt-client && bun run build)`

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/evidence.ts packages/rt-client/test/evidence.test.ts packages/rt-client/src/index.ts packages/rt-client/package.json
git commit -m "rt-client: parseEvidence and the evidence@1 shape"
```

---

### Task 2: Exact `subject` and `status` filters on `gate:list`

**Files:**
- Modify: `lib/daemon/gates-store.ts:59` (interface) and `list` (~line 590)
- Modify: `lib/daemon/handlers/gate.ts` (`"gate:list"`, ~line 662)
- Modify: `packages/rt-client/src/commands.ts:1061` (`gate:list` payload)
- Test: `lib/daemon/__tests__/gates-store.test.ts`, `lib/daemon/__tests__/gate-handlers.test.ts` (use whichever file already tests `gate:list`; `grep -ln '"gate:list"' lib/daemon/__tests__`)

**Interfaces:**
- Produces: `GatesStore.list(filter: { open?: boolean; subject?: string; subjectPrefix?: string; status?: GateStatus[]; kind?: string; limit?: number; cursor?: number })`; `Commands["gate:list"]["payload"]` gains `subject?: string; status?: GateStatus[]`.

- [ ] **Step 1: Write the failing store test** (append to the list describe in `gates-store.test.ts`, reusing its `openGate(s, subject)` helper)

```ts
test("subject matches exactly and status filters to the given set", () => {
  const s = store();
  const a = openGate(s, "run:20261008-1");
  const b = openGate(s, "run:20261008-12");
  s.close(a, "abandoned");
  expect(s.list({ subject: "run:20261008-1" }).gates.map((g) => g.id)).toEqual([a]);
  expect(s.list({ subjectPrefix: "run:", status: ["open"] }).gates.map((g) => g.id)).toEqual([b]);
  expect(s.list({ subject: "run:20261008-1", status: ["open"] }).gates).toEqual([]);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test lib/daemon/__tests__/gates-store.test.ts -t "subject matches exactly"`

- [ ] **Step 3: Implement** in `list`, after the `subjectPrefix` clause:

```ts
if (filter.subject) { clauses.push("subject = ?"); params.push(filter.subject); }
if (filter.status?.length) {
  clauses.push(`status IN (${filter.status.map(() => "?").join(", ")})`);
  params.push(...filter.status);
}
```

Update the interface signature, the `gate:list` payload type in `commands.ts`, and the handler:

```ts
const statuses = Array.isArray(payload?.status)
  ? payload.status.filter((s): s is GateStatus => ["open", "answered", "parked", "closed"].includes(s as string))
  : undefined;
const { gates, cursor } = store.list({
  open: payload?.open,
  subject: typeof payload?.subject === "string" && payload.subject.trim() ? payload.subject.trim() : undefined,
  subjectPrefix: payload?.subjectPrefix,
  status: statuses,
  kind: payload?.kind,
  cursor: num(payload?.cursor),
  limit: clampListLimit(num(payload?.limit)),
});
```

- [ ] **Step 4: Add a handler test** in the file that already exercises `gate:list`: open gates on `run:a` and `run:ab`, call `handlers["gate:list"]({ subject: "run:a" })`, expect one row. Run both test files, expect PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/gates-store.ts lib/daemon/handlers/gate.ts packages/rt-client/src/commands.ts lib/daemon/__tests__
git commit -m "gate:list: exact subject and status filters"
```

---

### Task 3: Keep run gates while their run exists

**Files:**
- Modify: `lib/daemon/gates-store.ts` (`createGatesStore` opts, `sweepStmt`, `sweep()`)
- Modify: `lib/runs/paths.ts` (add `runDirExists`)
- Modify: `lib/daemon.ts:686` (pass `runExists`)
- Test: `lib/daemon/__tests__/gates-store.test.ts` (sweep describe), `lib/runs/__tests__/paths.test.ts` (create if absent)

**Interfaces:**
- Produces: `createGatesStore({ ..., runExists?: (runId: string) => boolean })`; `runDirExists(runId: string): boolean` in `lib/runs/paths.ts`.
- Omitting `runExists` keeps today's sweep exactly (existing tests stay green).

- [ ] **Step 1: Write the failing tests**

```ts
test("an old answered run gate survives while its run exists, then sweeps", () => {
  let exists = true;
  const s = createGatesStore({ dbPath: tmp("gates.db"), log, retentionMs: 1000, retentionFloor: 0, runExists: () => exists });
  const runGate = openGate(s, "run:r1");
  const other = openGate(s, "mr:9");
  s.close(runGate, "abandoned");
  s.close(other, "abandoned");
  s.__db!.run("UPDATE gates SET closedAt = ?", [Date.now() - 10_000]);
  expect(s.sweep()).toBe(1);
  expect(s.get(runGate)).not.toBeNull();
  expect(s.get(other)).toBeNull();
  exists = false;
  expect(s.sweep()).toBe(1);
  expect(s.get(runGate)).toBeNull();
});
```

`lib/runs/__tests__/paths.test.ts`:

```ts
import { afterEach, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { join } from "path";
import { root } from "./fixtures.ts";
import { runDirExists } from "../paths.ts";

afterEach(() => { delete process.env.RT_RUNS_ROOT; });

test("runDirExists finds a run under any repo and rejects unsafe ids", () => {
  const dir = root();
  mkdirSync(join(dir, "remote:alpha", "20261008-1"), { recursive: true });
  expect(runDirExists("20261008-1")).toBe(true);
  expect(runDirExists("20261008-2")).toBe(false);
  expect(runDirExists("../x")).toBe(false);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test lib/daemon/__tests__/gates-store.test.ts lib/runs/__tests__/paths.test.ts`

- [ ] **Step 3: Implement**

`lib/runs/paths.ts`:

```ts
import { existsSync, readdirSync } from "fs";

export function runDirExists(runId: string): boolean {
  if (!isPathComponent(runId)) return false;
  const root = runsRoot();
  let repos: string[];
  try { repos = readdirSync(root); } catch { return false; }
  return repos.some((repo) => existsSync(join(root, repo, runId)));
}
```

`gates-store.ts`: add `runExists?: (runId: string) => boolean` to the opts. Change `sweepStmt` to take an exemption flag:

```sql
DELETE FROM gates
WHERE status IN ('closed', 'answered')
  AND (? = 0 OR subject NOT LIKE 'run:%')
  AND COALESCE(closedAt, json_extract(answer, '$.answeredAt'), openedAt) < ?
  AND id NOT IN (
    SELECT id FROM gates
    WHERE status IN ('closed', 'answered')
    ORDER BY COALESCE(closedAt, json_extract(answer, '$.answeredAt'), openedAt) DESC
    LIMIT ?
  )
```

Add two statements:

```ts
const oldRunSubjectsStmt = db.prepare(`
  SELECT DISTINCT subject FROM gates
  WHERE status IN ('closed', 'answered') AND subject LIKE 'run:%'
    AND COALESCE(closedAt, json_extract(answer, '$.answeredAt'), openedAt) < ?
`);
const deleteTerminalBySubjectStmt = db.prepare(
  "DELETE FROM gates WHERE subject = ? AND status IN ('closed', 'answered') AND COALESCE(closedAt, json_extract(answer, '$.answeredAt'), openedAt) < ?",
);
```

`sweep()`:

```ts
const cutoff = Date.now() - retentionMs;
const exempt = opts.runExists ? 1 : 0;
let changes = sweepStmt.run(exempt, cutoff, retentionFloor).changes;
if (opts.runExists) {
  for (const { subject } of oldRunSubjectsStmt.all(cutoff) as { subject: string }[]) {
    if (!opts.runExists(subject.slice("run:".length))) changes += deleteTerminalBySubjectStmt.run(subject, cutoff).changes;
  }
}
```

(keep the existing debug log and dead-subscription prune after this.)

`lib/daemon.ts:686`: `createGatesStore({ dbPath: join(RT_DIR, "gates.db"), log, runExists: runDirExists })` with `import { runDirExists } from "./runs/paths.ts";`.

- [ ] **Step 4: Run, expect PASS** (both files, plus the whole sweep describe)

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/gates-store.ts lib/runs/paths.ts lib/daemon.ts lib/daemon/__tests__/gates-store.test.ts lib/runs/__tests__/paths.test.ts
git commit -m "gates sweep: keep a run's gates while the run exists"
```

---

### Task 4: Stamp `meta.stage` on run gates; document `overridden`

**Files:**
- Modify: `lib/daemon/handlers/gate.ts` (deps type ~line 366, `"gate:open"` before `store.open`)
- Modify: `lib/daemon/command-router.ts:183-186` (wire `runCurrentStage`)
- Modify: `packages/rt-client/src/commands.ts:189` (doc comment on `GateAnswer.overridden`)
- Test: the gate handler test file that covers `gate:open`

**Interfaces:**
- Produces: deps `runCurrentStage?: (runId: string) => string | null`; every gate on subject `run:<id>` opened while that run has a `current_stage` carries `meta.stage`.

- [ ] **Step 1: Write the failing tests**

```ts
test("gate:open stamps meta.stage from the run's current stage", async () => {
  const h = createGateHandlers(store, bus, () => {}, { runCurrentStage: (id) => (id === "r1" ? "plan" : null) });
  const res = await h["gate:open"]({ subject: "run:r1", kind: "plan", questions: [q("approach")] });
  expect(res.ok).toBe(true);
  expect(store.get((res as any).data.id)!.meta).toEqual({ stage: "plan" });
});

test("a caller's meta.stage wins and other meta keys survive", async () => {
  const h = createGateHandlers(store, bus, () => {}, { runCurrentStage: () => "plan" });
  const res = await h["gate:open"]({ subject: "run:r1", kind: "plan", questions: [q("a")], meta: { stage: "ship", label: "Ship" } });
  expect(store.get((res as any).data.id)!.meta).toEqual({ stage: "ship", label: "Ship" });
});

test("non-run subjects and runs with no stage get no meta.stage", async () => {
  const h = createGateHandlers(store, bus, () => {}, { runCurrentStage: () => null });
  const a = await h["gate:open"]({ subject: "run:r2", kind: "k", questions: [q("a")] });
  const b = await h["gate:open"]({ subject: "mr:9", kind: "k", questions: [q("a")] });
  expect(store.get((a as any).data.id)!.meta).toBeNull();
  expect(store.get((b as any).data.id)!.meta).toBeNull();
});
```

(Use the file's existing store/bus setup and question factory; name it `q` here.)

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement.** Add to the deps type:

```ts
/** The run's current stage, by run id: stamped onto a run gate as meta.stage. */
runCurrentStage?: (runId: string) => string | null;
```

In `"gate:open"`, just before `store.open(...)`:

```ts
const callerMeta = isPlainObject(payload?.meta) ? payload!.meta : undefined;
const runStage = subject.startsWith("run:") && typeof callerMeta?.stage !== "string"
  ? deps.runCurrentStage?.(subject.slice("run:".length)) ?? null
  : null;
const meta = runStage ? { ...(callerMeta ?? {}), stage: runStage } : callerMeta;
```

and pass `meta` instead of `payload?.meta` to `store.open`.

`command-router.ts`, beside `runSpawnedBy`:

```ts
runCurrentStage: (runId) => findRun(runId)?.run.current_stage ?? null,
```

`commands.ts`, on `GateAnswer`: put above the interface

```ts
/** `overridden`: the answer went past the herd-owner guard. The console
    sets it on every answer it sends; it says nothing about whether the
    answer matched the recommended option. */
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/gate.ts lib/daemon/command-router.ts packages/rt-client/src/commands.ts lib/daemon/__tests__
git commit -m "gate:open: stamp meta.stage on run gates from the run's current stage"
```

---

### Task 5: Run summary gains stage end times, attempts and counts

**Files:**
- Modify: `lib/runs/store.ts:~136` (`withAttention` stages map + counts) and `readRun` (same stages map)
- Modify: `packages/rt-client/src/commands.ts:~395` (`RunSummary`)
- Modify: `lib/runs/__tests__/fixtures.ts` (optional `fields` seed)
- Test: `lib/runs/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `parseEvidence` (Task 1).
- Produces: `RunSummary.stages?: { name; status; started_at; ended_at: number | null; attempt: number }[]`, `RunSummary.decision_count?: number`, `RunSummary.evidence_count?: number` (optional on the type so older daemons still type-check).

- [ ] **Step 1: Extend the fixture** with `fields?: { key: string; value: string; producedBy?: string; at?: number }[]` in `SeedOpts`, inserted after the default rows:

```ts
const fieldInserts = (o.fields ?? [])
  .map((f) => `INSERT OR REPLACE INTO fields VALUES ('${id}', '${f.key}', '${f.value.replace(/'/g, "''")}', '${f.producedBy ?? "plan"}', ${f.at ?? startedAt});`)
  .join("\n    ");
```

(append `${fieldInserts}` to the exec block).

- [ ] **Step 2: Write the failing test**

```ts
test("summary carries stage ended_at and attempt, decision_count and evidence_count", () => {
  const dir = root();
  seedRun(dir, "remote:alpha", "r-1", 1000, 1, {
    stages: [{ name: "plan", status: "done", startedAt: 1000, endedAt: 2000 }, { name: "evidence", status: "running", attempt: 2, startedAt: 3000 }],
    fields: [{ key: "evidence", value: JSON.stringify({ v: 1, before: "/e/b.png", beforeAnnotated: "/e/ba.png" }), producedBy: "evidence" }],
  });
  const [s] = listRuns("remote:alpha");
  expect(s!.stages).toEqual([
    { name: "plan", status: "done", started_at: 1000, ended_at: 2000, attempt: 1 },
    { name: "evidence", status: "running", started_at: 3000, ended_at: null, attempt: 2 },
  ]);
  expect(s!.decision_count).toBe(1);
  expect(s!.evidence_count).toBe(2);
});

test("legacy evidence counts zero", () => {
  const dir = root();
  seedRun(dir, "remote:alpha", "r-2", 1000, 1, { fields: [{ key: "evidence", value: "see /tmp/x.png" }] });
  expect(listRuns("remote:alpha")[0]!.evidence_count).toBe(0);
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `bun test lib/runs/__tests__/store.test.ts -t "summary carries"`

- [ ] **Step 4: Implement.** In `store.ts` import `parseEvidence` from `../../packages/rt-client/src/evidence.ts`. Add a helper and use it in both `withAttention` and `readRun`:

```ts
function stageSummaries(stages: RunStageRow[]): NonNullable<RunSummary["stages"]> {
  return stages.map((s) => ({ name: s.name, status: s.status, started_at: s.started_at, ended_at: s.ended_at, attempt: s.attempt }));
}
function evidenceCount(fields: { key: string; value: string }[]): number {
  const parsed = parseEvidence(fieldValue(fields, "evidence"));
  return parsed.version === 1 ? parsed.images.length : 0;
}
```

In the `withAttention` return object add `decision_count: decisions.length, evidence_count: evidenceCount(fields)` and replace the stages map with `stageSummaries(stages)`; in `readRun` add the same three. Update `RunSummary` in `commands.ts` accordingly.

- [ ] **Step 5: Run, expect PASS; rebuild rt-client**

Run: `bun test lib/runs/__tests__/store.test.ts && (cd packages/rt-client && bun run build)`

- [ ] **Step 6: Commit**

```bash
git add lib/runs/store.ts lib/runs/__tests__ packages/rt-client/src/commands.ts
git commit -m "runs: summary carries stage end times, attempts, decision and evidence counts"
```

---

### Task 6: `runs:evidence` daemon verb

**Files:**
- Modify: `lib/daemon/handlers/runs.ts` (new handler)
- Modify: `packages/rt-client/src/commands.ts` (Commands entry + `COMMAND_NAMES`)
- Modify: `packages/rt-client/src/client.ts` (wrapper `runEvidence`)
- Test: `lib/daemon/__tests__/runs-handlers.test.ts`

**Interfaces:**
- Consumes: `parseEvidence`, `EVIDENCE_IMAGE_KEYS` (Task 1); `checkUploadPath(path, roots, opts)` from `lib/daemon/upload-guard.ts`.
- Produces: `Commands["runs:evidence"] = { payload: { runId: string; repo?: string; key: EvidenceImageKey }; data: { mime: string; base64: string } }`; client `runEvidence(runId: string, key: EvidenceImageKey, repo?: string, opts?: RtClientOptions): Promise<RtResponse<{ mime: string; base64: string }>>`.
- Errors: `"missing runId"`, `"unknown key"`, `"run not found"`, `"no evidence"`, or the guard's own message.

- [ ] **Step 1: Write the failing tests** (PNG bytes: the 8-byte signature plus padding is enough for the magic check; confirm against `lib/daemon/__tests__/upload-guard.test.ts` and reuse its fixture if one exists)

```ts
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

test("runs:evidence serves a key's file from the run's worktree", async () => {
  const dir = root();
  const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
  writeFileSync(join(tree, "before.png"), PNG);
  seedRun(dir, "remote:alpha", "r-1", 1000, 1, { fields: [
    { key: "worktree", value: tree },
    { key: "evidence", value: JSON.stringify({ v: 1, before: join(tree, "before.png") }) },
  ] });
  const h = createRunsHandlers({ log } as any, noEmit);
  const r = await (h["runs:evidence"] as any)({ runId: "r-1", key: "before" });
  expect(r.ok).toBe(true);
  expect(r.data.mime).toBe("image/png");
  expect(Buffer.from(r.data.base64, "base64").equals(PNG)).toBe(true);
});

test("runs:evidence refuses unknown keys, absent keys, legacy values and symlinks out", async () => {
  const dir = root();
  const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
  const outside = mkdtempSync(join(tmpdir(), "rt-out-"));
  writeFileSync(join(outside, "secret.png"), PNG);
  symlinkSync(join(outside, "secret.png"), join(tree, "link.png"));
  seedRun(dir, "remote:alpha", "r-2", 1000, 1, { fields: [
    { key: "worktree", value: tree },
    { key: "evidence", value: JSON.stringify({ v: 1, before: join(tree, "link.png") }) },
  ] });
  seedRun(dir, "remote:alpha", "r-3", 1000, 1, { fields: [{ key: "evidence", value: "see /tmp/x.png" }] });
  const h = createRunsHandlers({ log } as any, noEmit);
  const call = (p: object) => (h["runs:evidence"] as any)(p);
  expect((await call({ runId: "r-2", key: "transcript" })).error).toBe("unknown key");
  expect((await call({ runId: "r-2", key: "after" })).error).toBe("no evidence");
  expect((await call({ runId: "r-3", key: "before" })).error).toBe("no evidence");
  expect((await call({ runId: "r-2", key: "before" })).ok).toBe(false);
});
```

(`checkUploadPath` resolves the symlink to `outside/secret.png`, which is not under the worktree, the evidence folder or a run evidence folder, so it refuses. Pass `evidenceRoot` pointing at an empty temp dir in the handler's test seam if the real `~/.mattstack/evidence` would otherwise admit the temp path; it does not, since temp dirs are outside it.)

- [ ] **Step 2: Run, expect FAIL**

Run: `bun test lib/daemon/__tests__/runs-handlers.test.ts`

- [ ] **Step 3: Implement** in `handlers/runs.ts`:

```ts
import { EVIDENCE_IMAGE_KEYS, parseEvidence, type EvidenceImageKey } from "../../../packages/rt-client/src/evidence.ts";
import { checkUploadPath } from "../upload-guard.ts";

const EVIDENCE_MAX_BYTES = 15 * 1024 * 1024;
```

```ts
"runs:evidence": async (rawPayload: unknown): Promise<CommandResult<"runs:evidence">> => {
  const payload = rawPayload as Commands["runs:evidence"]["payload"] | undefined;
  const runId = typeof payload?.runId === "string" ? payload.runId.trim() : "";
  if (!runId) return { ok: false as const, error: "missing runId" };
  const key = payload?.key as EvidenceImageKey;
  if (!(EVIDENCE_IMAGE_KEYS as readonly string[]).includes(key)) return { ok: false as const, error: "unknown key" };
  const detail = payload?.repo ? readRun(payload.repo, runId) : findRun(runId);
  if (!detail) return { ok: false as const, error: "run not found" };
  const parsed = parseEvidence(detail.fields.find((f) => f.key === "evidence")?.value);
  const path = parsed.version === 1 ? parsed.images.find((i) => i.key === key)?.path : undefined;
  if (!path) return { ok: false as const, error: "no evidence" };
  const worktree = detail.fields.find((f) => f.key === "worktree")?.value;
  const checked = checkUploadPath(path, worktree ? [worktree] : [], { maxBytes: EVIDENCE_MAX_BYTES });
  if (!checked.ok) return { ok: false as const, error: checked.error };
  return { ok: true as const, data: { mime: checked.mime, base64: Buffer.from(checked.bytes).toString("base64") } };
},
```

Add `"runs:evidence"` to the `RunsHandlers` type, to `Commands` and `COMMAND_NAMES` (after `"runs:abandon"`), and the client wrapper beside `getRun`:

```ts
export function runEvidence(
  runId: string,
  key: EvidenceImageKey,
  repo?: string,
  opts: RtClientOptions = {},
): Promise<RtResponse<{ mime: string; base64: string }>> {
  const payload: Record<string, unknown> = { runId, key };
  if (repo !== undefined) payload.repo = repo;
  return rtCommand("runs:evidence", payload, { sockPath: opts.sockPath, timeoutMs: 15_000 });
}
```

- [ ] **Step 4: Run, expect PASS; rebuild rt-client; run the command-registry guards**

Run: `bun test lib/daemon/__tests__/runs-handlers.test.ts && (cd packages/rt-client && bun run build) && bun test packages/rt-client`

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/runs.ts packages/rt-client/src/commands.ts packages/rt-client/src/client.ts lib/daemon/__tests__/runs-handlers.test.ts
git commit -m "runs:evidence: serve a run's evidence image through the upload guard"
```

---

### Task 7: Console server routes

**Files:**
- Modify: `apps/console/src/server/gates.ts` (`/api/gates?subject=`)
- Modify: `apps/console/src/server/runs.ts` (evidence image route)
- Test: `apps/console/src/server/gates.test.ts`, `apps/console/src/server/runs.test.ts` (add `runEvidence` to their `vi.mock` factories)

**Interfaces:**
- Consumes: `gateList` with `subject`/`status` (Task 2), `runEvidence` (Task 6).
- Produces: `GET /api/gates?subject=run:<id>` → `{ gates }` (all statuses, all pages); `GET /api/runs/:repo/:runId/evidence/:key` → image bytes, 404 on any daemon refusal.

- [ ] **Step 1: Write the failing tests**

`gates.test.ts`:

```ts
it('passes an exact subject through and pages', async () => {
  vi.mocked(rt.gateList).mockResolvedValueOnce({ ok: true, data: { gates: [row({ subject: 'run:r1' })], cursor: 1 } });
  const res = await gates.fetch(new Request('http://localhost/api/gates?subject=run:r1'));
  expect(res.status).toBe(200);
  expect(vi.mocked(rt.gateList).mock.calls[0]![0]).toMatchObject({ subject: 'run:r1' });
  expect(vi.mocked(rt.gateList).mock.calls[0]![0]).not.toHaveProperty('subjectPrefix');
});
```

`runs.test.ts` (add `runEvidence: vi.fn()` to the mock factory):

```ts
it('relays an evidence image with its mime type', async () => {
  vi.mocked(rt.runEvidence).mockResolvedValueOnce({ ok: true, data: { mime: 'image/png', base64: Buffer.from('png!').toString('base64') } });
  const res = await routes.fetch(new Request('http://localhost/api/runs/remote:a/run-1/evidence/before'));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
  expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
  expect(await res.text()).toBe('png!');
});

it('answers 404 when the daemon refuses', async () => {
  vi.mocked(rt.runEvidence).mockResolvedValueOnce({ ok: false, error: 'no evidence' });
  const res = await routes.fetch(new Request('http://localhost/api/runs/remote:a/run-1/evidence/after'));
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd apps/console && bunx vitest run src/server/gates.test.ts src/server/runs.test.ts`

- [ ] **Step 3: Implement.** In `gates.ts`, give `listAllRunGates` an optional subject:

```ts
async function listAllRunGates(subject?: string) {
  // ...same loop, with the request built as:
  const filter = subject ? { subject } : { subjectPrefix: 'run:' };
  const res = await gateList({ ...filter, limit: GATE_LIST_PAGE_LIMIT, cursor }, rtClientOptions());
```

and the route, with a query validator (Hono RPC typing needs it):

```ts
.get(
  '/api/gates',
  validator('query', (value): { subject?: string } => {
    const v = value as { subject?: unknown };
    return { subject: typeof v?.subject === 'string' && v.subject.startsWith('run:') ? v.subject : undefined };
  }),
  async c => {
    const res = await listAllRunGates(c.req.valid('query').subject);
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json({ gates: res.gates }, 200);
  }
)
```

In `runs.ts`, chained beside the artifact route:

```ts
.get('/api/runs/:repo/:runId/evidence/:key', async c => {
  const { repo: rawRepo, runId, key } = c.req.param();
  const res = await runEvidence(runId, key as EvidenceImageKey, canonicalRepo(rawRepo), rtClientOptions());
  if (!res.ok || !res.data) return c.json({ error: res.error ?? 'no evidence' }, 404);
  return new Response(Buffer.from(res.data.base64, 'base64'), {
    status: 200,
    headers: { 'content-type': res.data.mime, 'cache-control': 'private, max-age=3600' },
  });
})
```

(import `runEvidence` and `type EvidenceImageKey` from `@mattstack/rt-client`; use the file's existing `rtClientOptions` helper, or `{ sockPath: process.env.RT_SOCK_PATH }` if runs.ts has none.)

- [ ] **Step 4: Run, expect PASS; typecheck**

Run: `cd apps/console && bunx vitest run src/server && cd ../.. && bun run console:typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/server/gates.ts apps/console/src/server/runs.ts apps/console/src/server/gates.test.ts apps/console/src/server/runs.test.ts
git commit -m "console: gates by exact subject, evidence image route"
```

---

### Task 8: Gate selectors

**Files:**
- Create: `apps/console/src/app/runs/derive/gates.ts`
- Create: `apps/console/src/app/runs/derive/gates.test.ts`

**Interfaces:**
- Consumes: `GateRow`, `GateQuestion`, `GateAnswer`, `RunStageRow` from `@mattstack/rt-client`; `optionValue`, `optionLabel`, `stripRecommended` from `@mattstack/gate-kit`.
- Produces:
  ```ts
  export function decisionLogForRun(gates: GateRow[], runId: string): GateRow[];
  export function gateStage(gate: GateRow, stages: RunStageRow[]): string | null;
  export function tookRecommendation(question: GateQuestion, answer: GateAnswer | null): boolean | null;
  export function waitingOnYou(gates: GateRow[], now: number): number;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import type { GateQuestion, GateRow, RunStageRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';
import { decisionLogForRun, gateStage, tookRecommendation, waitingOnYou } from './gates';

const gate = (o: Partial<GateRow>): GateRow => ({
  id: 'g', subject: 'run:r1', kind: 'plan', questions: [], meta: null, status: 'answered', answer: null,
  openedAt: 0, parkedAt: null, closedAt: null, closedReason: null, supersededBy: null, agent: null, pane: null,
  nudge: null, delivery: null, released: false, consumedAt: null, owner: null, escalatedAt: null, ...o,
});
const stage = (name: string, started_at: number, ended_at: number | null): RunStageRow =>
  ({ name, status: 'done', attempt: 1, started_at, ended_at, reason: null, detail_path: null });

describe('decisionLogForRun', () => {
  it('keeps every status for this run only, oldest first', () => {
    const log = decisionLogForRun([
      gate({ id: 'b', openedAt: 20, status: 'closed' }),
      gate({ id: 'a', openedAt: 10 }),
      gate({ id: 'x', subject: 'run:r12', openedAt: 5 }),
    ], 'r1');
    expect(log.map(g => g.id)).toEqual(['a', 'b']);
  });
});

describe('gateStage', () => {
  const stages = [stage('plan', 0, 100), stage('evidence', 100, null)];
  it('prefers meta.stage', () => expect(gateStage(gate({ meta: { stage: 'ship' }, openedAt: 50 }), stages)).toBe('ship'));
  it('falls back to the stage running at openedAt', () => {
    expect(gateStage(gate({ openedAt: 50 }), stages)).toBe('plan');
    expect(gateStage(gate({ openedAt: 500 }), stages)).toBe('evidence');
  });
  it('is null before any stage', () => expect(gateStage(gate({ openedAt: -1 }), stages)).toBeNull());
});

describe('tookRecommendation', () => {
  const q: GateQuestion = { id: 'approach', label: 'Which?', multi: false, options: [
    { value: 'server', label: 'Server-side (Recommended)' }, { value: 'client', label: 'Client-side' }] };
  const ans = (v: unknown) => ({ answers: { approach: v } as never, by: 'console', answeredAt: 1 });
  it('true when the pick is the recommended one', () => expect(tookRecommendation(q, ans('server'))).toBe(true));
  it('reads the value from a noted answer', () => expect(tookRecommendation(q, ans({ value: 'client', note: 'n' }))).toBe(false));
  it('null with no recommendation or no answer', () => {
    expect(tookRecommendation({ ...q, options: ['a', 'b'] }, ans('a'))).toBeNull();
    expect(tookRecommendation(q, null)).toBeNull();
  });
});

describe('waitingOnYou', () => {
  it('merges overlapping gates and counts open time to now', () => {
    const gates = [
      gate({ openedAt: 0, answer: { answers: {}, by: 'x', answeredAt: 100 } }),
      gate({ openedAt: 50, answer: { answers: {}, by: 'x', answeredAt: 150 } }),
      gate({ openedAt: 300, status: 'open' }),
    ];
    expect(waitingOnYou(gates, 400)).toBe(150 + 100);
  });
  it('ends a closed gate at closedAt', () => {
    expect(waitingOnYou([gate({ openedAt: 0, status: 'closed', closedAt: 30 })], 999)).toBe(30);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd apps/console && bunx vitest run src/app/runs/derive/gates.test.ts`

- [ ] **Step 3: Implement**

```ts
import { optionLabel, optionValue, stripRecommended } from '@mattstack/gate-kit';
import type { GateAnswer, GateQuestion, GateRow, RunStageRow } from '@mattstack/rt-client';

export function decisionLogForRun(gates: GateRow[], runId: string): GateRow[] {
  const subject = `run:${runId}`;
  return gates.filter(g => g.subject === subject).sort((a, b) => a.openedAt - b.openedAt);
}

export function gateStage(gate: GateRow, stages: RunStageRow[]): string | null {
  const stamped = gate.meta?.stage;
  if (typeof stamped === 'string' && stamped) return stamped;
  let found: string | null = null;
  for (const s of stages) {
    if (s.started_at == null || s.started_at > gate.openedAt) continue;
    if (s.ended_at == null || gate.openedAt < s.ended_at) found = s.name;
  }
  return found;
}

function pickedValues(raw: GateAnswer['answers'][string] | undefined): string[] {
  if (raw == null) return [];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw;
  const v = raw.value;
  return Array.isArray(v) ? v : [v];
}

export function tookRecommendation(question: GateQuestion, answer: GateAnswer | null): boolean | null {
  const recommended = question.options
    .filter(o => stripRecommended(optionLabel(o)).recommended)
    .map(optionValue);
  if (!answer || recommended.length === 0) return null;
  const picked = pickedValues(answer.answers[question.id]);
  if (picked.length === 0) return null;
  return picked.every(p => recommended.includes(p));
}

export function waitingOnYou(gates: GateRow[], now: number): number {
  const spans = gates
    .map(g => [g.openedAt, g.answer?.answeredAt ?? g.closedAt ?? now] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of spans) {
    if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else { if (cur) total += cur[1] - cur[0]; cur = [a, b]; }
  }
  return cur ? total + cur[1] - cur[0] : total;
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/runs/derive
git commit -m "console: gate selectors for the decision log"
```

---

### Task 9: Run selectors (`heldSpans`, `fieldKind`)

**Files:**
- Create: `apps/console/src/app/runs/derive/run.ts`
- Create: `apps/console/src/app/runs/derive/run.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FieldKind = 'cleared' | 'url' | 'sha-list' | 'json' | 'gate-ref' | 'text';
  export function fieldKind(key: string, value: string): FieldKind;
  export function heldSpans(stages: RunStageRow[], decisions: RunDecisionRow[]): { stage: string; from: number; to: number | null }[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import type { RunDecisionRow, RunStageRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';
import { fieldKind, heldSpans } from './run';

describe('fieldKind', () => {
  it.each([
    ['hold', '-', 'cleared'], ['hold', '  ', 'cleared'],
    ['mr', 'https://gitlab.com/a/-/merge_requests/1', 'url'],
    ['commits', 'e797751 cb5f031 1e90006', 'sha-list'],
    ['evidence', '{"v":1,"before":"/b.png"}', 'json'],
    ['waiting-gate', 'g_01HXYZ', 'gate-ref'],
    ['approach', 'direct-tdd', 'text'],
  ])('%s=%s is %s', (k, v, kind) => expect(fieldKind(k, v)).toBe(kind));
});

const st = (name: string, attempt: number, started_at: number): RunStageRow =>
  ({ name, status: 'done', attempt, started_at, ended_at: null, reason: null, detail_path: null });
const hold = (scope: string, at: number): RunDecisionRow =>
  ({ contract: 'gate@1', scope, selection: 'hold', decided_by: 'stage-plan', decided_at: at });

describe('heldSpans', () => {
  it('runs from the hold decision to the next attempt', () => {
    expect(heldSpans([st('plan', 1, 0), st('plan', 2, 500)], [hold('hold:plan:1', 100)]))
      .toEqual([{ stage: 'plan', from: 100, to: 500 }]);
  });
  it('is open-ended while no next attempt exists', () => {
    expect(heldSpans([st('plan', 1, 0)], [hold('hold:plan:1', 100)])).toEqual([{ stage: 'plan', from: 100, to: null }]);
  });
  it('ignores other scopes', () => expect(heldSpans([], [hold('plan', 1)])).toEqual([]));
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```ts
import type { RunDecisionRow, RunStageRow } from '@mattstack/rt-client';

export type FieldKind = 'cleared' | 'url' | 'sha-list' | 'json' | 'gate-ref' | 'text';

const GATE_REF_KEYS = new Set(['waiting-gate', 'gate']);

export function fieldKind(key: string, value: string): FieldKind {
  const v = value.trim();
  if (v === '' || v === '-') return 'cleared';
  if (/^https?:\/\/\S+$/.test(v)) return 'url';
  if (/^[0-9a-f]{7,40}(\s+[0-9a-f]{7,40})*$/i.test(v)) return 'sha-list';
  if (/^[[{]/.test(v)) { try { JSON.parse(v); return 'json'; } catch { /* not json */ } }
  if (GATE_REF_KEYS.has(key)) return 'gate-ref';
  return 'text';
}

const HOLD_SCOPE = /^hold:([^:]+):(\d+)$/;

export function heldSpans(stages: RunStageRow[], decisions: RunDecisionRow[]) {
  const spans: { stage: string; from: number; to: number | null }[] = [];
  for (const d of decisions) {
    const m = HOLD_SCOPE.exec(d.scope);
    if (!m) continue;
    const [, stage, attempt] = m;
    const next = stages.find(s => s.name === stage && s.attempt === Number(attempt) + 1);
    spans.push({ stage: stage!, from: d.decided_at, to: next?.started_at ?? null });
  }
  return spans;
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/runs/derive/run.ts apps/console/src/app/runs/derive/run.test.ts
git commit -m "console: held spans and field kinds"
```

---

### Task 10: Pipeline skills write `evidence@1` and ship records the AFTER

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/stage-evidence/SKILL.md:263-264` and the `run_field_set` instruction near line 19
- Modify: `plugins/mattstack/attachments/pipeline/stage-ship/SKILL.md:302-307` ("Capture the AFTER")
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version 0.30.21 → 0.30.22)

**Interfaces:**
- Produces: the `evidence` field as `evidence@1` JSON; ship merges `after`/`afterAnnotated`.

- [ ] **Step 1: Load `superpowers:writing-skills` and `mattstack:editing-skills`** and follow their RED/GREEN loop for both edits.

- [ ] **Step 2: Edit stage-evidence.** Replace the closing contract paragraph ("Finish with `evidence` as an object of labelled paths or URLs...") with:

```markdown
Finish with `evidence` as `evidence@1` JSON, written with `run_field_set`:
`{"v": 1, "before": "<absolute path>"}` plus whichever of `beforeAnnotated`,
`transcript`, `case`, `url` and `attach` the capture produced. `before` is
required; image paths are absolute. With no plan, write `{"plan": "none"}`.
Ship merges the AFTER into the same object.
```

- [ ] **Step 3: Edit stage-ship** under "Capture the AFTER when the domain names one", appending:

```markdown
Once captured, read `evidence` with `run_field_get`, add `after` (and
`afterAnnotated` when annotated) as absolute paths, keep every other key,
and write the merged object back with `run_field_set` (`stage: "ship"`).
A legacy value that is not `evidence@1` JSON stays as it is: link the
AFTER in the description only.
```

- [ ] **Step 4: Bump the version and check**

Run: `bun cli.ts skills check --strict` (from the repo root) and the plugin's own test script if `plugins/mattstack/AGENTS.md` names one.
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add plugins/mattstack
git commit -m "pipeline: evidence@1 shape, ship records the AFTER"
```

---

## Final verification

- [ ] `bun test lib/daemon/__tests__/gates-store.test.ts lib/daemon/__tests__/runs-handlers.test.ts lib/runs/__tests__ packages/rt-client`
- [ ] `cd apps/console && bunx vitest run src/server src/app/runs/derive`
- [ ] `bun run console:typecheck` and `bun run check` (static gates)
- [ ] `git log --oneline main..` shows one commit per task.
