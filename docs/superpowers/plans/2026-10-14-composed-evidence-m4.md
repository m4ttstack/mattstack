# Composed evidence M4: pipeline wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mattstack ships browser evidence as one reusable capability: when a pack's evidence fill picks a browser screenshot for a case, the pipeline writes a brief, delegates a composed board to the Fast Browser driver, reads it back, gates its redactions, keeps its bundle, records, uploads and revises it. A pack supplies only four blocks of facts about its app.

**Architecture:** Three layers, each owning only its part (spec, Milestone 4, "Who owns what"). Fast Browser captures and composes; mattstack never teaches drawing. mattstack's part is one new shared include, `browser-evidence`, inlined by `stage-evidence`, `stage-ship` and standalone `ship` beside `evidence-record`, and reached only through a host's new `Browser screenshot for this case?` diamond. A pack's part is a `## Browser target` section in its existing `evidence-domain@1` fill (four blocks, no procedure); a `ship-domain@1` fill points at that section for afters. No new engine and no new contract. A pack with no browser evidence does not change. The daemon's `mr:upload` refuses an unconfirmed redaction and an imported original (done in Task 2).

**Tech Stack:** Markdown skills with graphviz digraphs (mattstack plugin, compiled by `rt skills compile`), Bun + TypeScript (daemon, compile tests), `bun test`, the installed Fast Browser 0.1.13 (`fast-browser compose`, `fast-browser doctor`, `browser_capture_evidence`, the `composing-evidence` skill, the `fast-browser:browser-driver` agent).

**Spec:** `docs/superpowers/specs/2026-10-10-composed-evidence-design.md` (§6 "The agent workflow", "The board bundle", §7, "Milestone 4" including "Who owns what", the browser target section, "Rollout order" and "Tests for this part"), building on `2026-10-10-evidence-v2-design.md` and `2026-10-10-evidence-skills-design.md`. Read-only from here on.

## Global Constraints

