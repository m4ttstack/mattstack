# Team Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an org-level `mattstack.directory` setting naming each team's Linear key and Slack channels. Make it the only source the board and setup read for those facts. Move the old settings into it and delete them.

**Architecture:**
- A new registry key with a zod schema.
- Pure reads in `packages/rt-client/src/settings/team-directory.ts`.
- A write gate that refuses a code owners channel claimed twice.
- The board config overlays the directory (review channel, the codeowners tab channel, ticket prefix default, my team's channels).
- Code owner routing goes by those channels.
- The setup snapshot reads the Linear key from the directory.
- One setup migration seeds the directory and deletes the retired values.

**Tech Stack:** Bun, TypeScript, zod (authoring only), bun:test, vitest (console).

**Spec:** `docs/superpowers/specs/2026-10-08-team-directory-design.md`

## Global Constraints

- `mattstack.directory`: `scopes: ["org"]`, `merge: "replace"`, no `default`.
- No `board.*` registry row carries a `default`. Fallbacks live in the app-side read.
- Channel names are bare. Matching is case-insensitive and ignores a leading `#` (`normalizeChannel`).
- The board reads a missing `board.slack.reviewKind` as `"review"`.
- Known channel kinds: `["review"]`.
- No fallbacks to the retired settings. The board's team channel comes only from the directory, and the board has no default channel.
- Retired, then deleted by the migration:
  - `board.slack.channel`;
  - `mattstack.integrations.linear.teamKey`;
  - a codeowners tab `slackChannel` equal to the team's code owners channel;
  - `board.ticketPrefixes` when it equals `[linear.team]`;
  - the codeowners-tab "ours" inference in code.
- The refusal text with no review channel, used verbatim: `Add a review channel for your team to the team directory`.
- Migration id: `2026-10-08-team-directory`, never renamed.
- Run `bun test` from the repo root (rt-client and lib) or from `apps/board` (board). bunfig loads only from the cwd.
- After any change under `packages/rt-client/src`, run `cd packages/rt-client && bun run build`.
- Comments state only constraints the code cannot show.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **My team has a directory entry but no channel of the review kind.** Posting refuses with the exact text, and the board still loads. Tested in Tasks 4 and 5.
- **A channel written with `#` or different case** (`#Pod-Acme`). It still matches. Tested in Tasks 2 and 5.
- **`teamView.team()` is null** (a Mac on no team). There is no entry and no channel; posting refuses, nothing crashes. Tested in Task 4.
- **A codeowners tab whose `slackChannel` is another team's channel.** The migration keeps it, and the board uses it. Tested in Tasks 4 and 7.
- **The migration runs twice, or runs after someone hand-wrote an entry.** Nothing is overwritten, a second run is `skipped`, and values are deleted only for teams in the directory. Tested in Task 7.

---

### Task 1: Register the directory; retire the old schema fields

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts`:
  - add the `mattstack.directory` row after `mattstack.org`;
  - update the `board.slack` and `mattstack.integrations` descriptions.
- Modify: `packages/rt-client/src/settings/registry-schemas.ts`:
  - `"mattstack.directory"`;
  - `"board.slack"`;
  - `"mattstack.integrations"`;
  - the `board.tabs` `slackChannel` meta.
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts`
- Regenerate: `packages/rt-client/src/settings/schema.lock.json`

**Interfaces:**
- Produces: `Value<"mattstack.directory">`, which is
  `{ teams?: Record<string, { linear?: { team?: string }; slack?: { codeOwnersChannel?: string; channels?: Array<{ name: string; kind: string }> } }> }`.
- Produces: `Value<"board.slack">`. It gains `reviewKind?: string` and loses `channel`.
- Produces: `Value<"mattstack.integrations">`. Its `linear` loses `teamKey` and gains `workspace?: string`, which the org store already holds.

- [ ] **Step 1: Write the examples (the failing test).** In `schema-examples.ts`, add this entry next to `"mattstack.org"`:

```ts
  "mattstack.directory": {
    good: [
      {},
      { teams: {} },
      {
        teams: {
          widgets: {
            linear: { team: "WID" },
            slack: { codeOwnersChannel: "pod-widgets", channels: [{ name: "widgets-internal", kind: "review" }] },
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

Then make two changes to existing entries:
- In the `"board.slack"` entry, replace any `channel` in its `good` values with `reviewKind: "review"`.
- In the `"mattstack.integrations"` entry, replace any `linear: { teamKey: ... }` with `linear: { workspace: "acme" }`.

- [ ] **Step 2: Run the examples to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples`
Expected: FAIL. `mattstack.directory` has no row or schema.

- [ ] **Step 3: Add the row.** After `mattstack.org` in `registry-defs.ts`:

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

Make the `board.slack` description read: "The board's Slack posting config (app id, client id, templates, callback port, reviewKind). The team's review channel is in mattstack.directory. Client secrets stay out of this store."

Make the `mattstack.integrations` description read: "Team-wide external integration config (forge, slack app, linear workspace) the installer provisions; a team's Linear key is in mattstack.directory; client secrets never live here."

- [ ] **Step 4: Change the schemas.** In `registry-schemas.ts`, add after `"mattstack.org"`:

```ts
  "mattstack.directory": z.looseObject({
    teams: z
      .record(
        z.string(),
        z.looseObject({
          linear: z
            .looseObject({
              team: z.string().min(1).optional().meta({ title: "Linear team key", description: "The team's own Linear key, e.g. CV.", placeholder: "CV" }),
            })
            .optional(),
          slack: z
            .looseObject({
              codeOwnersChannel: z.string().min(1).optional().meta({
                title: "Code owners channel",
                description: "Where other teams ask this team for code owner review. A CODEOWNERS section naming this channel belongs to this team.",
                placeholder: "pod-acme",
              }),
              channels: z
                .array(
                  z.looseObject({
                    name: z.string().min(1).meta({ title: "Channel", description: "Slack channel name, no #." }),
                    kind: z.string().min(1).meta({ title: "Kind", description: "What the channel is for. The board reads review; teams may add their own kinds." }),
                  }),
                )
                .optional()
                .meta({ title: "Other channels" }),
            })
            .optional(),
        }),
      )
      .optional()
      .meta({ title: "Teams", description: "One entry per team, keyed by team name. A name matching a team folder is that mattstack team." }),
  }),
```

In `"board.slack"`, delete the `channel: z.string().optional(),` line and add `reviewKind: z.string().optional(),`.

In `"mattstack.integrations"`, change the `linear` line to:

```ts
    linear: z.looseObject({ workspace: z.string().optional() }).optional(),
```

In the `board.tabs` schema, change the `slackChannel` meta to:

```ts
  slackChannel: z.string().optional().meta({ title: "Slack channel", description: "Only for a tab that watches a channel other than your team's code owners channel." }),
```

- [ ] **Step 5: Regenerate and check the lock**

Run: `bun run cli.ts settings schema lock`
Run: `bun test packages/rt-client/src/settings/__tests__/`
Expected: PASS. Removing a property from a `looseObject` is classified as safe, so `breaking-schema-changes.json` needs no entry. If the lock check reports a breaking change anyway, stop and report it; do not bump `storeVersion`.

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client/src/settings/
git commit -m "settings: register mattstack.directory, retire board.slack.channel and integrations linear.teamKey"
```

---

### Task 2: Directory reads in rt-client

**Files:**
- Create: `packages/rt-client/src/settings/team-directory.ts`
- Create: `packages/rt-client/src/settings/__tests__/team-directory.test.ts`
- Modify: `packages/rt-client/src/index.ts`

**Interfaces:**
- Consumes: `Value<"mattstack.directory">` (Task 1); `getSetting` (`./resolve.ts`); `activeTeam` (`./active-team.ts`).
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
    const dup: TeamDirectory = { teams: { b: { slack: { codeOwnersChannel: "x" } }, a: { slack: { codeOwnersChannel: "X" } } } };
    expect(teamForChannel(dup, "x")?.name).toBe("b");
  });
});

describe("channelsOfKind and teamChannels", () => {
  const widgets = DIR.teams!.widgets!;
  test("channelsOfKind returns the names of that kind, normalized, in order", () => {
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
    expect(directoryIssues({ teams: { a: { slack: { channels: [{ name: "a", kind: "review" }] } } } })).toEqual({ duplicates: [], unknownKinds: [] });
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
- Modify: `packages/rt-client/src/settings/write.ts` (in `setSetting`, after `writeIntoStore(...)` returns)
- Test: `packages/rt-client/src/settings/__tests__/team-directory-write.test.ts`

**Interfaces:**
- Consumes: `directoryIssues` (Task 2). Also the existing `validateWrite`, `getDef`, `setSetting` and `setSettingsNoticeSink`.
- Produces: a `kind: "schema"` refusal for a code owners channel claimed twice, and one notice per unknown kind after a successful write.
- The notice goes through `setSetting`'s notice sink, which `rt settings set` prints. A console save does not show it; the console shows the refusal only. The spec's "Validation" says the same.

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

  test("accepts a kind no app reads", () => {
    expect(validateWrite(def, { teams: { a: { slack: { channels: [{ name: "a-x", kind: "oncall" }] } } } }, { scope: "org" }).ok).toBe(true);
  });
});
```

For the notice:
1. Run `grep -rln "setSettingsNoticeSink" packages/rt-client/src/settings/__tests__` to find the existing `setSetting` test that writes an org-scope value under a temp HOME using `seedOrg` from `packages/rt-client/test/org-fixture.ts`.
2. Add this case to that file, using the file's own org setup (an admin username, so the org write is allowed):

```ts
test("a directory write names each channel kind no app reads", () => {
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
Expected: FAIL. The verdict is ok for the duplicate.

- [ ] **Step 3: Implement the refusal.** In `validate-write.ts`, import `directoryIssues` from `./team-directory.ts`. After `if (layerIssues.length > 0) return ...;`, add:

```ts
  const semantic = SEMANTIC_CHECKS[def.key]?.(value);
  if (semantic) return { ok: false, kind: "schema", reason: semantic, issues: [] };
```

and at module level:

```ts
/** Rules a JSON Schema cannot state, such as uniqueness across a record. */
const SEMANTIC_CHECKS: Record<string, (value: unknown) => string | null> = {
  "mattstack.directory": (value) => {
    const dup = directoryIssues(value as never).duplicates[0];
    return dup ? `two teams claim #${dup.channel} as their code owners channel: ${dup.teams.join(", ")}` : null;
  },
};
```

- [ ] **Step 4: Implement the notice.** In `write.ts`, import `directoryIssues` from `./team-directory.ts`. Right after `setSetting`'s `writeIntoStore(...)` call, add:

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
git add packages/rt-client/src/settings/
git commit -m "settings: refuse a shared code owners channel, note unknown channel kinds"
```

---

### Task 4: Board config reads the directory, with no fallback

**Files:**
- Modify: `apps/board/src/config.ts`:
  - `DEFAULT_SLACK`'s `channel` becomes `''`;
  - `parseSlack` stops reading `channel`;
  - `BoardConfig` gets `ownChannels?: string[]`;
  - `withBoardStoreFallback` gets the overlay below.
- Test: `apps/board/src/__tests__/config-store-latch.test.ts`. Add the new `describe`, and update any existing case that expects `slack.channel` from `board.slack` or `config.json`.

**Interfaces:**
- Consumes: `directoryEntry`, `channelsOfKind`, `teamChannels` and `TeamDirectory` from `@mattstack/rt-client` (Task 2). Also the existing `teamView.team()`, `storeValue(key, resolve)` and `loadConfigFrom(path, resolve)`.
- Produces:
  - `config.slack.channel`: my team's first channel of kind `reviewKind`, or `''`;
  - `config.ownChannels`: `teamChannels(mine)`, or `[]`;
  - each codeowners tab without its own `slackChannel` gets my `codeOwnersChannel`;
  - `ticketPrefixes` defaults to `[mine.linear.team]` when neither `board.ticketPrefixes` nor `config.json` sets them.

- [ ] **Step 1: Write the failing tests.** Add at the end of `config-store-latch.test.ts`. `tmpConfig()`, `fakeResolve()`, `afterEach` and `teamView` are already defined or imported there; do not import them again.

```ts
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

  test("my team's review channel is the slack channel, and its channels are mine", () => {
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
        'board.slack': { reviewKind: 'pr' },
      })
    );
    expect(cfg.slack.channel).toBe('claim-pr');
  });

  test('no review channel in my entry means no channel, not a default', () => {
    teamView.team = () => 'claim';
    const cfg = loadConfigFrom(
      tmpConfig(),
      fakeResolve({
        'mattstack.directory': {
          teams: { claim: { slack: { codeOwnersChannel: 'pod-claim' } } },
        },
      })
    );
    expect(cfg.slack.channel).toBe('');
  });

  test('a codeowners tab without its own channel takes my code owners channel; a set one wins', () => {
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

  test("ticket prefixes default to my team's Linear key; a set value wins", () => {
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

  test('on no team there is no channel and nothing is mine', () => {
    teamView.team = () => null;
    const cfg = loadConfigFrom(
      tmpConfig(),
      fakeResolve({ 'mattstack.directory': DIRECTORY })
    );
    expect(cfg.slack.channel).toBe('');
    expect(cfg.ownChannels).toEqual([]);
  });
});
```

If `tmpConfig()`'s fixture sets `ticketPrefixes` or `slack.channel`, write one without them for these cases. Each test must fail before Step 3.

- [ ] **Step 2: Run them to see them fail**

Run (from `apps/board`): `bun test ./src/__tests__/config-store-latch.test.ts`
Expected: FAIL. `slack.channel` is `code-review` and `ownChannels` is undefined.

- [ ] **Step 3: Implement.** In `config.ts`:
  - Import `channelsOfKind`, `directoryEntry`, `teamChannels` and `type TeamDirectory` from `@mattstack/rt-client`.
  - In `DEFAULT_SLACK`, set `channel: ''`.
  - In `parseSlack`:
    - remove `'channel'` from the non-empty-string check loop (`for (const key of ['channel', 'singleTemplate', ...])`, around L505). The round trip through `parseConfig` carries `channel: ''`, and that check would throw on every load.
    - change `channel: s.channel ?? DEFAULT_SLACK.channel,` to `channel: DEFAULT_SLACK.channel,`. The channel is never read from a file or store any more; `withBoardStoreFallback` sets it.
  - Change the `SlackConfig.channel` doc comment to `/** The team's review channel from mattstack.directory; '' when it names none. */`.
  - Add `ownChannels?: string[];` to `BoardConfig`, with the doc comment `/** My team's channels from mattstack.directory, normalized; a code owners section naming one is my team's. */`.

  In `withBoardStoreFallback`, before `const merged: BoardConfig = {`, add:

```ts
  const mine = directoryEntry(
    storeValue<TeamDirectory>('mattstack.directory', resolve),
    teamView.team()
  );
  const {
    reviewKind,
    channel: _retired,
    ...slackFields
  } = storeValue<Partial<SlackConfig> & { reviewKind?: string }>(
    'board.slack',
    resolve
  ) ?? {};
  const reviewChannel = mine
    ? (channelsOfKind(mine, reviewKind ?? 'review')[0] ?? '')
    : '';
  const codeOwnersChannel = mine?.slack?.codeOwnersChannel;
  const tabs = (
    storeValue<TabConfig[]>('board.tabs', resolve) ?? fileConfig.tabs
  ).map(t =>
    t.source.kind === 'codeowners' && !t.slackChannel && codeOwnersChannel
      ? { ...t, slackChannel: codeOwnersChannel }
      : t
  );
  const defaultPrefixes = fileConfig.ticketPrefixes.length
    ? fileConfig.ticketPrefixes
    : mine?.linear?.team
      ? [mine.linear.team]
      : [];
```

  In `merged`:

```ts
    ticketPrefixes:
      storeValue('board.ticketPrefixes', resolve) ?? defaultPrefixes,
    slack: { ...fileConfig.slack, ...slackFields },
    tabs,
```

  Return:

```ts
  return {
    ...parsed,
    slack: { ...parsed.slack, channel: reviewChannel },
    teamPack: teamView.pack() ?? '',
    ownChannels: mine ? teamChannels(mine) : [],
  };
```

- [ ] **Step 4: Run the config tests**

Run (from `apps/board`): `bun test ./src/__tests__/config-store-latch.test.ts ./src/__tests__/config.test.ts`
Expected: PASS. If existing cases asserted a `code-review` default or a stored `slack.channel`, change them to the directory form: the behaviour they pinned is retired.

- [ ] **Step 5: Commit**

```bash
git add apps/board/src/config.ts apps/board/src/__tests__/config-store-latch.test.ts apps/board/src/__tests__/config.test.ts
git commit -m "board: the team directory is the only source of the review channel"
```

---

### Task 5: Board routes by the directory and refuses with no review channel

**Files:**
- Modify: `apps/board/src/codeowner-posts.ts`:
  - the `planOwnersPost` opts become `{ posted, slack?, ownChannels? }`; drop `ownSections` and `teamChannel`;
  - export `NO_REVIEW_CHANNEL`. Server and client both import it, and both already import this module.
- Modify: `apps/board/src/server.ts`:
  - `ownersPostPlan`;
  - `ownersPreviewOrPost`;
  - the `/slack/post` route;
  - `sweepOnce`;
  - the `/slack/resolve` route and the signal-reaction path. The server imports `NO_REVIEW_CHANNEL` from `codeowner-posts.ts` and does not declare its own.
- Modify: `apps/board/src/data.ts`. `configuredSlackChannels` filters out `''`.
- Modify: `apps/board/src/client/board/slack-post-flow.ts`. A preview refused with exactly `NO_REVIEW_CHANNEL` is shown, with no fallback. Every other preview failure (5xx, a missing rtRepos mapping) still falls back to the team post, as today.
- Modify:
  - `apps/board/docs/configuration.md`: the "Posting to code owners" section, L100-101 (tab `slackChannel` overriding `slack.channel`) and L161 (a failed check still posts);
  - `apps/board/docs/slack.md`: L66 and L80 document `slack.channel` with `code-review`.
- Tests:
  - `apps/board/src/__tests__/codeowner-posts.test.ts`
  - `apps/board/src/__tests__/server-slack-owners.test.ts`
  - `apps/board/src/__tests__/server-slack-post-channel.test.ts`
  - `apps/board/src/__tests__/server-slack-channel.test.ts`
  - `apps/board/src/__tests__/server-slack-refresh.test.ts`
  - `apps/board/src/__tests__/server-own-mr.test.ts`. Its "/slack/post posts it" case at ~L608 relied on the old `code-review` default.
  - `apps/board/src/client/board/__tests__/slack-post-flow.test.ts`

**Interfaces:**
- Consumes: `BoardConfig.ownChannels` and `config.slack.channel` (Task 4).
- Produces: `planOwnersPost(rules, { posted, slack?, ownChannels? })`. A section whose channel is in `ownChannels` (normalized) is mine. Also produces the `400 Add a review channel for your team to the team directory` refusal from `/slack/post`, `/slack/owners/preview` and `/slack/owners/post` when the MR's channel is `''`.

- [ ] **Step 1: Rewrite the plan's own-section tests.** In `codeowner-posts.test.ts`, delete these three tests:
  - "our own team's sections go to the team row, never their channel";
  - "a plan with no own sections says so";
  - "a section naming the team channel rides on the team row, never posts twice there".

  Then add:

```ts
  test('a section on any of my channels rides on the team row, matched without # and case', () => {
    const plan = planOwnersPost(
      [
        { section: 'Claim - #POD-claim', approved: false },
        { section: 'Claim Ops - #claim-internal', approved: false },
        { section: 'Acme - #pod-acme', approved: false },
      ],
      { posted: {}, ownChannels: ['pod-claim', 'claim-internal'] }
    );
    expect(plan.ownSections).toEqual([
      'Claim - #POD-claim',
      'Claim Ops - #claim-internal',
    ]);
    expect(plan.channels).toEqual([
      { channel: 'pod-acme', sections: ['Acme - #pod-acme'] },
    ]);
  });

  test('with no channels of mine every section is another team’s', () => {
    expect(
      planOwnersPost([{ section: 'Acme - #pod-acme', approved: false }], {
        posted: {},
      }).ownSections
    ).toEqual([]);
  });
```

- [ ] **Step 2: Add the server refusal test.** In `server-slack-owners.test.ts`, move the fixture to the directory:
  1. Create a team folder: write `{}` to `join(fakeHome, '.mattstack', 'orgs', 'testteam', 'mattstack', 'teams', 'web', 'settings.team.jsonc')`.
  2. Add `'mattstack.activeTeam': 'web'` to the user settings it writes.
  3. In the org settings, remove `channel` from `'board.slack'` and the `slackChannel` from the owners tab.
  4. Add to the org settings: `'mattstack.directory': { teams: { web: { slack: { codeOwnersChannel: 'ours-channel', channels: [{ name: 'code-review', kind: 'review' }] } } } }`.

  The existing expectations (team channel `code-review`, `ours-channel` riding on the team row) stay unchanged.

  Then add a second server boot that has no review channel. First factor the file's setup into one function, `bootBoard({ port, directory })`, which the file calls twice. It writes everything the routes need, under a fresh temp HOME:
  - the org store: `board.gitlabHost`, `board.projects`, the roster, `board.slack` (no channel), `board.tabs`, the `board.codeowners` repo section, and `mattstack.directory` set to the given `directory`;
  - the team folder, `teams/web/settings.team.jsonc`;
  - the user store: `board.defaultMember: 'alice'` and `mattstack.activeTeam: 'web'`;
  - the machine key and the machine store's `board.rtRepos`;
  - its own fake rt daemon on `<HOME>/.mattstack/rt/rt.sock`, answering `project-mrs:read` and `forge:get` as the file's daemon does;
  - the `Bun.spawn` of `server.ts` on `port`, with the Slack mock preload.

  It returns `{ port, stop }`.

  Call it once with the directory above (the existing tests), and once on another port with `{ teams: { web: { slack: { codeOwnersChannel: 'ours-channel' } } } }`. Assert:

```ts
for (const path of ['/slack/owners/preview', '/slack/owners/post', '/slack/post']) {
  const res = await postTo(NO_CHANNEL_PORT, path, path === '/slack/post' ? { mrUrls: [url('g/p', 701)] } : { mrUrl: url('g/p', 701), team: true });
  expect(res.status).toBe(400);
  expect(await res.text()).toBe('Add a review channel for your team to the team directory');
}
```

`postTo(port, path, body)` is the file's `post` helper with the port as a parameter. Kill the second server in `afterAll`.

  Make the same fixture move in these four files: a team folder, `mattstack.activeTeam`, the review channel in `mattstack.directory`, and no `board.slack.channel`.
  - `server-slack-post-channel.test.ts`
  - `server-slack-channel.test.ts`
  - `server-slack-refresh.test.ts`
  - `server-own-mr.test.ts`

  Also delete the `ownSections: []` arguments in `codeowner-posts.test.ts` (around L52, L110, L129). That option no longer exists, so typecheck would flag them as excess properties.

- [ ] **Step 3: Add the flow test.** In `slack-post-flow.test.ts`, add:

```ts
test('no review channel shows the refusal and posts nothing', async () => {
  const { done, events } = run({
    '/slack/owners/preview': fail(400, 'Add a review channel for your team to the team directory'),
  });
  await done;
  expect(events).toContain('fail Add a review channel for your team to the team directory');
  expect(events.filter(e => e.startsWith('post /slack/post'))).toEqual([]);
});

test('any other refused preview still falls back to the team post', async () => {
  const { done, events } = run({
    '/slack/owners/preview': fail(400, 'g/p: no rtRepos mapping in config.json'),
    '/slack/post': ok({ ok: true, posted: 1 }),
  });
  await done;
  expect(events).toContain(`post /slack/post {"mrUrls":["${URL}"]}`);
});
```

- [ ] **Step 4: Run them to see them fail**

Run (from `apps/board`): `bun test ./src/__tests__/codeowner-posts.test.ts ./src/__tests__/server-slack-owners.test.ts ./src/client/board/__tests__/slack-post-flow.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement.** In `codeowner-posts.ts`:
  - Replace the `ownSections?` and `teamChannel?` opts with:

```ts
    /** My team's channels from the directory; a section naming one is mine. */
    ownChannels?: readonly string[];
```

  - Replace `const own = new Set(opts.ownSections ?? []);` with:

```ts
  const own = new Set(
    (opts.ownChannels ?? []).map(c => c.replace(/^#/, '').toLowerCase())
  );
```

  - Make the own check:

```ts
    const sectionChannel = channelFromCodeownerSection(section);
    if (sectionChannel && own.has(sectionChannel.toLowerCase())) {
```

  Also in `codeowner-posts.ts`:

```ts
/** The refusal when the active team has no review channel in the directory; the client matches it exactly. */
export const NO_REVIEW_CHANNEL =
  'Add a review channel for your team to the team directory';
```

  In `server.ts`:
  - Import `NO_REVIEW_CHANNEL` from `./codeowner-posts.ts`.
  - In `/slack/resolve` (~L3776) and the signal-reaction path (~L4521), both of which fall back to `config.slack.channel`, return early with no lookup when the resolved channel is `''`. `/slack/resolve` answers `400 NO_REVIEW_CHANNEL`; the reaction path does nothing.
  - In `ownersPostPlan`, delete the `ownSections` computation. Pass `ownChannels: config.ownChannels ?? []` in both `planOwnersPost` calls, dropping `ownSections` and `teamChannel`.
  - At the top of `ownersPreviewOrPost`, add: `if (!channelForMR(config, mr)) return new Response(NO_REVIEW_CHANNEL, { status: 400 });`.
  - In `/slack/post`, right after `targetChannel` is resolved, add: `if (!targetChannel) return new Response(NO_REVIEW_CHANNEL, { status: 400 });`.
  - In `sweepOnce`, filter out targets whose `channelForMR(config, mr)` is `''` before calling `sweepSlackRefs`.

  In `data.ts` `configuredSlackChannels`, return `[...channels].filter(Boolean)`.

  In `slack-post-flow.ts`, import `NO_REVIEW_CHANNEL` from `../../codeowner-posts.ts` and change the failed-preview branch to:

```ts
  if (!read.ok) {
    if (read.status === 400 && read.text === NO_REVIEW_CHANNEL)
      return toast.fail(NO_REVIEW_CHANNEL);
    return postTeam(
      mr,
      deps,
      toast,
      `could not check code owners (${read.status})${read.text ? `: ${read.text}` : ''}`
    );
  }
```

- [ ] **Step 6: Update the docs.** In `apps/board/docs/configuration.md` ("Posting to code owners"), replace the sentence beginning "Your team's sections are the codeowners tab's section" with:

```markdown
Your team's sections are the ones whose channel is one of your team's
channels in the org's `mattstack.directory`: its code owners channel or any
channel listed under it. Their channel is where other teams ask you, so it is
never offered for your own MRs.
```

and add at the end of the section:

```markdown
The team channel is your team's first channel of kind `board.slack.reviewKind`
(default `review`) in `mattstack.directory`. With none, posting says to add
one. A codeowners tab watches your team's code owners channel unless you give
it a `slackChannel` of its own, and `board.ticketPrefixes` defaults to your
team's Linear key.
```

  Fix the other stale lines:
  - **`configuration.md` L100-101:** a tab's `slackChannel` overrides "your team's code owners channel from `mattstack.directory`", no longer `slack.channel`.
  - **`configuration.md` L161:** when the approvals cannot be read, the item still posts to the team channel, unless the team has no review channel. Then it says so and posts nothing.
  - **`slack.md` L66 and L80:** replace the `slack.channel` / `code-review` lines with: "The channel the board posts to is your team's `review` channel in the org's `mattstack.directory` (`rt settings set mattstack.directory ... --scope org`). The board has no default channel."

- [ ] **Step 7: Run the board suite**

Run (from `apps/board`): `bun test`
Expected: PASS.

Run (repo root): `bun run docs:check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/board/
git commit -m "board: route code owner sections by the team directory; no review channel is a clear refusal"
```

---

### Task 6: The Linear key comes from the directory

**Files:**
- Modify: `lib/setup/team-settings.ts` (`TeamIntegrations`, `readTeamSnapshot`)
- Modify: `apps/boxscore/scripts/import-legacy-settings.ts`. It no longer writes `linear.teamKey` (lines ~87-100 and ~212).
- Modify: `apps/boxscore/test/import-legacy.test.ts` (L50-78):
  - the `mergeIntegrations(current, { teamKey })` cases go away;
  - the remaining host cases stay, but any of them that also passes `teamKey`, such as the first one with `host` plus `teamKey: 'ZZ'`, loses that argument and any `linear.teamKey` expectation, or it will not type-check.
- Modify: `apps/boxscore/README.md` (L86). Drop the `linear.teamKey` mention, and say the team's Linear key is in `mattstack.directory`.
- Modify: `lib/setup/integrations.ts` (the L47 comment). It names `mattstack.directory`'s `linear.team` instead of `mattstack.integrations.linear.teamKey`.
- Test: `lib/setup/__tests__/team-settings.test.ts`

**Interfaces:**
- Consumes: `directoryEntry` and `TeamDirectory` (Task 2); `activeTeam` (rt-client `settings/active-team.ts`).
- Produces: `readTeamSnapshot(p, slug, { read?, warn?, team? })`. `snapshot.integrations.linear` is `{ teamKey }` from the active team's directory entry, or absent. `lib/daemon.ts`, `commands/setup.ts` and `lib/setup/validators/accounts.ts` keep reading `team.integrations.linear?.teamKey` unchanged.

- [ ] **Step 1: Write the failing tests.** In `describe("readTeamSnapshot — injected read seam", ...)`:
  1. Change the first test's `integrations` fixture to `{ forge: { host: "gitlab.example.com", provider: "gitlab" } }`, and pass `team: null`.
  2. Add:

```ts
  test("the Linear key comes from the active team's directory entry", () => {
    const read = fakeReader({
      "mattstack.integrations": { forge: { host: "gitlab.example.com", provider: "gitlab" } },
      "mattstack.directory": { teams: { claim: { linear: { team: "CV" } } } },
    });
    const snapshot = readTeamSnapshot(fakeProbes({ home: "/fake-home" }), "acme", { read, team: "claim" });
    expect(snapshot.integrations.linear).toEqual({ teamKey: "CV" });
  });

  test("a stray integrations teamKey is ignored", () => {
    const read = fakeReader({ "mattstack.integrations": { linear: { teamKey: "OLD" } } });
    const snapshot = readTeamSnapshot(fakeProbes({ home: "/fake-home" }), "acme", { read, team: "claim" });
    expect(snapshot.integrations.linear).toBeUndefined();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run (repo root): `bun test lib/setup/__tests__/team-settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `team-settings.ts`, add the imports:

```ts
import { activeTeam } from "../../packages/rt-client/src/settings/active-team.ts";
import { directoryEntry, type TeamDirectory } from "../../packages/rt-client/src/settings/team-directory.ts";
```

Leave `TeamIntegrations.linear` as `{ teamKey: string }`. It is now filled only from the directory. Add `team?: string | null` to the `readTeamSnapshot` opts, and replace the `integrations` line with:

```ts
  const { linear: _retired, ...declared } = read<TeamIntegrations>("mattstack.integrations") ?? {};
  const team = opts.team !== undefined ? opts.team : activeTeam().team;
  const linearTeam = directoryEntry(read<TeamDirectory>("mattstack.directory"), team)?.linear?.team;
  const integrations: TeamIntegrations = linearTeam ? { ...declared, linear: { teamKey: linearTeam } } : declared;
```

In `apps/boxscore/scripts/import-legacy-settings.ts`:
- delete the `teamKey` merge branch (the `if (incoming.teamKey !== undefined ...)` block);
- delete the `teamKey: settingsJson.linearTeam` argument, and its parameter in the function's `incoming` type.

- [ ] **Step 4: Run the tests**

Run (repo root): `bun test lib/setup/__tests__/`
Run (repo root): `bun run boxscore:test` (vitest)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/team-settings.ts lib/setup/integrations.ts lib/setup/__tests__/team-settings.test.ts apps/boxscore/scripts/import-legacy-settings.ts apps/boxscore/test/import-legacy.test.ts apps/boxscore/README.md
git commit -m "setup: the team's Linear key comes from the team directory"
```

---

### Task 7: Migration that seeds the directory and deletes the old settings

**Files:**
- Create: `lib/setup/migrations/team-directory.ts`
- Modify: `lib/setup/migrations/index.ts` (append to `MIGRATIONS`)
- Modify: `lib/setup/__tests__/migration-sdm-resources-key.test.ts`. Its "is the last migration in the list" becomes `expect(MIGRATIONS).toContain(sdmResourcesKeyMigration)`.
- Modify: `commands/__tests__/onboarding-org.test.ts` (~L438). Add `"migration.2026-10-08-team-directory"` to `expectedOrder` after `"migration.2026-10-07-sdm-resources-key"`.
- Check: `commands/__tests__/member-upgrade.test.ts`. If it pins the migration list or the last migration, add the new id the same way.
- Test: `lib/setup/__tests__/migration-team-directory.test.ts`

**Interfaces:**
- Consumes:
  - `orgLayoutState(p)` (`lib/team/org-layout.ts`); its kinds are `none`, `ready` and `waiting`;
  - `listTeamFolders` and `readStore` (rt-client `settings/stores.ts`);
  - `orgSettingsPath` and `teamSettingsPath` (rt-client `settings/paths.ts`);
  - `getDef` (rt-client `settings/registry-machinery.ts`) and `readSection` (rt-client `settings/migrate.ts`);
  - `setSetting`, `unsetSetting`, `pruneStoreName` and `SettingsOwnershipRefusal` (`lib/settings/write.ts`, which re-exports rt-client's);
  - `normalizeChannel`, `DirectoryTeam` and `TeamDirectory` (Task 2).
- Produces:
  - `teamDirectoryMigration: MigrationDef` (id `2026-10-08-team-directory`);
  - `entryFromTeamStore(values, orgValues): DirectoryTeam | null`;
  - `withoutRetired(values, entry): Array<{ key: string; value: unknown | undefined }>`. These writes delete one store's moved values; `value: undefined` means unset.

Constraints:
- `board.tabs` has `storeVersion: 2`, so a store may hold it as `board.tabs` (v1) or `board.tabs@2`. Always read it with `readSection(getDef("board.tabs")!, values, { layer: false }).value`. After writing it, prune every older name with `pruneStoreName(..., { force: true })`. Without the prune, the stale v1 value stays behind and a second run sees it again.
- `board.slack` and `mattstack.integrations` allow only `team` and `org` scopes. User and machine stores can't hold them, and the resolver skips any such value, so there is no per-Mac cleanup.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/setup/__tests__/migration-team-directory.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readSection } from "../../../packages/rt-client/src/settings/migrate.ts";
import { getDef } from "../../../packages/rt-client/src/settings/registry-machinery.ts";
import { readStore } from "../../../packages/rt-client/src/settings/stores.ts";
import { seedOrg, type SeedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { entryFromTeamStore, teamDirectoryMigration, withoutRetired } from "../migrations/team-directory.ts";
import { createRealProbes } from "../probes.ts";

const run = () => teamDirectoryMigration.run({ p: { ...createRealProbes(), home: process.env.HOME! } } as Partial<ApplyContext> as ApplyContext);
function seedClone(opts: SeedOrg) {
  const seeded = seedOrg(opts);
  const dir = join(process.env.HOME!, ".mattstack", "orgs", seeded.org);
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "config"), "");
  return seeded;
}
const store = (file: string) => readStore(file).global as Record<string, unknown>;
const tabsIn = (file: string) => readSection(getDef("board.tabs")!, store(file), { layer: false }).value as Array<Record<string, unknown>>;

const TABS = [
  { id: "team", label: "Team", source: { kind: "authors" } },
  { id: "q", label: "Q", source: { kind: "codeowners", section: "Claim - #pod-claim" }, slackChannel: "pod-claim" },
  { id: "w", label: "W", source: { kind: "codeowners", section: "Acme - #pod-acme" }, slackChannel: "pod-acme" },
];
// The v1 store name, as the live team store holds it today.
const CLAIM_STORE = {
  "mattstack.integrations": { linear: { teamKey: "CV" } },
  "board.slack": { channel: "claim-internal", singleTemplate: "{title}: {url}" },
  "board.tabs": TABS,
  "board.ticketPrefixes": ["CV"],
};
const ENTRY = {
  linear: { team: "CV" },
  slack: { codeOwnersChannel: "pod-claim", channels: [{ name: "claim-internal", kind: "review" }] },
};
const adminRoles = { admins: ["me"], teams: { claim: { owners: ["me"] } } };
const roster = [{ username: "me", teams: ["claim"] }];

describe("entryFromTeamStore", () => {
  test("builds an entry from the Linear key, the board channel and the first codeowners tab channel", () => {
    expect(entryFromTeamStore(CLAIM_STORE, {})).toEqual(ENTRY);
  });
  test("reads tabs stored under the current versioned name too", () => {
    const { "board.tabs": tabs, ...rest } = CLAIM_STORE;
    expect(entryFromTeamStore({ ...rest, "board.tabs@2": tabs }, {})).toEqual(ENTRY);
  });
  test("takes the org's board channel when the team has none", () => {
    expect(entryFromTeamStore({}, { "board.slack": { channel: "org-review" } })).toEqual({
      slack: { channels: [{ name: "org-review", kind: "review" }] },
    });
  });
  test("a store with nothing to move gives no entry", () => {
    expect(entryFromTeamStore({}, {})).toBeNull();
  });
});

describe("withoutRetired", () => {
  test("drops the moved fields and keeps everything else", () => {
    expect(withoutRetired(CLAIM_STORE, ENTRY)).toEqual([
      { key: "board.slack", value: { singleTemplate: "{title}: {url}" } },
      { key: "mattstack.integrations", value: undefined },
      { key: "board.tabs", value: [TABS[0], { id: "q", label: "Q", source: TABS[1]!.source }, TABS[2]] },
      { key: "board.ticketPrefixes", value: undefined },
    ]);
  });
  test("keeps ticket prefixes that add to the Linear key", () => {
    expect(withoutRetired({ "board.ticketPrefixes": ["CV", "PLA"] }, ENTRY).find((w) => w.key === "board.ticketPrefixes")).toBeUndefined();
  });
});

describe("2026-10-08-team-directory", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "dir-mig-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("is the last migration in the list", () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1]).toBe(teamDirectoryMigration);
  });

  test("an admin's Mac seeds the directory and deletes what moved", async () => {
    const { orgStore, teamStores } = seedClone({
      username: "me",
      roles: adminRoles,
      roster,
      settings: { "board.slack": { channel: "org-old" } },
      teams: { claim: CLAIM_STORE },
    });
    const result = await run();
    expect(result.state).toBe("done");
    expect(store(orgStore)["mattstack.directory"]).toEqual({ teams: { claim: ENTRY } });
    expect(store(orgStore)["board.slack"]).toBeUndefined();
    const team = store(teamStores.claim!);
    expect(team["board.slack"]).toEqual({ singleTemplate: "{title}: {url}" });
    expect(team["mattstack.integrations"]).toBeUndefined();
    expect(team["board.ticketPrefixes"]).toBeUndefined();
    expect(team["board.tabs"]).toBeUndefined();
    expect(tabsIn(teamStores.claim!).map((t) => t.slackChannel)).toEqual([undefined, undefined, "pod-acme"]);
  });

  test("a second run changes nothing", async () => {
    seedClone({ username: "me", roles: adminRoles, roster, teams: { claim: CLAIM_STORE } });
    await run();
    expect((await run()).state).toBe("skipped");
  });

  test("an existing entry is never overwritten, and its team's old values are still deleted", async () => {
    const { orgStore, teamStores } = seedClone({
      username: "me",
      roles: adminRoles,
      roster,
      settings: { "mattstack.directory": { teams: { claim: { linear: { team: "KEEP" } } } } },
      teams: { claim: CLAIM_STORE },
    });
    await run();
    expect(store(orgStore)["mattstack.directory"]).toEqual({ teams: { claim: { linear: { team: "KEEP" } } } });
    expect(store(teamStores.claim!)["mattstack.integrations"]).toBeUndefined();
  });

  test("a Mac that cannot write the org store leaves every shared store alone", async () => {
    const { orgStore, teamStores } = seedClone({
      username: "me",
      roles: { admins: ["someone-else"], teams: { claim: { owners: ["someone-else"] } } },
      roster,
      teams: { claim: CLAIM_STORE },
    });
    const result = await run();
    expect(result.state).toBe("skipped");
    expect(store(orgStore)["mattstack.directory"]).toBeUndefined();
    expect(store(teamStores.claim!)["board.slack"]).toEqual(CLAIM_STORE["board.slack"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (repo root): `bun test lib/setup/__tests__/migration-team-directory.test.ts`
Expected: FAIL, "Cannot find module '../migrations/team-directory.ts'".

- [ ] **Step 3: Implement**

```ts
// lib/setup/migrations/team-directory.ts
import { readSection } from "../../../packages/rt-client/src/settings/migrate.ts";
import { orgSettingsPath, teamSettingsPath } from "../../../packages/rt-client/src/settings/paths.ts";
import { getDef } from "../../../packages/rt-client/src/settings/registry-machinery.ts";
import { listTeamFolders, readStore } from "../../../packages/rt-client/src/settings/stores.ts";
import { normalizeChannel, type DirectoryTeam, type TeamDirectory } from "../../../packages/rt-client/src/settings/team-directory.ts";
import { pruneStoreName, SettingsOwnershipRefusal, setSetting, unsetSetting } from "../../settings/write.ts";
import { orgLayoutState } from "../../team/org-layout.ts";
import type { MigrationDef } from "./index.ts";

type Tab = { source?: { kind?: string }; slackChannel?: string } & Record<string, unknown>;
type Write = { key: string; value: unknown | undefined };
type Values = Record<string, unknown>;

const slackOf = (v: Values) => v["board.slack"] as ({ channel?: string } & Values) | undefined;
/** board.tabs is versioned; a store may hold it under either name. */
const tabsOf = (v: Values) => readSection(getDef("board.tabs")!, v, { layer: false }).value as Tab[] | undefined;

export function entryFromTeamStore(values: Values, orgValues: Values): DirectoryTeam | null {
  const linear = (values["mattstack.integrations"] as { linear?: { teamKey?: string } } | undefined)?.linear?.teamKey;
  const review = slackOf(values)?.channel ?? slackOf(orgValues)?.channel;
  const codeOwners = (tabsOf(values) ?? []).find((t) => t.source?.kind === "codeowners" && t.slackChannel)?.slackChannel;
  if (!linear && !review && !codeOwners) return null;
  return {
    ...(linear ? { linear: { team: linear } } : {}),
    ...(review || codeOwners
      ? {
          slack: {
            ...(codeOwners ? { codeOwnersChannel: codeOwners } : {}),
            ...(review ? { channels: [{ name: review, kind: "review" }] } : {}),
          },
        }
      : {}),
  };
}

/** The writes that delete one store's moved values; an emptied object is unset. */
export function withoutRetired(values: Values, entry: DirectoryTeam): Write[] {
  const writes: Write[] = [];
  const slack = slackOf(values);
  if (slack && "channel" in slack) {
    const { channel: _c, ...rest } = slack;
    writes.push({ key: "board.slack", value: Object.keys(rest).length ? rest : undefined });
  }
  const integrations = values["mattstack.integrations"] as ({ linear?: Values } & Values) | undefined;
  if (integrations?.linear && "teamKey" in integrations.linear) {
    const { teamKey: _k, ...linear } = integrations.linear;
    const { linear: _l, ...rest } = integrations;
    const next = Object.keys(linear).length ? { ...rest, linear } : rest;
    writes.push({ key: "mattstack.integrations", value: Object.keys(next).length ? next : undefined });
  }
  const own = entry.slack?.codeOwnersChannel;
  const tabs = tabsOf(values);
  const isOwn = (t: Tab) => t.source?.kind === "codeowners" && !!t.slackChannel && !!own && normalizeChannel(t.slackChannel) === normalizeChannel(own);
  if (tabs?.some(isOwn)) {
    writes.push({
      key: "board.tabs",
      value: tabs.map((t) => {
        if (!isOwn(t)) return t;
        const { slackChannel: _s, ...rest } = t;
        return rest;
      }),
    });
  }
  const prefixes = values["board.ticketPrefixes"] as string[] | undefined;
  const team = entry.linear?.team;
  if (team && prefixes?.length === 1 && prefixes[0]!.toUpperCase() === team.toUpperCase()) {
    writes.push({ key: "board.ticketPrefixes", value: undefined });
  }
  return writes;
}

function apply(org: string, writes: Write[], scope: "org" | "team", opts: { team?: string } = {}): number {
  for (const w of writes) {
    if (w.value === undefined) unsetSetting(w.key, scope, opts);
    else setSetting(w.key, w.value, scope, opts);
    if (w.key === "board.tabs") {
      const file = scope === "team" ? teamSettingsPath(org, opts.team!) : orgSettingsPath(org);
      for (const older of readSection(getDef("board.tabs")!, readStore(file).global, { layer: false }).older)
        pruneStoreName("board.tabs", older.storeName, scope, { ...opts, force: true });
    }
  }
  return writes.length;
}

export const teamDirectoryMigration: MigrationDef = {
  id: "2026-10-08-team-directory",
  title: "Move your teams' channels and Linear keys into the team directory",
  async run(ctx) {
    const layout = orgLayoutState(ctx.p);
    if (layout.kind === "none") return { state: "skipped", detail: "This Mac is in no org" };
    if (layout.kind === "waiting") return { state: "skipped", detail: "Your org has not moved to its new layout yet; nothing to move on this Mac" };
    const org = layout.slug;
    const orgValues = readStore(orgSettingsPath(org)).global;
    const existing = (orgValues["mattstack.directory"] ?? {}) as TeamDirectory;
    const teams = { ...(existing.teams ?? {}) };
    const claimed = new Set(Object.values(teams).flatMap((t) => (t.slack?.codeOwnersChannel ? [normalizeChannel(t.slack.codeOwnersChannel)] : [])));
    const folders = listTeamFolders(org);
    let added = 0;
    for (const team of folders) {
      if (teams[team]) continue;
      const entry = entryFromTeamStore(readStore(teamSettingsPath(org, team)).global, orgValues);
      if (!entry) continue;
      const own = entry.slack?.codeOwnersChannel;
      if (own && claimed.has(normalizeChannel(own))) continue;
      if (own) claimed.add(normalizeChannel(own));
      teams[team] = entry;
      added++;
    }
    let changed = 0;
    try {
      if (added > 0) {
        setSetting("mattstack.directory", { ...existing, teams }, "org");
        changed += added;
      }
      for (const [team, entry] of Object.entries(teams)) {
        if (!folders.includes(team)) continue;
        changed += apply(org, withoutRetired(readStore(teamSettingsPath(org, team)).global, entry), "team", { team });
      }
      const orgSlack = slackOf(orgValues);
      if (orgSlack && "channel" in orgSlack) changed += apply(org, withoutRetired({ "board.slack": orgSlack }, {}), "org");
    } catch (err) {
      if (!(err instanceof SettingsOwnershipRefusal)) throw err;
      if (changed === 0) return { state: "skipped", detail: "Only an org admin's Mac moves the team settings" };
    }
    return changed > 0
      ? { state: "done", detail: `Moved ${changed} ${changed === 1 ? "setting" : "settings"} into the team directory` }
      : { state: "skipped", detail: "Nothing left to move on this Mac" };
  },
};
```

In `index.ts`, import `teamDirectoryMigration` and append it after `sdmResourcesKeyMigration`. Then make the two test edits from the Files list:
- the sdm test's "last migration" assertion;
- `onboarding-org.test.ts`'s `expectedOrder`.

- [ ] **Step 4: Run the tests**

Run (repo root):
- `bun test lib/setup/__tests__/migration-team-directory.test.ts lib/setup/__tests__/migration-sdm-resources-key.test.ts lib/setup/__tests__/migrations.test.ts`
- `bun test commands/__tests__/onboarding-org.test.ts commands/__tests__/member-upgrade.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/migrations/ lib/setup/__tests__/migration-team-directory.test.ts lib/setup/__tests__/migration-sdm-resources-key.test.ts commands/__tests__/onboarding-org.test.ts commands/__tests__/member-upgrade.test.ts
git commit -m "setup: move team channels and Linear keys into the team directory, delete the old settings"
```

---

### Task 8: Console shows the directory

**Files:**
- Test: `apps/console/src/app/settings/groups.test.ts`

**Interfaces:**
- Consumes: the `mattstack.directory` row and lock (Task 1). No console code changes are expected: the console reads the registry, and this key's shape falls to its JSON editor.

- [ ] **Step 1: Pin the group.** In `groups.test.ts`, add:

```ts
it('puts the team directory in the Suite group', () => {
  expect(GROUPS.find(g => g.match('mattstack.directory'))?.id).toBe('suite');
});
```

Run (repo root): `bun run console:test`
Expected: PASS.

- [ ] **Step 2: Look at it in both schemes.** Run this branch's console server, not the deck-served one; `bun run dev` alone proxies `/api` to the shared checkout's console on 11011. From `apps/console`, following `apps/console/scripts/parity/run.md`:
  1. Start `PORT=11091 bun run src/server/index.ts`.
  2. Start `CONSOLE_API_PORT=11091 bunx vite --port 5191 --strictPort`.
  3. With Fast Browser, open `http://localhost:5191/settings?explain=mattstack.directory` and screenshot it in light and dark. Check that:
     - the row sits under Suite;
     - the JSON editor opens with the schema's titles and descriptions;
     - the value reads as unset.
  4. Open `?explain=board.slack` and check that `channel` is no longer a field.

  It reads this Mac's real settings, so view only and save nothing. Say plainly what looks wrong. Stop both processes.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/app/settings/groups.test.ts
git commit -m "console: pin the team directory to the Suite group"
```

---

### Task 9: Whole-branch verification

- [ ] **Step 1: Typecheck**

Run (repo root): `bun run typecheck`, then `bun run board:typecheck` and `bun run console:typecheck`
Expected: all clean.

- [ ] **Step 2: Run the touched suites**

Run (repo root): `bun test packages/rt-client/src/settings lib/setup`
Run (from `apps/board`): `bun test`
Run (repo root): `bun run console:test`
Expected: PASS.

- [ ] **Step 3: Check rt-client's dist is fresh**

Run (repo root): `bun test packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS. If it fails, rebuild rt-client; `dist/` is not committed.

- [ ] **Step 4: Guards**

Run (repo root): `bun test lib/__tests__/no-settings-bypass.test.ts`
Expected: PASS. The migration reads stores through `readStore`, which that guard counts. If it fails, add the file to the guard's allowlist with its pinned count, as the guard's message says.

- [ ] **Step 5: The release must carry the code and the migration together.** Put this sentence in the PR description: "Ships the team directory and the migration that deletes `board.slack.channel` and `mattstack.integrations.linear.teamKey`; members need this release before the admin's Mac runs `rt setup update`."
