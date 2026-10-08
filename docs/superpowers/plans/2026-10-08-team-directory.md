# Team Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an org-level `mattstack.directory` setting that names each team's Linear key and Slack channels. The board reads it to route code owner requests and to find the team's review channel; setup reads it for the Linear key.

**Architecture:** A new registry key with a zod schema, and pure helpers in `packages/rt-client/src/settings/team-directory.ts` that every reader shares. The settings write gate refuses a directory where two teams claim one code owners channel, and posts a notice for a channel kind no app reads. Every reader falls back to the key it replaces, so an org with no directory behaves exactly as today.

**Tech Stack:** Bun, TypeScript, zod (authoring only), bun:test.

**Spec:** `docs/superpowers/specs/2026-10-08-team-directory-design.md`

## Global Constraints

- `mattstack.directory`: `scopes: ["org"]`, `merge: "replace"`, no `default`.
- No `board.*` registry row carries a `default`. Fallbacks live in the app-side read (`getSetting(k).value ?? fallback`).
- Channel names are bare (no `#`). Matching is case-insensitive, and a leading `#` is ignored.
- The board reads a missing `board.slack.reviewKind` as `"review"`.
- Known channel kinds, the list the unknown-kind notice checks: `["review"]`.
- Every new read falls back to the key it replaces: `board.slack.channel`, a codeowners tab's own `slackChannel`, `board.ticketPrefixes`, the codeowners tab "ours" inference, and `mattstack.integrations.linear.teamKey`.
- Run `bun test` from the repo root (rt-client and lib), or from `apps/board` (board). bunfig only loads from the cwd.
- After any change under `packages/rt-client/src`, run `cd packages/rt-client && bun run build`; the board resolves rt-client's `dist/`.
- Comments state only constraints the code cannot show.
- Commit after each task. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **A directory entry for my team with no channel of the review kind.** The board keeps `board.slack.channel` and does not crash. Covered in Task 4.
- **A code owners channel written with `#` or different case** (`#Pod-Acme`). It still matches. Covered in Task 2.
- **`teamView.team()` is null** (a Mac on no team). There is no directory entry, and everything falls back. Covered in Task 4.
- **A codeowners tab with its own `slackChannel` set.** The set value wins over the directory. Covered in Task 4.
- **A directory with duplicate code owners channels already on disk** (written by hand). Readers take the first entry in key order, and only a new write is refused. Covered in Task 2.

---

### Task 1: Register `mattstack.directory` and `board.slack.reviewKind`

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (the `// --- mattstack (shared team truth)` block, after `mattstack.org`)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts` (beside `"mattstack.org"`, and `"board.slack"`)
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts`
- Regenerate: `packages/rt-client/src/settings/schema.lock.json`

**Interfaces:**
- Produces: the type `Value<"mattstack.directory">`, which has the shape
  `{ teams?: Record<string, { linear?: { team?: string }; slack?: { codeOwnersChannel?: string; channels?: Array<{ name: string; kind: string }> } }> }`.
- Produces: `Value<"board.slack">` with a new optional `reviewKind?: string`.

- [ ] **Step 1: Add the examples (the failing test).** In `schema-examples.ts`, add this entry next to `"mattstack.org"`:

```ts
  "mattstack.directory": {
    good: [
      {},
      { teams: {} },
      {
        teams: {
          widgets: {
            linear: { team: "WID" },
            slack: {
              codeOwnersChannel: "pod-widgets",
              channels: [{ name: "widgets-internal", kind: "review" }],
            },
          },
          gadgets: { slack: { codeOwnersChannel: "pod-gadgets" } },
        },
      },
    ],
    bad: [
      { value: { teams: { widgets: { slack: { channels: [{ name: "widgets-internal" }] } } } }, path: ["teams", "widgets", "slack", "channels", 0, "kind"] },
      { value: { teams: { widgets: { slack: { codeOwnersChannel: 4 } } } }, path: ["teams", "widgets", "slack", "codeOwnersChannel"] },
    ],
  },
```

Then find the `"board.slack"` entry and add `{ channel: "code-review", reviewKind: "review" }` to its `good` list.

- [ ] **Step 2: Run the examples to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples`
Expected: FAIL. `mattstack.directory` has no schema or registry row.

- [ ] **Step 3: Add the registry row.** In `registry-defs.ts`, after the `mattstack.org` row:

```ts
  {
    key: "mattstack.directory",
    type: "object",
    scopes: ["org"],
    merge: "replace",
    description:
      "Every team the apps should know about, on mattstack or not: each team's Linear key and Slack channels (the channel other teams ask it in for code owner review, plus channels by kind). Keyed by team name; a name matching a team folder is that mattstack team.",
  },
