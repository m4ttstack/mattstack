# Evidence MCP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `evidence_record`, `evidence_attach`, `dev_endpoints` and a
batch `mr_upload {paths}` to rt's MCP server, so the evidence skills' upload
loop, record merge and endpoint probe become tool calls.

**Architecture:** Pure helpers live in `lib/evidence/` (record merge,
bundle copy, section render and splice, uploads field, refusal buckets) and
`lib/endpoint/readiness.ts`. Each is unit tested without a daemon. The tool
defs live in `lib/mcp/evidence-tools.ts` behind a deps seam (`command`, run
tools, fs roots, fetch, clock), and are registered as one block in
`lib/mcp/tools.ts`. Every upload still goes through the daemon's
`mr:upload`.

**Tech Stack:** Bun + TypeScript, `bun:test`, rt-client's `rtCommand`, the
run tools in `lib/mcp/run-tools.ts`.

**Spec:** `docs/superpowers/specs/2026-10-16-evidence-tools-design.md`.
Read it before any task: it fixes the merge table, the copy rules, the
bucket table, the section format and the result shapes. This plan does not
repeat them.

## Global Constraints

- **Write fence.** Only these may change:
  - `lib/evidence/**`;
  - `lib/endpoint/readiness.ts`;
  - `lib/mcp/evidence-tools.ts`;
  - the `mr_upload` handler and one contiguous registration line in
    `lib/mcp/tools.ts`;
  - `NAMES` in `lib/mcp/__tests__/tools.test.ts` and `EXPECTED_TOOL_NAMES`
    in `e2e/tests/mcp-serve.test.ts`;
  - `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated)
    and the `version` line in `plugins/mattstack/.claude-plugin/plugin.json`;
  - `__tests__` beside these files;
  - `docs/superpowers/**`.

  Never edit skill text, `upload-guard.ts`, `evidence-record-check.ts`,
  `packages/rt-client/src/evidence.ts` or `lib/runs/**`.
- **Tests.** Run `bun test <file>` from the worktree root only, and only on
  targeted files.
- **Purity.** Fixtures use generic names (`acme`, `web`, `api`, case ids
  like `retry-badge`). No employer names, slugs or ticket ids anywhere.
- **No `console.*`.** Errors go back as `err(...)`. Comments follow
  clean-code: only a constraint the code cannot show.
- **Run fields.** Reads and writes go through the run tools' handlers
  (`runToolDefs()` found by name), as `realMrCompositeDeps.runTool` does on
  #844. Never through sqlite directly.
- **The `evidence-uploads` value:**
  `{"v":1,"uploads":{"<realpath>":{"sha256","project","url","markdown","at"}|{"linked":true,"at"}}}`.
- **The run evidence folder** is `<HOME>/.mattstack/work/<run id>/evidence/`,
  where `<run id>` is `basename(dirname(runDb))`. It holds per-case
  subfolders `<case>/`, and a transcript sits at the folder root.
- **Fast Browser's source folder** is `<HOME>/.fast-browser/screenshots`.
- **`dev_endpoints` numbers:** probe every 2000 ms; request timeout
  5000 ms; `waitSeconds` defaults to 90, maximum 300, and 0 means probe
  once.
- **`mr_upload {paths}`** takes 1 to 20 paths; passing both `path` and
  `paths` is refused.

## Review Focus

1. **A description with the heading inside a fenced code block, or a
   second heading with the same text.** Only the first heading outside
   fences counts. Text outside the section is byte-identical, and splicing
   twice changes nothing. Pinned in Task 3.
2. **A board shared by before and after, plus a waived dark image.** It
   uploads once and prints once as `- Before and after (light):` with
   `![before and after](...)`. The dark image prints its own `Waived:`.
   Pinned in Tasks 3 and 7.
3. **A resumed attach after a board was revised in place,** with the same
   path and new bytes. It re-uploads. A gated board (one with
   `<stem>.redactions.json` beside it) always re-uploads. Pinned in
   Task 7.
4. **A case with a case waiver that gains an after image.** The waiver
   moves onto the existing uncovered images, and the new after is
   uncovered, so nothing is written. Pinned in Task 1.
5. **`dev_endpoints` where one role answers and one never does.** The call
   returns after `waitSeconds` with `waiting: [role]` and still reports the
   answered role. An unclaimed role is not waited on. Pinned in Tasks 5
   and 8.

---

### Task 1: Record merge (`lib/evidence/record-merge.ts`)

**Files:**
- Create: `lib/evidence/record-merge.ts`
- Test: `lib/evidence/__tests__/record-merge.test.ts`

**Interfaces:**
- Consumes: `parseEvidence` (v1 detection) and `validateEvidence` from
  `packages/rt-client/src/evidence.ts`.
- Produces:
  ```ts
  export type Slot = "before" | "after";
  export type Theme = "light" | "dark";
  export interface RawImage { path: string; annotated?: string; caption?: string; waiver?: string; [k: string]: unknown }
  export type RawSlot = RawImage | { light?: RawImage; dark?: RawImage };
  export interface RawCase { id: string; label: string; waiver?: string; before?: RawSlot; after?: RawSlot; [k: string]: unknown }
  export interface RawRecord { cases: RawCase[]; transcript?: string; url?: string; attach?: string; extra: Record<string, unknown> }
  export interface ImageInput { case: string; label?: string; slot: Slot; theme?: Theme; path?: string; annotated?: string; caption?: string; waiver?: string }
  export interface MergeInput { images?: ImageInput[]; cases?: Array<{ id: string; label?: string; waiver?: string }>; remove?: Array<{ case: string; slot?: Slot; theme?: Theme }>; transcript?: string; url?: string }
  export type Uncovered = { case: string; slot: Slot; theme?: Theme; path: string; why: "no-cover" | "no-caption" };
  export type Encoding = "evidence@2" | "plan:text" | "plan:ticket" | "plan:none";
  export function parseCurrent(value: string | null): RawRecord;
  export function mergeRecord(current: RawRecord, input: MergeInput): { ok: true; record: RawRecord } | { ok: false; error: string };
  export function uncoveredImages(record: RawRecord): Uncovered[];
  export function serializeRecord(record: RawRecord, plan?: "none"): { ok: true; encoding: Encoding; value: string } | { ok: false; error: string };
  export function imageAddresses(record: RawRecord): Array<{ case: string; slot: Slot; theme?: Theme; image: RawImage }>;
  ```

Unknown keys at the record, case and image level are preserved verbatim:
`extra` holds the record's, and the index signatures hold the rest.

- [ ] **Step 1: Write the failing tests** in `record-merge.test.ts`, one
  `test` per row of the spec's merge table and per merge step:
  - `parseCurrent` of a v2 value keeps a case-level `waiver` on the case
    and NOT on its images.
    `parseCurrent('{"v":2,"cases":[{"id":"a","label":"A","waiver":"w","before":{"path":"/x.png"}}]}').cases[0]`
    → `{id:"a",label:"A",waiver:"w",before:{path:"/x.png"}}`.
  - v1 `{"v":1,"before":"/b.png","beforeAnnotated":"/ba.png","case":"Badge","url":"https://t"}`
    → one case `{id:"case",label:"Badge",before:{path:"/b.png",annotated:"/ba.png"}}`
    and `url: "https://t"`. An absent `beforeAnnotated` leaves no
    `annotated` key.
  - `""`, `"-"`, `null` and `{"plan":"none"}` → `cases: []`.
  - `{"plan":"text","transcript":"/t.txt","url":"https://t"}` → no cases,
    with `transcript` and `url` kept.
  - Legacy text `"see /a.png and https://x"` → `attach` equals that text.
  - **Recapture:** the current after is `{light, dark}` and the call brings
    an after with only `{theme:"light", path:"/new.png"}` → the slot is
    exactly `{light:{path:"/new.png"}}`.
  - **Cover update:** the same path with `annotated` + `caption` → those
    keys are set, `waiver` is removed, and any other image key stays.
  - **Case-waiver migration:** a case with `waiver:"w"` and `before`
    `{path:"/b.png"}` gains an after `{path:"/a.png"}` → before is
    `{path:"/b.png",waiver:"w"}`, the case has no `waiver`, and
    `uncoveredImages` lists the after with `why:"no-cover"`.
  - An entry carrying both `annotated` and `waiver` → `ok:false`, and the
    error names the address.
  - A cover update for a missing image → `ok:false`, error contains
    `case "a" after`.
  - A new case without a label → `ok:false`.
  - `remove` with no slot deletes the case; with a slot, the slot; with a
    theme, one image.
  - `uncoveredImages`: annotated without caption → `why:"no-caption"`.
  - `serializeRecord`: images → `encoding:"evidence@2"` and a value that
    starts `{"v":2`, which `validateEvidence` accepts. No cases plus a
    transcript → `{"plan":"text","transcript":...}`. A url only →
    `{"plan":"ticket","url":...}`. `plan:"none"` → `{"plan":"none"}`.
    Nothing at all → `ok:false`.
  - **Round trip:** `serializeRecord(parseCurrent(v))` of a valid v2 value
    with an unknown key `"z":1` on the record, a case and an image keeps
    all three.

- [ ] **Step 2: Run them to see them fail.**
  `bun test lib/evidence/__tests__/record-merge.test.ts` → FAIL (module not
  found).
- [ ] **Step 3: Implement** the functions above. Merge order is the spec's
  steps 1 to 5. "Recapture" means an entry whose `path` is present and
  differs from the image now at that address. All of a call's recapture
  entries for one `(case, slot)` together replace that slot.
- [ ] **Step 4: Run the tests until they pass.**
- [ ] **Step 5: Commit:** `evidence: record merge, coverage and encodings`.

### Task 2: Bundle copy (`lib/evidence/bundle.ts`)

**Files:**
- Create: `lib/evidence/bundle.ts`
- Test: `lib/evidence/__tests__/bundle.test.ts`

**Interfaces:**
- Consumes: `isInsideRoot`, `claudeTempRoots`, `builtInEvidenceRoot`,
  `runEvidenceRoot`, `workRoot` and `UPLOAD_EXTENSIONS` from
  `lib/daemon/upload-guard.ts` (import only); `evidenceDir` from
  `lib/rt-paths.ts`; `runsRoot` from `lib/runs/paths.ts`.
- Produces:
  ```ts
  export const BUNDLE_EXTRA_EXTENSIONS = ["json", "txt", "log"] as const;
  export function bundleStem(fileName: string): string | null;
  export function bundleMembers(dir: string, fileName: string, list: (dir: string) => string[]): string[];
  export interface CopyRequest { src: string; destDir: string; single?: boolean }
  export interface CopyResult { from: string; to: string }
  export function copyIntoRun(
    requests: CopyRequest[],
    o: { allowedRoots: string[]; referencedElsewhere: Set<string> },
  ): { ok: true; copied: CopyResult[]; mapped: Map<string, string> } | { ok: false; error: string };
  export function allowedSourceRoots(o: { home: string; uid: number | null; repoRoots: string[]; uploadRoots: string[] }): string[];
  ```
  `mapped` maps each requested `src` (as given) to the destination path of
  that file. `single` is set for a transcript.

- [ ] **Step 1: Write the failing tests** against a temp dir created under
  the test's own `mkdtempSync`:
  - `bundleStem("r1-badge-before.c1.png") === "r1-badge-before"`;
    `bundleStem("shot.png") === "shot"`; `bundleStem(".x.png") === null`;
    `bundleStem("noext") === null`.
  - `bundleMembers` in a folder holding `s.png`, `s.c1.png`,
    `s.c1.capture.json`, `s.spec.json`, `s.redactions.json`,
    `s.redact-1.png`, `s.c1.png.bak`, `s-other.png` and `app.ts` → the
    first six only, sorted.
  - `copyIntoRun` copies the whole bundle into `destDir` (created when
    missing). `mapped.get(src)` is `destDir/<name>`.
  - A source outside every allowed root → `ok:false`, the error names the
    file, and nothing is written.
  - A symlink whose target is outside the roots → refused.
  - A file with two hard links → refused.
  - **Refresh:** a destination with identical bytes is not rewritten (its
    mtime is unchanged); different bytes are overwritten.
  - **Collision:** a destination with different bytes whose path is in
    `referencedElsewhere` → `ok:false`, nothing copied.
  - A dotfile source, or a `.sh` file, is never copied.
  - A source already inside `destDir` → no copy, and `mapped` maps it to
    itself.
- [ ] **Step 2: Run them to see them fail.**
  `bun test lib/evidence/__tests__/bundle.test.ts`.
- [ ] **Step 3: Implement.**
  - Check every request before copying anything, so a refusal leaves
    disk untouched.
  - Realpath each source; it must be a regular file with `nlink === 1` and
    sit under an allowed root (using `isInsideRoot`, with roots also
    realpathed).
  - Copy with `copyFileSync` into `mkdirSync(destDir, {recursive: true})`.
  - `allowedSourceRoots` returns `repoRoots`, `claudeTempRoots(uid)`, the
    `builtInEvidenceRoot(evidenceDir(), uid)` result when non-null,
    `uploadRoots`, `<home>/.mattstack/work` and
    `<home>/.fast-browser/screenshots`.
  - A work-root source is accepted only when `runEvidenceRoot` derives a
    run for it.
- [ ] **Step 4: Run the tests until they pass.**
- [ ] **Step 5: Commit:** `evidence: bundle copy into a run's evidence folder`.

### Task 3: Section render and splice (`lib/evidence/section.ts`)

**Files:**
- Create: `lib/evidence/section.ts`
- Test: `lib/evidence/__tests__/section.test.ts`

**Interfaces:**
- Consumes: `readEvidence`, `EvidenceRecord` and `legacyItems` from
  `packages/rt-client/src/evidence.ts`.
- Produces:
  ```ts
  export type FileLink = { markdown: string } | { local: string };
  export function renderSection(
    record: EvidenceRecord,
    link: (path: string) => FileLink,
    o: { coveredUrls?: Set<string>; appendix?: string },
  ): string;
  export function spliceSection(description: string, heading: string, body: string, before?: string): string;
  ```
  `coveredUrls` holds upload URLs that `evidence-uploads` maps to a case
  file; an `attach` line whose links are all covered is dropped.

- [ ] **Step 1: Write the failing tests:**
  - **The page's single-image example.** A case "Retry badge on the job
    row", before annotated with caption "Red box: the badge reads 0" →
    ```
    **Retry badge on the job row**

    - Before: ![before](/uploads/h/before-annotated.png)
      Caption: Red box: the badge reads 0
    ```
    The alt text is rewritten from GitLab's `![before-annotated](...)`.
  - **Shared board.** The before and after(light) annotated paths are the
    same file, and after(dark) is waived → one entry
    `- Before and after (light): ![before and after](/uploads/h/pair.png)`
    with a caption line, then `- After (dark): ![after](/uploads/h/d.png)`
    and `  Waived: <reason>`.
  - A case waiver prints `Waived: w` once, under the label, and its images
    print no `Waived:` of their own.
  - **A local link** prints the bare path: `- Before: /abs/b.png`.
  - **Trailing lines:** `Transcript: /t.txt`, then `Ticket: https://t`,
    then an `attach` line whose link is not covered, then the appendix
    text verbatim, in that order. An `attach` line whose only link is a
    case path is dropped.
  - **`spliceSection` replaces the section.** For
    `"# T\n\n## Evidence\n_helper_\n\nold\n\n## Checklist\n- [ ] x\n"` with
    heading `## Evidence`, the result keeps `_helper_`, replaces `old`,
    and keeps `## Checklist` byte-identical.
  - The same heading inside a ``` fence is ignored.
  - **Insertion:** a heading absent with `before: "## Checklist"` is
    inserted above it; absent without `before`, it is appended at the end
    after one blank line.
  - **Idempotence:** splicing twice with the same body gives the same
    string.
  - An HTML comment block directly under the heading is kept.
- [ ] **Step 2: Run them to see them fail.**
  `bun test lib/evidence/__tests__/section.test.ts`.
- [ ] **Step 3: Implement.**
  - Entries group shots by link key (the annotated path, else the waived
    path) in record order.
  - The label is the covered slots, capitalized and joined by " and ",
    plus ` (<themes joined by " and ">)` when any are themed.
  - The alt text is the slots, lowercase, joined by " and ".
  - Upload markdown is rewritten to `![<alt>](<url from the markdown>)`.
- [ ] **Step 4: Run the tests until they pass.**
- [ ] **Step 5: Commit:** `evidence: render and splice the MR evidence section`.

### Task 4: Uploads field and refusal buckets

**Files:**
- Create: `lib/evidence/uploads-field.ts`, `lib/evidence/refusal-buckets.ts`
- Test: `lib/evidence/__tests__/uploads-field.test.ts`,
  `lib/evidence/__tests__/refusal-buckets.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UploadEntry = { sha256: string; project: string; url: string; markdown: string; at: number } | { linked: true; at: number };
  export function parseUploads(value: string | null): Record<string, UploadEntry>;
  export function serializeUploads(map: Record<string, UploadEntry>): string;
  export function sha256Of(path: string): string;
  export type Bucket = "record" | "raw-capture" | "import" | "redaction" | "roots" | "missing" | "size" | "bytes" | "other";
  export const BUCKETS: readonly Bucket[];
  export function bucketFor(error: string): Bucket;
  ```

- [ ] **Step 1: Write the failing tests:**
  - `parseUploads("nope")`, `null` and `{"v":2}` all give `{}`.
    `serializeUploads` then `parseUploads` round-trips both entry shapes.
  - `sha256Of` of a temp file containing `abc` →
    `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
  - **Buckets from the real main guard.** Produce messages by calling
    `checkUploadPath` (outside the roots → `roots`; a missing file →
    `missing`; a `.txt` → `bytes`; a `.png` holding text → `bytes`; a
    relative path → `missing`) and `evidenceUploadRefusal` (no record →
    `record`; a raw capture → `raw-capture`; not listed → `record`; run
    not found → `record`).
  - **Buckets from #822's literals**, copied exactly from the spec's
    table: each `redaction` string → `redaction`; the import string →
    `import`.
  - `"file is 60.0 MB; the upload cap is 50 MB"` → `size`.
  - `"GitLab upload returned 500 Internal Server Error"` and
    `"repo-unknown"` → `other`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** `bucketFor` walks an ordered table of
  `[Bucket, RegExp[]]` in the spec's row order and returns `other` when
  nothing matches.
- [ ] **Step 4: Run the tests until they pass.**
- [ ] **Step 5: Commit:** `evidence: uploads field and upload refusal buckets`.

### Task 5: Readiness probe (`lib/endpoint/readiness.ts`)

**Files:**
- Create: `lib/endpoint/readiness.ts`
- Test: `lib/endpoint/__tests__/readiness.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ProbeDeps { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number }
  export type ProbeOutcome = { answered: boolean; status: number | null; answeredAfterMs: number | null };
  export async function waitForAnswers(
    targets: Array<{ role: string; url: string }>,
    o: { waitMs: number; intervalMs?: number; requestTimeoutMs?: number; signal?: AbortSignal; progress?: () => void },
    deps: ProbeDeps,
  ): Promise<{ outcomes: Record<string, ProbeOutcome>; waitedMs: number }>;
  ```

- [ ] **Step 1: Write the failing tests** with a fake clock, where `sleep`
  advances `now`, and a fake `fetch`:
  - A fetch resolving `new Response("", {status: 404})` → `answered:true`,
    `status:404`, after one round.
  - A fetch that rejects (connection refused) until round 3, then gives
    200 → answered after 3 rounds; `answeredAfterMs` is 4000 with a
    2000 ms interval.
  - **One role answers and one never does** with `waitMs: 6000` →
    `waitedMs >= 6000`, the second has `answered:false`, and the first
    stays answered.
  - `waitMs: 0` → exactly one round and no sleep.
  - A pre-aborted signal → returns after at most one round.
  - `progress` is called once per round.
  - Each fetch is called with `redirect: "manual"` and a signal.
- [ ] **Step 2: Run them to see them fail.**
  `bun test lib/endpoint/__tests__/readiness.test.ts`.
- [ ] **Step 3: Implement.**
  - Defaults are `intervalMs` 2000 and `requestTimeoutMs` 5000.
  - Each round probes only the roles not yet answered, in parallel.
  - The loop stops when all have answered, the deadline has passed, or the
    signal has aborted.
- [ ] **Step 4: Run the tests until they pass.**
- [ ] **Step 5: Commit:** `endpoint: bounded readiness probe`.

### Task 6: Rebase checkpoint (no code)

- [ ] **Step 1:** Run `gh pr view 844 --repo m4ttstack/mattstack --json
  state -q .state`.
  - If it is not `MERGED`, the controller DMs the shepherd (`chat_dm` to
    `shepherd.y7rs`) and waits.
  - Tasks 7 to 9 need #844's `refuseGithubTarget` and `githubRefusal` in
    `lib/mcp/mr-composite-tools.ts`, and its `tools.ts`.
- [ ] **Step 2:** Run `git fetch origin && git rebase origin/main`.
  Resolve only conflicts inside this plan's own files.
- [ ] **Step 3:** Re-run the Task 1 to 5 test files. All pass.

### Task 7: `evidence_record` and `evidence_attach` (`lib/mcp/evidence-tools.ts`)

**Files:**
- Create: `lib/mcp/evidence-tools.ts`
- Test: `lib/mcp/__tests__/evidence-tools.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4; `checkRegisteredTree` and `TreeGuardDeps` from
  `tree-guard.ts`; `resolveRepoTarget` and `resolveMrTarget` from
  `mr-target.ts`; `refuseGithubTarget` and `githubRefusal` from
  `mr-composite-tools.ts`, used as detectors (non-null means GitHub);
  `isTimeoutError`, `ok`, `err`, `McpToolDef`, `MR_TARGET_PROPS` and
  `REPO_TARGET_PROPS` from `shared.ts`; `getSetting` for
  `rt.mcp.uploadRoots`.
- Produces:
  ```ts
  export interface EvidenceToolDeps {
    command: typeof rtCommand;
    runTool: (name: "run_snapshot" | "run_field_get" | "run_field_set", input: Record<string, unknown>, env: NodeJS.ProcessEnv) => Promise<ToolResult>;
    guard: TreeGuardDeps;
    resolveRepo: typeof resolveRepoTarget;
    home: () => string;
    uid: () => number | null;
    uploadRoots: () => string[];
    repoRoots: (identity: string) => string[];
    fetch: typeof fetch;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
  }
  export const realEvidenceToolDeps: EvidenceToolDeps;
  export type UploadOne = { path: string; ok: true; url: string; markdown: string } | { path: string; ok: false; error: string; timedOut: boolean };
  export async function uploadEach(deps: EvidenceToolDeps, o: { identity: string; paths: string[]; runId?: string; retryTimeoutOnce: boolean; signal?: AbortSignal; progress?: () => void }): Promise<UploadOne[]>;
  export function evidenceToolDefs(deps?: EvidenceToolDeps): McpToolDef[];
  export const MR_UPLOAD_TIMEOUT_MS = 120_000;
  ```
  - `uploadEach` sends `mr:upload` with a timeout of `MR_UPLOAD_TIMEOUT_MS`.
  - Both tool defs' descriptions say they are called only after the attach
    gate's proceed (`evidence_attach`), or that they write the run's
    `evidence` field (`evidence_record`).

- [ ] **Step 1: Write the failing tests** with fake deps. `command` records
  calls and returns scripted results, and `runTool` is backed by an
  in-memory field map.
  - **evidence_record:** missing `stage` → error.
  - **evidence_record:** a temp-root image with `annotated` + `caption` →
    the bundle is copied to `<home>/.mattstack/work/<id>/evidence/<case>/`,
    the written value's paths are the copied ones, and the result is
    `{written:true, encoding:"evidence@2", copied:[...]}`.
  - **evidence_record:** an uncovered image → `written:false`,
    `uncovered[0].why === "no-cover"`, `copied` non-empty, and
    `run_field_set` is never called.
  - **evidence_record:** a source outside the roots → error naming the
    file; nothing copied and nothing written.
  - **evidence_record:** a `fieldSet` refusal surfaces verbatim. Script
    `run_field_set` to fail with `evidence@2: case "a" ...`.
  - **evidence_record:** one test runs against a real temp run db. Use
    `runStart` from `lib/runs/start.ts` under a temp HOME, then call
    through `realEvidenceToolDeps.runTool`, so the run tools' seams are
    pinned.
  - **evidence_attach:** a record with a pair board shared by before and
    after → exactly one `mr:upload` for it, carrying `runId`.
  - **evidence_attach:** a timeout then success → two calls, and the file
    is uploaded. Two timeouts → it lands in `timedOutTwice`, the next file
    still uploads, and `notWritten:"refused"` with no `mr:update`.
  - **evidence_attach:** a raw-capture refusal → `refused["raw-capture"]`,
    and no `mr:update`.
  - **evidence_attach:** with `linkRefused:true`, a refused file prints its
    local path, the description is written, and `evidence-uploads` gains
    `{linked:true}` for it.
  - **evidence_attach, reuse:** an `evidence-uploads` entry with matching
    sha256 and project → no `mr:upload`, `reused:true`. Change the file's
    bytes → it re-uploads. Add `<stem>.redactions.json` beside it → it
    re-uploads.
  - **evidence_attach, description:** `mr:get` returns a description with
    the heading. `mr:update` receives the spliced text. A second call with
    everything reused sends no `mr:update` (`notWritten:"unchanged"`).
  - **evidence_attach:** no MR anywhere and no `repoName` → error. With
    `repoName` only, it uploads and returns `section` without
    `mr:get`/`mr:update` (`notWritten:"no-mr"`), and splices
    `description` when given.
  - **evidence_attach:** a `github.com` mrUrl → no `mr:upload`, local
    paths in `section`, `forge:"github"`, and the result text names
    `gh pr edit`.
  - **evidence_attach:** a `plan:text` record → no uploads; `section` is
    `Transcript: /t.txt`.
  - **evidence_attach:** an `mr:update` failure → `writeErrors` non-empty,
    and `uploaded` is still listed.
  - **`uploadEach` with `retryTimeoutOnce:false`** → one call per path,
    and a timed-out item has `timedOut:true`.
- [ ] **Step 2: Run them to see them fail.**
  `bun test lib/mcp/__tests__/evidence-tools.test.ts`.
- [ ] **Step 3: Implement both tools and `uploadEach`.**
  - `evidence_record`'s optional `tree` passes `checkRegisteredTree`; its
    identity's `deps.repoRoots(identity)` (checkout plus registered
    worktrees) joins the allowed sources.
  - The run id is `basename(dirname(realpath(runDb)))`. The run tools
    already confine `runDb`.
  - `evidence_attach` reads the record with `readEvidence` from the
    snapshot's `evidence` field.
  - The upload set is the distinct paths of `uploadablePaths(record)`, in
    order.
  - The project used for reuse is the target identity.
  - `evidence-uploads` is written once, after the uploads, under `stage`.
  - Result shapes are exactly the spec's.
- [ ] **Step 4: Run the tests until they pass.**
- [ ] **Step 5: Commit:** `mcp: evidence_record and evidence_attach`.

### Task 8: `dev_endpoints`

**Files:**
- Modify: `lib/mcp/evidence-tools.ts` (add the def to `evidenceToolDefs`)
- Test: `lib/mcp/__tests__/evidence-tools.test.ts` (new `describe`)

**Interfaces:**
- Consumes: `waitForAnswers` (Task 5), `checkRegisteredTree`, and
  `deps.command("endpoint:lookup", {repo, worktree, role})`.

- [ ] **Step 1: Write the failing tests:**
  - An unregistered `tree` → the `checkRegisteredTree` error, verbatim.
  - `roles: []` → error; nine roles → error; `waitSeconds: 301` → error.
  - Two claimed roles: `web` answers with 302, and `api` is refused
    forever, with `waitSeconds: 4` → `roles.web.answered === true`,
    `roles.web.status === 302`, `waiting` equal to `["api"]`, and
    `waitedMs >= 4000`.
  - An unclaimed role → `claimed:false`. It is never probed and not in
    `waiting`.
  - A lookup error for an undeclared role → `roles.x.error` is set, and
    the call still succeeds.
  - Without `waitSeconds`, the deadline used is 90000 ms. Assert it
    through the fake clock.
  - The probe URL is the lookup's `url` + `probePath`, defaulting to `/`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Look up roles in parallel, probe only the
  claimed roles, and pass `signal` and `progress` through.
- [ ] **Step 4: Run the tests until they pass.**
- [ ] **Step 5: Commit:** `mcp: dev_endpoints`.

### Task 9: Batch `mr_upload`, registration, roster and reference

**Files:**
- Modify: `lib/mcp/tools.ts`, in two places:
  - the `mr_upload` def: add `paths` to its schema and description, and
    call `uploadEach`;
  - one line, `...evidenceToolDefs(),`, after `...ciToolDefs(),`.

  Use `MR_UPLOAD_TIMEOUT_MS` from `evidence-tools.ts`, and drop the local
  copy in `tools.ts` only when nothing else in `tools.ts` uses it.
- Modify: `lib/mcp/__tests__/tools.test.ts` (`NAMES`, plus the batch
  tests), and `EXPECTED_TOOL_NAMES` in `e2e/tests/mcp-serve.test.ts`.
- Regenerate: `plugins/mattstack/attachments/mcp-tools/reference.md`.
- Modify: the `version` in `plugins/mattstack/.claude-plugin/plugin.json`,
  set to the next patch above `origin/main`'s at commit time.

- [ ] **Step 1: Write the failing tests** in `tools.test.ts`:
  - Add `"evidence_record","evidence_attach","dev_endpoints"` to `NAMES`.
  - `mr_upload` with both `path` and `paths` → error.
  - `paths: []` → error; 21 paths → error.
  - `paths` with a relative entry → error naming it.
  - Neither `path` nor `paths` → the error `pass "path" or "paths"`. A
    single `path` call behaves as today.
  - A `github.com` repoName with `paths` → the `refuseGithubTarget`
    refusal.
- [ ] **Step 2: Run them to see them fail.**
  `bun test lib/mcp/__tests__/tools.test.ts`.
- [ ] **Step 3: Implement.**
  - With `paths`, the handler returns `ok({results})`. Each item is
    `{path, ok:true, url, markdown}` or `{path, ok:false, error}`, where a
    timed-out error carries today's "may have landed anyway, and an unused
    upload is harmless, so retrying is safe" hint.
  - `required` becomes empty, and the handler refuses when neither `path`
    nor `paths` is given (`pass "path" or "paths"`).
- [ ] **Step 4: Run the tests until they pass.**
- [ ] **Step 5: Regenerate the reference:**
  `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`.
  Bump `plugin.json`'s patch version.
- [ ] **Step 6: Run the brief's verification, all green:**
  - `bun test lib/evidence/__tests__ lib/endpoint/__tests__/readiness.test.ts lib/mcp/__tests__/evidence-tools.test.ts lib/mcp/__tests__/tools.test.ts lib/mcp/__tests__/no-unredacted-mcp-output.test.ts`;
  - `bun test --preload ./e2e/setup.ts e2e/tests/mcp-serve.test.ts`;
  - `bun run check`;
  - `bun run purity`.
- [ ] **Step 7: Commit:** `mcp: batch mr_upload; register evidence tools; reference and plugin version`.
