# Chat Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every rt chat session gets a hidden identity id behind its display name, so a recycled name never inherits another agent's rooms, DMs, unread or history.

**Architecture:** A new `chat_identities` table maps ids (`remy.k3f9`) to display names; every existing handle is its own id, so no rows are rewritten. Sign-in mints a fresh id unless the caller explicitly continues one (herd, `rt agent start` reservations, `--as`). Every wire type keeps `handle` as the id and adds a display-name sibling; every surface shows the name and acts on the id.

**Tech Stack:** Bun + TypeScript + bun:sqlite (rt core, rt-client), React + Vite (apps/chat), Rust (herdr-chat), Swift (flock), Markdown skills.

**Spec:** `docs/superpowers/specs/2026-09-27-chat-identity-design.md`

This file is the master plan: shared constraints, the frozen contract every lane builds against, and the integration tasks. Each lane's task list is its own file under `docs/superpowers/plans/2026-09-27-chat-identity/`:

| Lane | File | Repo and tree |
|---|---|---|
| 1a rt state | `lane-1a-rt-state.md` | repo-tools, own worktree |
| 1b rt daemon, CLI, MCP | `lane-1b-rt-daemon.md` | repo-tools, own worktree, rebased on 1a |
| 2 rt-client + chat viewer | `lane-2-client-viewer.md` | repo-tools, own worktree |
| 3 herdr-chat | `lane-3-herdr-chat.md` | ~/Documents/GitHub/herdr-chat, `.worktrees/chat-identity` |
| 4 flock | `lane-4-flock.md` | ~/Documents/GitHub/flock, main checkout on main (flock rule) |
| 5 skills, plugins, docs | `lane-5-skills-docs.md` | repo-tools + mattstack-marketplace + mattstack-skills |

## Global Constraints

- Id format: `<base>.<suffix>`, suffix 4 lowercase base36 chars from `sha256(sessionId + ":" + mintedAt)`; lengthen to 6 on a clash. Charset stays `[a-z0-9._-]+`; never `#`.
- Every existing handle is its own id. No existing row in any table is rewritten.
- An id with no `chat_identities` row has itself as its name.
- Fixed ids that never mint: `chat.humanHandle` (default `matt`) and `SYSTEM_HANDLE` (`herdr`).
- `SCHEMA_VERSION` goes 13 to 14. Schema blocks contain only `IF NOT EXISTS` statements.
- No surface ever displays an id, except the reply hint in agent delivery frames (`rt chat dm <id>`).
- Consumers fall back to `handle` when a `name` field is missing.
- No em dashes or en dashes in code, comments, docs, commits or PR bodies.
- Comments only for constraints the code cannot show (clean-code-comments rule); no decision history in source.
- Built rt binaries run only under an isolated HOME. `bun test` runs from the repo root. Rebuild `packages/rt-client/dist` after touching rt-client.
- Skill edits go through `superpowers:writing-skills`.
- mattstack ticket ids never appear in the herdr-chat or flock repos' code; they are fine in rt.

## Review Focus

1. A session's presence row is pruned (daemon restart, stale sweep) and the same Claude session signs in again: it must get the same id back, found through `chat_identities.session_id`. Owner: lane 1a Task 3.
2. Two live sessions race to sign in with the same requested display name (herdr-chat signs panes in concurrently): exactly one gets `remy`, the other `remy-2`, and both get distinct ids. Owner: lane 1a Task 3.
3. A legacy handle that already contains a dot (older derived handles) is typed as a DM target or `--as`: it resolves as a known id (step 1), never as "name remy.x". Owner: lane 1a Task 4.
4. The viewer shows a legacy `remy` and a new `remy.k3f9` in one room and in two DM rows with kai: rows stay distinct (keys by id), colours differ, labels read `kai ↔ remy`. Owner: lane 2.
5. `--as matt` or `continue: "matt"` (the human) or `continue` of an id live in another session is refused with today's error wording. Owner: lane 1a Task 5.

## The frozen contract

Every lane builds against these names and types. A lane that needs to change one stops and raises it with the shepherd; it never renames locally.

### Store API (lane 1a produces, lane 1b consumes)

New file `lib/state/identity-store.ts`, re-exported from `lib/state/index.ts`:

