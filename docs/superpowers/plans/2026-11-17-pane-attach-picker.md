# rt pane attach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt pane attach [pane]` opens a picker over your Claude panes, enriched with mattstack data and the chat face, and attaches to the one you pick.

**Architecture:** The daemon's `pane:list` gains three optional joins (agent record, herd job, open gate) and a new `pane:attach-plan` verb that returns the exact herdr command for a pane on either server. The CLI gathers panes, faces and screen tails, sends rows with a new per-row `preview` to rt-ui's picker, then runs the returned command with inherited stdio. The Go picker gains a preview column that draws the face as a kitty image when the terminal answers the kitty query, and as half-blocks otherwise.

**Tech Stack:** Bun/TypeScript (CLI, daemon, rt-client), Go (rt-ui, Bubble Tea, lipgloss), herdr 0.9.5.

**Spec:** `docs/superpowers/specs/2026-11-17-pane-attach-picker-design.md`. Mock: `docs/design/pane-attach/pane-attach.pen`, frame **A · List + preview** (and **Face rendering**).

## Global Constraints

- Claude panes only, the set `pane:list` returns today; no change to its `agent === "claude"` filter.
- `rt pane list` off a terminal stays byte-identical (`commands/__tests__/fixtures/herd-pane-agent-bytes.json`; never regenerate it). `--json` only gains optional keys.
- The picker opens only when `process.stdin.isTTY && !json && !process.env.RT_BATCH`; otherwise a missing pane is the usage error.
- No UI code on the TS side (`lib/__tests__/no-ui-in-cli.test.ts`); all drawing in `ui/` (Go). All TS printing through `lib/ui/out.ts`; failures are `UserActionableError`.
- The picker's own pane (`HERDR_PANE_ID`, or its `bg:` ref) is never listed.
- Face: the handle's own tile (`ownTile(faceSeed(handle))`), 128 px PNG, drawn in a 16 × 8 cell box. Missing faces get at most about 1000 ms before the picker opens; the rest show the `?` tile.
- Agent-record match: session id first; pane id only for an unfinished record on the same server.
- Keys: ↵ attach · ctrl-t attach, taking over · ctrl-f just focus it · ↑↓ move · esc quit.
- Run tests from the worktree root (bunfig preload). Locally run only the targeted tests for touched files; CI runs the rest.

## Review Focus

1. **A pane with presence but no agent record, herd or gate** (a hand-started Claude): preview shows "started by hand" and "not in a herd", no empty sections, no crash. Test in Task 4.
2. **A stale agent record for a renumbered pane id** (finished, or other server): must not attach to the row. Test in Task 1.
3. **A handle whose face render hangs past the budget**: picker opens on time with `?`, and the face is cached afterwards. Test in Task 3.
4. **Only the picker's own pane exists**: falls through to the usage error / "No Claude panes to attach to", never an empty picker. Test in Task 4.
5. **A `bg:` pane picked while the bg server went down**: `pane:attach-plan` fails with a plain message, not a herdr dump. Test in Task 2.

---

### Task 0: Check nested `herdr agent attach` (manual, Matt)

Nothing in rt runs `herdr agent attach` yet; the spec makes it the first gate.

- [ ] **Step 1:** Add a Human Todos `terminal` item: from inside a herdr pane, run `herdr agent attach <another Claude pane id>`, detach, then repeat with `--takeover`. Ask what happened.
- [ ] **Step 2:** If herdr refuses or misbehaves nested, stop and bring it back to Matt (fallback ↵ = `pane:focus` changes the verb). Otherwise note the detach key in the plan's Task 5 copy and continue.

---

### Task 1: Daemon joins agent, herd and gate onto each pane

**Files:**
- Create: `lib/daemon/pane-extras.ts`
- Modify: `packages/rt-client/src/commands.ts` (`ChatPane`, ~line 405)
- Modify: `lib/daemon/handlers/pane.ts` (`createPaneHandlers` opts, `pane:list`)
- Modify: `lib/daemon/command-router.ts:194` (pass `herdStore`, `gatesStore`)
- Test: `lib/daemon/__tests__/pane-extras.test.ts`, `lib/daemon/__tests__/pane-handlers.test.ts`

**Interfaces:**
- Produces (rt-client, all optional on `ChatPane`):
  ```ts
  export interface ChatPaneAgent { id: string; provider: string; caller?: string; label?: string; model?: string; effort?: string; account?: string; startedAt: number }
  export interface ChatPaneHerd { herdId: string; job: string }
  export interface ChatPaneGate { id: string; question: string }
  // ChatPane gains: agent?: ChatPaneAgent; herd?: ChatPaneHerd; gate?: ChatPaneGate
  ```