- Write only under this worktree. Team-pack edits are drafted outside the repo (`.superpowers/pack-edits/`, git-ignored) and applied to a pack only after this PR merges and the release ships, and only after Matt approves the exact diff through `herd_ask`.
- m4ttstack/mattstack is PUBLIC: no employer names, URLs, data, ticket ids or insurance-domain wording in code, skills, scenarios, fixtures, commit messages or PR text. **No team pack is named** in this plan, commits, scenarios, fixtures or the PR (spec rule); fixtures use the invented app `acme-queue` at `gitlab.example.com/acme/queue`.
- No mattstack ticket id, mattstack-internal reference, or this spec's path on any team-pack surface.
- Skill text: no em or en dashes, no personal names or home paths, no ticket ids. Follow `mattstack:process-digraphs` (plaintext tool nodes, diamond decisions, red-octagon STOPs, explicit counters, one `###` section per judgment box).
- Every skill edit goes through `superpowers:writing-skills` (RED before the edit, GREEN after) and `mattstack:editing-skills` (certify, version bump).
- mattstack never teaches drawing: no mattstack text names a mark primitive's geometry, an annotator, or `annotating-screenshots`; the driver follows `fast-browser:composing-evidence`.
- Never edit `plugins/mattstack/attachments/gate-protocol/` (it would force a board skills re-expand).
- Never edit `plugins/mattstack/CERTIFICATION.md`: its footer says lanes never edit it. The ledger rows go in the final report for the orchestrating session.
- No change in fast-browser. A need from the tool goes to the shepherd by `chat_dm`.
- Matt's ruling, verbatim in effect: compose and the composing skill keep `title`, `note` and `tag` optional; the pipeline's verification evidence always writes a tag and a description on every label, and the description asserts the outcome (what was added that was not there before, or which bug is fixed that previously was not working, and whether verification is complete). On a `steps` board the tag and description sit on each step (the panel's `tag` and `note`) and a mark inside a step may carry no text; on `single` and `pair` boards they sit on each mark.
- The brief says what each label carries and leaves where it goes to the driver's composing skill, so the same text works on Fast Browser 0.1.13 and on the release that adds the panel `tag` and `note`.
- The driver runs on Sonnet: the include spawns `fast-browser:browser-driver` with `model: "sonnet"` (its own default is Haiku).
- Run only targeted tests locally (repo rule); CI runs the full suite.
- Squash to one commit before any push. Never merge.
- Implementers: Sonnet for code and test-harness tasks (Tasks 1, 2, 3, 9, 11's runs); Opus for skill-text tasks (Tasks 4 to 8), which are judgment work. Model and effort named on every spawn. Opus for the final whole-branch review.

## Review Focus

1. **A revised board whose spec dropped its last redaction.** The old `<stem>.redactions.json` left in the evidence folder would make the upload refuse a board that needs no gate. Expected: the revise step removes the old crops and record before copying the new render. Pinned in Task 4's revise text and in Task 2's stale-record test.
2. **A pair board that is listed on two images.** Expected: one upload, one description entry naming both slots, and the raw-capture refusal still firing for each image's own `c1.png`. Pinned by Task 2's pair-board test and scenario S4.
3. **A pack with no browser evidence** (its fill captures by script, uploads images as shot). Expected: its compiled verbs differ from main only by the inlined `browser-evidence` text, which its run never reaches; no driver spawn, no brief. Pinned by Task 9's compile test and scenario S8.
4. **A fill that picks a browser screenshot but leaves a block out** (no Personal data block, say). Expected: the include's stated default for that block applies (hide every personal detail not being verified), never a skipped `hide`. Pinned by scenario S7's variant and the include's defaults table.
5. **The driver comes back needing a login.** Expected: the saved login is tried by the driver first; then one clarify question to the developer, at most twice per stage pass, then the case is not drawn with the reason quoted; never a typed credential. Pinned by scenario S7b.
6. **Revising a shipped run.** `run_field_set` on a `done` run must still write. Pinned by Task 2's done-run test.

---

## File map

| File | Change |
|---|---|
| `lib/daemon/redaction-record-check.ts`, its test, `lib/daemon/handlers/mr-upload.ts`, `mr-upload.test.ts`, `lib/runs/__tests__/write.test.ts`, `lib/mcp/tools.ts`, `attachments/mcp-tools/reference.md` | Done in Task 2 |
| `plugins/mattstack/docs/superpowers/tests/2026-10-14-composed-evidence/` | Tasks 1 and 3 (RED), 10 (GREEN), 11 (dry run) |
| `plugins/mattstack/attachments/browser-evidence/SKILL.md` | Create: the shared browser evidence text |
| `plugins/mattstack/attachments/evidence-record/SKILL.md` | Draw step points at the board; caption; merge rule; upload and description dedupe |
| `plugins/mattstack/attachments/pipeline/stage-evidence/SKILL.md` | Browser diamond, ticket image import, `plan: ticket` narrowed, the `## Browser target` contract note, `{{include:browser-evidence}}` |
| `plugins/mattstack/attachments/pipeline/stage-ship/SKILL.md` | Browser diamond for afters, pairs, `{{include:browser-evidence}}` |
| `plugins/mattstack/attachments/pipeline/ship/SKILL.md` | Same as stage-ship, plus revise a board on a shipped run |
| `plugins/mattstack/plugin/skills/extending-a-pack/slots.md`, new `plugins/mattstack/plugin/skills/extending-a-pack/browser-target.md`, `plugins/mattstack/docs/your-first-pack.md` | Pack-author docs for the browser target section |
| `lib/skills/__tests__/` (a new test file plus fixtures under `lib/skills/__tests__/fixtures/browser-target/`) | Compile tests: opted-in pack, pack with no browser evidence |
| `plugins/mattstack/.claude-plugin/plugin.json` | `version` 0.31.3 to 0.32.0 |
| `.superpowers/pack-edits/` (git-ignored, never committed) | Task 12: drafted team-pack diffs for approval |

---

### Task 1: RED baselines (done)

**Files:**
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-14-composed-evidence/scenarios/S1-live-before.md` .. `S6-revise-gated.md`
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-14-composed-evidence/red-green.md`

Harness: copy the method of `plugins/mattstack/docs/superpowers/tests/2026-10-10-evidence-skills/red-green.md` exactly (read it first): scratch copy of `plugins/mattstack` from `git archive HEAD plugins/mattstack` (HEAD = this branch before any skill edit), its `pack/stubs.jsonc` also rostering `stage-evidence`, `stage-ship`, `ship`; system file from `bun cli.ts skills compile --pack-dir <copy> --mattstack-dir <scratch> --verb <verb> --preview > <system-file>`; reps with `claude --model sonnet --tools "" --strict-mcp-config --append-system-prompt-file <system-file> -p "$(cat <scenario>)"`, a fresh empty directory per rep, 3 reps, in parallel. The scratch dirs live under `$TMPDIR`, never in the repo.

Every scenario uses project `gitlab.example.com/acme/queue`, run id `r-20261014-q7k`, runDb `/home/dev/.mattstack/runs/queue/r-20261014-q7k/state.db`, evidence folder `/home/dev/.mattstack/work/r-20261014-q7k/evidence/`, MR `https://gitlab.example.com/acme/queue/-/merge_requests/41`, and ends with the 2026-10-10 scenarios' closing paragraph ("Tools are unavailable in this test. Write every tool call you make, in order, with exact arguments (JSON), from now until the stage ends or its first gate, including a gate form if one opens. State a tool result you assume only if the scenario did not give it."). Agent spawns count as tool calls.

- [ ] **Step 1: Write the six scenarios**

S1 live before (`stage-evidence`): one case `retry-badge`, label "Retry badge on the job row"; the bug: the retry badge reads 0 after a retry. The domain captured the before at `http://localhost:5173/jobs/42` as a preview `/home/dev/.mattstack/work/r-20261014-q7k/evidence/retry-preview.png`; the MR is open; `evidence-attach` was answered `{"annotations":["retry-badge/before: the badge reads 0"],"attach":"now","next":"proceed"}`. The scenario gives the driver's return when the agent spawns one: `{"case":"retry-badge","board":"/home/dev/.fast-browser/screenshots/r-20261014-q7k-retry-badge-before.png","spec":"/home/dev/.fast-browser/screenshots/r-20261014-q7k-retry-badge-before.spec.json","captures":["/home/dev/.fast-browser/screenshots/r-20261014-q7k-retry-badge-before.c1.capture.json"],"warnings":[]}`.
Pass: a brief per the case with `state: FOUND`, every `point at` entry carrying a tag and a description that asserts the outcome; an `Agent` spawn with `subagent_type: "fast-browser:browser-driver"` and `model: "sonnet"`; the bundle copied into the evidence folder; the record's before `path` = the bundle's `c1.png`, `annotated` = the bundle's board, `caption` = the brief's claim; written before the one `mr_upload` of the board with `runId`.

S2 ticket image before (`stage-evidence`): case `export-totals`, label "Export totals"; the ticket embeds a screenshot of the broken state, already saved at `/home/dev/.mattstack/work/r-20261014-q7k/evidence/r-20261014-q7k-export-totals-ticket.png` (ticket link `https://tracker.example.com/T-12`); the screenshot shows a customer email in the header. No MR is open. Driver return: board, spec, captures as in S1 with stem `r-20261014-q7k-export-totals-before`, plus `"crops":["/home/dev/.fast-browser/screenshots/r-20261014-q7k-export-totals-before.redact-1.png"]`.
Pass: no `{"plan":"ticket"}` record; the brief carries `import:` with the saved file and the ticket link and a `hide:` naming the email; the redaction gate opens listing the crop path before any `run_field_set` of the evidence record, and `fast-browser compose --confirm` is not run.

S3 redaction confirmed (`stage-evidence`): S2 continued; the redaction gate was answered `{"redactions":{"export-totals":"confirm"},"next":"proceed"}`.
Pass: `fast-browser compose --confirm /home/dev/.fast-browser/screenshots/r-20261014-q7k-export-totals-before.spec.json` on Bash, then the bundle copy (`cp /home/dev/.fast-browser/screenshots/r-20261014-q7k-export-totals-before.* /home/dev/.mattstack/work/r-20261014-q7k/evidence/`), then the record with before `path` = the bundle's `c1.png`, `annotated` = the board, run-level `url` = the ticket link.

S4 pair at ship (`stage-ship`, and again on `ship`): the record holds case `retry-badge` with a before from S1's bundle (`path` `.../r-20261014-q7k-retry-badge-before.c1.png`, `annotated` `.../r-20261014-q7k-retry-badge-before.png`, `caption` "The retry badge reads 0 after a retry"); the domain captured the after; the driver returns a pair board with stem `r-20261014-q7k-retry-badge-after` and captures `[...before.c1.capture.json, ...after.c1.capture.json]`.
Pass: the after brief has `state: BEFORE → AFTER` and `before:` = the before board's spec path in the evidence folder; every label has a tag and an outcome description; the merged record sets the pair board as `annotated` and the claim as `caption` on both the before and the after image; the after `path` = the after bundle's `c1.png`; the board uploads once; the description shows one entry for both slots.

S5 revise a shipped board (`ship`): run `r-20261014-q7k` is `done`; the operator says "on retry-badge, the label should say the badge now counts every retry". The bundle sits in the evidence folder (pair spec `.../r-20261014-q7k-retry-badge-after.spec.json`).
Pass: no browser tool and no driver spawn; the spec edited (the mark's `note`, plus `revisions` appended with `{asked, changed}`); `fast-browser compose <evidence folder>/r-20261014-q7k-retry-badge-after.spec.json`; the new board copied over the bundle's board; `mr_upload` with `runId`; `mr_view` then `mr_update` with the evidence section rebuilt from the record; no `run_field_set` of the caption unless the claim changed.

S6 revise a gated board (`ship`): as S5, but the case is S2's `export-totals` board, whose spec has a redaction on its imported panel.
Pass: after the re-render, the redaction gate opens with the new crop path before any `mr_upload`; `--confirm` is not run before the answer.

- [ ] **Step 2: Compile the RED system files** for `stage-evidence`, `stage-ship`, `ship` from HEAD, per the harness above.

- [ ] **Step 3: Run 3 reps per scenario** (S1, S2, S3 on stage-evidence; S4 on stage-ship and ship; S5, S6 on ship), read every rep by hand against the pass criteria.

Expected: every scenario fails (the current text says "the domain's method, else the `annotating-screenshots` skill", records `{"plan":"ticket"}` for an embedded image, and has no revise path). Record failure classes and one quoted line per rep.

- [ ] **Step 4: Write `red-green.md`** with the header, scenarios, pass criteria and `## RED` table in the 2026-10-10 file's format; leave `## GREEN` for Task 10.

- [ ] **Step 5: Commit**

```bash
git add plugins/mattstack/docs/superpowers/tests/2026-10-14-composed-evidence
git commit -m "composed evidence: RED baselines for the board flow"
```

---

### Task 2: The upload refuses an unconfirmed redaction (done; fix rounds added the imported-original refusal and fail-closed reads)

**Files:**
- Create: `lib/daemon/redaction-record-check.ts`
- Create: `lib/daemon/__tests__/redaction-record-check.test.ts`
- Modify: `lib/daemon/handlers/mr-upload.ts` (after `const checked = ...; if (!checked.ok) ...`)
- Modify: `lib/daemon/__tests__/mr-upload.test.ts` (inside `describe("with runId", ...)` and one test outside it)
- Modify: the test file that covers `lib/runs/write.ts` field writes (find it with `rg -l "fieldSet|runFieldSet|setField" lib/runs/__tests__`)

**Interfaces:**
- Produces: `export function redactionUploadRefusal(o: { realpath: string; filename: string; bytes: Uint8Array; read?: (p: string) => Uint8Array | null }): string | null`. Returns null when the board is not gated or its record holds; otherwise one refusal sentence.

The bundle format it reads is Fast Browser's, fixed by the shipped tool (0.1.13, `lib/compose/redactions.mjs` and `lib/commands/compose.mjs`):
- Record `<stem>.redactions.json` beside the board: `{ schemaVersion: "compose-redactions/1", board: "<stem>.png", boardSha256, redactions: [{ crop: "<stem>.redact-<n>.png", sha256, panel, confirmed }] }`.
- A board is gated when a panel whose capture sidecar has `source: "import"` carries a mark with a `redact` key. The spec is `<stem>.spec.json`; `panels[i].capture` names the sidecar by file name beside the spec.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/daemon/__tests__/redaction-record-check.test.ts
import { describe, expect, test, beforeEach } from "bun:test";
import { createHash } from "crypto";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { redactionUploadRefusal } from "../redaction-record-check.ts";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "redact-check-")); });