```ts
export interface IdentityRow { id: string; name: string; baseName: string; mintedAt: number; sessionId: string | null }

/** Mints and inserts a fresh identity. `name` is the display name (suffix included); `base` is the pool or chosen base. */
export function mintIdentity(args: { base: string; name: string; sessionId: string | null; now?: number }, db?: Database): IdentityRow;

/** The identity a session already holds, if any (survives presence prune). */
export function identityForSession(sessionId: string, db?: Database): IdentityRow | undefined;

/** Binds an existing identity (a reservation or a continuation) to a session. */
export function bindIdentitySession(id: string, sessionId: string, db?: Database): void;

/** Display name for one id; falls back to the id itself. */
export function identityName(id: string, db?: Database): string;

/** Display names for many ids in one query; every input id is a key, missing rows map to themselves. */
export function identityNames(ids: Iterable<string>, db?: Database): Map<string, string>;

/** True when `x` is a known id: a chat_identities row, or a handle in chat_presence, chat_members, chat_messages or chat_dms. */
export function isKnownId(x: string, db?: Database): boolean;

/** Spec "Resolving a typed name": known id, else live display name, else most recent identity by name, else `x`. */
export function resolveHandle(x: string, db?: Database): string;
```

`lib/state/presence-store.ts`:

```ts
export function signIn(
  args: { sessionId: string; baseHandle?: string; continueId?: string; cwd?: string; repo?: string; branch?: string; pane?: string; statusText?: string; now?: number },
  db?: Database, deps?: RegistryDeps,
): { handle: string; baseHandle: string; name: string; reclaimed: boolean; continued: boolean } | undefined;

/** Mints the reservation at draw time; returns the id. */
export function reserveAgentHandle(db?: Database, now?: number): string;
```

`PresenceRow` (store type) gains `name: string`. `paneHandleFor` and `rememberPaneHandle` are deleted.

`lib/chat-names.ts`: `AGENT_NAMES` grows to at least 1,000 entries; `pickAgentName` signature unchanged.

`lib/state/chat-store.ts`: `ChatMessage` (store type) gains `name: string` and `mentionNames: string[]`; `MemberRow`-derived `ChatMember` gains `name`. `peekUnread` and `readUnread` exclude the reader's own messages.

### Wire (lane 2 produces in rt-client; lanes 1b, 2 consume)

`packages/rt-client/src/commands.ts`, exact additions:

```ts
export interface ChatMember { /* existing */ name: string }
export interface ChatMessage { /* existing */ name: string; mentionNames: string[]; quiet?: boolean }
export type ChatClaimOutcome =
  | { outcome: "claimed"; author: string; authorName: string; room: string; previousHolder?: string; previousHolderName?: string }
  | { outcome: "held"; author: string; authorName: string; room: string }
  | { outcome: "lost"; holder: string; holderName: string; claimedAt: number; expiresAt: number };
export interface RoomSummary { /* existing */ participants?: { a: string; b: string; aName: string; bName: string } }
export interface PresenceRow { /* existing */ name: string }
export interface ChatPane { /* existing */ presence?: { handle: string; name: string; status: BuddyStatus; rooms: string[] } }
export interface AgentRecord { /* existing */ name?: string }
export interface HerdInfo { /* existing */ shepherdName: string }
export interface HerdJobInfo { /* existing */ handleName: string }
```

Commands:

| Command | Change |
|---|---|
| `chat:join` | data adds `name: string` |
| `chat:post` | data adds `recipientNames: string[]` (parallel to `recipients`) |
| `chat:dm` | data adds `recipientNames: string[]` |
| `chat:ack` | data adds `authorName: string` |
| `chat:release` | data adds `holderName: string` |
| `chat:sign-in` | payload adds `continue?: string`; data adds `name: string`, `continued: boolean` |

Payload fields `handle`, `from`, `to`, `mentions[]` accept an id or a name; the daemon resolves with `resolveHandle` before use. The human's own `handle` and the session-file handle are ids already.

Session file `~/.mattstack/rt/chat/sessions/<sessionId>.json`: `{ "handle": "<id>", "baseHandle": "<base>", "name": "<display>" }`.

Delivery frame (agent-facing): header and lines show names; the reply hint line names the sender's id, e.g. `Reply privately with: rt chat dm remy.k3f9 "..."` (lane 1b owns the exact wording in `lib/daemon/inbox.ts`).

### herdr-chat JSON (lane 3 produces; lane 4 consumes)

| Verb output | Change |
|---|---|
| `status` | `{ ..., "handle": "<id>"|null, "name": "<display>"|null }` |
| `peek.buddies[]` | adds `"name"` |
| `jump` | adds `"name"` |
| `targets.people[]` | unchanged format `"@<display name>"` |
| `quick-send --to @x` | `x` may be a name or an id |
| `jump --handle x` | `x` may be a name or an id |