- Produces (daemon): `paneExtras(pane: ChatPane, src: PaneExtrasSources): Pick<ChatPane, "agent" | "herd" | "gate">` with
  `interface PaneExtrasSources { agents: AgentRecord[]; jobsByPane: (ref: string) => HerdJobRow[]; openGates: GateRow[] }`.
  `pane.paneId` is already in ref form (`bg:` prefixed for background rows).

- [ ] **Step 1: Write the failing tests** in `pane-extras.test.ts`:
  - `agent matched by session id`: record `{sessionId:"s1", paneId:"w9-9"}`, pane `{sessionId:"s1", paneId:"w1-3"}` → `agent.id` set, `startedAt === record.createdAt`.
  - `pane-id fallback skips finished records`: record `{sessionId:"other", paneId:"w1-3", finishedAt: 5}` → no `agent`.
  - `pane-id fallback skips the other server`: record `{paneId:"w1-3", surface: <visible surface>}` vs pane `bg:w1-3` → no `agent`. (Read `AgentSurface` in `agents-store.ts` for the value that marks the bg server.)
  - `herd from jobsByPane`: `jobsByPane("w1-3")` returns `{herd:"h-7c1", name:"docs-sweep"}` → `herd` `{herdId:"h-7c1", job:"docs-sweep"}`.
  - `gate by origin.paneId, else pane`: an open gate with `origin.paneId:"w1-3"` and `questions[0].label:"Merge now or wait for CI?"` → `gate.question` is that label; a gate for another pane is ignored.
  - `empty sources` → `{}` (no keys at all).
- [ ] **Step 2:** Run `bun test lib/daemon/__tests__/pane-extras.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Implement `paneExtras` in `lib/daemon/pane-extras.ts`; add the three interfaces to `commands.ts`. Omit a key entirely when there is no match.
- [ ] **Step 4:** Wire into `pane:list`: `createPaneHandlers` takes optional `herdStore?: Pick<HerdStore, "jobsByPane">` and `gatesStore?: Pick<GatesStore, "list">`; build sources once per call (`listAgents({}, db)`, `gatesStore.list({ open: true }).gates`), spread `paneExtras` into each final row (after the `bg:` ref rewrite). Pass both stores from `command-router.ts`.
- [ ] **Step 5:** Add to `pane-handlers.test.ts`: `pane:list joins extras` (fake herd store and gate store, one visible and one bg pane, assert keys land on the right rows) and `pane:list without stores matches today` (no extra keys).
- [ ] **Step 6:** Run `bun test lib/daemon/__tests__/pane-extras.test.ts lib/daemon/__tests__/pane-handlers.test.ts commands/__tests__/herd-pane-agent-bytes.test.ts`; expect PASS, bytes fixture untouched.
- [ ] **Step 7:** Commit `pane:list joins agent, herd and gate onto each pane`.

---

### Task 2: `pane:attach-plan` returns the herdr command for a pane

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (catalog near line 1158, command list near line 1606; client fn in the rt-client exports alongside `paneFocus`)
- Modify: `lib/daemon/attend.ts` (extract the terminal-id lookup)
- Modify: `lib/daemon/handlers/pane.ts`
- Test: `lib/daemon/__tests__/pane-handlers.test.ts`, `lib/daemon/__tests__/attend.test.ts` if present

**Interfaces:**
- Produces: `"pane:attach-plan": { payload: { paneId: string; takeover?: boolean }; data: { argv: string[]; env: Record<string, string> } }` and rt-client `paneAttachPlan(payload, opts)`.
- Produces: `bgTerminalId(opts: { socket: string; paneId: string; herdrRunnerFor }): Promise<{ ok: true; termId: string } | { ok: false; error: string }>` in `attend.ts`, used by `attendPane` and the new handler.

- [ ] **Step 1: Write the failing tests:**
  - `visible pane`: `{paneId:"w1-3"}` → `argv` `["herdr","agent","attach","w1-3"]`, `env` `{}`; with `takeover:true` → `--takeover` appended.
  - `bg pane`: `{paneId:"bg:w1-3"}` with a fake runner answering `pane get` with `terminal_id:"t42"` → `argv` is the same `herdr terminal attach … t42` line `attendPane` builds (always `--takeover`, as attend does), `env` carries `HERDR_SOCKET_PATH` and `HERDR_SESSION` for the bg server.
  - `bg server down` (Review Focus 5): `bg.up()` false → `ok:false`, error `"The background herdr server isn't running"`.
- [ ] **Step 2:** Run the targeted tests; expect FAIL.
- [ ] **Step 3:** Extract `bgTerminalId` from `attendPane` (behavior unchanged; its existing tests stay green), implement the handler with `resolvePaneRef`, add the catalog entry, command-list entry and client function.
- [ ] **Step 4:** Run the targeted tests plus any `attend` tests; expect PASS.
- [ ] **Step 5:** Commit `pane:attach-plan: the herdr command that attaches to a pane`.

---

### Task 3: Face paths for handles, with a time budget

**Files:**
- Create: `lib/pane-faces.ts`
- Test: `lib/__tests__/pane-faces.test.ts`

**Interfaces:**
- Produces: `resolveFaces(handles: string[], opts?: { budgetMs?: number; size?: number; face?: (handle: string, size: number) => Promise<string> }): Promise<Map<string, string>>`. Defaults: `budgetMs` 1000, `size` 128, `face` = `chatFacePng(generatedFace(seed, ownTile(seed)).toString(), size)` with `seed = faceSeed(handle)` (same recipe as `commands/chat-avatar.ts` without `--alongside`; reuse its helper if one exists rather than re-deriving).

- [ ] **Step 1: Write the failing tests:**
  - `fast faces all land`: fake `face` resolving immediately for `["kirk","ada"]` → map has both paths.
  - `slow face is left out but keeps rendering` (Review Focus 3): fake for `"fred"` resolves after 50 ms with `budgetMs: 10` → map lacks `fred`; awaiting the fake's promise afterwards still resolves (no cancellation).
  - `a failing face is left out`: fake rejects for `"nadia"` → map lacks it, no throw.
  - `duplicates render once`.
- [ ] **Step 2:** Run `bun test lib/__tests__/pane-faces.test.ts`; expect FAIL.
- [ ] **Step 3:** Implement with `Promise.race` against a budget timer; never await stragglers.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `pane-faces: chat face paths for handles within a time budget`.

---

### Task 4: Picker row protocol and the `rt pane attach` verb

**Files:**
- Modify: `lib/ui/protocol.ts` (`PickRow`), `ui/internal/protocol/pick.go` (`PickRow`)
- Create: `commands/pane-attach.ts`
- Modify: `lib/command-tree-def.ts` (`pane` subcommands), `lib/module-registry.ts` (register `commands/pane-attach.ts`)
- Modify: `commands/pane.ts` (`paneRow` badge cell for the human table only)
- Test: `lib/ui/__tests__/protocol.test.ts`, `ui/internal/protocol/protocol_test.go`, `commands/__tests__/pane-attach.test.ts`, `commands/__tests__/pane.test.ts`

**Interfaces:**
- Produces (both TS and Go, same JSON):
  ```ts
  export interface PickPreview {
    face?: { path?: string; placeholder?: string }; // PNG path, or a glyph for the empty tile ("?")
    header: PickSegment[][];                          // lines beside the face
    sections: { title: string; rows: { key: string; value: PickSegment[] }[] }[];
    screen?: string[];                                // verbatim tail lines
  }
  // PickRow gains: preview?: PickPreview
  ```
  Go: `Preview *PickPreview \`json:"preview,omitempty"\`` with matching structs.