```

- [ ] **Step 4: Add the schemas.** In `registry-schemas.ts`, after `"mattstack.org"`:

```ts
  "mattstack.directory": z.looseObject({
    teams: z
      .record(
        z.string(),
        z.looseObject({
          linear: z.looseObject({ team: z.string().min(1).optional() }).optional(),
          slack: z
            .looseObject({
              codeOwnersChannel: z.string().min(1).optional(),
              channels: z.array(z.looseObject({ name: z.string().min(1), kind: z.string().min(1) })).optional(),
            })
            .optional(),
        }),
      )
      .optional(),
  }),
```

In `"board.slack"`, add `reviewKind: z.string().optional(),` after `channel`.

- [ ] **Step 5: Regenerate the lock**

Run: `bun run cli.ts settings schema lock`
Expected: `schema.lock.json` gains `mattstack.directory`, and `board.slack` gains `reviewKind`.

- [ ] **Step 6: Run the settings tests**

Run: `bun test packages/rt-client/src/settings/__tests__/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/settings/registry-schemas.ts packages/rt-client/src/settings/__tests__/schema-examples.ts packages/rt-client/src/settings/schema.lock.json
git commit -m "settings: register mattstack.directory and board.slack.reviewKind"
```

---

### Task 2: Directory helpers in rt-client

**Files:**
- Create: `packages/rt-client/src/settings/team-directory.ts`
- Create: `packages/rt-client/src/settings/__tests__/team-directory.test.ts`
- Modify: `packages/rt-client/src/index.ts` (export beside the `active-team.ts` exports)

**Interfaces:**
- Consumes: `Value<"mattstack.directory">` (Task 1), `getSetting` (`./resolve.ts`), `activeTeam` (`./active-team.ts`).
- Produces:

```ts
export type TeamDirectory = Value<"mattstack.directory">;
export type DirectoryTeam = NonNullable<TeamDirectory["teams"]>[string];
export const KNOWN_CHANNEL_KINDS: readonly string[]; // ["review"]
export function normalizeChannel(channel: string): string;
export function directoryEntry(dir: TeamDirectory | undefined, team: string | null): DirectoryTeam | null;
export function teamForChannel(dir: TeamDirectory | undefined, channel: string): { name: string; entry: DirectoryTeam } | null;
export function channelsOfKind(entry: DirectoryTeam, kind: string): string[];
export function teamChannels(entry: DirectoryTeam): string[];
export function directoryIssues(dir: TeamDirectory | undefined): {
  duplicates: Array<{ channel: string; teams: string[] }>;
  unknownKinds: Array<{ team: string; channel: string; kind: string }>;
};
export function myDirectoryTeam(): DirectoryTeam | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/rt-client/src/settings/__tests__/team-directory.test.ts
import { describe, expect, test } from "bun:test";
import {
  channelsOfKind,
  directoryEntry,
  directoryIssues,
  normalizeChannel,
  teamChannels,
  teamForChannel,
  type TeamDirectory,
} from "../team-directory.ts";

const DIR: TeamDirectory = {
  teams: {
    widgets: {
      linear: { team: "WID" },
      slack: {
        codeOwnersChannel: "pod-widgets",
        channels: [
          { name: "widgets-internal", kind: "review" },
          { name: "widgets-alerts", kind: "oncall" },
        ],
      },
    },
    gadgets: { slack: { codeOwnersChannel: "pod-gadgets" } },
  },
};

describe("normalizeChannel", () => {
  test("drops a leading # and lowercases", () => {
    expect(normalizeChannel("#Pod-Widgets")).toBe("pod-widgets");
  });
});

describe("directoryEntry", () => {
  test("finds the entry for a team name", () => {
    expect(directoryEntry(DIR, "widgets")?.linear?.team).toBe("WID");
  });
  test("no team, no directory or an unlisted team is null", () => {
    expect(directoryEntry(DIR, null)).toBeNull();
    expect(directoryEntry(undefined, "widgets")).toBeNull();
    expect(directoryEntry(DIR, "sprockets")).toBeNull();
  });
});