`broadcasts.json` `Recipient`: `{ "handle": "<id>", "name": "<display>", ... }`; reading an old file with no `name` falls back to `handle`.

### flock (lane 4)

`ChatStatus.name: String?`, `ChatBuddy.name: String?`, `ChatJump.name: String?`. Display `name ?? handle`. Act on `handle`.

## Lane dependencies

- 1a and 2 and 3 and 4 and 5 start at once.
- 1b starts at once against the store API above, writes its tests against it, and rebases on 1a when 1a's branch is green; its tests run for real only after the rebase.
- 2's viewer server calls the daemon through rt-client; its tests use fixtures (`apps/chat/src/server/fixtures.ts`), so it does not wait on 1a/1b.
- 3 and 4 test against fixture JSON in the shapes above.

---

## Integration tasks (shepherd, after all lanes are green)

### Task I1: Claim schema version 14

- [ ] **Step 1:** Check no other open rt branch has taken v14: `git fetch origin && git log origin/main -1 --format=%h -- lib/state/db.ts` and `grep -n "SCHEMA_VERSION = " lib/state/db.ts` on `origin/main`. If main is already at 14, renumber lane 1a's schema to the next free number and amend.
- [ ] **Step 2:** Announce in `#rt` with the `chat_post` tool: "Taking SCHEMA_VERSION 14 for chat_identities (chat identity lanes). Renumber if you are also on 14."

### Task I2: Combine the rt lanes into one PR

- [ ] **Step 1:** In the lane 1a worktree, merge lane 1b then lane 2 then lane 5's repo-tools commits (`git merge --no-ff <branch>`), resolving conflicts in favour of the contract above.
- [ ] **Step 2:** Run the full gates from the repo root: `bun run check`, `bun run test:all`, `bun run chat:test` (or the viewer's vitest script named in `apps/AGENTS.md`). Expected: all green. Capture long output to a file once and grep it.
- [ ] **Step 3:** `cd packages/rt-client && bun run build`, then re-run `bun test packages/rt-client/test/dist-freshness.test.ts` from the repo root. Expected: PASS.
- [ ] **Step 4:** Open the PR to `main` titled `chat: a hidden identity behind every handle`; wait for CodeRabbit and CI per the Coderabbit rule.

### Task I3: The incident, end to end, under an isolated HOME

- [ ] **Step 1:** Build the binary into a scratch dir and run it only under `env -i HOME=<temp> PATH=$PATH`. Start its daemon in that HOME.
- [ ] **Step 2:** Script: sign in session A with `--as remy` (continuation of nothing, so it mints), DM kai, sign A out, run `rt chat prune`; make `remy` the only least-recently-used name by writing the `chat`/`names` kv ledger in the temp HOME's `state.db` with `sqlite3` (every other `AGENT_NAMES` entry stamped now, `remy` stamped 0), then sign in session B with no `--as`. Expected: B's `handle` differs from A's; `rt chat rooms --json` for B lists no DM; B's welcome frame has no catch-up; `rt chat dm remy "hi"` from kai lands in a new DM room.
- [ ] **Step 3:** Stop that daemon; delete the temp HOME after asserting its path is under the scratchpad.

### Task I4: UI validation (mandatory)

- [ ] **Step 1:** Delegate to `fast-browser:browser-driver`: open the chat viewer from `deck list`'s localhost URL for chat in a dev instance seeded with a legacy `remy` and a new `remy.k3f9` in `#rt` and one DM each with kai. Screenshot light and dark.
- [ ] **Step 2:** Check by eye: no `.k3f9` anywhere, two DM rows both labelled `kai ↔ remy` with different hues, mention highlight on `@remy`. Report plainly what looks wrong.
- [ ] **Step 3:** flock: after lane 4's dev build, screenshot the chat popover, peek and quick-send in both schemes; same checks.

### Task I5: Ship order on merge day

- [ ] **Step 1:** Merge the rt PR; in the shared checkout confirm `git branch --show-current` is `main`, pull, restart the dev daemon, `deck restart chat`.
- [ ] **Step 2:** Merge herdr-chat; rebuild and reinstall the plugin per its README.
- [ ] **Step 3:** flock: `Scripts/dev-build.sh` on main.
- [ ] **Step 4:** mattstack-marketplace and mattstack-skills: publish per `mattstack:editing-skills`; run `/reload-plugins` in live sessions.