- Produces: `attachRows(panes: ChatPane[], faces: Map<string, string>, peeks: Map<string, string[]>, selfRef: string | undefined): PickRow[]` (pure), and the handler `paneAttach(args: string[]): Promise<void>`.
- Consumes: `paneExtras` fields (Task 1), `paneAttachPlan` (Task 2), `resolveFaces` (Task 3), `runPick` (`lib/ui/pick.ts`), `paneFocus`, `panePeek` (rt-client).

- [ ] **Step 1: Write the failing protocol tests:** a `PickRow` with a full `preview` round-trips TS → JSON → Go struct → JSON unchanged; a row without `preview` serializes with no `preview` key.
- [ ] **Step 2: Write the failing `attachRows` tests:**
  - groups: rows carry `group` = workspace label; every `bg:` row has group `"background"` and sorts last.
  - self excluded: the row whose `paneId === selfRef` is absent.
  - badge priority: gate > herd > caller > first room; badge text `"? gate"`, `"herd h-7c1"`, `"board:review"`, `"#mattstack"`.
  - not signed in: name segment `"not signed in"` with a faint tone, `preview.face.placeholder === "?"`, no `path`.
  - hand-started (Review Focus 1): no `agent` → STARTED BY section has one row `"started by hand"`; no `herd` → HERD row `"not in a herd"`; no `gate` → no GATE section.
  - preview header for a signed-in agent pane is four lines: handle (bold); status word plus presence (`"· live in chat"`); rooms (`"#a #b"`); `provider · model · effort` from `agent` (line omitted when there is no record).
  - WHERE rows: `repo` = `"repo · branch"`, `folder` = cwd, `herdr` = `"workspace › tab · pane <id>"`.
  - gate present: GATE section sits before HERD with the question text.
  - `match` contains handle, repo, branch, tab and rooms.
