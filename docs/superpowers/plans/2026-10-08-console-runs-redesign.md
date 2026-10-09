# Console Runs Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the console's run page (live and finished) and runs pages (Lanes and Day timeline) to the refined pen.dev boards, with the data additions they need, verified for parity in Fast Browser in light and dark.

**Architecture:** Daemon additions (gate filters by run, run outcome with a background MR refresher, transcript serving) travel through `packages/rt-client` to the console server, which only relays. The console gets pure selectors in `apps/console/src/app/runs/derive/`, shared units in `apps/console/src/app/runs/run-page/` and `apps/console/src/app/runs/runs-page/`, and design-fixture scenarios so the existing parity harness (`apps/console/scripts/parity/run.md`) compares every page with its board.

**Tech Stack:** Bun + bun:sqlite + bun:test (rt), Hono + React + Mantine via `@mattstack/app-kit` + vitest (console), Markdown skills (`plugins/mattstack`), pen.dev exports, Fast Browser.

**Spec:** `docs/superpowers/specs/2026-10-08-console-runs-redesign-design.md` (read it whole before any task; section letters below refer to it).

## Global Constraints

- Run `bun test` from the repo root only. Console tests: `cd apps/console && bunx vitest run <files>`. Console typecheck: `bun run console:typecheck`. Root typecheck: `bunx tsc --noEmit`.
- After any change under `packages/rt-client/src`, run `bun run build` in `packages/rt-client`; `packages/rt-client/test/dist-freshness.test.ts` must pass.
- Never print through `console.*` or `process.stdout` under `lib/`.
- Comments only state a constraint the code cannot show.
- Wire changes are additive: no key, envelope or field is renamed.
- UI: `docs/apps/ui-authoring.md` and `apps/AGENTS.md` bind. Mantine through `@mattstack/app-kit/*` only; a Mantine component as it ships, then a CSS module via `classNames`, never inline `style`/`styles` colour; colour only through `color`/`variant` props and `--tk-*` role tokens; font weights 400/500/700 only; every surface works in light and dark; confirmations via `modals.confirm`.
- Kit-aware: an element that does not apply to a run's kind is omitted (Earlier rows keep "—" in the evidence column).
- Parity: every UI task ends with the parity run (`apps/console/scripts/parity/run.md`) for each board it lists, in `light` and `dark`, with **0 mismatches outside the board-fix list** in `docs/apps/design/console/README.md`. A kit-versus-board difference goes on that board-fix list in the same task, with one line saying why. Use ports 11097 (fixture server), 5307 (vite), 11098 (harness); never touch 11001 or 11011.
- Boards draw Inter; the app renders the system sans. Width differences from the font are not mismatches (`run.js` re-sets canvas fonts; follow its `fonts` report).
- Plugin edits bump `plugins/mattstack/.claude-plugin/plugin.json` version by one patch and go through `superpowers:writing-skills` and `mattstack:editing-skills`.
- Only targeted tests locally; CI runs the full suite.
- Invented data only in fixtures and boards (`acme`, `WEB-4xx`); never real ticket text.

## Review Focus

1. A review or respond run (one stage, gates on `mr:` subjects) opened on the run page: no rail, a hand-off card instead of a gate panel, its decisions listed from linked gates. Tests in Tasks 1, 11, 13.
2. A finished run whose stage row still says `running`: every duration and timeline bar ends at the run's `ended_at`, never at now. Tests in Task 6.
3. A herd-owned gate: never counted as waiting on you, panel neutral, submit confirms the override. Tests in Tasks 6, 12, 14.
4. An `mr` field written as `!412` or `412` rather than a URL, and a repo with no identity: outcome resolves the iid or stays `unknown`, never throws, never blocks `listRuns`. Tests in Tasks 2, 3.
5. Legacy evidence (every run so far): links listed, no image requests, evidence stat shows "<n> links". Tests in Tasks 6, 10, 13.

---

### Task 0 (controller, before Task 1): board exports into the repo

Done by the controller, not a subagent, because it needs the Pen canvas.

**Files:**
- Create: `docs/apps/design/console/parity/runs-*.{light,dark}.html`, `run-*.{light,dark}.html` (22 files)
- Create: `docs/apps/design/console/renders/runs-*.{light,dark}.png`, `run-*.{light,dark}.png` (22 files)
- Modify: `docs/apps/design/console/README.md` (new "Runs redesign" section)

Boards (light id / dark id in `console work runs.pen`):

| slug | light | dark | route | scenario |
|---|---|---|---|---|
| `runs-lanes` | VgoVH | i3s19q | `/` | `runs` |
| `runs-timeline` | NnSYh | s72EG | `/?view=timeline` | `runs` |
| `runs-empty` | hf9kp | h1rK2E | `/` | `runs-empty` |
| `run-live` | CiXq3 | M60gHD | `/runs/remote%3Aacme%2Fweb/20261008-1338` | `runs` |
| `run-gate` | ZDGNt | zcWiu | `/runs/remote%3Aacme%2Fweb/20261008-1340` | `runs` |
| `run-record` | p54Uq | lzSxv | `/runs/remote%3Aacme%2Fweb/20261008-1142` | `runs` |
| `run-review-live` | p3K9mj | AqQeM | `/runs/remote%3Aacme%2Fweb/20261008-1502` | `runs` |
| `run-two-gates` | b7Glr | Blua8 | `/runs/remote%3Aacme%2Fweb/20261008-1600` | `runs` |
| `run-story-edges` | wEAjb | LXpRo | `/runs/remote%3Aacme%2Fweb/20261008-0900` | `runs` |
| `run-record-abandoned` | wHNMJ | e9le3O | `/runs/remote%3Aacme%2Fweb/20261007-1310` | `runs` |
| `run-record-review` | wHNMJ | e9le3O | `/runs/remote%3Aacme%2Fweb/20261008-0940` | `runs` |

