# Settings defaults sweep, PR 1: registry and console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every registry key has a default or a `defaultNote`, except a shrink-only list of latched keys that later PRs retire, and the console shows each key's default and files unset keys in a neutral "Not set" block.

**Architecture:** `SettingDef` gains an optional `defaultNote` string that rides `SettingDefWire` to the console. Keys with no latch and no presence check get their real or empty `default` now; latched keys wait on a pending list in `registry-console-ready.test.ts`. The console's `subheadOf` returns `'unset'` for a key no store sets, and `KeyPanel`'s default line prints the note when there is no default.

**Tech Stack:** Bun + TypeScript (rt-client, settings-kit, rt), React + Mantine via `@mattstack/app-kit` (console), Vitest (console, board), `bun test` (rt, rt-client).

**Spec:** `docs/superpowers/specs/2026-10-10-settings-defaults-sweep-design.md`

## Global Constraints

- Work in the worktree `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/beorn`, branch `rt-487-settings-defaults`. Run `bun test` from the repo root (bunfig preload).
- No app drops its own fallback in this PR; behaviour with nothing set is unchanged.
- No new code tests a registered key with `.value === undefined` / `!== undefined`.
- A key on `PENDING_DEFAULT` never gets a `default` in this PR.
- `defaultNote` copy: one short plain sentence, ends with a period, no flags, no file paths, no store names (`rt:ui-copy`).
- No real org, team, repo or person names in code, tests or fixtures (public repo purity).
- After touching `packages/rt-client/src` or `packages/settings-kit/src`, run `bun run build` in that package before testing consumers (stale `dist/` footgun).
- Comments only state a constraint the code cannot show.
- Console UI follows `docs/apps/ui-authoring.md`; tokens by role, no raw colours.

## Review Focus

- A repoOnly key with a registry default (`rt.roles`, `rt.sync`, …) must not make `rt settings check` report a global value: the default is not a store value. Pinned in Task 2 by running `check` over empty stores.
- A key set only in repo sections stays in its store's block, never "Not set". Pinned in Task 4.
- A key with a default of `{}` or `[]` shows `0 fields` / `0 items` on its default line and stays in "Not set" until a store sets it. Pinned in Task 4.
- A key with both a default and a user value: the default line still shows the default in a popover, the user line opens the editor (shipped on main in d2d682ea8; Task 3 keeps it passing).
- The "Not set" block reads as its own surface in light and dark. Checked in Task 5's browser pass.

---

### Task 1: `defaultNote` on the registry and the wire

**Files:**
- Modify: `packages/rt-client/src/settings/registry-machinery.ts` (the `SettingDef` interface)
- Modify: `packages/settings-kit/src/server.ts` (`SettingDefWire`, `defToWire`)
- Test: `packages/settings-kit/src/__tests__/server.test.ts` (create if absent; else add to the existing `defToWire` test file — `rg -l defToWire packages/settings-kit/src/__tests__`)

**Interfaces:**
- Produces: `SettingDef.defaultNote?: string`; `SettingDefWire.defaultNote?: string` (present only when the def has one).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import type { SettingDef } from "@mattstack/rt-client";
import { defToWire } from "../server.ts";

const base: SettingDef = { key: "x.note", type: "string", scopes: ["user"], merge: "replace", description: "d" };
const effective = { scope: null, file: null } as never;