describe("teamForChannel", () => {
  test("matches a team by its code owners channel, ignoring # and case", () => {
    expect(teamForChannel(DIR, "#POD-gadgets")?.name).toBe("gadgets");
  });
  test("a team's other channels do not claim a section", () => {
    expect(teamForChannel(DIR, "widgets-internal")).toBeNull();
  });
  test("an unknown channel or no directory is null", () => {
    expect(teamForChannel(DIR, "pod-other")).toBeNull();
    expect(teamForChannel(undefined, "pod-widgets")).toBeNull();
  });
  test("with two teams on one channel already on disk, the first by key wins", () => {
    const dup: TeamDirectory = {
      teams: { b: { slack: { codeOwnersChannel: "x" } }, a: { slack: { codeOwnersChannel: "X" } } },
    };
    expect(teamForChannel(dup, "x")?.name).toBe("b");
  });
});

describe("channelsOfKind and teamChannels", () => {
  const widgets = DIR.teams!.widgets!;
  test("channelsOfKind returns the names of that kind, in order", () => {
    expect(channelsOfKind(widgets, "review")).toEqual(["widgets-internal"]);
    expect(channelsOfKind(widgets, "missing")).toEqual([]);
  });
  test("teamChannels lists the code owners channel and every other channel, normalized", () => {
    expect(teamChannels(widgets)).toEqual(["pod-widgets", "widgets-internal", "widgets-alerts"]);
  });
});