`run-record-abandoned` and `run-record-review` share one frame (the record headers board); each compares only its own root (`Hero abandoned`, `Hero review`), so the same export is committed under both slugs. `run-story-edges` is one run (`20261008-0900`) whose story runs evidence (legacy), implement attempt 1 (failed), implement attempt 2, self-review (redirected), with the Now card on implement attempt 3. `run-two-gates` is one run with a herd-owned ship gate and Matt's plan gate open together. The route column is the contract Task 7's fixture and board table follow; the run ids, repo and titles are the boards' own data.

- [ ] Copy the exports from the controller's scratch export dir into the paths above.
- [ ] Add the README section: what the boards are, the table above, "Kit chrome is not compared" pointer, and a board-fix list seeded with: "Boards draw Inter; the console renders the system sans."
- [ ] Commit: `docs: runs redesign boards and parity exports`.

---

### Task 1: Gates linked to a run (`run` and `linked` filters)

**Files:**
- Modify: `lib/daemon/gates-store.ts` (`list` filter), `lib/daemon/handlers/gate.ts` (`gate:list`)
- Modify: `packages/rt-client/src/commands.ts` (`gate:list` payload), `packages/rt-client/src/client.ts` (`gateList` allowlist)
- Modify: `apps/console/src/server/gates.ts` (`?run=`, `?linked=1`)
- Test: `lib/daemon/__tests__/gates-store.test.ts`, `lib/daemon/__tests__/gates-handlers.test.ts`, `packages/rt-client/test/gate-wrappers.test.ts`, `apps/console/src/server/gates.test.ts`