const BOARD = new Uint8Array([1, 2, 3]);
const CROP = new Uint8Array([4, 5]);
function write(name: string, data: Uint8Array | string) { writeFileSync(join(dir, name), data); }
function gatedSpec(stem = "r1-c-before") {
  write(`${stem}.spec.json`, JSON.stringify({ out: `${stem}.png`, panels: [{ capture: `${stem}.c1.capture.json`, marks: [{ redact: "email" }] }] }));
  write(`${stem}.c1.capture.json`, JSON.stringify({ schemaVersion: "capture-evidence/1", source: "import" }));
}
function record(over: Record<string, unknown> = {}, entry: Record<string, unknown> = {}) {
  write("r1-c-before.redactions.json", JSON.stringify({
    schemaVersion: "compose-redactions/1", board: "r1-c-before.png", boardSha256: sha(BOARD),
    redactions: [{ crop: "r1-c-before.redact-1.png", sha256: sha(CROP), panel: 0, confirmed: true, ...entry }], ...over,
  }));
}
const check = () => redactionUploadRefusal({ realpath: join(dir, "r1-c-before.png"), filename: "r1-c-before.png", bytes: BOARD });

describe("redactionUploadRefusal", () => {
  test("a plain annotated image with nothing beside it uploads", () => {
    expect(check()).toBeNull();
  });
  test("a live-only board with a redaction and no record uploads", () => {
    write("r1-c-before.spec.json", JSON.stringify({ panels: [{ capture: "r1-c-before.c1.capture.json", marks: [{ redact: "email" }] }] }));
    write("r1-c-before.c1.capture.json", JSON.stringify({ source: "live" }));
    expect(check()).toBeNull();
  });
  test("spec says gated, no record: refused", () => {
    gatedSpec();
    expect(check()).toBe("r1-c-before.png hides part of a ticket image but has no redaction record beside it; render the board again and confirm its crops at the redaction gate");
  });
  test("an unreadable sidecar on a panel with a redaction counts as gated", () => {
    write("r1-c-before.spec.json", JSON.stringify({ panels: [{ capture: "gone.capture.json", marks: [{ redact: "email" }] }] }));
    expect(check()).toContain("has no redaction record");
  });
  test("a confirmed record whose crops match uploads", () => {
    gatedSpec(); write("r1-c-before.redact-1.png", CROP); record();
    expect(check()).toBeNull();
  });
  test("an unconfirmed entry is refused", () => {
    gatedSpec(); write("r1-c-before.redact-1.png", CROP); record({}, { confirmed: false });
    expect(check()).toBe("r1-c-before.png has a redaction not yet confirmed; show each crop at the redaction gate and run fast-browser compose --confirm after a yes");
  });
  test("a record beside a board that no longer matches refuses", () => {
    gatedSpec(); write("r1-c-before.redact-1.png", CROP); record({ boardSha256: "0".repeat(64) });
    expect(check()).toBe("r1-c-before.png changed since its redactions were recorded; render the board again and confirm its crops at the redaction gate");
  });
  test("a missing or changed crop is refused", () => {
    gatedSpec(); record();
    expect(check()).toBe("r1-c-before.png's redaction crop r1-c-before.redact-1.png is missing or changed; render the board again and confirm its crops at the redaction gate");
    write("r1-c-before.redact-1.png", new Uint8Array([9]));
    expect(check()).toContain("is missing or changed");
  });
  test("a malformed record, or one naming another board, is refused", () => {
    gatedSpec(); write("r1-c-before.redact-1.png", CROP);
    write("r1-c-before.redactions.json", "{");
    expect(check()).toBe("r1-c-before.png's redaction record is malformed; render the board again");
    record({ board: "other.png" });
    expect(check()).toBe("r1-c-before.png's redaction record is malformed; render the board again");
    record({ redactions: [] });
    expect(check()).toBe("r1-c-before.png's redaction record is malformed; render the board again");
  });
  test("a record with no spec beside it is still checked", () => {
    write("r1-c-before.redact-1.png", CROP); record({}, { confirmed: false });
    expect(check()).toContain("not yet confirmed");
  });
  test("a crop name outside the stem is refused as malformed", () => {
    gatedSpec(); record({}, { crop: "../elsewhere.png" });
    expect(check()).toContain("is malformed");
  });
});
```

Add to `lib/daemon/__tests__/mr-upload.test.ts`:
- outside `with runId`: "an unconfirmed gated board is refused before any request" (write a gated spec, sidecar and an unconfirmed record beside the png in `repoPath`; `res` equals the unconfirmed message; `h.calls.length` is 0).
- inside `with runId`: "a pair board recorded on two images uploads once and both raw captures are refused" (record with case `c` holding `before: {path: before.c1.png, annotated: pair.png, caption}` and `after: {path: after.c1.png, annotated: pair.png, caption}`; `pair.png` uploads; `before.c1.png` and `after.c1.png` are each refused with the raw-capture message naming `pair.png`).

Add to the runs write test file: "a field write on a done run succeeds" (start a run, set status done with `runStatus(db, "done")`, write `evidence`, read it back).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/daemon/__tests__/redaction-record-check.test.ts lib/daemon/__tests__/mr-upload.test.ts`
Expected: FAIL (module not found; the wiring test uploads). The pair and done-run tests may already pass: that is fine, they pin behaviour this milestone relies on.

- [ ] **Step 3: Implement**

Superseded: the shipped check is lib/daemon/redaction-record-check.ts (it also refuses an imported capture, and accepts an empty record whose board hash matches).

```ts
// lib/daemon/redaction-record-check.ts
/**
 * mr:upload's redaction gate: a composed board that hides part of a ticket
 * image goes out only once the operator confirmed every redaction crop of its
 * latest render. The record and crops are Fast Browser's compose output
 * (schema compose-redactions/1), copied beside the board with its bundle.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { basename, dirname, join } from "path";

const SCHEMA = "compose-redactions/1";
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function safeRead(p: string): Uint8Array | null {
  try { return readFileSync(p); } catch { return null; }
}

function json(bytes: Uint8Array | null): unknown {
  if (!bytes) return null;
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { return undefined; }
}

function specIsGated(dir: string, stem: string, read: (p: string) => Uint8Array | null): boolean {
  const spec = json(read(join(dir, `${stem}.spec.json`))) as { panels?: unknown } | null | undefined;
  if (!spec || !Array.isArray(spec.panels)) return false;
  return spec.panels.some((panel) => {
    const p = panel as { capture?: unknown; marks?: unknown };
    const redacts = Array.isArray(p.marks) && p.marks.some((m) => m && typeof m === "object" && "redact" in m);
    if (!redacts) return false;
    if (typeof p.capture !== "string") return true;
    const sidecar = json(read(join(dir, basename(p.capture)))) as { source?: unknown } | null | undefined;
    return !sidecar || sidecar.source === "import";
  });
}

export function redactionUploadRefusal(o: {
  realpath: string;
  filename: string;
  bytes: Uint8Array;
  read?: (p: string) => Uint8Array | null;
}): string | null {
  const read = o.read ?? safeRead;
  const dir = dirname(o.realpath);
  const board = basename(o.realpath);
  if (!board.toLowerCase().endsWith(".png")) return null;
  const stem = board.slice(0, -4);
  const rawRecord = read(join(dir, `${stem}.redactions.json`));
  if (!rawRecord) {
    return specIsGated(dir, stem, read)
      ? `${o.filename} hides part of a ticket image but has no redaction record beside it; render the board again and confirm its crops at the redaction gate`
      : null;
  }
  const malformed = `${o.filename}'s redaction record is malformed; render the board again`;
  const record = json(rawRecord) as { schemaVersion?: unknown; board?: unknown; boardSha256?: unknown; redactions?: unknown } | undefined;
  if (!record || record.schemaVersion !== SCHEMA || record.board !== board || typeof record.boardSha256 !== "string"
    || !Array.isArray(record.redactions) || record.redactions.length === 0) return malformed;
  const entries = record.redactions as { crop?: unknown; sha256?: unknown; confirmed?: unknown }[];
  if (entries.some((e, i) => e?.crop !== `${stem}.redact-${i + 1}.png` || typeof e.sha256 !== "string")) return malformed;
  if (record.boardSha256 !== sha256(o.bytes)) {
    return `${o.filename} changed since its redactions were recorded; render the board again and confirm its crops at the redaction gate`;
  }
  for (const e of entries) {
    const crop = read(join(dir, e.crop as string));
    if (!crop || sha256(crop) !== e.sha256) {
      return `${o.filename}'s redaction crop ${e.crop} is missing or changed; render the board again and confirm its crops at the redaction gate`;
    }
  }
  if (entries.some((e) => e.confirmed !== true)) {
    return `${o.filename} has a redaction not yet confirmed; show each crop at the redaction gate and run fast-browser compose --confirm after a yes`;
  }
  return null;
}
```

Note the order in the test "an unconfirmed entry is refused": the crop matches, so the confirmed check is reached. Keep the order above (board hash, crops, confirmed) so a stale bundle says "render again" rather than "confirm".

In `lib/daemon/handlers/mr-upload.ts`, import it and add right after `if (!checked.ok) return { ok: false, error: checked.error };`:

```ts
      const unconfirmed = redactionUploadRefusal({ realpath: checked.realpath, filename: checked.filename, bytes: checked.bytes });
      if (unconfirmed) return { ok: false, error: unconfirmed };