describe("directoryIssues", () => {
  test("names a code owners channel claimed twice and every kind no app reads", () => {
    const dup: TeamDirectory = {
      teams: {
        a: { slack: { codeOwnersChannel: "Shared", channels: [{ name: "a-x", kind: "reveiw" }] } },
        b: { slack: { codeOwnersChannel: "#shared" } },
      },
    };
    expect(directoryIssues(dup)).toEqual({
      duplicates: [{ channel: "shared", teams: ["a", "b"] }],
      unknownKinds: [{ team: "a", channel: "a-x", kind: "reveiw" }],
    });
  });
  test("a clean directory has no issues", () => {
    expect(directoryIssues({ teams: { a: { slack: { channels: [{ name: "a", kind: "review" }] } } } })).toEqual({
      duplicates: [],
      unknownKinds: [],
    });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/team-directory.test.ts`
Expected: FAIL, "Cannot find module '../team-directory.ts'".

- [ ] **Step 3: Implement**

```ts
// packages/rt-client/src/settings/team-directory.ts
/**
 * The org's team directory (`mattstack.directory`): pure reads every app
 * shares, so "which team owns this channel" has one answer.
 */

import { activeTeam } from "./active-team.ts";
import type { Value } from "./registry-schemas.ts";
import { getSetting } from "./resolve.ts";

export type TeamDirectory = Value<"mattstack.directory">;
export type DirectoryTeam = NonNullable<TeamDirectory["teams"]>[string];

/** Channel kinds some app reads; any other kind is legal but draws a notice on write. */
export const KNOWN_CHANNEL_KINDS: readonly string[] = ["review"];

export function normalizeChannel(channel: string): string {
  return channel.trim().replace(/^#/, "").toLowerCase();
}

export function directoryEntry(dir: TeamDirectory | undefined, team: string | null): DirectoryTeam | null {
  if (!team) return null;
  return dir?.teams?.[team] ?? null;
}

export function teamForChannel(dir: TeamDirectory | undefined, channel: string): { name: string; entry: DirectoryTeam } | null {
  const want = normalizeChannel(channel);
  for (const [name, entry] of Object.entries(dir?.teams ?? {})) {
    const own = entry.slack?.codeOwnersChannel;
    if (own && normalizeChannel(own) === want) return { name, entry };
  }
  return null;
}

export function channelsOfKind(entry: DirectoryTeam, kind: string): string[] {
  return (entry.slack?.channels ?? []).filter((c) => c.kind === kind).map((c) => normalizeChannel(c.name));
}

export function teamChannels(entry: DirectoryTeam): string[] {
  const own = entry.slack?.codeOwnersChannel;
  return [...(own ? [own] : []), ...(entry.slack?.channels ?? []).map((c) => c.name)].map(normalizeChannel);
}

export function directoryIssues(dir: TeamDirectory | undefined): {
  duplicates: Array<{ channel: string; teams: string[] }>;
  unknownKinds: Array<{ team: string; channel: string; kind: string }>;
} {
  const byChannel = new Map<string, string[]>();
  const unknownKinds: Array<{ team: string; channel: string; kind: string }> = [];
  for (const [team, entry] of Object.entries(dir?.teams ?? {})) {
    const own = entry.slack?.codeOwnersChannel;
    if (own) {
      const key = normalizeChannel(own);
      byChannel.set(key, [...(byChannel.get(key) ?? []), team]);
    }
    for (const c of entry.slack?.channels ?? []) {
      if (!KNOWN_CHANNEL_KINDS.includes(c.kind)) unknownKinds.push({ team, channel: c.name, kind: c.kind });
    }
  }
  const duplicates = [...byChannel].filter(([, teams]) => teams.length > 1).map(([channel, teams]) => ({ channel, teams }));
  return { duplicates, unknownKinds };
}

/** The active team's directory entry, or null on no team, no directory or no entry. */
export function myDirectoryTeam(): DirectoryTeam | null {
  return directoryEntry(getSetting<TeamDirectory>("mattstack.directory").value, activeTeam().team);
}
```

In `packages/rt-client/src/index.ts`, after the `active-team.ts` export line, add:

```ts
export {
  KNOWN_CHANNEL_KINDS,
  channelsOfKind,
  directoryEntry,
  directoryIssues,
  myDirectoryTeam,
  normalizeChannel,
  teamChannels,
  teamForChannel,
  type DirectoryTeam,
  type TeamDirectory,
} from "./settings/team-directory.ts";
```

- [ ] **Step 4: Run the tests and build**

Run: `bun test packages/rt-client/src/settings/__tests__/team-directory.test.ts`
Expected: PASS.

Run: `cd packages/rt-client && bun run build && cd -`
Expected: the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/settings/team-directory.ts packages/rt-client/src/settings/__tests__/team-directory.test.ts packages/rt-client/src/index.ts
git commit -m "rt-client: team directory reads"
```

---

### Task 3: Write gate for the directory

**Files:**
- Modify: `packages/rt-client/src/settings/validate-write.ts`
- Modify: `packages/rt-client/src/settings/write.ts` (inside `setSetting`, after `writeIntoStore(...)` returns)
- Test: `packages/rt-client/src/settings/__tests__/team-directory-write.test.ts`

**Interfaces:**
- Consumes: `directoryIssues` (Task 2), and the existing `validateWrite(def, value, opts)`, `getDef(key)` and `setSettingsNoticeSink(sink)`.
- Produces: a `validateWrite` refusal (`kind: "schema"`) when two teams claim one code owners channel, and a notice after a successful write for each unknown kind.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/rt-client/src/settings/__tests__/team-directory-write.test.ts
import { describe, expect, test } from "bun:test";
import { getDef } from "../registry-machinery.ts";
import { validateWrite } from "../validate-write.ts";

const def = getDef("mattstack.directory")!;

describe("validateWrite: mattstack.directory", () => {
  test("refuses two teams on one code owners channel, naming both", () => {
    const verdict = validateWrite(
      def,
      { teams: { a: { slack: { codeOwnersChannel: "shared" } }, b: { slack: { codeOwnersChannel: "#Shared" } } } },
      { scope: "org" },
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("two teams claim #shared as their code owners channel: a, b");
  });

  test("accepts a kind no app reads; only the notice mentions it", () => {
    const verdict = validateWrite(
      def,
      { teams: { a: { slack: { channels: [{ name: "a-x", kind: "oncall" }] } } } },
      { scope: "org" },
    );
    expect(verdict.ok).toBe(true);
  });
});
```

For the notice, find the existing `setSetting` test that writes an org-scope value into a temp HOME and captures notices through `setSettingsNoticeSink`; `grep -rln "setSettingsNoticeSink" packages/rt-client/src/settings/__tests__` finds it. Add a case alongside it:

```ts
test("a directory write names each channel kind no app reads", () => {
  // Same temp-HOME org setup as the neighbouring org-scope write test in this file.
  const lines: string[] = [];
  const prev = setSettingsNoticeSink((line) => lines.push(line));
  try {
    setSetting("mattstack.directory", { teams: { a: { slack: { channels: [{ name: "a-x", kind: "oncall" }] } } } }, "org");
  } finally {
    setSettingsNoticeSink(prev);
  }
  expect(lines).toContain('#a-x on a has kind "oncall", which no app reads yet.');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/team-directory-write.test.ts`
Expected: FAIL. The duplicate passes the schema, so the verdict is ok.

- [ ] **Step 3: Implement the refusal.** In `validate-write.ts`, import `directoryIssues` from `./team-directory.ts`. Right after the layer-schema check (`if (layerIssues.length > 0) return ...`), add:

```ts
  const semantic = SEMANTIC_CHECKS[def.key]?.(value);
  if (semantic) return { ok: false, kind: "schema", reason: semantic, issues: [] };
```

At module level, below `validateWrite`:

```ts
/** Rules a JSON Schema cannot state, such as uniqueness across a record. */
const SEMANTIC_CHECKS: Record<string, (value: unknown) => string | null> = {
  "mattstack.directory": (value) => {
    const dup = directoryIssues(value as never).duplicates[0];
    return dup ? `two teams claim #${dup.channel} as their code owners channel: ${dup.teams.join(", ")}` : null;
  },
};
```

- [ ] **Step 4: Implement the notice.** In `write.ts`, import `directoryIssues` from `./team-directory.ts`. In `setSetting`, right after the `writeIntoStore(...)` call returns, add:

```ts
  if (key === "mattstack.directory") {
    for (const u of directoryIssues(value as never).unknownKinds)
      notify({ text: `#${u.channel} on ${u.team} has kind "${u.kind}", which no app reads yet.` });
  }
```

- [ ] **Step 5: Run the tests and build**

Run: `bun test packages/rt-client/src/settings/__tests__/`
Expected: PASS.

Run: `cd packages/rt-client && bun run build && cd -`
Expected: the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client/src/settings/validate-write.ts packages/rt-client/src/settings/write.ts packages/rt-client/src/settings/__tests__/
git commit -m "settings: refuse a shared code owners channel, note unknown channel kinds"
```

---

### Task 4: Board config reads the directory

**Files:**
- Modify: `apps/board/src/config.ts`:
  - `BoardConfig` gets `ownChannels?: string[]`.
  - `withBoardStoreFallback` gets the overlay below.
  - The `SlackConfig` doc comment notes the `reviewKind` read.
- Test: `apps/board/src/__tests__/config-store-latch.test.ts` (new `describe` block)

**Interfaces:**
- Consumes: `directoryEntry`, `channelsOfKind`, `teamChannels` and `TeamDirectory` from `@mattstack/rt-client` (Task 2). Also the existing `teamView.team()`, `storeValue(key, resolve)` and `loadConfigFrom(path, resolve)`.
- Produces:
  - `BoardConfig.ownChannels`: my team's channels, normalized; `[]` when the directory has no entry for my team.
  - `config.slack.channel` comes from the directory's review channel when there is one.
  - A codeowners tab with no `slackChannel` gets the directory's `codeOwnersChannel`.
  - `ticketPrefixes` falls back to the directory's Linear key.

- [ ] **Step 1: Write the failing tests.** Add at the end of `config-store-latch.test.ts`. `tmpConfig()` and `fakeResolve()` are already defined in that file. `teamView` is a mutable exported object; stub `team`, then restore it.

```ts
import { teamView } from '../config.ts';

describe('loadConfigFrom: mattstack.directory', () => {
  const DIRECTORY = {
    teams: {
      claim: {
        linear: { team: 'CV' },
        slack: {
          codeOwnersChannel: 'pod-claim',
          channels: [{ name: 'Claim-Internal', kind: 'review' }],
        },
      },
    },
  };
  const realTeam = teamView.team;
  afterEach(() => {
    teamView.team = realTeam;
  });

  test("my team's review channel replaces board.slack.channel, and its channels are mine", () => {
    teamView.team = () => 'claim';
    const cfg = loadConfigFrom(
      tmpConfig(),
      fakeResolve({ 'mattstack.directory': DIRECTORY })
    );
    expect(cfg.slack.channel).toBe('claim-internal');
    expect(cfg.ownChannels).toEqual(['pod-claim', 'claim-internal']);
  });

  test('board.slack.reviewKind picks the kind', () => {
    teamView.team = () => 'claim';
    const dir = structuredClone(DIRECTORY);
    dir.teams.claim.slack.channels.push({ name: 'claim-pr', kind: 'pr' });
    const cfg = loadConfigFrom(
      tmpConfig(),
      fakeResolve({
        'mattstack.directory': dir,
        'board.slack': { channel: 'old', reviewKind: 'pr' },
      })
    );
    expect(cfg.slack.channel).toBe('claim-pr');
  });

  test('no review channel in my entry keeps board.slack.channel', () => {
    teamView.team = () => 'claim';
    const cfg = loadConfigFrom(
      tmpConfig(),
      fakeResolve({
        'mattstack.directory': {
          teams: { claim: { slack: { codeOwnersChannel: 'pod-claim' } } },
        },
        'board.slack': { channel: 'old' },
      })
    );
    expect(cfg.slack.channel).toBe('old');
  });

  test('a codeowners tab without its own channel takes the directory one; a set one wins', () => {
    teamView.team = () => 'claim';
    const tab = (id: string, slackChannel?: string) => ({
      id,
      label: id,
      source: { kind: 'codeowners', section: 'Claim - #pod-claim' },
      ...(slackChannel ? { slackChannel } : {}),
    });
    const cfg = loadConfigFrom(
      tmpConfig(),
      fakeResolve({
        'mattstack.directory': DIRECTORY,
        'board.tabs': [tab('a'), tab('b', 'watch-elsewhere')],
      })
    );
    expect(cfg.tabs.map(t => t.slackChannel)).toEqual([
      'pod-claim',
      'watch-elsewhere',
    ]);
  });

  test("ticket prefixes fall back to my team's Linear key, and a set value wins", () => {
    teamView.team = () => 'claim';
    expect(
      loadConfigFrom(
        tmpConfig(),
        fakeResolve({ 'mattstack.directory': DIRECTORY })
      ).ticketPrefixes
    ).toEqual(['CV']);
    expect(
      loadConfigFrom(
        tmpConfig(),
        fakeResolve({
          'mattstack.directory': DIRECTORY,
          'board.ticketPrefixes': ['CV', 'PLA'],
        })
      ).ticketPrefixes
    ).toEqual(['CV', 'PLA']);
  });

  test('on no team, or with no entry, nothing changes', () => {
    teamView.team = () => null;
    const cfg = loadConfigFrom(
      tmpConfig(),
      fakeResolve({ 'mattstack.directory': DIRECTORY })
    );
    expect(cfg.ownChannels).toEqual([]);
  });
});
```

Check `tmpConfig()` first. If its fixture already sets `ticketPrefixes`, write a fixture without them for the fallback case; the test must fail before Step 3. Add `afterEach` to that file's `bun:test` import if it is missing.

- [ ] **Step 2: Run them to see them fail**

Run (from `apps/board`): `bun test ./src/__tests__/config-store-latch.test.ts`
Expected: FAIL. `ownChannels` is undefined and `slack.channel` is unchanged.

- [ ] **Step 3: Implement.** In `config.ts`:
  - Import `channelsOfKind`, `directoryEntry`, `teamChannels` and `type TeamDirectory` from `@mattstack/rt-client`.
  - Add `ownChannels?: string[];` to `BoardConfig`, with this doc comment: `/** My team's channels from mattstack.directory, normalized; a code owners section naming one is my team's. */`.
  - In `withBoardStoreFallback`, before `const merged: BoardConfig = {`, add:

```ts
  const mine = directoryEntry(
    storeValue<TeamDirectory>('mattstack.directory', resolve),
    teamView.team()
  );
  const slackStore = storeValue<Partial<SlackConfig> & { reviewKind?: string }>(
    'board.slack',
    resolve
  );
  const reviewChannel = mine
    ? channelsOfKind(mine, slackStore?.reviewKind ?? 'review')[0]
    : undefined;
  const codeOwnersChannel = mine?.slack?.codeOwnersChannel;
  const tabs = (storeValue<TabConfig[]>('board.tabs', resolve) ??
    fileConfig.tabs).map(t =>
    t.source.kind === 'codeowners' && !t.slackChannel && codeOwnersChannel
      ? { ...t, slackChannel: codeOwnersChannel }
      : t
  );
  const fileOrDirPrefixes = fileConfig.ticketPrefixes.length
    ? fileConfig.ticketPrefixes
    : mine?.linear?.team
      ? [mine.linear.team]
      : [];
```

  In `merged`, replace these three lines:

```ts
    ticketPrefixes:
      storeValue('board.ticketPrefixes', resolve) ?? fileOrDirPrefixes,
    slack: {
      ...(slackStore ?? fileConfig.slack),
      ...(reviewChannel ? { channel: reviewChannel } : {}),
    },
```

  and `tabs,`.

  `merged.slack` now carries `reviewKind` into `parseConfig`. Read `parseConfig`'s slack parsing (around `config.ts:390`). If it rejects an unknown slack field, strip the field before building `merged`: `const { reviewKind: _reviewKind, ...slackFields } = slackStore ?? {};`, then spread `slackFields` instead of `slackStore`.

  Change the return to:

```ts
  return {
    ...parsed,
    teamPack: teamView.pack() ?? '',
    ownChannels: mine ? teamChannels(mine) : [],
  };
```

- [ ] **Step 4: Run the tests**

Run (from `apps/board`): `bun test ./src/__tests__/config-store-latch.test.ts ./src/__tests__/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/config.ts apps/board/src/__tests__/config-store-latch.test.ts
git commit -m "board: read the team directory for the review channel, tab channel and ticket prefixes"
```

---

### Task 5: Board routes code owner sections by the directory

**Files:**
- Modify: `apps/board/src/codeowner-posts.ts` (`planOwnersPost` opts)
- Modify: `apps/board/src/server.ts` (`ownersPostPlan`, the two `planOwnersPost(rules, {...})` calls)
- Modify: `apps/board/docs/configuration.md` ("Posting to code owners")
- Test: `apps/board/src/__tests__/codeowner-posts.test.ts`

**Interfaces:**
- Consumes: `BoardConfig.ownChannels` (Task 4).
- Produces: a new `planOwnersPost` option, `ownChannels?: readonly string[]`. A section whose channel is in it is the team's own. When `ownChannels` is non-empty, `ownSections` is ignored.

- [ ] **Step 1: Write the failing tests.** Add inside `describe('planOwnersPost', ...)`:

```ts
  test("a section on any of my directory channels rides on the team row; the tab's section list is ignored", () => {
    const plan = planOwnersPost(
      [
        { section: 'Claim - #POD-claim', approved: false },
        { section: 'Claim Ops - #claim-internal', approved: false },
        { section: 'Other Tab - #pod-other', approved: false },
      ],
      {
        posted: {},
        ownChannels: ['pod-claim', 'claim-internal'],
        ownSections: ['Other Tab - #pod-other'],
      }
    );
    expect(plan.ownSections).toEqual([
      'Claim - #POD-claim',
      'Claim Ops - #claim-internal',
    ]);
    expect(plan.channels).toEqual([
      { channel: 'pod-other', sections: ['Other Tab - #pod-other'] },
    ]);
  });

  test('with no directory channels the tab sections still decide', () => {
    const plan = planOwnersPost(
      [{ section: 'Ours - #pod-ours', approved: false }],
      { posted: {}, ownChannels: [], ownSections: ['Ours - #pod-ours'] }
    );
    expect(plan.ownSections).toEqual(['Ours - #pod-ours']);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run (from `apps/board`): `bun test ./src/__tests__/codeowner-posts.test.ts`
Expected: FAIL. The first test leaves the directory sections in `channels`.

- [ ] **Step 3: Implement.** In `codeowner-posts.ts`, add to the `opts` type:

```ts
    /** My team's channels from the directory; when set, they decide which sections are mine. */
    ownChannels?: readonly string[];
```

Replace `const own = new Set(opts.ownSections ?? []);` with:

```ts
  const ownChannels = new Set(
    (opts.ownChannels ?? []).map(c => c.replace(/^#/, '').toLowerCase())
  );
  const own = new Set(ownChannels.size ? [] : (opts.ownSections ?? []));
```

and widen the own check in the loop:

```ts
    const sectionChannel = channelFromCodeownerSection(section);
    if (
      own.has(section) ||
      (!!sectionChannel && ownChannels.has(sectionChannel.toLowerCase())) ||
      (!!opts.teamChannel && sectionChannel === opts.teamChannel)
    ) {
```

In `server.ts` `ownersPostPlan`, add `ownChannels: config.ownChannels ?? [],` to both `planOwnersPost(rules, { ... })` calls.

- [ ] **Step 4: Update the docs.** In `apps/board/docs/configuration.md`, replace the sentence that begins "Your team's sections are the codeowners tab's section" with:

```markdown
Your team's sections are the ones whose channel is one of your team's
channels in the org's `mattstack.directory` (its code owners channel or any
channel listed under it). Without a directory entry for your team, they are
the codeowners tab's section and any section that names the team channel.
Their channel is where other teams ask you, so it is never offered for your
own MRs.
```

and add this paragraph at the end of the section:

```markdown
With a `mattstack.directory` entry for your team, the team channel is your
team's first channel of kind `board.slack.reviewKind` (default `review`), a
codeowners tab with no `slackChannel` watches your team's code owners
channel, and `board.ticketPrefixes` defaults to your team's Linear key.
```

- [ ] **Step 5: Run the board's Slack tests**

Run (from `apps/board`): `bun test ./src/__tests__/codeowner-posts.test.ts ./src/__tests__/server-slack-owners.test.ts`
Expected: PASS.

Run (repo root): `bun run docs:check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/board/src/codeowner-posts.ts apps/board/src/server.ts apps/board/src/__tests__/codeowner-posts.test.ts apps/board/docs/configuration.md
git commit -m "board: a code owners section is mine when the directory says its channel is"
```

---

### Task 6: Setup reads the Linear key from the directory

**Files:**
- Modify: `lib/setup/team-settings.ts` (`readTeamSnapshot`)
- Test: `lib/setup/__tests__/team-settings.test.ts`

**Interfaces:**
- Consumes: `directoryEntry` and `TeamDirectory` from `../../packages/rt-client/src/settings/team-directory.ts`, and `activeTeam` from `../../packages/rt-client/src/settings/active-team.ts`.
- Produces: `readTeamSnapshot(p, slug, { read?, warn?, team? })`. `snapshot.integrations.linear.teamKey` prefers the active team's `linear.team` from the directory. `lib/daemon.ts` and `lib/setup/validators/accounts.ts` need no change, since they read the snapshot.

- [ ] **Step 1: Write the failing test.** Add to `describe("readTeamSnapshot — injected read seam", ...)`:

```ts
  test("the directory's Linear key wins over mattstack.integrations", () => {
    const read = fakeReader({
      "mattstack.integrations": { linear: { teamKey: "OLD" } },
      "mattstack.directory": { teams: { claim: { linear: { team: "CV" } } } },
    });
    const snapshot = readTeamSnapshot(fakeProbes({ home: "/fake-home" }), "acme", { read, team: "claim" });
    expect(snapshot.integrations.linear).toEqual({ teamKey: "CV" });
  });

  test("with no directory entry the integrations key stays", () => {
    const read = fakeReader({ "mattstack.integrations": { linear: { teamKey: "OLD" } } });
    const snapshot = readTeamSnapshot(fakeProbes({ home: "/fake-home" }), "acme", { read, team: "claim" });
    expect(snapshot.integrations.linear).toEqual({ teamKey: "OLD" });
  });
```

- [ ] **Step 2: Run it to see it fail**

Run (repo root): `bun test lib/setup/__tests__/team-settings.test.ts`
Expected: FAIL. `teamKey` is `"OLD"`.

- [ ] **Step 3: Implement.** Add `team?: string | null` to `readTeamSnapshot`'s `opts` type. Replace the `integrations` line with:

```ts
  const declared = read<TeamIntegrations>("mattstack.integrations") ?? {};
  const team = opts.team !== undefined ? opts.team : activeTeam().team;
  const linearTeam = directoryEntry(read<TeamDirectory>("mattstack.directory"), team)?.linear?.team;
  const integrations: TeamIntegrations = linearTeam ? { ...declared, linear: { teamKey: linearTeam } } : declared;
```

with the imports:

```ts
import { activeTeam } from "../../packages/rt-client/src/settings/active-team.ts";
import { directoryEntry, type TeamDirectory } from "../../packages/rt-client/src/settings/team-directory.ts";
```

The existing test that expects `integrations` to equal the raw reader value passes no `team`. It must not reach the real `activeTeam()` and read this Mac's org. Pass `team: null` in that test's `readTeamSnapshot(p, "acme", { read })` call.

- [ ] **Step 4: Run the tests**

Run (repo root): `bun test lib/setup/__tests__/team-settings.test.ts lib/setup/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/team-settings.ts lib/setup/__tests__/team-settings.test.ts
git commit -m "setup: the team directory's Linear key wins"
```

---

### Task 7: Whole-branch verification

- [ ] **Step 1: Typecheck everything touched**

Run (repo root): `bun run typecheck` and `bun run board:typecheck`
Expected: both clean.

- [ ] **Step 2: Run the touched suites**

Run (repo root): `bun test packages/rt-client/src/settings lib/setup`
Run (from `apps/board`): `bun test`
Expected: PASS.

- [ ] **Step 3: rt-client dist freshness**

Run (repo root): `bun test packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS. If it fails, run `cd packages/rt-client && bun run build` and commit nothing; `dist/` is gitignored.

- [ ] **Step 4: Prove an org without a directory is unchanged**

Run (from `apps/board`): `bun test ./src/__tests__/server-slack-owners.test.ts`
Expected: PASS with no directory set. Its fixture has none, so the #758 behaviour holds.