- [ ] **Step 3: Write the failing verb tests** (fake rt-client and spawn seams):
  - no pane, not a TTY → usage failure, title `"Which pane should rt attach to?"`, next `rt pane attach <pane>`, exit 2, nothing spawned.
  - only the self pane exists, at a TTY (Review Focus 4) → no picker opened; failure `"No Claude panes to attach to"`.
  - `rt pane attach w1-3` → spawns `pane:attach-plan`'s `argv` with its `env` merged over `childEnv()`, stdio inherited, exits with the child's code.
  - picker result `ctrl-t` → plan requested with `takeover: true`; `ctrl-f` → `paneFocus` called, nothing spawned.
- [ ] **Step 4:** Run `bun test lib/ui/__tests__/protocol.test.ts commands/__tests__/pane-attach.test.ts` and `go test ./ui/internal/protocol/...`; expect FAIL.
- [ ] **Step 5:** Add the protocol types (TS and Go).
- [ ] **Step 6:** Implement `attachRows` and `paneAttach` in `commands/pane-attach.ts`. Peeks: `panePeek({paneId, lines: 3})` for every row in parallel; a failed peek leaves `screen` unset. Picker request: `layout: "fullscreen"`, breadcrumb `["rt", "pane attach"]`, `idleCount` `"N agents · M waiting on you"`, actions `attach` (primary, ↵), `takeover` (`ctrl+t`), `focus` (`ctrl+f`).
- [ ] **Step 7:** Add the leaf `attach` under `pane` in `lib/command-tree-def.ts`: description `"Pick one of your Claude agents and jump into its terminal"`, `omitBehavior: "picker"`, positional `Pane` (optional) plus `--takeover`. Register the module. Run `bun run docs:gen` and `bun run picker:check`.
- [ ] **Step 8:** Add the badge cell to `paneRow` in `commands/pane.ts` (human table only; `renderPane` untouched) and a `pane.test.ts` case through `renderPlain`.
- [ ] **Step 9:** Run Step 4's commands plus `commands/__tests__/pane.test.ts`, `commands/__tests__/herd-pane-agent-bytes.test.ts`, `lib/__tests__/picker-conformance.test.ts`, `lib/__tests__/no-raw-output.test.ts`, `lib/__tests__/no-ui-in-cli.test.ts`; expect PASS.
- [ ] **Step 10:** Commit `rt pane attach: pick a Claude agent and attach to it`.

At this point the verb works end to end; rows show without a preview column (the Go picker ignores `preview` until Task 5).

---

### Task 5: Preview column and face drawing (built live with Matt)

UI work stays out of the subagent loop: built inline, look-tweak-look against frame **A · List + preview**, with Matt watching. Tests follow once the look settles.

**Files:**
- Modify: `ui/internal/views/picker/render.go`, `ui/internal/views/picker/picker.go`
- Create: `ui/internal/views/picker/preview.go`, `ui/internal/termimage/halfblock.go`, `ui/internal/termimage/kitty.go`
- Test: `ui/internal/termimage/halfblock_test.go`, `ui/internal/views/picker/render_test.go`

**Interfaces:**
- Produces: `termimage.HalfBlock(pngPath string, cols, rows int) (string, error)` (box-filter to `cols × 2·rows` pixels, `▀` with truecolor fg/bg); `termimage.KittySupported(timeout time.Duration) bool` (sends the kitty graphics query, caches the answer per process); `termimage.Kitty(pngPath string, cols, rows int) (string, error)`.

- [ ] **Step 1:** Draw the preview column from `PickRow.Preview` for the cursor row: face box (16 × 8), header lines, sections (dim title, faint key column, soft value), screen lines in a ruled box. Hide the column under 100 terminal columns.
- [ ] **Step 2:** Half-block faces first; then kitty when `KittySupported(≈150ms)` is true, keeping placement stable across redraws.
- [ ] **Step 3:** Matt's look in a herdr pane on Ghostty, kitty on and with `terminal.kitty_graphics = false`; screenshot both, say plainly what looks wrong, iterate.
- [ ] **Step 4:** Once settled: `halfblock_test.go` (a 2 × 2 PNG of known colors → expected escape string) and a `render_test.go` golden for a row with a preview at 140 columns and none at 90.
- [ ] **Step 5:** Run `go test ./ui/...`; expect PASS. Run the pty gate if `scripts/ci/test-scope.ts` lists picker paths in `GLITTER_TRIGGERS` (`bun run test:pty`).
- [ ] **Step 6:** Commit `rt-ui picker: preview column with chat faces`.

---

### Task 6: Docs and wrap-up

- [ ] **Step 1:** Update the docs site reference for `rt pane attach` (rt:docs skill) if `docs:gen` didn't cover it.
- [ ] **Step 2:** Push, open the PR, wait for CodeRabbit and CI per the repo's merge flow.