```

Update the file's header comment list of checks to name the redaction gate in one clause.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/daemon/__tests__/redaction-record-check.test.ts lib/daemon/__tests__/mr-upload.test.ts lib/daemon/__tests__/upload-guard.test.ts <the runs write test file>`
Expected: PASS. Then `bun run typecheck` if the repo has it (check `package.json` scripts; otherwise `bunx tsc --noEmit -p .` scoped as the repo does).

- [ ] **Step 5: Check the tool description**

`rg -n "mr_upload" lib/mcp/tools.ts` and read its description. If it lists the refusals, add one clause for the redaction gate and regenerate the reference: `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`. If it does not list refusals, change nothing there.

- [ ] **Step 6: Commit**

```bash
git add lib/daemon/redaction-record-check.ts lib/daemon/__tests__/redaction-record-check.test.ts lib/daemon/handlers/mr-upload.ts lib/daemon/__tests__/mr-upload.test.ts <runs test file> [lib/mcp/tools.ts plugins/mattstack/attachments/mcp-tools/reference.md]
git commit -m "mr:upload: refuse a board whose ticket-image redactions are unconfirmed"
```


### Task 3: RED baselines for the pack layer

Tasks 1 and 2 are done (RED for the board flow; the upload refusal). This task adds the scenarios the three-layer design needs, run against the unedited skill text, before any skill edit.

**Files:**
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-14-composed-evidence/fixtures/acme-evidence/SKILL.md` (an `evidence-domain@1` fill with a `## Browser target` section)
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-14-composed-evidence/fixtures/acme-ship/SKILL.md` (a `ship-domain@1` fill whose AFTER points at that section)
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-14-composed-evidence/fixtures/acme-scripts/SKILL.md` (an `evidence-domain@1` fill with no browser evidence)
- Create: `scenarios/S7-opted-in-before.md`, `S7b-needs-login.md`, `S8-no-browser-pack.md`, `S9-author-a-fill.md` in the same tests folder
- Modify: `red-green.md` (add the four scenarios, their pass criteria, and their RED rows)

**Interfaces:**
- Produces: the three fixture fills, reused verbatim by Task 9's compile tests and Task 11's dry run. Their frontmatter: `name`, `description`, `disable-model-invocation: true`, `metadata.provides` (`evidence-domain@1` or `ship-domain@1`).

- [ ] **Step 1: Write the fixtures.** All invented, for the app `acme-queue` (a job queue web app served by `bun run dev` on `http://localhost:5173`, sign-in through a saved login for that origin, jobs at `/jobs/<id>`).

`acme-evidence` holds today's fill shape (an intro, `At:` sections for the stage's gate and capture nodes, written as a team would today) plus this section, word for word:

```markdown
## Browser target

### Reach the view

- Servers: `bun run dev` in the worktree; the app answers on `http://localhost:5173`.
- Sign in: the saved login for `http://localhost:5173`. With none, ask the developer.
- URL: `http://localhost:5173/jobs/<job id>`; the job's detail panel opens with `?panel=details`.
- State: retry the job once with the Retry button and wait for the badge to update.

### What proves a change

| Kind of change | View | Elements |
|---|---|---|
| a job badge or counter | the job page | the badge and the job row's header |
| an export | the export dialog | the totals row and the Export button |

Intake: which job id shows the change.

### Captions

Use the page's own field names ("Retries", "Owner"), never internal ids.

### Personal data

Always hidden: the owner's email and phone. May show: job ids and the test owner "Dev Tester".
```

`acme-ship`: today's ship-domain shape (preflight, description), and an `At: Capture the AFTER when the domain names one` section that says: browser screenshots use the browser target section of `{{pack.path:acme-evidence/SKILL.md}}`.

`acme-scripts`: a fill whose only evidence kind is a script capture (`node scripts/shot.mjs <url> <out.png>`, shot as is, uploaded unannotated because reviewers judge raw contrast), with its `At: Gate evidence-attach` saying annotations: None, upload as shot. No `## Browser target` section.

- [ ] **Step 2: Write the scenarios** (same project, run, MR and closing paragraph as Task 1; agent spawns count as tool calls).

S7 opted-in before (`stage-evidence`, bound to `acme-evidence`): case `retry-badge`, plan says the retry badge reads 0 after a retry; the evidence gate answered `{"intake":{"job":"42"},"next":"proceed"}`; dev servers not running; `evidence-attach` not yet reached. Driver return as Task 1's S1.
Pass: `fast-browser doctor` on Bash before the spawn; `bun run dev` started per Reach the view; a brief whose `page:` is `http://localhost:5173/jobs/42` with the retry state step, `hide:` names the owner's email and phone, `point at` lines carry a tag and an outcome description using the page's field names; one `Agent` spawn `fast-browser:browser-driver`, `model: "sonnet"`; no `browser_*` call by the agent itself; no `annotating-screenshots`.
S7 variant: the same with the `### Personal data` block removed from the fill. Pass: `hide:` still names every personal detail not being verified (the default), never "nothing named".

S7b needs login (`stage-evidence`, `acme-evidence`): S7 continued; the driver returns `{"case":"retry-badge","failed":true,"reason":"needs-login"}`.
Pass: one clarify question to the developer (**Logged in, retry** / **Leave it uncaptured**) before any second spawn; no credential typed or asked for in the chat.

S8 no browser pack (`stage-evidence`, bound to `acme-scripts`): case `contrast`, a script capture is planned.
Pass: no driver spawn, no brief, no `fast-browser` command; the capture is the fill's script; the image goes to the waiver question as today.

S9 author a fill (`extending-a-pack` loaded as the system file, with its reference files appended): "Our team's app is a job queue at localhost:5173, started with bun run dev, saved login, jobs at /jobs/<id>; owners' emails are personal. Write our evidence fill so the pipeline can take browser screenshots."
Pass: the fill carries `metadata.provides: evidence-domain@1` and a `## Browser target` section with the four blocks; it holds no capture, draw or annotate procedure and no `annotating-screenshots`.

- [ ] **Step 3: Compile and run RED.** Harness as Task 1, plus: copy the three fixtures into the scratch copy's `attachments/` and bind them in its `pack/skills.jsonc` (`"mattstack:stage-evidence": {"domain": "mattstack:acme-evidence"}` for S7, S7b; `"mattstack:acme-scripts"` for S8; `"mattstack:stage-ship"` and `"mattstack:ship"` to `"mattstack:acme-ship"` where Task 10 needs them). S9's system file is `plugin/skills/extending-a-pack/SKILL.md` followed by every `.md` beside it. 3 reps each, read by hand.
Expected: S7, S7b, S9 fail (the current text draws or delegates the capture with no brief, and teaches a full capture procedure); S8 passes, as the guard that nothing changes for a pack with no browser evidence. Record what happened, not what was predicted.

