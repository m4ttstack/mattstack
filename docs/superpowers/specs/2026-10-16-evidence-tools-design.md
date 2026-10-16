# Evidence MCP tools

Wave 2 of the digraph-to-MCP herd, evidence lane. Code and tests only: no
skill edits, which come in wave 3.

## Why

The evidence record page (about 1.7K words) is inlined into six compiled
verbs. The per-file upload loop is drawn separately in stage-evidence,
stage-ship and ship. That loop holds a corrected-path retry, a timeout
retry, a record-fix retry, `mr_view`, then a hand-spliced `mr_update`.
Agents drift there in observed ways:
- they upload the raw base instead of the annotated copy;
- they drop `runId`;
- they write a second evidence section instead of replacing the first;
- they upload before the record is written;
- they write invented v1/v2 hybrid records;
- they pass `value` as an object instead of a string.

This lane moves those mechanics into rt's MCP server. The tools return
results, and the skills keep every gate. Recon is `00-SYNTHESIS.md` and
`05-evidence.md` (candidates C1, C2, C3) in the herd's recon folder.

## Herd ruling: no behavior change

Matt's ruling governs every lane. Move today's logic into tools, and keep
what agents and humans see and get exactly as today. Every place this
design departs from today's behavior is listed under
[Behavior changes](#behavior-changes), with its approval status.

## Goals

- `evidence_record`: one write path for the `evidence` run field. It
  merges, validates and writes, and returns which images still need marks
  or a waiver.
- `evidence_attach`: uploads every file the record allows (with `runId`),
  renders the MR evidence section from the record, and replaces that
  section in place in the description. It returns refused files bucketed by
  reason.
- `mr_upload {paths}`: a batch form of the existing tool.
- `dev_endpoints`: looks up a worktree's dev-server ports and waits, within
  a bound, until they answer.

## Non-goals

- No skill text changes, and no plugin skill edits (wave 3).
- No change to the evidence@2 schema, to `validateEvidence`'s rules, to
  the upload guard (`lib/daemon/upload-guard.ts`), or to the record check
  (`lib/daemon/evidence-record-check.ts`).
- No browser driving. Captures come from Fast Browser; these tools only
  file and upload them.
- No gate opens, and no answer is picked. The `evidence`,
  `evidence-attach` and `evidence-waiver` gates, and the upload off-script
  gate, stay in the skills.
- No text-evidence slot in the record. Ingestion's `<details>` text blocks
  ride `evidence_attach`'s `appendix` input (below) and stay domain-owned.

## Anti-goals

- A tool that copies a refused file somewhere the guard accepts, or retries
  without `runId`. A refusal always comes back as data.
- A description that carries a mattstack marker string. The description is
  employer-visible, so the section is found by its heading, never by a
  hidden marker.
- An upload or description write that skips the skill's attach gate. The
  tool descriptions say each is called only after that gate's proceed.

## Constraints

- **Write fence:**
  - new `lib/mcp/evidence-tools.ts`;
  - new `lib/evidence/**`;
  - the record helpers in `packages/rt-client/src/evidence.ts` and
    `lib/daemon/evidence-record-check.ts` (no edits expected);
  - the `mr_upload` handler in `lib/mcp/tools.ts` (batch only);
  - one contiguous registration block in `lib/mcp/tools.ts`;
  - new files under `lib/endpoint/`;
  - the generated `reference.md` and the `plugin.json` patch version;
  - `EXPECTED_TOOL_NAMES` in `e2e/tests/mcp-serve.test.ts`;
  - the `__tests__` beside all of these;
  - this spec and its plan.
- **Ordering:** mr-composites (#844) changes `lib/mcp/tools.ts` and adds
  `githubRefusal`/`refuseGithubTarget` in `lib/mcp/mr-composite-tools.ts`.
  This lane rebases onto main after #844 merges and before it touches
  `tools.ts`, then reuses those helpers for its GitHub refusals.
- **Composed evidence (#822, unmerged, targets v2.25.0):** confirmed with
  its worker (m4-premerge) on branch `composed-evidence-m4` at `b402be333`:
  - evidence@2's shape is unchanged.
  - `annotated` is now a composed board, and one board may be the
    `annotated` of several images (a pair board covers before and after).
  - Bundles (`<stem>.*`: board, spec, captures, and for a gated board
    `<stem>.redactions.json` plus `<stem>.redact-*.png`) sit **flat** in the
    run's evidence folder. A pair spec names the before bundle's captures by
    bare file name.
  - `mr:upload` gains a redaction gate. It refuses a gated board whose
    record is missing, unconfirmed or stale, and it refuses an imported
    original.
  - Uploads dedupe: each distinct file uploads once.
  - In the section, a shared board prints once, at its first slot, labelled
    with every slot it covers.

  Everything below works on main today and stays correct once #822 lands.
- Every upload goes through the daemon's `mr:upload`, so the path guard,
  #822's redaction gate and the `runId` record check run on every file
  sent. No tool reads or sends file bytes to a forge itself.
- The one exception is B2's reuse, which sends nothing. It is limited so
  that it never skips a check that could now refuse:
  - the file is in the record's upload set, which is what the record check
    tests;
  - its bytes match the upload by sha256;
  - it has no `<stem>.redactions.json` beside it, so a gated board always
    goes back through the daemon.
- Run reads and writes go through `runToolDefs`' handlers (`run_snapshot`,
  `run_field_get`, `run_field_set`), which reuse their `runDb`
  confinement. The `evidence` write therefore still passes `fieldSet`'s
  `validateEvidence`. `run_field_set` on a done run is allowed; #822's
  revise-after-ship path relies on that.
- Every result passes through `callTool`'s redaction.
- Fixtures and tests use generic names (`web`, `api`, `acme`). Never
  employer names: `bun run purity` runs before every push.

## `evidence_record {runDb, stage, ...}`

One merge, validate and write of the `evidence` field.

**Input:**
```
{runDb, stage,
 images?: [{case, label?, slot: "before"|"after", theme?: "light"|"dark",
            path?, annotated?, caption?, waiver?}],
 cases?: [{id, label?, waiver?}],
 remove?: [{case, slot?, theme?}],
 transcript?, url?, plan?: "none", tree?}
```
- `tree` is the run's worktree root, checked with `checkRegisteredTree`.
  It names the repo whose checkout and worktrees count as allowed copy
  sources. Without it, only the repo-independent sources count. The run's
  `repo` column is a folder name, not an identity, so it cannot name the
  repo by itself; the tree must still belong to the run's repo (its
  identity's slug matches that folder name), or the call is refused before
  any copy, so a run cannot launder another repo's files into its folder.
- `case` is the case id (`^[a-z0-9][a-z0-9-]{0,63}$`). `label` names a new
  case. It can also come from `cases[]`, and it is required when the case
  is new.
- `images` entries address one image by `(case, slot, theme)`. `theme` is
  given only when the slot is a `{light, dark}` pair.
- `plan: "none"` writes `{"plan": "none"}`. It is refused alongside images,
  `transcript` or `url`.

**Reads.** `evidence` via `run_field_get`. Unset reads as no record. The
current value is parsed by a raw reader in `lib/evidence/`, not by
`readEvidence`. `readEvidence` copies a case `waiver` onto each uncovered
image, which would lose the case-level waiver on write-back.

**Merge** (the evidence-record page's "Merge into the record" table, plus
#822's ship-board rule):

| Current value | Start from |
|---|---|
| evidence@2 | it, keeping every case and key |
| evidence@1 | one case `case`, label = its `case` text or `Evidence`; `annotated` only when set (never `null`); `transcript`, `url`, `attach` kept |
| unset, `-`, `{"plan":"none"}` | empty |
| other JSON with `url` or `transcript` | empty, keeping those as run-level keys |
| any other text | empty, carrying the text in `attach` |

Then, in order:
1. `remove` entries delete an image, a slot (no `theme`) or a case (no
   `slot`).
2. `cases` entries set a case's `label` and/or case `waiver`.
3. **Recaptures.** For each `(case, slot)`, the `images` entries whose
   `path` is new content for that address are a recapture. This is decided
   once, on the sources, before anything is copied: an entry is unchanged
   only when its source is the recorded file, or carries the recorded
   file's name, and the bytes match. (A changed bundle lands in a content
   folder, so comparing paths after the copy says nothing.) They
   set that slot to exactly those images: today's rule that "an AFTER for
   an existing case's id sets that case's after". When the case carries a
   case `waiver`, it first moves onto each of the case's existing images
   that have neither `annotated` nor their own `waiver`, and the case-level
   key is deleted, as the page says.
4. **Cover updates.** Entries with no `path`, or the same path, patch the
   addressed image. `annotated` and `caption` replace that image's pair and
   clear its `waiver`. `waiver` clears `annotated` and `caption`. #822's
   ship pair board is this case: it replaces `annotated` and `caption`, and
   every other key stays. An entry that carries both `annotated` and
   `waiver` is refused. A cover update for an image that does not exist is
   refused, naming the address.
5. `transcript` and `url` set run-level keys. `attach` is only ever carried
   over.

**Copy into the run's folder.** This is Matt's ruling on the open policy
question (gate `8f4b7290` q1, reaffirmed in shepherd DM #5811 over the
narrower reading in #5808). Every team files into one run folder, which
ends ingestion's `upload_root` question.
- Each image's `path` and `annotated` named in the call is copied to
  `~/.mattstack/work/<run id>/evidence/<case>/` (or a content folder under
  it, below), unless it is already there, and the record stores the
  copied path.
- A `transcript` is copied to `~/.mattstack/work/<run id>/evidence/`.
- `<run id>` is the path segment before `/state.db` in `runDb`. Folders
  are created as needed, and that run folder is the only place the tool
  writes.
- Copying is always on. There is no opt-out flag, since the run folder is
  the one evidence root.
- Per-case folders fit #822. A pair board covers its own case's before and
  after, so a pair spec's bare-name reference to the before bundle resolves
  inside the same case folder, or inside the content folder its bundle
  landed in. A board's redaction record and crops copy
  beside it as part of its bundle.
- Only bundle file types are copied: the upload extensions plus `json`,
  `txt` and `log`. Never a dotfile.
- **Allowed sources.** A source is allowed only when its realpath is a
  regular file with one link, and sits inside one of these:
  - a root `mr_upload` would admit for the run's repo: the checkout, its
    registered worktrees, the Claude Code temp roots, `~/.mattstack/evidence`
    (a real directory the user owns), `rt.mcp.uploadRoots`, or a run's
    evidence folder;
  - Fast Browser's screenshot folder, `~/.fast-browser/screenshots`.

  Anything else is refused before anything is copied, naming the file and
  the roots.
- **Destinations.** A copy lands only under `~/.mattstack/work`. A symlink
  above that folder is followed, the way the upload guard resolves it. A
  symlink at or below the run folder, whether the run folder, `evidence`,
  a case folder or the destination file itself, is refused before anything
  is copied, so a copy never leaves the run.
- **Bundles.** An image copies as its whole bundle.
  - **The stem.** For a capture named `<stem>.c<n>.<ext>`, the stem is that
    `<stem>`. For any other image, it is the file name minus its extension.
  - **The bundle** is the image itself plus these regular files beside it
    in the source folder, when they exist:
    - `<stem>.<image ext>` (the board);
    - `<stem>.c<n>.<image ext>` and `<stem>.c<n>.capture.json`;
    - `<stem>.spec.json`;
    - `<stem>.redactions.json` and `<stem>.redact-*.png`.
  - Nothing else is swept up. A capture inside a checkout therefore never
    drags its neighbours along, and an empty stem or a dotfile copies
    nothing.
  - That keeps the board, spec, captures, redaction record and crops
    together, as #822's guard and pair specs need.
  - A transcript copies alone.
- **Never overwrite** (Matt's ruling after review round 2). No file
  already in the run folder is ever rewritten; copies use `COPYFILE_EXCL`.
  - A bundle whose every file is absent from the case folder, or already
    there with the same bytes, lands in the case folder. Identical files
    are left as they are.
  - A bundle that would change any existing file lands whole in a content
    folder, `<case>/<12 hex>/`: the first 12 hex digits of a sha256 over
    the bundle's file names and bytes. File names stay as they are, since
    #822's guard pairs a board with its redaction record and crops by
    name. The same bundle sent again lands in the same folder, and a
    source already inside the case folder or one of its content folders is
    not copied.
  - The record then points at the new copy, so an old capture stays intact
    and paired with its cover until the record is rewritten. A recapture
    that leaves the record unwritten (uncovered) changes nothing the record
    names. Calling again after `fast-browser compose --confirm` or a
    re-render lands the new redaction record and crops beside their board
    in its content folder (m4-premerge's ordering trap).
  - A transcript follows the same rule in `evidence/`.
- Copying happens before validation, and returns `copied: [{from, to}]`
  even when nothing is written. The next call can then name the copied
  paths.

**Write.**
- **Coverage first.** An image with neither `annotated` (plus `caption`)
  nor a waiver (its own, or its case's) is uncovered. When any image is
  uncovered, nothing is written. The result lists `uncovered`, and the call
  still succeeds as data, so the skill routes to "Annotate or waive". The
  agent then calls again with the same images carrying their cover.
- Otherwise the serialized value is written as a string via `run_field_set
  {key: "evidence", value, stage}`. `fieldSet` runs `validateEvidence`, and
  any other refusal comes back as the error verbatim.
- **Encodings with no cases:**
  - `transcript` (plus `url`) becomes `{"plan":"text","transcript":...}`;
  - `url` alone becomes `{"plan":"ticket","url":...}`;
  - `plan: "none"` becomes `{"plan":"none"}`;
  - nothing at all is refused.

**Returns:**
```
{written, encoding: "evidence@2"|"plan:text"|"plan:ticket"|"plan:none",
 value (the JSON written, or that would have been),
 uncovered: [{case, slot, theme?, path, why: "no-cover"|"no-caption"}],
 copied: [{from, to}]}
```

## `evidence_attach {runDb, stage, heading, ...}`

Uploads what the record allows, renders the section, and puts it in the
description. The skill calls it only after the attach gate's proceed.

**Input:**
```
{runDb, stage, heading, before?, appendix?,
 mrUrl? | repoName? + iid?, description?, linkRefused?: boolean}
```
- `heading` is the section's full heading line (`## Verification
  Evidence`). The domain decides it, so it is required, with no default.
- `before` is a heading line the section is inserted above when `heading`
  is not in the description. Without it, the section is appended at the
  end.
- `appendix` is domain markdown, such as ingestion's `<details>` text
  blocks. It is printed inside the section after the generated content, so
  it is replaced along with the section, never duplicated.
- The target is `mrUrl` (or `repoName` plus `iid`), else the run's `mr`
  field. The repo is that target's, else the run's `repo` column. An `iid`
  passed with neither `mrUrl` nor `repoName` must match the `mr` field's
  iid (a GitHub field's PR number); a mismatch is refused before any
  upload.

**Steps:**
1. **Read.** `run_snapshot` gives `evidence`, `evidence-uploads` and
   `mr`.
   - The record is read with `readEvidence`, so v1 and v2 records both
     upload, as ship does today.
   - A `plan:text`/`plan:ticket` value uploads nothing; its section
     carries only `Transcript:`/`Ticket:` lines.
   - With no record, or `plan:none`, the section is empty and the
     description is untouched.
   - The repo is the target's: `mrUrl`, else `repoName`, else the run's
     `mr` field. With none of these the call is refused; a handback before
     an MR exists passes `repoName`, such as the tree path.
2. **GitHub** (a github.com identity or PR URL; #844's helpers):
   - uploads nothing;
   - every entry carries its local path;
   - returns `section`, plus `description` spliced from the `description`
     input when one is given;
   - never writes;
   - the result names the move: `gh pr view <n> --json body`, then
     `gh pr edit <n> --body-file`. That matches today's GitHub branch.
3. **Upload set.**
   - Each distinct `annotated` path, and each waived image's `path`, once,
     in record order. Never a base whose image is annotated, never a
     sidecar, never a transcript.
   - A file is reused, not re-uploaded, when all of these hold:
     - its `evidence-uploads` entry matches its realpath, its current
       sha256 and the target project;
     - it has no `<stem>.redactions.json` beside it (see Constraints).

     A revised board at the same path has new bytes, so it re-uploads.
4. **Upload.** `mr:upload {repoName, path, runId}` per file, sequentially.
   A timeout (`isTimeoutError`) retries once, as the skills do today; a
   second timeout lands in `timedOutTwice`. Any other error is a refusal,
   classified into exactly one bucket by its text:

   | Bucket | Guard text it matches |
   |---|---|
   | `record` | not in the run's evidence record; run has no evidence record; run not found |
   | `raw-capture` | is the raw capture for case ... |
   | `import` (#822) | `is the unredacted original of an imported ticket image` |
   | `redaction` (#822) | `has no redaction record beside it`, `redaction record is malformed`, `changed since its redactions were recorded`, `redaction crop`, `has a redaction not yet confirmed` |
   | `roots` | `outside the allowed upload roots` |
   | `missing` | `file not found`, `path must be absolute` |
   | `size` | `the upload cap is` |
   | `bytes` | `extension must be one of`, `file bytes do not match`, `not a regular file`, `other hard links`, `cannot open file`, `cannot stat open file`, `changed identity`, `read short`, `grew during read` |
   | `other` | anything else, verbatim: GitLab status, token, network, `repo-unknown` |

   Rows match top to bottom, so `record`'s `run ... not found` wins over
   `missing`'s `file not found`, and `redaction` wins over `bytes`.
   - Main's guard strings are pinned in tests against messages produced by
     calling the real guard functions.
   - #822's strings are pinned as literals copied from
     `composed-evidence-m4` at `b402be333`
     (`lib/daemon/redaction-record-check.ts:66-90`) until it merges.
5. **Remember.** New uploads merge into the `evidence-uploads` run field
   (below) via `run_field_set` under `stage`.
   - Under `linkRefused: true`, each refused or twice-timed-out file is
     also recorded there as `{linked: true}`, so a resumed run sees the
     Take.
   - A later call without `linkRefused` sends a `{linked: true}` file
     again, so a cause the human fixed (a new upload root) clears it: an
     upload replaces the entry. Refused again, it stays linked: it prints
     its local path, is listed in `linked: [{path, error}]` rather than
     `refused`, and does not block the description write. Timed out twice,
     it lands in `timedOutTwice` like any other file.
   - Today's `run_field_set {key: evidence, value: <the record plus
     attach>}` after the description write is not repeated (B5). The record
     stays what was verified, and `evidence-uploads` holds where it went.
   - A failed write comes back in `writeErrors` and does not undo the
     uploads.
6. **Render** the section body from the record (format below). An
   uploaded or reused file prints its upload markdown. A refused or
   twice-timed-out file prints its local path only when `linkRefused: true`
   (the off-script gate's Take). Otherwise the description is not written
   (step 7).
7. **Description.**
   - Not written when there is no MR target, when a refused or
     twice-timed-out file exists without `linkRefused`, or on GitHub.
     `notWritten` says which.
   - Otherwise: `mr:get` gives the live description, the body is spliced
     by heading (below), and `mr:update {description}` writes it.
   - An unchanged description is not rewritten.
   - A write error comes back in `writeErrors`, with the uploads kept.
   - With no MR (handback), the result carries `section`, and `description`
     when one was passed in.

**Splice by heading.** This is pure, in `lib/evidence/`.
- Headings are ATX headings outside fenced code.
- The section runs from the line that equals `heading` (trailing
  whitespace ignored) to the next heading of the same or a higher level.
- Template helper lines directly under the heading are kept. Those are
  blank lines, one italic-only line (`_..._` or `*...*`), and HTML comment
  blocks. Everything after them is replaced by the rendered body.
- A heading absent from the description is inserted above `before` when
  given and found, else appended at the end.
- Splicing twice gives the same text (idempotent). Text outside the
  section is byte-identical.

**Section format.** This is the evidence-record page's format, in #822's
version, which reduces to today's when no board is shared.
- One block per case: `**<label>**`, then `Waived: <reason>` once when the
  case carries a case waiver.
- One entry per distinct file, at the first slot it covers. The entry is
  labelled with every slot it covers: the slots joined by "and", then the
  themes in parens (`- Before and after (light):`,
  `- After (light and dark):`).
- The entry text is the upload markdown, with its alt text set to the
  covered slots joined by "and", lowercase, with no theme (`![after]`,
  `![before and after]`), as the page's examples print. Where nothing
  uploaded, it is the bare local path.
- A caption prints once as `  Caption: <caption>`, and an image waiver as
  `  Waived: <reason>`.
- After the cases come `Transcript: <path>`, then `Ticket: <url>`, then the
  lines of `attach` whose links no case file covers, then `appendix`.
- A link counts as covered when it is:
  - a case image's `path` or `annotated`;
  - or an upload URL that `evidence-uploads` maps to one of those files.

**Returns:**
```
{forge: "gitlab"|"github", mr: url|null,
 uploaded: [{path, url, markdown, reused}],
 refused: {record|raw-capture|import|redaction|roots|missing|size|bytes|other: [{path, error}]},
 timedOutTwice: [path], linked: [{path, error}], section, description?,
 descriptionWritten,
 notWritten?: "no-mr"|"refused"|"github"|"unchanged",
 writeErrors?: [string]}
```
A refusal of the call itself is an error, and nothing outward has happened
at that point. Causes: no `runDb`, no `heading`, an unresolvable target, or
GitHub with uploads requested through a GitLab target.

## The `evidence-uploads` run field

This is Matt's ruling (gate `8f4b7290`, q2): a separate field, with no
evidence@2 change. Its value is JSON:
```
{"v": 1, "uploads": {"<realpath>": {"sha256", "project": "<repo identity>", "url", "markdown", "at"}
                     | {"linked": true, "at"}}}
```
- Only `evidence_attach` reads and writes it.
- An unreadable value counts as empty and is overwritten on the next
  write.
- `validateEvidence` and the console never see it. Its key differs from
  `evidence`, so `fieldSet`'s check does not apply.

## `mr_upload {paths}`

- `paths` (1 to 20 absolute paths) is accepted instead of `path`; passing
  both is refused. `runId` and the target props apply to every file.
- Files go one `mr:upload` at a time, in order. A failure does not stop the
  rest.
- Returns `{results: [{path, ok: true, url, markdown} | {path, ok: false,
  error}]}`. A timed-out item carries today's "may have landed; retrying is
  safe" hint.
- No retries. Single `path` behavior is unchanged.
- On GitHub it refuses up front with #844's helper, which names no `gh`
  move because GitHub has no upload API. The skill links local paths, as
  today.

## `dev_endpoints {tree, roles, waitSeconds?, probePath?}`

The capture graph's two `rt endpoint lookup` calls plus dev-servers' curl
probe, in one bounded call.
- `tree` must pass `checkRegisteredTree`, which gives the repo identity
  and the tree root.
- `roles` holds 1 to 8 role names.
- For each role, the daemon's `endpoint:lookup {repo, worktree: <root>,
  role}` returns `{claimed, port, url, running, listener}`. A lookup error
  (an undeclared role) is reported on that role and does not fail the call.
- **Probe.** For every claimed role: HTTP GET `http://localhost:<port>` +
  `probePath` (default `/`), with a 5-second request timeout and no
  redirect follow.
  - Any HTTP response counts as answered. That is today's `curl -s -o
    /dev/null` success, so a 404 counts, and so does a 302 from a login
    page.
  - A connection refused or a timeout does not count.
  - Probes repeat every 2 seconds until every claimed role answers or
    `waitSeconds` passes. The default is 90, today's `--retry-max-time 90`;
    the maximum is 300; 0 means probe once.
  - It sends a progress ping each round when the caller asked for one, and
    honors abort.
- Unclaimed roles are reported, never waited on.
- `running` is reported but never trusted as "up". The dev-servers page's
  trap is that it can read true in the boot window, so the probe is the
  signal.
- Returns:
  ```
  {tree, waitedMs,
   roles: {<role>: {claimed, port, url, running, listener, answered,
                    status, answeredAfterMs, error?}},
   waiting: [roles claimed but not answered]}
  ```
- The probe lives in `lib/endpoint/readiness.ts`, with injectable `fetch`,
  `sleep` and clock. The tool def lives in `evidence-tools.ts`.

## Module layout (builder's call within this)

| File | Holds |
|---|---|
| `lib/evidence/record-merge.ts` | raw parse, merge, coverage, serialize, encodings |
| `lib/evidence/bundle.ts` | source-root check, bundle copy |
| `lib/evidence/section.ts` | render and splice |
| `lib/evidence/uploads-field.ts` | `evidence-uploads` parse, merge, sha256 |
| `lib/evidence/refusal-buckets.ts` | upload error to bucket |
| `lib/endpoint/readiness.ts` | the bounded probe |
| `lib/mcp/evidence-tools.ts` | tool defs and a deps seam (`command`, run tools, fs, clock, fetch) |

`mr_upload`'s batch loop lives in `evidence-tools.ts` as `uploadEach()`.
The handler in `tools.ts` calls it, and `evidence_attach` reuses it with
its retry.

## Behavior changes

| # | Change | Status |
|---|---|---|
| B1 | `evidence_record` copies captures (whole bundles) into one run folder, `~/.mattstack/work/<run id>/evidence/<case>/`, for every team, instead of each domain's folder. That ends ingestion's `upload_root` question once wave 3 adopts it. | Approved by Matt (gate `8f4b7290` q1; shepherd DM #5811). |
| B2 | A resumed attach reuses an earlier upload, by sha256 and project, instead of re-uploading. | Approved by Matt (gate `8f4b7290` q2). |
| B3 | Shared boards print once and upload once (#822's rules) rather than main's one entry per image. | Flagged improvement: follows #822, which lands in the same release, and is identical to today when no board is shared. |
| B5 | `evidence_attach` no longer rewrites `evidence` with "the record plus attach" after the description write. Upload markdown and the Take's linked paths live in `evidence-uploads` instead, so `attach` stays legacy-only and the dedupe stays exact. | Flagged improvement (builder check). |
| B6 | A twice-timed-out file is reported per file while the rest still upload. Today one STOP ends the loop at the first such file. | Flagged improvement: the off-script gate still sees every refused file at once. |
| B7 | A carried-over `attach` line that would read as a heading (`#` to `######`) or open a fence (three or more backticks or tildes), up to three spaces in, prints with a backslash before that marker. Today's skill pastes the line as is. | Flagged change: an unescaped heading or fence would move the section's end on the next splice, so a re-attach could swallow the text after it; the escaped line reads the same in the rendered description. |
| B8 | A copy never rewrites a file in the run folder. A bundle that would change one lands in a content folder, `<case>/<12 hex>/`, and the record points there. A shared pair board refreshed through one slot therefore moves only that slot's `annotated`; the other slot keeps the board it was captioned against until it is resent. | Matt's ruling after review round 2; the content-folder form and the pair-board consequence approved by the shepherd (DM #5962). |
| B4 | `mr_upload {paths}` and the three new tools are additive. A single-path `mr_upload` call behaves as today, missing-path error included (`"path" is required`). The one schema change: `path` is no longer in `required`, since a `{paths}` call carries none and the Claude API refuses a top-level `anyOf`; the handler refuses a call with neither. | Flagged change (schema only), approved by the shepherd (gate `92dc5722`). |

Everything else mirrors today's skill text:
- the merge table;
- coverage and validation;
- the upload set and its exclusions;
- one timeout retry;
- no description write while a file is refused, until the off-script
  gate's Take;
- replacing the section, never appending a second one;
- local paths on GitHub;
- any HTTP answer counting as up, with a 90-second wait.

## My calls (flagged for review)

- `heading` is required, with no default. A default would be a new
  behavior.
- A cover update for a missing image, and an entry with both `annotated`
  and `waiver`, are refused rather than guessed.
- A recapture replaces the whole slot. Today's rule is per call, so the
  skill sends both themes in one call.
- The renderer prints a local path bare, with no backticks.
- `evidence_attach` never copies. A refused file is only ever moved by the
  human.
- GitHub detection reuses #844's `refuseGithubTarget`/`githubRefusal` as
  detectors (a non-null return means GitHub). `evidence_attach` turns that
  into its GitHub branch rather than refusing.
- `dev_endpoints` lives beside the evidence tools rather than in a new
  file, since capture is its first caller.