**Interfaces:**
- Produces: `GatesStore.list({ ..., run?: string, linked?: boolean })`; `Commands["gate:list"]["payload"]` gains `run?: string; linked?: boolean`; `GET /api/gates?run=<id>` and `GET /api/gates?linked=1` → `{ gates: GateRow[] }`, every status, all pages.
- Helper produced: `apps/console/src/shared/gate-run.ts` exports `runIdOfGate(g: GateRow): string | null` (the `run:` subject's id, else `g.origin?.runId`, else null).

- [ ] **Step 1: Failing store tests** (in the list describe, using the file's `openGate` helper; open a gate with `origin` the way the file's other origin tests do):

```ts
test("run matches the run: subject and gates whose origin names the run", () => {
  const s = store();
  const a = openGate(s, "run:r1");
  const b = openGate(s, "mr:acme/web!412", { origin: { runId: "r1" } });
  openGate(s, "run:r12");
  openGate(s, "mr:acme/web!9", { origin: { runId: "r2" } });
  expect(s.list({ run: "r1" }).gates.map((g) => g.id).sort()).toEqual([a, b].sort());
});
test("linked returns run: subjects and any gate with an origin run", () => {
  const s = store();
  const a = openGate(s, "run:r1");
  const b = openGate(s, "mr:acme/web!412", { origin: { runId: "r9" } });
  openGate(s, "mr:acme/web!9");
  openGate(s, "herd:alpha");
  expect(s.list({ linked: true }).gates.map((g) => g.id).sort()).toEqual([a, b].sort());
});
```

- [ ] **Step 2: Run, expect FAIL.** `bun test lib/daemon/__tests__/gates-store.test.ts`
- [ ] **Step 3: Implement** in `list`, beside the `subject` clause:

```ts
if (filter.run) {
  clauses.push("(subject = ? OR json_extract(origin, '$.runId') = ?)");
  params.push(`run:${filter.run}`, filter.run);
}
if (filter.linked) {
  clauses.push("(subject LIKE 'run:%' OR json_extract(origin, '$.runId') IS NOT NULL)");
}
```

Handler: pass `run` (trimmed non-empty string) and `linked` (`payload.linked === true`). Add both keys to the `gateList` allowlist and to the payload type. Handler test: `gate:list {run:"r1"}` returns the run: and origin-linked rows. Wrapper test: both keys forwarded.

- [ ] **Step 4: Console route.** Extend the query validator: `run` (non-empty string) and `linked` (`'1'`). `listAllRunGates(filter)` sends `{ run }` or `{ linked: true }` (older daemons ignore unknown keys and fall back to the existing `subjectPrefix: 'run:'`, so always send `subjectPrefix: 'run:'` together with `run` only when no `linked`; with `linked`, send `{ linked: true }` alone). Tests: `?run=r1` passes `run`; `?linked=1` passes `linked: true`; neither keeps today's behaviour. Add `runIdOfGate` with unit tests (run: subject, origin, neither).
- [ ] **Step 5: Run, expect PASS; rebuild rt-client; typecheck.**

```
bun test lib/daemon/__tests__/gates-store.test.ts lib/daemon/__tests__/gates-handlers.test.ts packages/rt-client/test/gate-wrappers.test.ts
(cd packages/rt-client && bun run build)
cd apps/console && bunx vitest run src/server/gates.test.ts src/shared && cd ../.. && bun run console:typecheck && bunx tsc --noEmit
```

- [ ] **Step 6: Commit** `gates: list every gate linked to a run`.

Note on old daemons: with `run`, an old daemon ignores it; the console then receives the `subjectPrefix: 'run:'` listing and filters client-side by `runIdOfGate === runId`, so the page is still right (review gates simply absent). Put that filter in the hook in Task 8.

---

### Task 2: Run outcome model and cache merge

**Files:**
- Create: `lib/runs/outcome.ts`, `lib/runs/__tests__/outcome.test.ts`
- Modify: `lib/runs/store.ts` (merge outcome into summaries from `listRuns`, `findRun`, `readRun`), `packages/rt-client/src/commands.ts` (`RunOutcome`, `RunSummary.outcome?`)

**Interfaces:**
- Produces (rt-client): 
  ```ts
  export interface RunOutcome {
    status: "running" | "done" | "abandoned" | "failed";
    mr?: { iid: number; state: "opened" | "merged" | "closed" | "unknown"; url: string | null; mergedAt?: number };
    reviewed?: { iid: number; url: string | null; posted: string | null };
    ci?: string | null;
  }
  ```
- Produces (`lib/runs/outcome.ts`):
  - `parseMrRef(value: string | null | undefined): { iid: number; url: string | null } | null` — URL `.../merge_requests/<iid>`, `!<iid>`, bare `<iid>`.
  - `mrRole(producedBy: string | null, workType: string): "own" | "reviewed" | null` — `ship`/`watch-ci` on a non-review run → own; `review`/`receive-review` → reviewed.
  - `postedFromDecisions(decisions: RunDecisionRow[]): string | null` — the latest decision whose scope is `post` and whose selection has a string `disposition`.
  - `OUTCOME_KV_NS = "runs.outcome"`; `interface CachedOutcome { iid: number; state: "opened"|"merged"|"closed"; mergedAt?: number; ci: string | null; posted: string | null; checkedAt: number }`.
  - `buildOutcome(summary: { status: string; work_type: string }, mrField: { value: string; produced_by: string } | null, decisions: RunDecisionRow[], cached: CachedOutcome | null): RunOutcome`.
  - `readCachedOutcome(runId: string): CachedOutcome | null` and `writeCachedOutcome(runId: string, v: CachedOutcome): void` over `getKvValue`/`setKvValue` (`lib/state/kv-blob.ts`).

- [ ] **Step 1: Failing tests** for `parseMrRef` (three formats, junk → null), `mrRole` (ship/watch-ci own, review/receive-review reviewed, other → null), `postedFromDecisions`, and `buildOutcome`:
  - running work run, no mr → `{ status: "running" }`;
  - done work run, mr `!405` by ship, cache merged → `mr: { iid: 405, state: "merged", url: null, mergedAt }`, `ci` from cache;
  - done work run, mr by ship, no cache → `state: "unknown"`;
  - review run, mr URL by review, post decision `{findings:3, disposition:"request changes"}` → `reviewed: { iid, url, posted: "request changes" }`, no `mr`;
  - review run without a post decision but cache `posted: "approve"` → posted `approve`.
- [ ] **Step 2: Run, expect FAIL.** `bun test lib/runs/__tests__/outcome.test.ts`
- [ ] **Step 3: Implement** the pure functions and the kv read/write. `status` maps the run's own status (`running`, `done`, `abandoned`, `failed`; anything else → `done`).
- [ ] **Step 4: Merge into summaries.** In `store.ts`, where a `RunSummary` is built (both the cached list path and `readRun`), set `outcome: buildOutcome(...)` reading the `mr` field row (value + `produced_by`) and decisions, and `readCachedOutcome(id)`. The summary cache key must not freeze `outcome`: merge the kv value after the mtime-cached summary is read, so a refresher write shows on the next list. Store test: a seeded run with an `mr` field by `ship` and a kv entry `merged` lists `outcome.mr.state === "merged"`; without the kv entry, `unknown`.
- [ ] **Step 5: Run, expect PASS; rebuild rt-client; typecheck.** `bun test lib/runs/__tests__/outcome.test.ts lib/runs/__tests__/store.test.ts && (cd packages/rt-client && bun run build) && bunx tsc --noEmit && bun run console:typecheck`
- [ ] **Step 6: Commit** `runs: outcome on the run summary`.

---

### Task 3: Outcome refresher in the daemon

**Files:**
- Create: `lib/daemon/run-outcome-refresher.ts`, `lib/daemon/__tests__/run-outcome-refresher.test.ts`
- Modify: `lib/daemon.ts` (start it beside the other periodic sweeps; stop on shutdown)

**Interfaces:**
- Consumes: Task 2's `parseMrRef`, `mrRole`, `readCachedOutcome`, `writeCachedOutcome`, `CachedOutcome`; `listRuns`/`readRun` from `lib/runs/store.ts`; the gate store's `list({ run })` from Task 1.
- Produces:
  ```ts
  export interface OutcomeRefresherDeps {
    listRunsForOutcome: () => { id: string; repo: string; work_type: string; status: string; started_at: number; ended_at: number | null; mr: { value: string; produced_by: string } | null }[];
    getMr: (repoName: string, iid: number) => Promise<{ ok: true; state: "opened" | "merged" | "closed"; mergedAt?: number; ci: string | null } | { ok: false }>;
    hasRepo: (repoKey: string) => boolean;
    postedFromGates: (runId: string) => string | null;
    emitRunUpdated: (runId: string, repo: string) => void;
    now: () => number;
  }
  export function createOutcomeRefresher(deps: OutcomeRefresherDeps, opts?: { batch?: number; openTtlMs?: number; maxAgeMs?: number }): { tick: () => Promise<void> };
  ```
  Defaults: `batch` 4, `openTtlMs` 10 min, `maxAgeMs` 7 days.

Rules for `tick`:
- Candidates: runs whose `mr` field has a role (`mrRole`) and parses (`parseMrRef`).
- Reviewed role: compute `posted` from decisions (Task 2 already does) else `postedFromGates(runId)` (the answered `review-post` gate's `outcome` question pick label, or `respond-post`'s `disposition`); write it into the cache entry; no forge call.
- Own role: skip when cached state is `merged` or `closed`; skip when cached `opened` and `now - checkedAt < openTtlMs`; skip when the run started more than `maxAgeMs` ago and is cached at all; skip when `!hasRepo(repo)` (stays unknown).
- At most `batch` forge calls per tick, oldest `checkedAt` first; a failed `getMr` leaves the entry as it was.
- When a written entry differs from the previous one, `emitRunUpdated`.

- [ ] **Step 1: Failing tests** with in-memory deps (kv through the real `kv-blob` on the test's isolated state db, as other daemon tests do): merged is final (no second call); opened refreshes only after the TTL; batch cap; unknown repo → no call; failed call keeps the old entry; reviewed run → posted written, no `getMr`; a change emits `run-updated`, no change emits nothing.
- [ ] **Step 2: Run, expect FAIL.** `bun test lib/daemon/__tests__/run-outcome-refresher.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Wire in `lib/daemon.ts`**: `getMr` dispatches the routed `mr:get` handler with `{ repoName, iid }` and maps `data.mr` (`state`, `merged_at`→`mergedAt`, `head_pipeline?.status ?? pipeline?.status`→`ci`); `hasRepo` is `repoKey in ctx.repoIndex()`; `postedFromGates` uses the gates store `list({ run })`; `emitRunUpdated` uses the daemon's existing `run-updated` emitter; tick every 60 s with the same timer pattern the daemon uses for its other sweeps, never overlapping (skip a tick while one runs).
- [ ] **Step 5: Run, expect PASS; typecheck.** `bun test lib/daemon/__tests__/run-outcome-refresher.test.ts && bunx tsc --noEmit`
- [ ] **Step 6: Commit** `daemon: refresh run outcomes in the background`.

---

### Task 4: Transcript key on `runs:evidence`

**Files:**
- Modify: `lib/daemon/upload-guard.ts` (add `checkTextPath`), `lib/daemon/handlers/runs.ts`, `packages/rt-client/src/evidence.ts` (`EVIDENCE_TEXT_KEYS = ["transcript"] as const`), `packages/rt-client/src/commands.ts` (payload `key: EvidenceImageKey | "transcript"`, data adds `text?: string`), `apps/console/src/server/runs.ts`
- Test: `lib/daemon/__tests__/upload-guard.test.ts`, `lib/daemon/__tests__/runs-handlers.test.ts`, `apps/console/src/server/runs.test.ts`

**Interfaces:**
- Produces: `checkTextPath(path: string, roots: readonly string[], opts: { maxBytes: number; runsRoot?: string; workRoot?: string; evidenceRoot?: string; uid?: number | null }): { ok: true; text: string; mime: "text/plain" | "text/markdown" } | { ok: false; error: string }` — same realpath, regular single-link file, no-symlink read and root admission as `checkUploadPath`; extension `.md` (markdown), `.txt` or `.log` (plain); UTF-8 decoded with `new TextDecoder("utf-8", { fatal: true })`; cap 256 KB.
- `runs:evidence` with `key: "transcript"` returns `{ ok: true, data: { mime, text } }`; the image path is unchanged.
- Console: `GET /api/runs/:repo/:runId/evidence/transcript` → `text/plain; charset=utf-8` (or `text/markdown; charset=utf-8`) body, 404 on refusal.

- [ ] **Step 1: Failing tests**: a `.md` transcript under a registered worktree served as markdown text; `.log` as plain; 300 KB refused; invalid UTF-8 bytes refused; `.png` refused; a symlink refused; an unregistered root refused (use the handler's `isRunTree` seam); console relay returns the text with the content type.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `checkTextPath` by reusing `checkUploadPath`'s internal realpath/stat/containment helpers (extract a shared internal function rather than copying; keep `checkUploadPath`'s behaviour byte-identical, its existing tests prove it).
- [ ] **Step 4: Run, expect PASS; rebuild rt-client; typecheck.** `bun test lib/daemon/__tests__/upload-guard.test.ts lib/daemon/__tests__/runs-handlers.test.ts && (cd packages/rt-client && bun run build) && cd apps/console && bunx vitest run src/server/runs.test.ts && cd ../.. && bunx tsc --noEmit && bun run console:typecheck`
- [ ] **Step 5: Commit** `runs:evidence: serve the evidence transcript as text`.

---

### Task 5: Pipeline skills record stages and label recommendations

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/work/SKILL.md` (after `run_start`: `run_field_set {key: "pipeline-stages", value: "<{{pipeline.stages}} joined by spaces>", stage: "provision"}` or whatever stage the orchestrator uses for its own writes; read the file to see how it names its writes)
- Modify: every stage skill that asks a run gate with a recommended pick (at least `stage-plan/SKILL.md` ~117, `stage-evidence/SKILL.md` ~226, `stage-ship/SKILL.md` ~411; grep `recommended` and `first` under `plugins/mattstack/attachments/pipeline/`) so the recommended option's label ends with ` (Recommended)`.
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (one patch bump).

- [ ] **Step 1:** Load `superpowers:writing-skills` and `mattstack:editing-skills`; follow their process. Confirm `{{pipeline.stages}}` is a placeholder the compile resolves (`lib/skills/placeholders.ts`); if the orchestrator has no such placeholder in scope, name the stages from the chain the skill already lists.
- [ ] **Step 2:** Edit each skill; keep graphs and prose in agreement.
- [ ] **Step 3:** Checks: `bash plugins/mattstack/scripts/certify.sh` on each changed skill dir (or the certify command the `plugin-mattstack` job runs), `check-dot`, `bun cli.ts skills check --pack-dir $PWD/plugins/mattstack --mattstack-dir $TMPDIR/ms --strict`, `bun scripts/ci/plugin-version-bumped.ts --base HEAD~1`.
- [ ] **Step 4: Commit** `pipeline: record the stage list, label the recommended option`.

---

### Task 6: Selectors

**Files:**
- Create: `apps/console/src/app/runs/derive/kind.ts`, `fields.ts`, `stages.ts`, `timeline.ts`, `answers.ts` with sibling `*.test.ts`
- Modify: `apps/console/src/app/runs/derive/gates.ts` only if a helper belongs there

**Interfaces (all pure, all exported):**
- `kind.ts`: `type RunKind = "work" | "review" | "respond" | "utility"`; `runKind(workType: string): RunKind` (`feature`/`work` → work, `review` → review, `receive-review` → respond, else utility); `runTitle(run: { ticket: string | null; branch: string | null; work_type: string; id: string }, enrichment: { ticketTitle?: string | null; mrTitle?: string | null }): string` (ticket title, else branch, else MR title for review/respond, else `<work_type> · <id>`).
- `answers.ts`: `answeredBy(g: GateRow): { you: true; via: "console" | "pane" | "board" } | { you: false; via: "shepherd" } | null`; `structuredContextSummary(context: string | null | undefined): string | null` (`findings@1` → `"<n> findings"`, `carryover@1` → `"<n> carried over"`, `skipped@1` → `"<n> skipped"`, other JSON object → `"structured context"`, prose → null; the schema is read from a `gate-ctx` or `schema` key; the count from the first array value); `countCommits(value: string | null): number` (space- or comma-separated shas, `a..b (n): ...` → n, single sha → 1, empty → 0).
- `fields.ts`: `PLUMBING_KEYS` (`hold`, `gate`, `waiting-gate`, `claude-session`, `herdr-pane`, `agent`, `pipeline-stages`, and any `extra.*`); `SIDE_KEYS` (`ticket`, `branch`, `worktree`, `mr`, `commits`); `storyFields(fields: RunFieldRow[]): RunFieldRow[]` (drops plumbing, side keys and `evidence`); `placeFields(fields: RunFieldRow[], attempts: StageAttempt[]): Map<string, RunFieldRow[]>` keyed `"<stage>#<attempt>"` by `at` falling in the attempt window.
- `stages.ts`: `interface StageAttempt { stage: string; attempt: number; status: "running" | "done" | "failed" | "redirected"; startedAt: number | null; endedAt: number | null }`; `stageAttempts(stages: RunStageRow[], run: { status: string; ended_at: number | null }, now: number): StageAttempt[]` (run order; a `running` attempt on a finished run ends at `ended_at`; window end = next attempt's start when no `ended_at`); `railStages(pipelineStages: string | null, attempts: StageAttempt[], held: { stage: string; to: number | null }[]): { name: string; status: "done" | "running" | "failed" | "redirected" | "held" | "waiting" | "not-started"; durationMs: number | null; attempts: number }[]` (pipeline list order, executed stages not in the list appended; `waiting` when a mine-answerable gate sits on that stage, passed in by the caller via a `waitingStage: string | null` argument — add it as the last parameter).
- `timeline.ts`: `type SegmentKind = "done" | "running" | "you" | "ci" | "held" | "idle"`; `timelineSegments(input: { attempts: StageAttempt[]; myGateSpans: { from: number; to: number }[]; held: { from: number; to: number | null }[]; runStart: number; runEnd: number; dayStart: number; dayEnd: number }): { kind: SegmentKind; from: number; to: number; stage: string | null }[]` — precedence you > ci (`watch-ci` attempts) > held > stage status (`done`/`running`; failed and redirected draw as done); gaps inside the run are `idle`; clipped to the day window; sorted, non-overlapping, adjacent same-kind segments merged.
- `myGateSpans(gates: GateRow[], now: number): { from: number; to: number }[]` in `answers.ts` using `isMine` from `apps/console/src/shared/gate-waiting.ts`.

- [ ] **Step 1: Failing tests** covering each export, including: field placement across a re-run (attempt 1 vs 2 windows); finished run with a `running` stage clamps to `ended_at`; precedence with overlapping gate and watch-ci spans; idle gap; day clipping; `answeredBy` for `console`, `pane`, `board`, `shepherd`, missing; `structuredContextSummary` for each schema, a `gate-ctx` of another schema, prose and invalid JSON; `countCommits` for all four formats and empty; `runTitle` fallbacks; `railStages` with and without `pipeline-stages`, held and waiting.
- [ ] **Step 2: Run, expect FAIL.** `cd apps/console && bunx vitest run src/app/runs/derive`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS; typecheck; format.** plus `bunx prettier --check src/app/runs/derive`.
- [ ] **Step 5: Commit** `console: selectors for run kinds, fields, stages, timeline and answers`.

---

### Task 7: Design fixture for the runs pages and the parity board table

**Files:**
- Create: `apps/console/src/server/fixtures/design/runs/` (JSON per payload: `runs.json`, `run-<id>.json` details, `gates.json`, `effective-inputs-<id>.json`, `stage-doc-<id>-<stage>.md`, `evidence/` PNG placeholders and a transcript `.md`)
- Create: `apps/console/src/server/fixtures/design/runsFixture.ts` + test
- Modify: `apps/console/src/server/fixtures/design/scenarios.ts` (add `runs`, `runs-empty`), `apps/console/src/server/runs.ts`, `gates.ts`, `effectiveInputs.ts` (answer from the fixture when `fixtureMode` is on, the way `mountSkills` takes `fixture?.runRt`)
- Modify: `apps/console/scripts/parity/boards.ts` (the eleven boards from Task 0's table; roots named after each board's top content layers; `height` = board height), `apps/console/scripts/parity/boards.test.ts` if it enumerates
- Test: `apps/console/src/server/fixtures/design/runsFixture.test.ts`

**Interfaces:**
- Produces: `runsFixture(scenario): { listRuns(): RunSummary[]; getRun(repo, id): RunDetail | null; gates(filter): GateRow[]; effectiveInputs(repo, id); stageDoc(repo, id, stage): string; evidence(repo, id, key): { mime: string; bytes: Uint8Array } | null }`.
- Every value a board draws (titles, run ids, stage names and durations, field keys and values, gate questions, options, picks, notes, times, counts, MR iids, outcome labels) exists in the fixture so the page renders that exact text. Times are fixed: the fixture's `now` is the board's "as of" time on 2026-10-08 (America/Chicago), injected through the server's clock seam (add one if the run routes call `Date.now()` directly; the client reads `now` from the same response, e.g. an `asOf` field, never its own clock, under fixture mode).

- [ ] **Step 1:** Read every board PNG in `docs/apps/design/console/renders/runs-*` and `run-*` and the matching `parity/*.light.html` layer names; list each board's data in the fixture JSON.
- [ ] **Step 2: Failing test**: the fixture serves each board's run with the board's title, stage list and gate questions (assert a handful of exact strings per board, read from the board html as `boards.test.ts` does for the skills boards).
- [ ] **Step 3: Implement** the fixture and the route seams. With `CONSOLE_FIXTURE` unset, every route behaves exactly as before (existing route tests stay green).
- [ ] **Step 4:** Add the eleven boards to `boards.ts` with routes and scenarios from Task 0's table.
- [ ] **Step 5: Run** `cd apps/console && bunx vitest run src/server scripts/parity && cd ../.. && bun run console:typecheck`.
- [ ] **Step 6: Commit** `console: design fixture for the runs pages`.

---

### Task 8: Shared units A: data hooks, StageRail, FieldValue, OutcomeBadge

**Files:**
- Create: `apps/console/src/app/runs/run-page/useRunGates.ts`, `apps/console/src/app/runs/runs-page/useLinkedGates.ts`
- Create: `apps/console/src/app/runs/run-page/StageRail.tsx`, `FieldValue.tsx`, `OutcomeBadge.tsx` (+ `.module.css` as needed, `.stories.tsx`, `.test.tsx`)

**Interfaces:**
- `useRunGates(runId: string): { gates: GateRow[]; isLoading: boolean }` — `GET /api/gates?run=<id>`, then keeps only `runIdOfGate(g) === runId` (old-daemon fallback); invalidated by the `gates` websocket topic like today's `useGates`.
- `useLinkedGates(): { byRun: Map<string, GateRow[]>; all: GateRow[] }` — `?linked=1`, grouped by `runIdOfGate`.
- `<StageRail stages={RailStage[]} gateCounts={Record<string, number>} compact?: boolean />` — Mantine `Progress` per column; layer names `Stage <name>`, `bar`, `lab`, `meta` as on the boards.
- `<FieldValue fieldKey={string} value={string} />` — by `fieldKind`: url → `Anchor`, sha-list → monospace shas, json → collapsed `Code`, gate-ref → muted mono, text → text.
- `<OutcomeBadge outcome={RunOutcome} />` — merged (ok tone, git-merge icon), CI passed/failed, abandoned (neutral), failed (bad), reviewed (accent, `reviewed !<iid> · <posted>`); `unknown` MR state renders nothing.

- [ ] **Step 1: Failing tests** (Testing Library): StageRail renders not-started stages muted and the gate count; FieldValue picks the renderer per kind; OutcomeBadge per outcome incl. unknown → empty.
- [ ] **Step 2–4:** implement, stories for each state, run `cd apps/console && bunx vitest run src/app/runs/run-page src/app/runs/runs-page`, typecheck, prettier.
- [ ] **Step 5: Commit** `console: run rail, field values and outcome badges`.

---

### Task 9: Shared units B: DecisionRow, DecisionCard, HandoffCard

**Files:**
- Create: `apps/console/src/app/runs/run-page/DecisionRow.tsx`, `DecisionCard.tsx`, `HandoffCard.tsx` (+ css, stories, tests)

**Interfaces:**
- `<DecisionRow gate={GateRow} question={GateQuestion} />` — signpost icon, question label, pick, `you · 1:41 PM` / `shepherd · 1:41 PM` / time only (`answeredBy`), surface in a `Tooltip`; expands (Mantine `Collapse`, chevron `ActionIcon`) to note, other options, "went against the recommendation" (`tookRecommendation === false`); closed/superseded gates render muted with "closed: <reason>" / "superseded". Board layers: `Decision`, `qa`, chevron.
- `<DecisionCard gate={GateRow} />` — record layout (p54Uq): gate context once as "What the agent found · <n> lines" collapsed (`structuredContextSummary` line + collapsed mono JSON when structured), each question's options with the pick highlighted (ok-soft) and `recommended` badge, "overrode recommendation" badge (warn), note or edited reply `text`, who/when.
- `<HandoffCard gate={GateRow} boardUrl={string | null} />` — p3K9mj's Now slot: head "Review post · waiting in the board" (warn-soft), the question, options as read-only numbered chips with the recommended badge, `structuredContextSummary` line, "Answer in the board" `Button` (`component="a"` when `boardUrl`, else muted text). `boardUrl`: the board app's MR page if the board exposes a route for it (grep `apps/board` for its MR route); else null.

- [ ] Steps: failing tests (each state), implement with gate-kit helpers (`optionLabel`, `optionValue`, `stripRecommended`), stories, run `cd apps/console && bunx vitest run src/app/runs/run-page`, typecheck, prettier, commit `console: decision rows, decision cards and the board hand-off`.

---

### Task 10: Shared units C: EvidenceCard, compare modal, transcript

**Files:**
- Create: `apps/console/src/app/runs/run-page/EvidenceCard.tsx`, `EvidenceCompare.tsx`, `TranscriptBlock.tsx` (+ css, stories, tests)

**Interfaces:**
- `<EvidenceCard repo runId evidence={ParsedEvidence} variant: "story" | "record" />` — version 1: `SegmentedControl` Plain/Annotated (only present variants) and Before/After (when both), Mantine `Image` from `/api/runs/:repo/:runId/evidence/:key`, caption = file name, `onError` → "image unavailable" placeholder, click → `modals.open` full size. Version 0: links list (`Anchor`), no image requests. `variant="record"` is the record column: Before/After thumbnails + "Compare full size" (`EvidenceCompare` in a modal with Before/After toggle and arrow `ActionIcon`s), "attached to !<iid>" when `evidence.attach === "ship"` and an own MR exists, "Case used" card.
- `<TranscriptBlock repo runId />` — fetches `/evidence/transcript`; `text/markdown` renders through the console's existing markdown renderer (find the one `GateContext` uses), else a mono `Code block` with the first 40 lines and "show all".

- [ ] Steps: failing tests (v1 toggle variants, v0 links, image error placeholder, transcript md vs plain, 404 → nothing), implement, stories, run tests, typecheck, prettier, commit `console: evidence card, compare and transcript`.

---

### Task 11: Live run page: shell, header, Now card, story, side cards, inputs drawer

**Files:**
- Create: `apps/console/src/app/runs/run-page/RunPage.tsx`, `RunHeader.tsx`, `NowCard.tsx`, `Story.tsx`, `StorySection.tsx`, `SideCards.tsx`, `InputsDrawer.tsx` (+ css, stories, tests)
- Modify: `apps/console/src/app/runs/RunDetail.tsx` (becomes the shell that picks live vs record), `RunDetail.test.tsx` (rewrite for the new page)
- Delete: the tab code in `RunDetail.tsx`, `SummaryCard`, `StageProgress.tsx` (+ test) once unused, `Timeline.tsx`'s rendering (keep any helper still imported elsewhere, moving it to `derive/`)

**Behaviour:** spec A (header, rail for work runs only, Now card, story per attempt with `placeFields`, failed/redirected/held sections, `EvidenceCard` in evidence and ship sections, one-stage runs as one block, side cards, drawer with `?inputs`), the `#gate-<id>` deep link, today's header action visibility rules, `HandoffCard` in the slot for review/respond runs with an answerable linked gate. Layer names via `data-parity` exactly as the boards name them.

- [ ] **Step 1: Failing tests**: work run renders rail + Now + story sections in order; one-stage review run renders no rail and the hand-off card; finished run renders the record (stub until Task 14: assert RunDetail picks the record component); plumbing keys never render; evidence field never renders as a field; `?inputs` opens the drawer.
- [ ] **Step 2–3:** implement; delete the replaced code; keep `RunSearch`, `RunBoard` imports compiling.
- [ ] **Step 4:** run `cd apps/console && bunx vitest run src/app/runs`, typecheck, lint (`bun run console:lint`), prettier.
- [ ] **Step 5: Parity** for `run-live`, `run-story-edges`, `run-review-live` in light and dark: 0 mismatches outside the board-fix list. Fix the app until it holds; record any kit-vs-board difference in the README's board-fix list.
- [ ] **Step 6: Commit** `console: live run page`.

---

### Task 12: Gate panel

**Files:**
- Create: `apps/console/src/app/runs/run-page/GatePanel.tsx`, `useGateDraft.ts` (+ css, stories, tests)
- Modify: `RunPage.tsx` (slot), delete `GateCard.tsx`/`GateQuestionnaire.tsx` and their tests/stories once replaced (move any still-used helper)

**Behaviour:** spec A "Gate panel": stacked answerable `run:` gates oldest first; mine vs herd-owned tone and copy; `Stepper` with `allowStepSelect` (hidden for one question); findings panel always open (question context, else gate context; markdown; "expand" modal; hidden when none); `Radio.Card`/`Checkbox.Card` options with recommended badge and number `Kbd` on the first nine; note `Textarea`; "Open the pane"; "draft saved"; Next/Submit with `⌘↵` `Kbd`; keys 1-9 and `⌘↵` while focused; drafts in `localStorage` key `console.gateDraft.<gateId>` with try/catch, cleared on success or when no longer answerable; submit through today's answer mutation; herd-owned submit first `modals.confirm`s the override; parked badge and resume note kept.

- [ ] **Step 1: Failing tests**: stepper navigation; number keys pick; `⌘↵` advances then submits; draft restored after remount and cleared after submit; localStorage throwing does not break the panel; herd-owned submit opens the confirm and does not post until confirmed; multi-select with skippable; >9 options have no `Kbd` past nine; two gates stack in order.
- [ ] **Step 2–4:** implement, stories, run tests, typecheck, lint, prettier.
- [ ] **Step 5: Parity** for `run-gate` and `run-two-gates`, light and dark, 0 mismatches.
- [ ] **Step 6: Commit** `console: gate panel`.

---

### Task 13: Record view

**Files:**
- Create: `apps/console/src/app/runs/run-page/RecordPage.tsx`, `RecordHeader.tsx`, `DecisionsTab.tsx` (+ css, stories, tests)
- Modify: `RunDetail.tsx` (route finished runs here)

**Behaviour:** spec B: header with span and `OutcomeBadge`s; stats row (applicable stats only); `Tabs` Story / Decisions (default when any answered gate) / Evidence (work runs) / Inputs; Decisions tab "By stage" nav (work runs) with counts and override marks, `DecisionCard`s in stage order, closed/superseded muted, evidence column (`EvidenceCard variant="record"`, `TranscriptBlock`, Case used); "Open log →" in the side card selects Decisions on a finished run.

- [ ] **Step 1: Failing tests**: merged work run shows merged + CI badges and all six stats; abandoned run hides took-recommendation when no recommendation existed; review run hides evidence/commits stats and the Evidence tab and shows `reviewed !412 · request changes`; Decisions default vs Story default.
- [ ] **Step 2–4:** implement, stories, tests, typecheck, lint, prettier.
- [ ] **Step 5: Parity** for `run-record`, `run-record-abandoned` and `run-record-review`, light and dark, 0 mismatches.
- [ ] **Step 6: Commit** `console: record view of a finished run`.

---

### Task 14: Runs page, Lanes

**Files:**
- Create: `apps/console/src/app/runs/runs-page/RunsPage.tsx`, `StatCards.tsx`, `WaitingBanner.tsx`, `LiveLane.tsx`, `EarlierList.tsx` (+ css, stories, tests)
- Modify: the `/` route to render `RunsPage`; delete `RunBoard.tsx`/`RunRow.tsx`/`bands.ts` rendering once replaced (keep `aging.ts` and any band logic the Live/Earlier split uses, moved to `derive/` if needed)

**Behaviour:** spec C Lanes: All/Live/Waiting/Done `SegmentedControl` (URL state), repo picker (today's), stat cards (waiting = `countsForConsoleBadge` gates and the oldest age; live count and current stages; finished today split work merged/abandoned and reviews posted; median work run over the last 30 finished work runs), waiting banner (oldest mine `run:` gate; read-only numbered options; "Answer gate" and `g` → run page `#gate-<id>`), live lanes (running and not stale by today's aging rules; compact `StageRail` for work runs; latest field line; MR line; decision count from linked gates), Earlier grouped by day with outcome icon, decisions, evidence ("—" for non-work), duration, end time, review sub-line, stale marker; "waiting in the board" marker on review rows with a waiting linked `mr:` gate; empty states per `runs-empty`.

- [ ] **Step 1: Failing tests**: stats from a mixed fixture (reviews excluded from median); herd gates excluded from waiting; `g` navigates; filter segments; empty state.
- [ ] **Step 2–4:** implement, stories, tests, typecheck, lint, prettier.
- [ ] **Step 5: Parity** for `runs-lanes` and `runs-empty`, light and dark, 0 mismatches.
- [ ] **Step 6: Commit** `console: runs page lanes`.

---

### Task 15: Runs page, Day timeline

**Files:**
- Create: `apps/console/src/app/runs/runs-page/DayTimeline.tsx`, `TimeSpent.tsx`, `DecisionsToday.tsx` (+ css, stories, tests)
- Modify: `RunsPage.tsx` (`?view=timeline`, Timeline/List `SegmentedControl`, day nav with `?day=YYYY-MM-DD`)

**Behaviour:** spec C Day timeline: legend; one row per run active that day with `timelineSegments` bars on a time axis (8 AM..6 PM extended to cover the day's runs; a "now" marker on today); hover `Tooltip` with stage and gate; "Where today's time went" totals per legend category; "Decisions you made today" from `answeredBy(...).you` answers that day.

- [ ] **Step 1: Failing tests**: segment colours per kind; day navigation changes the run set; totals add up to the bars; decisions list excludes shepherd answers.
- [ ] **Step 2–4:** implement, stories, tests, typecheck, lint, prettier.
- [ ] **Step 5: Parity** for `runs-timeline`, light and dark, 0 mismatches.
- [ ] **Step 6: Commit** `console: runs day timeline`.

---

### Task 16: Final parity sweep and gates

- [ ] Parity for all eleven boards in light and dark (22 runs), 0 mismatches outside the board-fix list; fix any regression in the task that owns it.
- [ ] Against the live daemon (not the fixture): start the console from this worktree on a free port (`PORT=11097 bun src/server/index.ts` without `CONSOLE_FIXTURE`, vite on 5307) and screenshot in Fast Browser, light and dark: the runs page, a real work run, a real review run, a finished run. Report anything that reads wrong.
- [ ] `bun run check` (static gates), `bun run console:test`, the targeted rt tests of Tasks 1–4.
- [ ] Commit any fixes as `console: parity fixes`.

## Final verification

- [ ] `bun test lib/daemon/__tests__/gates-store.test.ts lib/daemon/__tests__/gates-handlers.test.ts lib/daemon/__tests__/run-outcome-refresher.test.ts lib/daemon/__tests__/runs-handlers.test.ts lib/daemon/__tests__/upload-guard.test.ts lib/runs/__tests__ packages/rt-client`
- [ ] `bun run console:test && bun run console:typecheck && bun run check`
- [ ] 22 parity runs at 0 mismatches outside the board-fix list.