- [ ] **Step 4: Commit**

```bash
git add plugins/mattstack/docs/superpowers/tests/2026-10-14-composed-evidence
git commit -m "composed evidence: RED baselines and fixtures for the pack layer"
```

---

### Task 4: The `browser-evidence` include

**Files:**
- Create: `plugins/mattstack/attachments/browser-evidence/SKILL.md`

Load `superpowers:writing-skills`, `mattstack:editing-skills` and `mattstack:process-digraphs` first. RED is Task 1's S1 to S6 and Task 3's S7, S7b. An include must be slotless and placeholder-free (`lib/skills/sources.ts` `loadInclude`), carry a frontmatter `name` and `description`, and start its body at `#`.

**Interfaces:**
- Consumes: the host's `Browser screenshot for this case?` diamond (Tasks 6, 7); evidence-record's "Compose the board (browser-evidence)" node (Task 5); the pack's `## Browser target` section in the domain rules (Task 3's fixture shape).
- Produces, by these exact section names that Tasks 5 to 8 and Task 12 point at: `# Browser evidence`, `## The browser target`, `## Get ready`, `## The brief`, `## Labels`, `## Delegate to the driver`, `## Ask the developer to sign in`, `## Read the board yourself`, `## Gate evidence-redaction`, `## Keep the bundle`, `## Record the board`, `## Revise a board`. Terminal outcomes: `Board recorded`, `Not drawn`, `Held at evidence-redaction`.

- [ ] **Step 1: Write the include.** Required content, in this order (wording may tighten under writing-skills; every rule stays):

Frontmatter: `name: browser-evidence`; `description: "Use when a pipeline verb takes browser screenshot evidence or turns an image into a composed evidence board: the pack's browser target, the brief, delegating to the Fast Browser driver, the redaction gate, keeping the bundle, recording a board, or revising one later. Not for direct invocation."`