describe("defToWire defaultNote", () => {
  test("carries a def's defaultNote", () => {
    expect(defToWire({ ...base, defaultNote: "Push alerts are off." }, undefined, effective).defaultNote).toBe("Push alerts are off.");
  });
  test("leaves it out when the def has none", () => {
    expect("defaultNote" in defToWire(base, undefined, effective)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `bun test packages/settings-kit/src/__tests__/server.test.ts` (typecheck error or `undefined`).

- [ ] **Step 3: Implement**

In `registry-machinery.ts`, inside `SettingDef` after `default?: unknown;`:

```ts
  /** What a reader gets with nothing set, for a key with no `default`. */
  defaultNote?: string;
```

In `server.ts`, add to `SettingDefWire` after `defaultValue: unknown;`:

```ts
  defaultNote?: string;
```

and in `defToWire`, after the `wire` object literal:

```ts
  if (def.defaultNote !== undefined) wire.defaultNote = def.defaultNote;
```

- [ ] **Step 4: Build and pass** — `(cd packages/rt-client && bun run build) && (cd packages/settings-kit && bun run build) && bun test packages/settings-kit/src/__tests__/server.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add packages/rt-client/src/settings/registry-machinery.ts packages/settings-kit/src && git commit -m "rt-client: defaultNote on SettingDef and the wire"`

---

### Task 2: Defaults and notes in the registry, with the console-ready gate

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts`
- Modify: `packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts`
- Modify: `lib/daemon/system-process-scanner.ts` (export the three constants)
- Test: `lib/daemon/__tests__/system-process-scanner.test.ts`, `apps/board/src/__tests__/turn-setting.test.ts`

**Interfaces:**
- Consumes: `SettingDef.defaultNote` (Task 1).
- Produces: `RUNAWAY_DEFAULTS` exported from `lib/daemon/system-process-scanner.ts`.

- [ ] **Step 1: Write the failing gate**

Append to `registry-console-ready.test.ts` (keep the existing tests):

```ts
import { validateJson } from "../../index.ts";

/** Keys held for a legacy file or a presence check: each gets its default in
    the PR that retires the hold. Shrink only. */
const PENDING_DEFAULT: readonly string[] = [
  "board.botUsernames", "board.cwds", "board.defaultMember", "board.doctorSkill",
  "board.gateGraceMinutes", "board.hiddenMembers", "board.slack", "board.tabs",
  "board.title", "board.triage", "board.triage.doctorSkill", "board.triageMaxConcurrent",
  "board.workspaces", "claude.marketplaces", "claude.plugins", "deck.access",
  "deck.apps", "deck.platform", "gitq.forges", "gitq.workSlots", "mattstack.roster",
  "rt.branchNaming", "rt.hooks", "rt.sdmEnrichment", "sdm.carriers", "sdm.resources",
  "skills.writingStyle",
];

describe("every setting says what it is when nothing is set", () => {
  const defs = allDefs();
  test("every key has a default or a defaultNote", () => {
    const bare = defs.filter((d) => !("default" in d) && !d.defaultNote).map((d) => d.key);
    expect({ newWithout: bare.filter((k) => !PENDING_DEFAULT.includes(k)), note: ADD_A_KEY }).toEqual({ newWithout: [], note: ADD_A_KEY });
    expect(PENDING_DEFAULT.filter((k) => !bare.includes(k))).toEqual([]);
  });
  test("no key has both a default and a defaultNote", () => {
    expect(defs.filter((d) => "default" in d && d.defaultNote).map((d) => d.key)).toEqual([]);
  });
  test("every default passes its key's schema", () => {
    const bad = defs
      .filter((d) => "default" in d && d.schema)
      .map((d) => [d.key, validateJson(d.schema!, d.default)] as const)
      .filter(([, issues]) => issues.length > 0);
    expect(bad).toEqual([]);
  });
  test("a defaultNote is one short sentence", () => {
    const bad = defs.filter((d) => d.defaultNote && (!/^[A-Z].*\.$/.test(d.defaultNote) || d.defaultNote.length > 80 || /--|`|\//.test(d.defaultNote)));
    expect(bad.map((d) => [d.key, d.defaultNote])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `bun test packages/rt-client/src/settings/__tests__/registry-console-ready.test.ts`; `newWithout` lists the keys Step 3 fills.

- [ ] **Step 3: Add defaults and notes**

In `registry-defs.ts`, add these fields to the named rows (leave every other field alone). Where a block comment says the block carries no defaults, cut that sentence (keep the rest of the comment).

Defaults:

| Key | Add |
|---|---|
| rt.runaway | `default: { cpuThreshold: 80, sustainMs: 300000, graceMs: 120000 },` |
| agent.claude.yolo | `default: false,` |
| agent.codex.yolo | `default: false,` |
| board.turn | `default: { author: ["threads", "changesRequested", "conflicts", "rebase", "ciFailing", "readyToMerge"], reviewer: ["assigned", "approvalReset", "repliedThreads"] },` |
| board.codeowners | `default: { slack: { fromSectionName: false } },` |
| boxscore.sizeBand | `default: { tooSmall: 10, tooLarge: 400 },` |
| boxscore.defaultRange | `default: "30d",` |
| rt.roles, rt.workspacePrefs, rt.repoTracking, rt.variations, rt.presets, mattstack.integrations, mattstack.tracking, mattstack.directory, boxscore.roles | `default: {},` |
| rt.intercepts, board.peerAsksAlwaysAllow, boxscore.linearDoneStates, boxscore.excludeFilePatterns, boxscore.ignoredMrs, boxscore.botPatterns, boxscore.hiddenMembers | `default: [],` |
| rt.ignoredMrs | `default: { targetBranches: [], authors: [] },` |
| rt.cron | `default: { triggers: [] },` |
| rt.sync | `default: { autoResolve: [] },` |
| mattstack.org | `default: { admins: [], teams: {} },` |

Notes:

| Key | `defaultNote:` |
|---|---|
| rt.worktreeReadyApproval | `"Nobody has approved a ladder yet."` |
| rt.repoIdentityOverrides | `"No overrides, so repo names come from the remote."` |
| rt.dopplerTemplate | `"No template, so Doppler sync skips this repo."` |
| rt.daemonPath | `"Your login shell's PATH."` |
| mattstack.appPath | `"Found in Applications or your home Applications folder."` |
| rt.integrations | `"No forge host confirmed yet."` |
| mattstack.activeTeam | `"Your first team on the roster."` |
| chat.handle | `"Taken from the pane title, the repo, or this Mac."` |
| chat.push.provider | `"Push alerts are off."` |
| chat.push.target | `"Push alerts are off."` |
| agent.claude.model, agent.claude.effort, agent.claude.extraArgs | `"Left out, so Claude uses its own."` |
| agent.claude.account | `"Your default Claude profile."` |
| agent.codex.model, agent.codex.effort, agent.codex.extraArgs | `"Left out, so Codex uses its own."` |
| board.agent.account | `"Your default Claude profile."` |
| board.agent.model, board.agent.effort | `"Left out, so Claude uses its own."` |
| board.gitlabHost | `"Required: the team's GitLab host."` |
| board.projects | `"Required: the projects the board tracks."` |
| board.ticketPrefixes | `"The active team's Linear key."` |
| board.staleAfterDays | `"Each project's MR sync window."` |
| boxscore.projects | `"Required: the projects boxscore scores."` |
| gitq.board | `"Set up by rt setup with the repos it finds."` |

If the gate then names a key not in either table and not pending (for example `agent.provider` or another key with neither field), read its reader, classify it by the spec's four kinds, and add the default or note; list it in the PR description.

- [ ] **Step 4: Pin the parser-backed defaults**

In `lib/daemon/system-process-scanner.ts`, replace the three `const DEFAULT_*` lines with:

```ts
export const RUNAWAY_DEFAULTS = { cpuThreshold: 80, sustainMs: 5 * 60 * 1000, graceMs: 2 * 60 * 1000 } as const;
const DEFAULT_CPU_THRESHOLD = RUNAWAY_DEFAULTS.cpuThreshold;
const DEFAULT_SUSTAIN_MS = RUNAWAY_DEFAULTS.sustainMs;
const DEFAULT_GRACE_MS = RUNAWAY_DEFAULTS.graceMs;
```

Add to `lib/daemon/__tests__/system-process-scanner.test.ts`:

```ts
import { getDef } from "@mattstack/rt-client";
import { RUNAWAY_DEFAULTS } from "../system-process-scanner.ts";

test("rt.runaway's registry default is the scanner's own", () => {
  expect(getDef("rt.runaway")!.default).toEqual({ ...RUNAWAY_DEFAULTS });
});
```

Add to `apps/board/src/__tests__/turn-setting.test.ts`:

```ts
import { getDef } from '@mattstack/rt-client';
import { ALL_TURN } from '../turn.ts';

it("board.turn's registry default is every signal", () => {
  expect(getDef('board.turn')!.default).toEqual(ALL_TURN);
});
```

(Match each file's existing import style and test runner: board uses Vitest `it`, rt uses `bun:test` `test`.)

- [ ] **Step 5: Regenerate and check**

```bash
(cd packages/rt-client && bun run build)
bun run cli.ts settings schema lock
bun test packages/rt-client/src/settings/__tests__/
bun test lib/daemon/__tests__/system-process-scanner.test.ts
bun run board:test -- turn-setting
env -i HOME="$(mktemp -d)" PATH="$PATH" bun cli.ts settings check --json
```

Expected: all PASS; the isolated `check` prints `{"ok":true,"findings":[]}` (a default is not a store value, so repoOnly keys raise nothing). Then `bun run docs:check`; if it reports a stale settings reference, run `bun run docs:gen` and include the result.

- [ ] **Step 6: Run the suites that read these keys**

```bash
bun test lib/__tests__ lib/daemon/__tests__ lib/setup commands/__tests__ --bail 2>&1 | tail -30
bun run boxscore:test && bun run board:test && bun run console:test
```

Expected: PASS. A failure that asserts a key has no default or resolves `undefined` is updated to the registry default; anything else stops the task and is reported.

- [ ] **Step 7: Commit** — `git add -A packages/rt-client lib/daemon apps/board/src/__tests__ && git commit -m "registry: defaults and defaultNotes for every unlatched key"`

---

### Task 3: Console default line shows the note

**Files:**
- Modify: `apps/console/src/app/settings/KeyPanel.tsx` (`LayerValue`)
- Test: `apps/console/src/app/settings/KeyPanel.test.tsx`

**Interfaces:**
- Consumes: `SettingDefWire.defaultNote` (Task 1).

- [ ] **Step 1: Write the failing test** (inside the existing `describe` that uses `renderPanel` and `pool`; reuse those helpers — `pool(merge, defaultValue)` builds a def, so pass a def without a default the way neighbouring tests do, then set `defaultNote`):

```tsx
it('shows the default note on an empty default line', async () => {
  const def = { ...pool('replace', undefined), hasDefault: false, defaultValue: null, defaultNote: 'Push alerts are off.' };
  renderPanel(def, [
    { scope: 'default', file: null, present: false },
    { scope: 'user', file: '/stores/user.jsonc', present: false },
  ]);
  expect(await screen.findByTestId('layer-value-default')).toHaveTextContent('Push alerts are off.');
});
```

If `pool`'s signature does not accept `undefined`, build the def inline from the same fixture `pool` returns and override `hasDefault`, `defaultValue` and `defaultNote`.

- [ ] **Step 2: Run, expect FAIL** — `cd apps/console && npx vitest run src/app/settings/KeyPanel.test.tsx -t "default note"` (finds no test id, or text "not set").

- [ ] **Step 3: Implement** — in `LayerValue`, replace the `!row.present` branch:

```tsx
  if (!row.present)
    return (
      <Text
        fz={13}
        lh="17px"
        c={text.muted}
        data-testid={`layer-value-${row.scope}`}
      >
        {row.scope === 'default' && def.defaultNote ? def.defaultNote : 'not set'}
      </Text>
    );
```

- [ ] **Step 4: Pass** — rerun Step 2's command, then the whole file: PASS.

- [ ] **Step 5: Commit** — `git add apps/console/src/app/settings/KeyPanel.tsx apps/console/src/app/settings/KeyPanel.test.tsx && git commit -m "console: default line prints the key's default note"`

---

### Task 4: "Not set" block

**Files:**
- Modify: `apps/console/src/app/settings/view.ts` (`SUB_ORDER`, `Subsection`, `subheadOf`, `buildSections`)
- Modify: `apps/console/src/app/settings/SettingsSection.tsx` (`ScopeBlock`, both section renderers)
- Modify: `apps/console/src/app/settings/SettingsSection.module.css`
- Test: `apps/console/src/app/settings/view.test.ts`

**Interfaces:**
- Produces: `type SubheadScope = StoreScope | 'unset'`; `Subsection.scope: SubheadScope`.

- [ ] **Step 1: Write the failing tests** (in `view.test.ts`, reusing its `def()` helper and `NO_FILTER`):

```ts
it('files a key no store sets under Not set', () => {
  const defs = [
    def('board.onDefault', { scopes: ['user', 'team'], effective: { scope: 'default', file: null, value: [] } }),
    def('board.nothing', { scopes: ['user'], effective: { scope: null, file: null, value: undefined } }),
    def('board.mine', { scopes: ['user'], effective: { scope: 'user', file: '/u', value: 1 } }),
  ];
  const board = buildSections(defs, NO_FILTER)[0]!;
  expect(board.subsections.map(s => [s.scope, s.defs.map(d => d.key).sort()])).toEqual([
    ['user', ['board.mine']],
    ['unset', ['board.nothing', 'board.onDefault']],
  ]);
});

it('keeps a key set only in repo sections with its store', () => {
  const d = def('board.perRepo', {
    type: 'object',
    scopes: ['user', 'team'],
    repoScoped: true,
    effective: { scope: 'default', file: null, value: {} },
    repos: [{ identity: 'h/r0', scopes: ['team'] }],
  });
  expect(buildSections([d], NO_FILTER)[0]!.subsections.map(s => s.scope)).toEqual(['team']);
});
```

Update the existing test "puts a per-project key with no global value with the store its repo sections live in": `where(false, 'board.none')` and `where(true, ...)` for a key with no repo sections now expect `'unset'`; `board.mixed` keeps `'user'` / `'org'`.

- [ ] **Step 2: Run, expect FAIL** — `cd apps/console && npx vitest run src/app/settings/view.test.ts`.

- [ ] **Step 3: Implement `view.ts`**

```ts
export type SubheadScope = StoreScope | 'unset';

const SUB_ORDER: SubheadScope[] = ['org', 'team', 'user', 'machine', 'unset'];

export interface Subsection {
  scope: SubheadScope;
  defs: SettingDefWire[];
}
```

In `subheadOf` (return type `SubheadScope`), replace the final line

```ts
  return sharedOnly ? def.scopes.find(isShared) : def.scopes[0];
```

with

```ts
  // A stray value (a store the key does not allow) is still set somewhere,
  // so only a key no store holds at all is Not set.
  if (served === null && stores.size === 0 && !(def.repos ?? []).length)
    return 'unset';
  return sharedOnly ? def.scopes.find(isShared) : def.scopes[0];
```

(`rungBase('default')` and `rungBase(null)` are `null`, so `served === null` means the value comes from the default or nothing.) Add one more case to Step 1's first test: a def with `effective: { scope: 'machine', … }` and `scopes: ['user']` (a stray machine value) lands under `'user'`, not `'unset'`.

and update the doc comment above `subheadOf` to: "A key sits under the layer its value comes from, so its block and its row say the same thing; a key no store sets sits under Not set."

`buildSections`' filter comparison `(f.scope === 'any' ? subheadOf(d, sharedOnly) : f.scope) === scope` stays; with a scope picked, only keys set there pass the filter, so no `'unset'` subsection appears.

- [ ] **Step 4: Implement the block**

In `SettingsSection.tsx`, change `ScopeBlock` to take `scope: SubheadScope`:

```tsx
function ScopeBlock({ scope, children }: { scope: SubheadScope; children: ReactNode }) {
  return (
    <Box
      className={classes.block}
      data-scope={scope}
      __vars={scope === 'unset' ? undefined : { '--block-hue': `var(--tk-fill-${SCOPE_COLOR[scope]})` }}
    >
      <Group gap={8} wrap="nowrap" className={classes.head}>
        {scope === 'unset' ? (
          <Text fz={13} fw={600} c="var(--tk-text-1)">Not set</Text>
        ) : (
          <ScopeBadge scope={scope} />
        )}
      </Group>
      {children}
    </Box>
  );
}
```

Both renderers pass `subhead={sub.scope === 'unset' ? null : sub.scope}` to `SettingRow` (its prop is already `StoreScope | null`), and `AgentsSection`'s `row` helper takes `scope: SubheadScope` and does the same. Import `SubheadScope` from `./view`.

In `SettingsSection.module.css`, after the `.head` rule:

```css
/* Not set has no layer, so it takes the page's card surface instead of a
   scope's wash. */
.block[data-scope='unset'] {
  background: var(--tk-card);
}

.block[data-scope='unset'] .head {
  background: var(--tk-panel);
}
```

- [ ] **Step 5: Pass** — `cd apps/console && npx vitest run src/app/settings/ && npx tsc -p tsconfig.json --noEmit && npx eslint src/app/settings && npx prettier --check src/app/settings`. Fix any `SettingsSection.test`/`SettingsPage.test` expectation that assumed an unset key under its first scope.

- [ ] **Step 6: Commit** — `git add apps/console/src/app/settings && git commit -m "console: unset keys go in a Not set block"`

---

### Task 5: Verify in the browser and open the PR

**Files:** none new.

- [ ] **Step 1: Run the console against this worktree** — `cd apps/console && PORT=11091 bun --watch src/server/index.ts &` plus `bun x vite --port 11092 --strictPort` (match `mattstack.deck.json`'s `live` commands; ports outside deck's range), or `deck live console on --worktree <this path>` if Matt prefers his live entry; ask before switching his live console.

- [ ] **Step 2: Fast Browser pass** — delegate to `fast-browser:browser-driver`: open `/settings`, screenshot the Board section in light and dark, open `board.peerAsks` → Where it's set (default popover), `chat.push.provider` → Where it's set (note text), and confirm the "Not set" block heads each section's unset keys. Report anything that reads wrong.

- [ ] **Step 3: Full gates for touched areas**

```bash
bun run check 2>&1 | tail -20
bun test packages/rt-client packages/settings-kit lib/daemon/__tests__/system-process-scanner.test.ts
```

- [ ] **Step 4: Push and open the PR** — title `RT-487: settings defaults, part 1 (registry and console)`; body follows the repo's PR template, lists the defaults and notes added and the 27 pending keys and which later PR takes each. Then follow the CodeRabbit + CI rule before asking Matt to merge.