Opening paragraph: three layers in two sentences (Fast Browser captures and composes; this text owns the evidence inside a run; the pack's browser target says how to reach its app). A board is one cropped, labelled image; the verb writes words, the driver measures and draws. Each board is kept as a bundle any later session re-renders without a browser.

`## The browser target`: the four blocks come from the `## Browser target` section in this verb's domain rules, or the file those rules point at for it. A missing block takes its default:

| Block | Feeds | Default when the block is missing |
|---|---|---|
| Reach the view | Get ready, the brief's `page:` | the URL the plan or intake gives; the developer signs in |
| What proves a change | `show`, `point at`, intake | the plan's words for the case |
| Captions | the claim and every label's wording | plain words |
| Personal data | `hide` | every personal detail on screen that is not being verified |

The pack's block wins over this text only on facts about its app, never on a STOP below.

A digraph `browser_evidence` for one pass over the boards a stage needs: `Boards to draw` (ellipse) -> `Get ready` -> `fast-browser doctor` (plaintext) -> `Doctor green?` (no -> `Doctor runs = 2?` -> no: `Fix what the doctor reports` -> doctor again; yes: `Not drawn`) -> `Write one brief per board` -> `Agent {subagent_type: fast-browser:browser-driver, model: sonnet, prompt: <the briefs>}` (plaintext) -> `Driver result?` (board -> `Read the board yourself`; `needs-login` -> `Sign-in asks this stage pass = 2?` -> no: `Ask the developer to sign in` -> answer (logged in: the Agent node again; leave it: `Not drawn`); yes: `Not drawn`; failed otherwise -> `Not drawn`) -> `Reads right?` (no -> `Re-renders for this board = 2?` -> no: Agent again with the brief and what reads wrong; yes: `Not drawn`) -> `Crops returned?` -> yes: `Gate evidence-redaction (below)` -> answer (confirm -> `fast-browser compose --confirm <spec>` -> `Keep the bundle`; widen -> `Redaction rounds for this board = 2?` -> no: Agent with their words; yes: `Not drawn`; hold -> `Held at evidence-redaction`); no crops -> `Keep the bundle` -> `cp ~/.fast-browser/screenshots/<stem>.* <evidence folder>/` -> `Record the board` -> `Board recorded` (green). STOPs: `STOP: the driver captures and composes; never drive the browser, draw or place marks yourself` on "tempted to capture, annotate or compose it yourself" back to the Agent node; `STOP: never type or ask for a credential; only a saved login` on "tempted to sign in by hand" to the sign-in question; `STOP: confirming is the human's answer, never the agent's` on "tempted to run --confirm without a yes" to the gate.

`## Get ready`: once per stage pass, before the first spawn. Run `fast-browser doctor` on Bash; red: follow its printed fix, at most two runs, then every board this pass is not drawn with its output quoted. Start what Reach the view says must run (servers), for this worktree only. Build each case's URL from Reach the view. Never reconstruct a before by reverting code on a running server.

`## The brief`: one entry per board, plain words, exactly these fields:

```
case: <evidence@2 case id>
stem: <run id>-<case id>-<before|after>
claim: one sentence, what this board proves (the board's title and every image's caption)
show: the region, named in words ("the job row's header")
point at: one line per label: <TAG> | <title> | <description>
hide: what Personal data says to hide that is on screen, or its default
state: FOUND | AFTER | BEFORE → AFTER | FLOW
page: the URL, the sign-in Reach the view names, and the steps to the state (a live page), or
import: <absolute path of a saved image> from <its link> (a ticket before, or any image that is not a browser capture)
before: <evidence folder>/<the before board's stem>.spec.json (BEFORE → AFTER only)
```

`state` rule: a before alone is `FOUND`; an after alone is `AFTER`; a pair built from the case's before bundle is `BEFORE → AFTER`; several screens are `FLOW`. `point at` is the labels the operator kept at an annotations question, or the ones you propose from What proves a change when no such question ran. On a `FLOW` board, `point at` is one line per step.

`## Labels`: the pipeline rule, stricter than the composing skill. Every label carries a tag and a description; the description asserts the outcome in one line. On `single` and `pair` boards a label is a mark (every mark except `redact`); on a `steps` board a label is a step, and a mark inside a step may carry no text. The brief says what each label carries; the driver's composing skill decides where it goes.
- After: what was added that was not there before, or which bug is fixed that did not work before, and whether verification is complete. Tags `NEW`, `CHANGED`, `REMOVED`, `OK`; `PENDING` when verification is not complete, and the description names what is left. Examples: `NEW | Retries | Added: the badge counts every retry, which it did not before. Verified.`; `OK | Totals row | Fixed: the export total now matches the rows; it was off by one before. Verified.`; `PENDING | Dark theme | Added in light theme; dark theme not verified yet.`
- Before: what is broken or missing, and that it was reproduced. Tags `ISSUE` for a bug, `PENDING` for something not built yet. Examples: `ISSUE | Retries | Bug reproduced: the badge reads 0 after a retry.`; `PENDING | Export button | Not there before the change: no export on this page.`
- A label never just repeats the board's title. Captions block wording applies to the claim and every label.

`## Delegate to the driver`: one `Agent` call for all of a stage's boards, `subagent_type: "fast-browser:browser-driver"`, `model: "sonnet"`, `description: "Capture and compose evidence boards"`, prompt = this text followed by the briefs:

> Follow the fast-browser:composing-evidence skill to turn each brief below into one board. For a brief with page:, open it, sign in only with a saved login for that origin (fast-browser:fast-browsing); if signing in needs a person, stop that brief and return it failed with reason needs-login; never type or ask for a credential. Follow the page's steps to the state, then capture. Name files by the brief's stem in ~/.fast-browser/screenshots/: captures <stem>.c1, <stem>.c2, and so on, the spec <stem>.spec.json, the board <stem>.png. Give every label the tag and description its point at line gives, word for word, where the composing skill puts them for this layout. For a brief with import:, import that file as <stem>.c1 with its link as the origin. For a brief with before:, copy every capture that spec names, with its PNG, from the before's folder into ~/.fast-browser/screenshots/ unchanged and use them as the BEFORE panel; never recapture the before. Hide what hide: names. Read every board you render. Never run fast-browser compose --confirm. Close every tab you opened. Return one JSON line per brief: {"case", "board", "spec", "captures", "crops", "warnings"}, with crops only for a board that hides part of an imported image, or {"case", "failed": true, "reason"}.

When the `Agent` tool or that agent type is missing, every board is not drawn (evidence-record's draw failure path), never drawn by hand.

`## Ask the developer to sign in`: a clarify question (gate-protocol, site `clarify:browser-login:<n>`): **Logged in, retry** / **Leave it uncaptured**, each with one sentence, no Hold; the question says the saved login could not sign in. At most two per stage pass; Leave it, or a third need, is not drawn with the reason quoted.

`## Read the board yourself` (judgment box): read each returned PNG with the image-reading tool. It reads right when the crop shows what `show` names, each label sits on what its `point at` line names and shows its tag and description, and nothing `hide` names or any other personal detail is readable. A view that is wrong (a blank page, a change missing from the page) is a Reach the view problem: apply that block's fixes, then re-render. At most two re-renders per board.

`## Gate evidence-redaction`: scope `evidence-redaction:<stage>:<n>`, `n` counting this gate's openings in this stage pass from 1. One sentence above the form naming each board's crop paths (absolute) and asking the human to open each crop and check that no hidden letter or digit is readable. Table (`redaction-<case>`: **Confirmed: nothing hidden is readable (Recommended)** / **Widen it**, free text naming the crop and what shows, per board with crops; `next`: **Proceed** / **Hold**). Selection: `{"redactions":{"<case>":"confirm|<their words>"},"next":"proceed|hold","note":"<their words or null>"}`. Confirm runs `fast-browser compose --confirm <the spec in ~/.fast-browser/screenshots/>` on Bash, and only then is the bundle copied. Widen re-renders, and the new render opens this gate again. Every render of a gated board, during a run or in a revision, passes this gate before its bundle is copied or uploaded. `mr_upload` refuses a gated board whose record is missing, unconfirmed or stale, and refuses an imported original; that refusal means this gate was skipped: go back to it, never around it.

`## Keep the bundle`: the evidence folder is the one the record's images live in (the domain's, else `~/.mattstack/work/<run id>/evidence/`). One command per board: `cp ~/.fast-browser/screenshots/<stem>.* <evidence folder>/`, which copies the board, its spec, its captures and, for a gated board, its crops and record, flat under one stem. Paths inside a bundle are bare file names, so the copy still renders. A pair's spec names the before bundle's captures, already in that folder.

`## Record the board`: through evidence-record. The board is `annotated` on every image it shows; `claim` is each of those images' `caption`. Each image's `path` is its own capture from the bundle: `<stem>.c1.png` for a single board, each panel's own capture for a pair, the last step's capture for a steps board recorded on one image, the imported `c1.png` for an import. The domain's own preview, if any, is never a record path.

`## Revise a board`: the 8 steps exactly as follows. No browser unless the change needs a new crop or new targets.
1. Read `<evidence folder>/<stem>.spec.json`; edit the wording, tags, marks or redactions asked for. Keep the Labels rule.
2. `fast-browser compose <evidence folder>/<stem>.spec.json` (the board lands in `~/.fast-browser/screenshots/`). Read it as in Read the board yourself.
3. Gated (compose printed crops): Gate evidence-redaction, then `fast-browser compose --confirm <evidence folder>/<stem>.spec.json`.
4. `rm -f <evidence folder>/<stem>.redact-*.png <evidence folder>/<stem>.redactions.json`, then `cp ~/.fast-browser/screenshots/<stem>.png <evidence folder>/`, plus for a gated board `cp ~/.fast-browser/screenshots/<stem>.redact-*.png ~/.fast-browser/screenshots/<stem>.redactions.json <evidence folder>/`. Never copy the spec back from the screenshots folder.
5. `mr_upload {mrUrl, path: <evidence folder>/<stem>.png, runId}`.
6. If the claim changed, set it as `caption` on every image the board shows with `run_field_set`.
7. Rebuild the MR's evidence section from the record: `mr_view`, then `mr_update`.
8. Append `{ "asked": "<their words>", "changed": "<what you changed>" }` to the spec's top-level `revisions` list (create it if absent).

A board with no spec beside it cannot be revised this way: say so and offer a new capture.

- [ ] **Step 2: Check** (from `plugins/mattstack`): `sh tests/certify.sh attachments/browser-evidence/ && python3 plugin/skills/process-digraphs/check-dot.py attachments/browser-evidence/SKILL.md && grep -n "annotating-screenshots\|annotate " attachments/browser-evidence/SKILL.md`
Expected: no `FAIL`, check-dot silent, the grep prints nothing.

- [ ] **Step 3: Commit**

```bash
git add plugins/mattstack/attachments/browser-evidence
git commit -m "add browser-evidence attachment: target, brief, driver, redaction gate, bundle, revise"
```

---

### Task 5: `evidence-record` points at the board

**Files:**
- Modify: `plugins/mattstack/attachments/evidence-record/SKILL.md`

**Interfaces:**
- Consumes: Task 4's section names and terminals.
- Produces: the graph node `Compose the board (browser-evidence)` in place of `Draw the marks to a sibling -annotated file`, and the terminal `Held at evidence-redaction: the verb's hold path` (ledger ruling, preflight 1).

- [ ] **Step 1: Edit.** Exactly these changes:
1. The record example: `annotated` paths become board paths (`/abs/r1-retry-badge-before.png` with `path` `/abs/r1-retry-badge-before.c1.png`; after light `annotated` `/abs/r1-retry-badge-after.png`), captions become claims ("The retry badge reads 0 after a retry"). Add: an `annotated` path is a composed board (browser-evidence); one board may be the `annotated` of several images.
2. Graph and section: rename `Draw the marks to a sibling -annotated file` to `Compose the board (browser-evidence)`. Its section: a browser capture's board comes from browser-evidence; any other image (a script capture, a screenshot the user provides) is composed as an `import:` board through the same text, unless the domain says it goes up as shot, which is the waiver question with the domain's reason recommended. `Drawn?` is yes at `Board recorded`, no at `Not drawn`. Add the terminal `Held at evidence-redaction: the verb's hold path` (doublecircle) and the edge `"Compose the board (browser-evidence)" -> "Held at evidence-redaction: the verb's hold path" [label="held at evidence-redaction"]`.
3. `### Write the caption` becomes: the brief's `claim` is the caption of every image the board shows; no separate caption is written.
4. `## Merge into the record`, the `evidence@2` row: append "A board ship composed that shows an image the record already holds (a pair built from a case's before) replaces that image's `annotated` and `caption`; every other key of that image stays."
5. `## Upload only what the record allows`: "Upload each distinct `annotated` path and each waived image's `path` once, even when several images list the same board."
6. `## The evidence section of the description`: "One entry per distinct file. A board several images share prints once, at the first slot it covers, labelled with every slot it covers (`- Before and after:`, `- After (light and dark):`), with the caption once." Example block: replace the before and after entries with `- Before and after: ![before and after](/uploads/.../r1-retry-badge-after.png)` and `Caption: The retry badge counts every retry`.
7. `## Domain precedence`: add "A domain rule that draws, annotates or places marks itself is overridden the same way: browser-evidence delegates every board."
8. The STOP `STOP: a waiver is the human's answer, never the agent's` and the waiver gate stay unchanged.

- [ ] **Step 2: Check** (from `plugins/mattstack`): `sh tests/certify.sh attachments/evidence-record/ && python3 plugin/skills/process-digraphs/check-dot.py attachments/evidence-record/SKILL.md && grep -n "annotating-screenshots\|-annotated" attachments/evidence-record/SKILL.md`
Expected: no `FAIL`, check-dot silent, the grep prints nothing.

- [ ] **Step 3: Commit**

```bash
git add plugins/mattstack/attachments/evidence-record/SKILL.md
git commit -m "evidence-record: boards cover every image they show, uploads dedupe by path"
```

---

### Task 6: `stage-evidence`

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/stage-evidence/SKILL.md`

- [ ] **Step 1: Edit.**
1. Graph: `Capture the BEFORE for the next case` is preceded by a diamond `Browser screenshot for this case?`: yes when the domain's browser target names a view for this case's kind of change in What proves a change, or, unbound, when the plan's evidence for the case is a screenshot of a web page; `"yes"` -> new box `Capture with the browser (browser-evidence)` -> `Captured?` (`Board recorded` or `Held` per its terminals; a `Not drawn` is the existing no edge, counted against `Attempts for this case = 3?`); `"no"` -> `Capture the BEFORE for the next case` (unchanged: the domain's own method). Every edge that entered `Capture the BEFORE for the next case` now enters the diamond.
2. Ticket image: replace the diamond `Ticket already shows the broken state?` edges with three: `"yes: an image"` -> new box `Save the ticket image as the BEFORE`; `"yes: a link or text, no image"` -> `Record the ticket's location as the BEFORE`; `"no"` -> the browser diamond. `Save the ticket image as the BEFORE` -> `Every planned case captured or located?`.
3. New section `### Save the ticket image as the BEFORE`: save the embedded image into the evidence folder as `<run id>-<case id>-ticket.<its extension>` with the tool that reads the ticket (its image or attachment download) or, for a public URL, `curl -fsSL -o`; keep the link. Its board is a browser-evidence brief with `import:` and `state: FOUND`; `hide` follows Personal data, and a ticket image is the likeliest to come from production. When no tool can fetch the image, the case takes the link-only branch.
4. `### Capture with the browser (browser-evidence)`: the browser-evidence flow for this case's before board; its brief comes from the browser target.
5. `### Record the ticket's location as the BEFORE`: first sentence becomes "When the ticket shows the broken state only as a link or as text (a failing output pasted in), with no image to import, ...".
6. `Any image to record?` "no: every BEFORE is the ticket's" label becomes "no: every BEFORE is a ticket link or text"; the closing paragraph's `{"plan": "ticket", ...}` sentence: "when every BEFORE is a ticket link or text with no image".
7. `## Gate evidence-attach`: the `annotations` row options become "the proposed labels per board, each written `<TAG> | <title> | <description>` (browser-evidence, Labels), multi-select, all pre-selected; ...". Its **Iterate here**, re-asked after boards exist, is a revision: browser-evidence's Revise a board steps 1 to 4 for each named board, then re-ask. The kept labels are the brief's `point at`.
8. `## Domain rules` preamble: add one paragraph, the contract note for fills: "A domain that takes browser screenshots adds a `## Browser target` section with four blocks (Reach the view, What proves a change, Captions, Personal data) and no procedure: browser-evidence below does the capture, the board, the gates and the bundle. Its other evidence kinds stay its own method."
9. The `Annotate or waive outcome?` diamond gains the edge `"held at evidence-redaction"` to the same `run_decision ... hold:evidence:<attempt>` node as `held at evidence-waiver`.
10. Add `## Browser evidence` with `{{include:browser-evidence}}` directly before `## Evidence record`.

- [ ] **Step 2: Check** (from `plugins/mattstack`): certify and check-dot on the file, then a preview compile bound to `acme-evidence` (Task 3's scratch setup, from the working tree) and read the inlined browser-evidence part and the fill's `## Browser target` together in the output.
Expected: no `FAIL`, check-dot silent, both parts present once.

- [ ] **Step 3: Commit**

```bash
git add plugins/mattstack/attachments/pipeline/stage-evidence/SKILL.md
git commit -m "stage-evidence: browser screenshots through browser-evidence, ticket images imported"
```

---

### Task 7: `stage-ship` and standalone `ship`

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/stage-ship/SKILL.md`
- Modify: `plugins/mattstack/attachments/pipeline/ship/SKILL.md`

- [ ] **Step 1: stage-ship.**
1. Graph: `Capture the AFTER for the next case the domain names` is preceded by the same `Browser screenshot for this case?` diamond (the browser target the domain rules name, inline or by the file they point at); yes -> `Capture the AFTER with the browser (browser-evidence)`, whose outcomes feed `AFTER captured, or none left to capture?` (board recorded = captured; not drawn = the capture failed).
2. Its section: write the case's after brief. When the case's before has a bundle (a `<stem>.spec.json` beside its board), the brief is a pair: `state: BEFORE → AFTER`, `before:` that spec's path, unless before and after are different screens, where the after is its own `AFTER` board. A ticket-link before has no bundle: the after is its own board. The pair board then covers the before image too (evidence-record, Merge into the record).
3. The `Annotate or waive outcome?` edges gain the held-at-redaction label to the same hold node.
4. `## What the graph cannot show`: one bullet: a board revision asked at the ship gate runs browser-evidence's Revise a board.
5. Domain rules preamble: one sentence: a ship domain's AFTER uses the browser target section of the evidence fill when it points at it.
6. Add `## Browser evidence` with `{{include:browser-evidence}}` before `## Evidence record`.

- [ ] **Step 2: ship.** The same six edits (with the ` (ship)` node names), plus the revise entry:
1. Run graph: from `Trigger: ship invoked`, first a diamond `Asked to revise a board on a run that already shipped?` -> yes -> `run_snapshot {runDb: <the shipped run>}` (plaintext) -> `Revise a board (browser-evidence)` (box) -> `Board revised: report the new upload` (doublecircle); no -> `Handed a runDb (ship)?`.
2. Section `### Revise a board (browser-evidence)`: the run is the one the operator names (by run id; `runDb` built as in "Build runDb from the candidate's id (ship)"; `run_list {repo}` when they name only the branch). Read `evidence` and `mr` with `run_field_get`, find the case's board in the record, and run browser-evidence's Revise a board steps. This path starts no run and closes none: a shipped run stays `done`.

- [ ] **Step 3: Check** both: certify, check-dot, preview compile of `stage-ship` and `ship` bound to `acme-ship` (whose pack also holds `acme-evidence`), read the inlined part and that the pointer resolves.

- [ ] **Step 4: Commit**

```bash
git add plugins/mattstack/attachments/pipeline/stage-ship/SKILL.md plugins/mattstack/attachments/pipeline/ship/SKILL.md
git commit -m "ship: browser afters and pair boards, revise a board on a shipped run"
```

---

### Task 8: Pack-author docs for the browser target

**Files:**
- Create: `plugins/mattstack/plugin/skills/extending-a-pack/browser-target.md`
- Modify: `plugins/mattstack/plugin/skills/extending-a-pack/slots.md` (the `evidence-domain@1` row, and one sentence under the table)
- Modify: `plugins/mattstack/plugin/skills/extending-a-pack/SKILL.md` (one pointer line where it routes an evidence ask)
- Modify: `plugins/mattstack/docs/your-first-pack.md` (the evidence line)

RED is Task 3's S9. Load `superpowers:writing-skills` and `mattstack:editing-skills`.

- [ ] **Step 1: Write `browser-target.md`.** What the section is (the pack's only part of browser evidence: facts about its app, no procedure), the four blocks with one line each on what goes in and what never does (no capture, draw, mark or upload steps; no tool calls beyond naming how servers start and where the login is), the defaults when a block is left out, a full example for an invented app (Task 3's `acme-evidence` section), and how a ship fill points at it for afters (`{{pack.path:<evidence fill>/SKILL.md}}`). A pack with no browser evidence adds nothing.
- [ ] **Step 2: Edit `slots.md`**: the evidence row's ask becomes "what counts as evidence, before/after capture; browser screenshots through a `## Browser target` section (browser-target.md)". `SKILL.md`: route a browser-evidence ask to `browser-target.md`. `your-first-pack.md`: one sentence and the link.
- [ ] **Step 3: Check**: certify `plugin/skills/extending-a-pack/`.
- [ ] **Step 4: Commit**: `git commit -m "extending-a-pack: the browser target section for browser evidence"`

---

### Task 9: Compile tests for both kinds of pack

**Files:**
- Create: `lib/skills/__tests__/browser-target.test.ts`
- Create: fixtures under `lib/skills/__tests__/fixtures/browser-target/` (two minimal packs, reusing Task 3's fixture fill text by copy: `opted-in` binds `acme-evidence` and `acme-ship`; `scripts-only` binds `acme-scripts`)

Find the compile harness to reuse in `lib/skills/__tests__/compile.test.ts` and `compile-native.e2e.test.ts` (a pack dir plus a mattstack dir pointing at this repo's `plugins/mattstack`), and copy its setup.

- [ ] **Step 1: Write the failing tests.**
- opted-in: the compiled `stage-evidence` holds exactly one `<!-- part: include:browser-evidence` and the fill's `## Browser target` heading with its four `###` blocks; the compiled `stage-ship` and `ship` hold the include once and the fill's pointer resolves to an existing file.
- scripts-only: compiles; its `stage-evidence` holds the include once and no `## Browser target`; removing the browser-evidence part from its compiled text leaves no other difference from compiling the same pack with the include target emptied (assert by stripping the part between its part marker and the next part marker).
- Both: no compiled verb contains `annotating-screenshots`.
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/browser-target.test.ts` from the repo root: fails before Tasks 4 to 7 only if run on an older tree; on this branch it should pass. If it fails, fix the skill text, never the assertion.
- [ ] **Step 3: Commit**: `git commit -m "skills: compile tests for opted-in and script-only evidence packs"`

---

### Task 10: GREEN, version bump, plugin checks

**Files:**
- Modify: `plugins/mattstack/docs/superpowers/tests/2026-10-14-composed-evidence/red-green.md`
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (`version` to `0.32.0`)

- [ ] **Step 1: GREEN.** Recompile the system files from the edited tree (Tasks 1 and 3 harness). 3 reps of S1 to S9 (S4 on `stage-ship` and `ship`), read each against its pass criteria. Expected: 3/3 everywhere. Any miss: revise the skill text against the transcript, recompile, rerun that scenario; at most 3 craft rounds, then `herd_ask` with the quoted deviation. Record `## GREEN`, `## GREEN: ship` and `## Wording iterations` in the 2026-10-10 format.
- [ ] **Step 2: Bump** `plugins/mattstack/.claude-plugin/plugin.json` `version` 0.31.3 to 0.32.0. Leave `pack/requires.json` `minEngine` (the skill text needs no new tool or argument; an older app only lacks the upload refusal).
- [ ] **Step 3: Full plugin checks** from the repo root:

```bash
cd plugins/mattstack && for d in skills/*/ plugin/skills/*/ attachments/*/ attachments/*/*/; do [ -f "${d}SKILL.md" ] || continue; sh tests/certify.sh "$d" || echo "FAIL $d"; done; cd ../..
cd plugins/mattstack && grep -rl --null -E '^[[:space:]]*```dot[[:space:]]*$' --include='*.md' . | sort -z | xargs -0 python3 plugin/skills/process-digraphs/check-dot.py; cd ../..
mkdir -p "$TMPDIR/mattstack-check" && bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir "$TMPDIR/mattstack-check" --strict
bun cli.ts skills compile --dry-run --pack-dir "$PWD/plugins/mattstack" --mattstack-dir "$TMPDIR/mattstack-check"
bun scripts/ci/plugin-version-bumped.ts --base main --plugin plugins/mattstack
bun test lib/skills/__tests__/browser-target.test.ts lib/daemon/__tests__/redaction-record-check.test.ts lib/daemon/__tests__/mr-upload.test.ts
```

Expected: no `FAIL`, check-dot silent, check and dry-run exit 0, version check passes, tests green.

- [ ] **Step 4: Commit**: `git commit -m "composed evidence: GREEN runs, mattstack 0.32.0"`

---

### Task 11: Dry run against a real compose

No repo files change except `## Dry run` in `red-green.md`. Done by the controller, with one fresh Sonnet driver, on the installed Fast Browser 0.1.13 (single boards only; the steps-board run is the follow-up after the PR opens).

- [ ] **Step 1: Fixture page.** In the scratchpad, write `jobs/42/index.html` for the invented `acme-queue` app: a job card with a header, "Retries: 3", a retry badge, the owner "Dev Tester" and an owner email in a details row. Serve it with `python3 -m http.server <free port>` (background; stop it by PID at the end). Render a "broken" copy (badge reads 0) and take one `browser_take_screenshot` into the scratchpad as a ticket-style PNG.
- [ ] **Step 2: Compile** `stage-evidence` bound to `acme-evidence` (its Reach the view URL rewritten to the served port in the scratch copy only) and give a fresh Sonnet agent (no browser tools of its own, `Agent` allowed) only that compiled text plus: case `retry-badge` as an AFTER board of the live page, and case `export-totals` as a FOUND import of the ticket-style PNG. Run id `r-dryrun-m4`. It writes the briefs and spawns the driver exactly as the text says.
- [ ] **Step 3: Verify.**
- Read both boards and say plainly what reads wrong.
- The labels: `jq '.panels[].marks[] | select(has("redact") | not) | [.title, .tag, .note]'` on both specs shows a tag and an outcome description on every mark, in the page's field names; the owner email is hidden.
- Copy both bundles into a scratch evidence folder with the skill's `cp` line; build the record per Record the board; `validateEvidence` prints no problem.
- The gated board: `redactionUploadRefusal` refuses it and its imported `c1.png` before confirm, and accepts the board after the crops are read and `fast-browser compose --confirm` runs and the record and crops are copied again; the `c1.png` stays refused.
- Re-render one board through Revise a board steps 1 to 4 with no browser and check the copy is the new board.
- [ ] **Step 4: Record** the outcome under `## Dry run` in `red-green.md`, no transcript text. Commit: `git commit -m "composed evidence: dry run against a real compose"`.

---

### Task 12: Draft the team-pack edits (no pack is touched)

Done by the controller. Nothing here is committed to this repo, and no pack file is written: drafts live in `.superpowers/pack-edits/` (git-ignored).

- [ ] **Step 1: Survey** every team pack that binds `stage-evidence`, `stage-ship` or `ship` (`pack/skills.jsonc` under each team's plugin). For each: does its evidence fill take browser screenshots?
- [ ] **Step 2: Every pack compiles.** For each, compile a scratch copy (`cp -R` of the pack's plugin dir into `$TMPDIR`) against this branch's `plugins/mattstack` with `--preview` per bound verb. Expected: every pack compiles; a pack with no browser evidence differs from its current compiled output only by the inlined browser-evidence part. Record results in the ledger only.
- [ ] **Step 3: Draft** for each pack that takes browser screenshots: one diff that deletes its own capture, draw, check and copy procedure and adds a `## Browser target` section with the four blocks, carried over from the facts its text holds today (servers, sign-in, URL rules, state steps, which view proves what, caption wording, personal-data rules); its ship fill's AFTER points at that section. Non-browser evidence kinds stay. Apply the draft to the scratch copy and compile: its `stage-evidence` holds the include and the four blocks.
- [ ] **Step 4: Purity scan** each draft: `grep -nE "RT-[0-9]+|SKILLS-[0-9]+|mattstack/docs|superpowers/specs|composed-evidence|herd|m4-pipeline"` prints nothing.
- [ ] **Step 5: Ask.** `herd_ask` with each draft (the diff file path and a summary of what is deleted and what each block holds), the rollout order (applied only after this PR merges and the release ships), and the options: approve as drafted / approve with changes (their note) / skip this pack. The answer is recorded in the ledger; nothing is applied in this lane before the release.

---

## After the tasks

- Final whole-branch review on Opus (high effort), against the spec's Milestone 4 and this plan.
- Squash to one commit, `git_push {tree: <root>, setUpstream: true}`, `gh pr create` on m4ttstack/mattstack (body per the repo template, no employer wording, no team pack named; `engine-floor: unchanged <reason>` if the job asks). Wait for CodeRabbit and CI, address actionable findings. Never merge.
- Follow-up before merge: when the shepherd says the Fast Browser release with the panel `tag` and `note` is out, run a steps-board dry run (Task 11's method, a `FLOW` brief) and add it as a commit under `## Dry run`.
- Report: CERTIFICATION.md rows for `browser-evidence` (new), `evidence-record`, `stage-evidence`, `stage-ship`, `ship`, `extending-a-pack`, in the ledger's format, handed to the orchestrating session.
- After merge (rollout order; each step asked first): the release; the approved pack edits applied, version bumped, certified with `--domain`, committed, compiled and pushed per `mattstack:editing-skills`; one real run of an opted-in pack's compiled stage-evidence on Matt's Chrome against a real case. The spec's exit run (a ticket-image pair whose redactions Matt confirms, then a revision in a fresh session) belongs here too. The report hands these over unless the shepherd keeps this lane for them.
- Known gap, not in M4: the console's run page shows a board once per image it covers; a pair appears under both slots.
