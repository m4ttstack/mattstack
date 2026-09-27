# Lane 2: rt-client and the chat viewer (chat identity)

Part of `docs/superpowers/plans/2026-09-27-chat-identity.md` (master plan: constraints, frozen contract, integration). Spec: `docs/superpowers/specs/2026-09-27-chat-identity-design.md`.

**Repo:** repo-tools. **Tree:** this lane's own rt worktree, branched from `chat-identity` (get one with EnterWorktree name-mode, for example `chat-identity-lane-2`; never hand-roll `git worktree add`). Every command below runs from that tree's root unless it names another path.

**Goal:** rt-client carries the frozen contract's display-name fields, and the chat viewer shows names everywhere while keying, colouring and acting on ids.

**Architecture:** rt-client gains only type fields and one forwarded payload key; the wrappers stop restating data shapes inline and read them from `Commands`. The viewer gets one small helper module (`src/app/display-name.ts`) that every label site uses, a `nameOf` directory on the buddies context, and a `name` prop on `AgentName`. Hue and avatar already seed from `handle`, which is now the id, so they need no change beyond tests that pin them.

**Tech stack:** Bun + TypeScript (rt-client, `bun test`), React 19 + Mantine via `@mattstack/app-kit`, Hono server, vitest + Testing Library (viewer).

## PLAN NOTES (not contract issues)

1. **`remy.k3f9` collides with `remy` on the speaker hue.** `speakerHue` folds a 31-multiplier hash into 5 hues; `remy` and `remy.k3f9` both land on index 0 (purple chip). Their invadrs avatars do differ (palette index 1 vs 3). This lane's fixture therefore uses `remy.m2p4`, which differs from `remy` on both (chip index 1 vs 0, avatar index 4 vs 1) and from `kai` too. Master plan Task I4 seeds `remy.m2p4` too (shepherd ruling). The general point stands for real traffic: about one recycled name in five shares a chip colour with its old holder, and the avatar is the reliable tell.
2. **Two DM rows that read the same pair.** Today DM rows render no avatar (`withAvatar={false}`), so `kai ↔ remy` twice would be two identical rows. This lane shows the id-seeded avatars on a DM row only when another listed DM row has the same label. It is the least visible change that makes Review Focus 4 true; every other DM row is unchanged. `design/ANATOMY.md` records the rule.
3. **Root typecheck will name files this lane does not own.** Making `name`, `shepherdName` and friends required in rt-client breaks object literals typed with them outside this lane (for example `lib/__tests__/herd-cli.test.ts` builds `HerdInfo`). Those files belong to lane 1b. Task 1 lists them for the shepherd and does not edit them.
4. **The fixtures diverge from `design/build.py` on purpose.** The recycled remy, its DM with kai and three `#rt` messages exist only in `fixtures.ts`. `design/audit.mjs` will count one more roster row and one more DM than the artboards draw; that is expected until someone decides whether the artboards should grow the same case.

No CONTRACT ISSUE notes: every name below is used exactly as the frozen contract spells it.

## Lane constraints

- Everything in the master plan's Global Constraints applies. Most relevant here: no em or en dashes anywhere; comments only for constraints the code cannot show; consumers fall back to `handle` when a name field is missing; no surface ever displays an id.
- **Show `name`, act on `handle`.** Map keys, React keys, `data-testid`s, fetch bodies, `onOpenDm`, `insertMention`, mention ids, hue and avatar seeds all use the id. Visible text, `aria-label`s and the "title equals" checks use the name.
- **Commands.** rt-client: `bun test packages/rt-client/test/<file>` from the repo root (never from inside the package: bun reads `bunfig.toml` from the cwd only). Viewer, one file: `bun run --cwd apps/chat test src/app/<File>.test.tsx`. Viewer gates (what CI runs): `bun run chat:typecheck`, `bun run chat:lint`, `bun run chat:test`.
- rt-client's `dist/` is gitignored and stale until rebuilt: `bun run --cwd packages/rt-client build` after touching `packages/rt-client/src`, then `bun test packages/rt-client/test/dist-freshness.test.ts`.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use two `-m` flags (heredocs are refused in worktree sessions).

## Review Focus

The master plan's Review Focus 4 is this lane's: the viewer shows a legacy `remy` and a new `remy.m2p4` in one room and in two DM rows with kai; rows stay distinct (keys by id), colours differ, labels read `kai ↔ remy`. Pinned by Task 5 (`two identities that share a name read the same and keep their own hue`) and Task 6 (`Review Focus 4: two DM rows with kai stay distinct...`). Further failure modes this lane owns:

1. **An older daemon sends no `name`.** Every label falls back to the id. Owner: Task 3 (`displayName`/`dmPairLabel` fallback tests, `AgentName` fallback).
2. **A pane title that equals the display name but not the id.** `doing()` and `PaneRow` must still treat it as "the title just repeats the name". Owners: Task 3 (`doing`), Task 7 (`PaneRow`).
3. **Autocomplete picks one of two remys.** The text reads `@remy`, the posted `mentions` carry exactly the picked id. Owner: Task 7.
4. **A mention whose text is a name but whose id differs.** `@remy` highlights, and `data-mention` carries the id so "is this me" stays exact. Owner: Task 5.

## File map

| File | Change |
|---|---|
| `packages/rt-client/src/commands.ts` | contract type and command additions |
| `packages/rt-client/src/client.ts` | wrappers read data shapes from `Commands`; `chatSignIn` forwards `continue` |
| `packages/rt-client/test/chat-identity-wire.test.ts` | new: compile-time and wire tests |
| `packages/rt-client/README.md` | "Ids and names" subsection under "Chat" |
| `apps/chat/src/app/display-name.ts` (+ test) | new: `displayName`, `dmPairLabel` |
| `apps/chat/src/app/buddies-context.tsx` | `nameOf` directory, `memberNames` prop |
| `apps/chat/src/app/AgentName.tsx` (+ new test) | `name` prop; card header shows the name |
| `apps/chat/src/app/doing.ts` (+ test) | title check compares against the name |
| `apps/chat/src/server/inbox.ts`, `chat.ts`, `fixtures.ts` (+ tests) | card and DM tail carry names; recycled-remy fixtures |
| `apps/chat/src/app/remark-mentions.ts`, `MessageMarkdown.tsx`, `Transcript.tsx`, `Reader.tsx`, `InboxCard.tsx` (+ tests) | names in headers and mentions |
| `apps/chat/src/app/FleetTree.tsx`, `PageBar.tsx`, `App.tsx`, `RoomRail` test | DM labels, member rows, result line, member names |
| `apps/chat/src/app/Composer.tsx`, `PanePicker/PaneRow.tsx`, `PanePicker/PanePickerModal.tsx` (+ tests) | autocomplete by name, pane rows by name |
| `apps/chat/ARCHITECTURE.md`, `README.md`, `design/ANATOMY.md` | ids and names |

---

### Task 1: rt-client wire types and wrappers

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (types at lines 182-185, 206-277, 372-387; commands at 652-711)
- Modify: `packages/rt-client/src/client.ts:151-303`
- Create: `packages/rt-client/test/chat-identity-wire.test.ts`
- Modify: `packages/rt-client/README.md` ("Chat", after the table)

**Interfaces:**
- Consumes: the frozen contract ("Wire").
- Produces: `ChatMember.name`, `ChatMessage.name | mentionNames | quiet?`, `ChatClaimOutcome.authorName | holderName | previousHolderName?`, `RoomSummary.participants.aName | bName`, `PresenceRow.name`, `ChatPane.presence.name`, `AgentRecord.name?`, `HerdInfo.shepherdName`, `HerdJobInfo.handleName`; `chat:join` data `name`; `chat:post`/`chat:dm` data `recipientNames`; `chat:ack` data `authorName`; `chat:release` data `holderName`; `chat:sign-in` payload `continue?`, data `name`, `continued`. `chatSignIn({ continue })` sends `continue` on the wire. Tasks 2 to 7 rely on these field names.

- [ ] **Step 1: Write the failing test**

Create `packages/rt-client/test/chat-identity-wire.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { chatAck, chatDm, chatJoin, chatPost, chatRelease, chatSignIn } from "../src/client.ts";
import type {
  AgentRecord,
  ChatClaimOutcome,
  ChatMember,
  ChatMessage,
  ChatPane,
  Commands,
  HerdInfo,
  HerdJobInfo,
  PresenceRow,
  RoomSummary,
} from "../src/index.ts";
import { fakeDaemon } from "./fake-daemon.ts";

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function assertType<_T extends true>(): void {}

type Data<C extends keyof Commands> = Commands[C]["data"];
type Claimed = Extract<ChatClaimOutcome, { outcome: "claimed" }>;
type Held = Extract<ChatClaimOutcome, { outcome: "held" }>;
type Lost = Extract<ChatClaimOutcome, { outcome: "lost" }>;
type Participants = NonNullable<RoomSummary["participants"]>;
type PanePresence = NonNullable<ChatPane["presence"]>;

assertType<Equals<ChatMember["name"], string>>();
assertType<Equals<ChatMessage["name"], string>>();
assertType<Equals<ChatMessage["mentionNames"], string[]>>();
assertType<Equals<ChatMessage["quiet"], boolean | undefined>>();
assertType<Equals<Claimed["authorName"], string>>();
assertType<Equals<Claimed["previousHolderName"], string | undefined>>();
assertType<Equals<Held["authorName"], string>>();
assertType<Equals<Lost["holderName"], string>>();
assertType<Equals<Participants["aName"], string>>();
assertType<Equals<Participants["bName"], string>>();
assertType<Equals<PresenceRow["name"], string>>();
assertType<Equals<PanePresence["name"], string>>();
assertType<Equals<AgentRecord["name"], string | undefined>>();
assertType<Equals<HerdInfo["shepherdName"], string>>();
assertType<Equals<HerdJobInfo["handleName"], string>>();
assertType<Equals<Data<"chat:join">["name"], string>>();
assertType<Equals<Data<"chat:post">["recipientNames"], string[]>>();
assertType<Equals<Data<"chat:dm">["recipientNames"], string[]>>();
assertType<Equals<Data<"chat:ack">["authorName"], string>>();
assertType<Equals<Data<"chat:release">["holderName"], string>>();
assertType<Equals<Commands["chat:sign-in"]["payload"]["continue"], string | undefined>>();
assertType<Equals<Data<"chat:sign-in">["name"], string>>();
assertType<Equals<Data<"chat:sign-in">["continued"], boolean>>();
assertType<Equals<NonNullable<Awaited<ReturnType<typeof chatJoin>>["data"]>, Data<"chat:join">>>();
assertType<Equals<NonNullable<Awaited<ReturnType<typeof chatPost>>["data"]>, Data<"chat:post">>>();
assertType<Equals<NonNullable<Awaited<ReturnType<typeof chatAck>>["data"]>, Data<"chat:ack">>>();
assertType<Equals<NonNullable<Awaited<ReturnType<typeof chatRelease>>["data"]>, Data<"chat:release">>>();
assertType<Equals<NonNullable<Awaited<ReturnType<typeof chatDm>>["data"]>, Data<"chat:dm">>>();

const stops: Array<() => void> = [];
afterEach(() => { for (const stop of stops) stop(); stops.length = 0; });

describe("chat identity on the wire", () => {
  test("chatSignIn sends continue only when given", async () => {
    const { sock, seen, stop } = fakeDaemon({
      "chat:sign-in": { ok: true, data: { handle: "remy.m2p4", baseHandle: "remy", name: "remy", reclaimed: false, continued: true, sessionId: "s1", room: null } },
    });
    stops.push(stop);
    await chatSignIn({ sessionId: "s1" }, { sockPath: sock });
    const res = await chatSignIn({ sessionId: "s1", continue: "remy.m2p4" }, { sockPath: sock });
    expect(seen.map((s) => s.payload)).toEqual([{ sessionId: "s1" }, { sessionId: "s1", continue: "remy.m2p4" }]);
    expect(res.data).toMatchObject({ handle: "remy.m2p4", name: "remy", continued: true });
  });

  test("join, post, ack, release and dm hand back the name siblings untouched", async () => {
    const { sock, stop } = fakeDaemon({
      "chat:join": { ok: true, data: { handle: "remy.m2p4", name: "remy", memberCount: 3, unread: 0 } },
      "chat:post": { ok: true, data: { id: 9, recipients: ["remy.m2p4"], recipientNames: ["remy"], others: 2 } },
      "chat:ack": { ok: true, data: { author: "remy.m2p4", authorName: "remy", room: "rt", already: false } },
      "chat:release": { ok: true, data: { holder: "remy.m2p4", holderName: "remy" } },
      "chat:dm": { ok: true, data: { room: "dm-2c9b7e41d0a5", id: 10, recipients: ["remy.m2p4"], recipientNames: ["remy"] } },
    });
    stops.push(stop);
    const o = { sockPath: sock };
    expect((await chatJoin({ room: "rt", handle: "remy.m2p4" }, o)).data?.name).toBe("remy");
    expect((await chatPost({ room: "rt", handle: "matt", body: "@remy hi", mentions: ["remy"] }, o)).data?.recipientNames).toEqual(["remy"]);
    expect((await chatAck({ id: 9, handle: "matt" }, o)).data?.authorName).toBe("remy");
    expect((await chatRelease({ id: 9, handle: "matt" }, o)).data?.holderName).toBe("remy");
    expect((await chatDm({ from: "kai", to: "remy", body: "hi" }, o)).data?.recipientNames).toEqual(["remy"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/rt-client/test/chat-identity-wire.test.ts`
Expected: FAIL in "chatSignIn sends continue only when given" (the second payload lacks `continue`). The other runtime test passes (the fake daemon's data flows through untyped).

Run: `bunx tsc --noEmit 2>&1 | grep "packages/rt-client/"`
Expected: errors in `packages/rt-client/test/chat-identity-wire.test.ts` (for example `Property 'name' does not exist on type 'ChatMember'`).

- [ ] **Step 3: Add the contract fields to `commands.ts`**

Replace the `HerdInfo` line (182) with:

```ts
export interface HerdInfo { id: string; repo: string; room: string; workspace: string; shepherdSession: string; shepherdHandle: string; shepherdName: string; herdrSocket: string | null; hidden: boolean; status: "active" | "wrapped"; createdAt: number; wrappedAt: number | null }
```

In the `HerdJobInfo` line (185), change `agentId: string | null; handle: string; status:` to:

```ts
agentId: string | null; handle: string; handleName: string; status:
```

In `ChatMember`, add one line right after `handle: string;` (leave the rest of the interface, including its existing `status` doc comment, untouched):

```ts
  name: string;
```

Replace `ChatMessage` and `ChatClaimOutcome` (218-232) with:

```ts
export interface ChatMessage {
  id: number;
  room: string;
  handle: string;
  name: string;
  body: string;
  mentions: string[];
  /** Parallel to `mentions`: the display name each mentioned id had at post time. */
  mentionNames: string[];
  replyTo?: number;
  postedAt: number;
  quiet?: boolean;
}

/** `claimed` is the only outcome that woke anyone; `previousHolder` marks a takeover of an expired claim. */
export type ChatClaimOutcome =
  | { outcome: "claimed"; author: string; authorName: string; room: string; previousHolder?: string; previousHolderName?: string }
  | { outcome: "held"; author: string; authorName: string; room: string }
  | { outcome: "lost"; holder: string; holderName: string; claimedAt: number; expiresAt: number };
```

In `RoomSummary`, replace `participants?: { a: string; b: string };` with:

```ts
  participants?: { a: string; b: string; aName: string; bName: string };
```

In `PresenceRow`, after `baseHandle: string;` add:

```ts
  name: string;
```

In `ChatPane`, replace the `presence?` line with:

```ts
  presence?: { handle: string; name: string; status: BuddyStatus; rooms: string[] };
```

In `AgentRecord`, replace `label?: string; caller?: string; handle?: string;` with:

```ts
  label?: string; caller?: string; handle?: string; name?: string;
```

In the `Commands` map, replace these lines:

```ts
  "chat:join": { payload: { room: string; handle: string; wakeOn?: WakeMode; cwd?: string; pane?: string }; data: { handle: string; name: string; memberCount: number; unread: number } };
```

```ts
  "chat:post": { payload: { room: string; handle: string; body: string; mentions?: string[]; quiet?: boolean }; data: { id: number; recipients: string[]; recipientNames: string[]; others: number } };
  "chat:ack": { payload: { id: number; handle: string }; data: { author: string; authorName: string; room: string; already: boolean } };
  "chat:claim": { payload: { id: number; handle: string }; data: ChatClaimOutcome };
  "chat:release": { payload: { id: number; handle: string }; data: { holder: string; holderName: string } };
```

```ts
  "chat:dm": { payload: { from: string; to: string; body: string; sessionId?: string }; data: { room: string; id: number; recipients: string[]; recipientNames: string[] } };
```

In `chat:sign-in`, after `noRoom?: boolean;` add:

```ts
      /** An id or a name to continue instead of minting a fresh identity; when that identity is live in another session, a new one is minted under its name with a display suffix (`continued: false`). */
      continue?: string;
```

and replace its `data` line with:

```ts
    data: { handle: string; baseHandle: string; name: string; reclaimed: boolean; continued: boolean; sessionId: string; room: string | null };
```

- [ ] **Step 4: Point the wrappers at `Commands` and forward `continue`**

In `packages/rt-client/src/client.ts`, replace `chatJoin`, `chatPost`, `chatAck` and `chatRelease` with:

```ts
export function chatJoin(
  a: Commands["chat:join"]["payload"],
  o: RtClientOptions = {},
): Promise<RtResponse<Commands["chat:join"]["data"]>> {
  const payload: Record<string, unknown> = { room: a.room, handle: a.handle };
  if (a.wakeOn !== undefined) payload.wakeOn = a.wakeOn;
  if (a.cwd !== undefined) payload.cwd = a.cwd;
  if (a.pane !== undefined) payload.pane = a.pane;
  return rtCommand<Commands["chat:join"]["data"]>("chat:join", payload, { sockPath: o.sockPath, timeoutMs: o.timeoutMs ?? 10_000 });
}
```

```ts
export function chatPost(
  a: Commands["chat:post"]["payload"],
  o: RtClientOptions = {},
): Promise<RtResponse<Commands["chat:post"]["data"]>> {
  const payload: Record<string, unknown> = { room: a.room, handle: a.handle, body: a.body };
  if (a.mentions !== undefined) payload.mentions = a.mentions;
  if (a.quiet) payload.quiet = true;
  return rtCommand<Commands["chat:post"]["data"]>("chat:post", payload, { sockPath: o.sockPath, timeoutMs: o.timeoutMs ?? 10_000 });
}

export function chatAck(
  a: Commands["chat:ack"]["payload"],
  o: RtClientOptions = {},
): Promise<RtResponse<Commands["chat:ack"]["data"]>> {
  return rtCommand<Commands["chat:ack"]["data"]>(
    "chat:ack",
    { id: a.id, handle: a.handle },
    { sockPath: o.sockPath, timeoutMs: o.timeoutMs ?? 10_000 },
  );
}
```

```ts
export function chatRelease(a: Commands["chat:release"]["payload"], o: RtClientOptions = {}): Promise<RtResponse<Commands["chat:release"]["data"]>> {
  return rtCommand<Commands["chat:release"]["data"]>("chat:release", { id: a.id, handle: a.handle }, { sockPath: o.sockPath, timeoutMs: o.timeoutMs ?? 10_000 });
}
```

Replace `chatDm` with:

```ts
export function chatDm(
  a: Commands["chat:dm"]["payload"],
  o: RtClientOptions = {},
): Promise<RtResponse<Commands["chat:dm"]["data"]>> {
  const payload: Record<string, unknown> = { from: a.from, to: a.to, body: a.body };
  if (a.sessionId !== undefined) payload.sessionId = a.sessionId;
  return rtCommand<Commands["chat:dm"]["data"]>("chat:dm", payload, { sockPath: o.sockPath, timeoutMs: o.timeoutMs ?? 10_000 });
}
```

In `chatSignIn`, after `if (a.noRoom !== undefined) payload.noRoom = a.noRoom;` add:

```ts
  if (a.continue !== undefined) payload.continue = a.continue;
```

- [ ] **Step 5: Run the tests and the type check**

Run: `bun test packages/rt-client/test/chat-identity-wire.test.ts packages/rt-client/test/client.test.ts`
Expected: PASS.

Run: `bunx tsc --noEmit 2>&1 | grep "packages/rt-client/"`
Expected: no output.

Run: `bunx tsc --noEmit 2>&1 | grep "error TS" | cut -d'(' -f1 | sort -u`
Expected: only files outside this lane (lane 1b's `lib/`, `commands/`, `e2e/` literals that now miss a required name field). Paste that file list into this lane's report for the shepherd. Do not edit them.

- [ ] **Step 6: Document ids and names in the README**

In `packages/rt-client/README.md`, after the paragraph that ends "the agent-facing rules are `skills/rt-chat/SKILL.md`.", add:

````markdown
### Ids and names

Every handle-bearing field (`handle`, `author`, `holder`, `participants.a`
and `b`, `mentions`, `recipients`, `shepherdHandle`) carries an identity id
such as `remy.k3f9`. A handle from before identities is its own id. Each has
a display-name sibling: `name`, `authorName`, `holderName`, `aName` and
`bName`, `mentionNames`, `recipientNames`, `shepherdName`, `handleName`.
Show the name, act on the id, and fall back to the id when a name field is
missing (an older daemon). Payload `handle`, `from`, `to` and `mentions`
accept either; the daemon resolves a name to an id.

```ts
const page = await chatMessages({ room: 'rt' });
for (const m of page.data?.messages ?? []) console.log(`${m.name ?? m.handle}: ${m.body}`);

// Continue an identity instead of minting a new one; if it is live elsewhere you get a new one named remy-2 (continued false).
const res = await chatSignIn({ sessionId, continue: 'remy.k3f9' }); // res.data?.continued === true
```
````

- [ ] **Step 7: Rebuild `dist/` and check freshness**

Run: `bun run --cwd packages/rt-client build`
Expected: exits 0.

Run: `bun test packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/rt-client/src/commands.ts packages/rt-client/src/client.ts packages/rt-client/test/chat-identity-wire.test.ts packages/rt-client/README.md
git commit -m "rt-client: chat identity name fields and sign-in continue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The viewer compiles against the new wire

No behaviour change: every object literal typed with a changed rt-client type gains its name field, set equal to the id, so `chat:typecheck` is green before any display work starts.

**Files:**
- Modify: `apps/chat/src/server/fixtures.ts`
- Modify: `apps/chat/src/app/test-utils.tsx`
- Modify: every test file `bun run chat:typecheck` reports (expected: `server/chat.test.ts`, `server/inbox.test.ts`, `shared/open-ask.test.ts`, `app/folding.test.ts`, `app/Transcript.test.tsx`, `app/Reader.test.tsx`, `app/FleetTree.test.tsx`, `app/InboxCard.test.tsx`, `app/Inbox.test.tsx`, `app/App.test.tsx`, `app/RoomRail.test.tsx`, `app/NewRoomModal.test.tsx`, `app/PanePicker/PanePicker.test.tsx`)

**Interfaces:**
- Consumes: Task 1's types (through the rebuilt `dist/`; `chat:typecheck` resolves rt-client's `types` condition).
- Produces: `fixtures.ts` exports unchanged; internal `nameOf(id)` and `named(messages)` helpers and `FleetEntry.name?` that Task 4 extends.

- [ ] **Step 1: See the failures**

Run: `bun run chat:typecheck 2>&1 | grep "error TS"`
Expected: many errors of the forms `Property 'name' is missing`, `Property 'mentionNames' is missing`, `Property 'aName' is missing`.

- [ ] **Step 2: Give the fixtures their name fields**

In `apps/chat/src/server/fixtures.ts`, add `name?: string;` to `FleetEntry` right after `h: string;`:

```ts
interface FleetEntry {
  h: string;
  /** Display name when it differs from the id (a recycled pool name). */
  name?: string;
```

After the `FLEET` array, add:

```ts
const NAME_BY_ID = new Map(FLEET.map(f => [f.h, f.name ?? f.h]));

function nameOf(id: string): string {
  return NAME_BY_ID.get(id) ?? id;
}

type Unnamed = Omit<ChatMessage, 'name' | 'mentionNames'>;

function named(messages: Unnamed[]): ChatMessage[] {
  return messages.map(m => ({
    ...m,
    name: nameOf(m.handle),
    mentionNames: m.mentions.map(nameOf),
  }));
}
```

In `fixtureBuddies`, replace `handle: f.h,\n      baseHandle: f.h,` with:

```ts
      handle: f.h,
      baseHandle: nameOf(f.h),
      name: nameOf(f.h),
```

In `fixtureRooms`, replace `participants: { a, b: c },` with:

```ts
      participants: { a, b: c, aName: nameOf(a), bName: nameOf(c) },
```

In `fixtureMembers`, add `name: b.name,` after `handle,` in the returned object.

In `fixtureMessages`, wrap each of the four returned arrays: `return [` becomes `return named([` and the matching `];` becomes `]);`.

In `fixturePanes`, add `name` equal to the handle in each `presence`, for example:

```ts
      presence: { handle: 'fred', name: 'fred', status: 'live', rooms: ['repo-tools'] },
```

- [ ] **Step 3: Give `test-utils.tsx` its name fields**

In `pushFrame`'s synthesized message, after `handle: 'fixture-agent',` add `name: 'fixture-agent',`, and after `mentions: [],` add `mentionNames: [],`. Do the same in `longCodeBlockMessage` (`name: 'board-fix-auth',` and `mentionNames: [],`).

- [ ] **Step 4: Sweep the test literals**

Fix every remaining error with these rules, and nothing else:

- A `ChatMessage` literal: add `name:` equal to its `handle` right after `handle`, and `mentionNames:` equal to its `mentions` array right after `mentions`.
- A `ChatMember`, `PresenceRow` or `RosterBuddy` literal: add `name:` equal to its `handle` (after `baseHandle` when present, else after `handle`).
- A `participants: { a: X, b: Y }` literal: make it `{ a: X, b: Y, aName: X, bName: Y }`.
- A `ChatPane.presence` literal: add `name:` equal to its `handle`.

Where a file builds these through a helper, fix the helper once. The known helpers:

`server/inbox.test.ts` and `shared/open-ask.test.ts` `msg()`:

```ts
function msg(
  over: Partial<ChatMessage> & { id: number; body: string }
): ChatMessage {
  const handle = over.handle ?? 'jay';
  return {
    room: 'rt',
    handle,
    name: handle,
    mentions: [],
    mentionNames: over.mentions ?? [],
    postedAt: over.id * 1000,
    ...over,
  };
}
```

(Keep each file's own default room and handle; the shape above is `inbox.test.ts`'s.)

`app/FleetTree.test.tsx`: in `buddy()` add `name: handle,` after `baseHandle: handle,`; in `dm()` make it `participants: { a, b, aName: a, bName: b },`.

`app/Transcript.test.tsx` `page()`: add `name: 'fred',` after `handle: 'fred',` and `mentionNames: [],` after `mentions: [],`.

Example of an inline fix (`app/Reader.test.tsx`):

```ts
const opened: ChatMessage = {
  id: 412,
  room: 'boxscore',
  handle: 'jay',
  name: 'jay',
  body: '@matt metrics-hardening is ready for review: PR #12.',
  mentions: ['matt'],
  mentionNames: ['matt'],
  postedAt: card.postedAt,
};
```

Re-run `bun run chat:typecheck 2>&1 | grep "error TS"` after each file until it prints nothing.

- [ ] **Step 5: Run the viewer gates**

Run: `bun run chat:typecheck`
Expected: exits 0.

Run: `bun run chat:test`
Expected: PASS, same count as before this task.

- [ ] **Step 6: Commit**

```bash
git add apps/chat/src
git commit -m "chat: compile against the identity wire fields" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Display-name helpers, buddies directory, AgentName, doing

**Files:**
- Create: `apps/chat/src/app/display-name.ts`, `apps/chat/src/app/display-name.test.ts`
- Create: `apps/chat/src/app/AgentName.test.tsx`
- Modify: `apps/chat/src/app/buddies-context.tsx`
- Modify: `apps/chat/src/app/AgentName.tsx` (props, `AgentCard` header, `AgentName` label)
- Modify: `apps/chat/src/app/doing.ts`, `apps/chat/src/app/doing.test.ts`

**Interfaces:**
- Consumes: `PresenceRow.name` (via `RosterBuddy`).
- Produces:
  - `displayName(row: { handle: string; name?: string }): string`
  - `dmPairLabel(pair: { a: string; b: string; aName?: string; bName?: string }): string`, rendering `aName ↔ bName`
  - `BuddiesContextValue.nameOf(handle: string): string`
  - `BuddiesProvider` prop `memberNames?: ReadonlyMap<string, string>`
  - `AgentNameProps.name?: string`
  - `DoingInput.name?: string`

- [ ] **Step 1: Write the failing tests**

`apps/chat/src/app/display-name.test.ts`:

```ts
import { expect, test } from 'vitest';

import { displayName, dmPairLabel } from './display-name';

test('displayName prefers the name and falls back to the id', () => {
  expect(displayName({ handle: 'remy.m2p4', name: 'remy' })).toBe('remy');
  expect(displayName({ handle: 'kai' })).toBe('kai');
});

test('dmPairLabel reads names, each side falling back to its id', () => {
  expect(
    dmPairLabel({ a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' })
  ).toBe('kai ↔ remy');
  expect(dmPairLabel({ a: 'kai', b: 'remy' })).toBe('kai ↔ remy');
});
```

`apps/chat/src/app/AgentName.test.tsx`:

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { AgentCard, AgentName } from './AgentName';
import { BuddiesProvider } from './buddies-context';
import type { RosterBuddy } from './roster-types';

const NOW = 1_700_000_000_000;

function row(handle: string, name: string): RosterBuddy {
  return {
    sessionId: `s-${handle}`,
    handle,
    baseHandle: name,
    name,
    signedInAt: NOW - 60_000,
    lastSeenAt: NOW - 1_000,
    status: 'live',
    rooms: ['rt'],
  };
}

const avatarFill = (el: HTMLElement) =>
  el.querySelector('svg[shape-rendering="crispEdges"]')!.getAttribute('fill');

test('the label is the name: prop, then roster row, then member directory, then the id', () => {
  renderWithProviders(
    <BuddiesProvider
      buddies={[row('remy.m2p4', 'remy')]}
      roomMembers={[]}
      memberNames={new Map([['kai.x9z1', 'kai']])}
      now={NOW}
      reachable
    >
      <div data-testid="prop">
        <AgentName handle="ghost.q1w2" name="ghost" />
      </div>
      <div data-testid="roster">
        <AgentName handle="remy.m2p4" />
      </div>
      <div data-testid="member">
        <AgentName handle="kai.x9z1" />
      </div>
      <div data-testid="legacy">
        <AgentName handle="max" />
      </div>
    </BuddiesProvider>
  );
  expect(screen.getByTestId('prop')).toHaveTextContent(/^ghost$/);
  expect(screen.getByTestId('roster')).toHaveTextContent(/^remy$/);
  expect(screen.getByTestId('member')).toHaveTextContent(/^kai$/);
  expect(screen.getByTestId('legacy')).toHaveTextContent(/^max$/);
});

test('the avatar seeds from the id, so two remys differ', () => {
  renderWithProviders(
    <>
      <div data-testid="old">
        <AgentName handle="remy" name="remy" />
      </div>
      <div data-testid="new">
        <AgentName handle="remy.m2p4" name="remy" />
      </div>
    </>
  );
  expect(avatarFill(screen.getByTestId('old'))).not.toBe(
    avatarFill(screen.getByTestId('new'))
  );
});

test('the hover card header shows the name, never the id', () => {
  renderWithProviders(<AgentCard buddy={row('remy.m2p4', 'remy')} now={NOW} />);
  const card = screen.getByTestId('detail-remy.m2p4');
  expect(card).toHaveTextContent('remy');
  expect(card).not.toHaveTextContent('m2p4');
});
```

Append to `apps/chat/src/app/doing.test.ts`, inside `describe('doing', ...)`:

```ts
  test('a title equal to the display name falls through even when the id differs', () => {
    expect(
      doing({ ...base, handle: 'remy.m2p4', name: 'remy', paneTitle: 'remy' })
    ).toEqual({ text: 'repo-tools · main', kind: 'path' });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run --cwd apps/chat test src/app/display-name.test.ts src/app/AgentName.test.tsx src/app/doing.test.ts`
Expected: FAIL. `display-name` cannot be resolved; `AgentName` shows `remy.m2p4` and `kai.x9z1`; the card shows `remy.m2p4`; `doing` returns `{ text: 'remy', kind: 'title' }`. The avatar test already passes (it pins the existing id seed).

- [ ] **Step 3: Write `display-name.ts`**

```ts
export interface Named {
  handle: string;
  name?: string;
}

export interface DmPair {
  a: string;
  b: string;
  aName?: string;
  bName?: string;
}

export function displayName(row: Named): string {
  return row.name ?? row.handle;
}

/** A DM is named by its pair; the hashed room name is never shown. */
export function dmPairLabel(pair: DmPair): string {
  return `${pair.aName ?? pair.a} ↔ ${pair.bName ?? pair.b}`;
}
```

- [ ] **Step 4: Add the directory to the buddies context**

Replace the body of `apps/chat/src/app/buddies-context.tsx` from `export interface BuddiesContextValue` through the end of `BuddiesProvider` with:

```tsx
export interface BuddiesContextValue {
  /** Keyed by identity id: two agents that share a display name are two entries. */
  byHandle: Map<string, RosterBuddy>;
  /** Ids in the open room: decides whether a card offers @mention or DM. */
  roomMembers: string[];
  now: number;
  reachable: boolean;
  actions?: BuddyActions;
  /** Display name for an id: the roster's, then the open room's members', then the id. */
  nameOf: (handle: string) => string;
}

const BuddiesContext = createContext<BuddiesContextValue | null>(null);

/** The one place presence is looked up by id, so `AgentName` can render
    anywhere an identity appears (roster, sender, chip, DM pair) with the same
    data the roster has. Outside a provider a name is just a name. */
export function BuddiesProvider({
  buddies,
  roomMembers,
  memberNames,
  now,
  reachable,
  actions,
  children,
}: Omit<BuddiesContextValue, 'byHandle' | 'nameOf'> & {
  buddies: RosterBuddy[];
  memberNames?: ReadonlyMap<string, string>;
  children: ReactNode;
}) {
  const value = useMemo<BuddiesContextValue>(() => {
    const byHandle = new Map(buddies.map(b => [b.handle, b]));
    return {
      byHandle,
      roomMembers,
      now,
      reachable,
      actions,
      nameOf: handle =>
        byHandle.get(handle)?.name ?? memberNames?.get(handle) ?? handle,
    };
  }, [buddies, roomMembers, memberNames, now, reachable, actions]);
  return (
    <BuddiesContext.Provider value={value}>{children}</BuddiesContext.Provider>
  );
}
```

- [ ] **Step 5: Render the name in `AgentName` and `AgentCard`**

In `apps/chat/src/app/AgentName.tsx`:

Add the import: `import { displayName } from './display-name';`

In `AgentNameProps`, after `handle: string;` add:

```ts
  /** Display name; unset falls back to the roster row, the context directory, then the id. */
  name?: string;
```

In `AgentCard`, replace the header name text (`{buddy.handle}` inside `<Text size="lg" fw={600} truncate>`) with `{displayName(buddy)}`.

In `AgentName`, add `name,` to the destructured props after `handle,`, and after `const buddy = buddyProp ?? ctx?.byHandle.get(handle);` add:

```ts
  const shown = name ?? buddy?.name ?? ctx?.nameOf(handle) ?? handle;
```

Then replace the visible `{handle}` in each variant's name `<Text>` with `{shown}`: the `row` variant's `<Text size="sm" fw={600} style={{ flex: 'none' }}>`, the `inline` variant's `<Text component="span" size="lg" fw={600} ...>`, and the `name` variant's `<Text component="span" fw={600} inherit className={classes.name}>`. Leave every `handle` passed to `HandleAvatar`, `TaskLine` and `data-testid` as the id.

- [ ] **Step 6: Compare pane titles against the name in `doing.ts`**

Add `name?: string;` to `DoingInput` after `handle: string;`, and replace:

```ts
  if (b.paneTitle && b.paneTitle !== b.handle) {
```

with:

```ts
  if (b.paneTitle && b.paneTitle !== (b.name ?? b.handle)) {
```

- [ ] **Step 7: Run the tests**

Run: `bun run --cwd apps/chat test src/app/display-name.test.ts src/app/AgentName.test.tsx src/app/doing.test.ts`
Expected: PASS.

Run: `bun run chat:typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add apps/chat/src/app/display-name.ts apps/chat/src/app/display-name.test.ts apps/chat/src/app/AgentName.test.tsx apps/chat/src/app/buddies-context.tsx apps/chat/src/app/AgentName.tsx apps/chat/src/app/doing.ts apps/chat/src/app/doing.test.ts
git commit -m "chat: display names behind AgentName, doing and the buddies context" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Server: named inbox cards, DM tails, and the recycled-remy fixtures

**Files:**
- Modify: `apps/chat/src/server/inbox.ts` (`InboxCard`, `toCard`)
- Modify: `apps/chat/src/server/chat.ts` (`DmLastMessage`, `withDmLastMessage`)
- Modify: `apps/chat/src/server/fixtures.ts` (FLEET, DMS, DM_ROOM, DM_LAST, `fixtureRooms`, `fixtureMessages`)
- Modify: `apps/chat/src/app/FleetTree.tsx:56-59` (`DmLastMessage` type)
- Test: `apps/chat/src/server/inbox.test.ts`, `chat.test.ts`, `fixtures.test.ts`
- Modify (type fallout): every `InboxCard` literal in `app/Reader.test.tsx`, `app/InboxCard.test.tsx`, `app/Inbox.test.tsx`, `app/App.test.tsx`

**Interfaces:**
- Consumes: Task 2's `nameOf`/`named`.
- Produces: `InboxCard.name: string`; `InboxCard.participants?: RoomSummary['participants']`; `/api/chat/rooms` DM `lastMessage.name`; fixture ids `remy` and `remy.m2p4` (both named `remy`), DM rooms `dm-e41f7a3c68bd` (kai, remy) and `dm-2c9b7e41d0a5` (kai, remy.m2p4), `#rt` messages 607 to 609.

- [ ] **Step 1: Write the failing tests**

Append to `apps/chat/src/server/inbox.test.ts`:

```ts
test('a card names its author and its DM pair; the ids stay on the side', () => {
  const dm = room({
    room: 'dm-2c9b7e41d0a5',
    unread: 1,
    kind: 'dm',
    participants: { a: 'matt', b: 'remy.m2p4', aName: 'matt', bName: 'remy' },
  });
  const m = msg({
    id: 30,
    room: 'dm-2c9b7e41d0a5',
    handle: 'remy.m2p4',
    name: 'remy',
    body: 'picked up the lane',
  });
  const [card] = buildInbox(
    [dm],
    new Map([['dm-2c9b7e41d0a5', [m]]]),
    'matt'
  ).needsYou;
  expect(card).toMatchObject({
    handle: 'remy.m2p4',
    name: 'remy',
    participants: { a: 'matt', b: 'remy.m2p4', aName: 'matt', bName: 'remy' },
  });
});
```

Append to `apps/chat/src/server/chat.test.ts`:

```ts
test('dm/open hands the daemon a name or an id exactly as typed', async () => {
  vi.mocked(rt.chatDmOpen).mockResolvedValue({
    ok: true,
    data: { room: 'dm-2c9b7e41d0a5', created: false },
  });
  for (const to of ['remy', 'remy.m2p4']) {
    const res = await routes.request('/api/chat/dm/open?handle=matt', {
      method: 'POST',
      body: JSON.stringify({ to }),
    });
    expect(res.status).toBe(200);
  }
  expect(vi.mocked(rt.chatDmOpen).mock.calls.map(c => c[0])).toEqual([
    { from: 'matt', to: 'remy' },
    { from: 'matt', to: 'remy.m2p4' },
  ]);
});

test('buddies that share a name keep their own rooms, keyed by id', async () => {
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        { sessionId: 's1', handle: 'remy', baseHandle: 'remy', name: 'remy', signedInAt: 1, lastSeenAt: 1, status: 'idle' },
        { sessionId: 's2', handle: 'remy.m2p4', baseHandle: 'remy', name: 'remy', signedInAt: 2, lastSeenAt: 2, status: 'live' },
      ],
    },
  });
  vi.mocked(rt.chatRooms).mockImplementation(async ({ handle }) => ({
    ok: true,
    data: {
      rooms:
        handle === 'remy'
          ? [{ room: 'rt', memberCount: 2, unread: 0, mentions: 0 }]
          : [
              {
                room: 'dm-2c9b7e41d0a5',
                memberCount: 3,
                unread: 0,
                mentions: 0,
                kind: 'dm' as const,
                participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
              },
            ],
    },
  }));
  const res = await routes.request('/api/chat/buddies');
  const { buddies } = await res.json();
  expect(buddies).toMatchObject([
    { handle: 'remy', name: 'remy', rooms: ['rt'] },
    { handle: 'remy.m2p4', name: 'remy', rooms: ['dm'] },
  ]);
});

test('a DM tail carries its author name beside the id', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        {
          room: 'dm-2c9b7e41d0a5',
          memberCount: 3,
          unread: 1,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
        },
      ],
    },
  });
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({ ok: true, data: { buddies: [] } });
  vi.mocked(rt.chatMessages).mockResolvedValue({
    ok: true,
    data: {
      messages: [
        { id: 812, room: 'dm-2c9b7e41d0a5', handle: 'remy.m2p4', name: 'remy', body: 'on it', mentions: [], mentionNames: [], postedAt: 1 },
      ],
    },
  });
  const res = await routes.request('/api/chat/rooms?handle=matt');
  expect((await res.json()).rooms[0].lastMessage).toEqual({
    handle: 'remy.m2p4',
    name: 'remy',
    body: 'on it',
  });
});
```

In `apps/chat/src/server/fixtures.test.ts`, change the roster expectation and the DM count, and add a test:

```ts
  // design/build.py's FLEET table (3 live, 1 idle, 9 offline) plus the
  // recycled remy.m2p4, live.
  expect(byStatus).toEqual({ live: 4, idle: 1, offline: 9 });
```

```ts
  expect(dms).toHaveLength(5);
```

```ts
test('a recycled name: two remys share a display name, never an id', () => {
  const remys = fixtureBuddies().filter(b => b.name === 'remy');
  expect(remys.map(b => [b.handle, b.baseHandle])).toEqual([
    ['remy', 'remy'],
    ['remy.m2p4', 'remy'],
  ]);
  const kaiDms = fixtureRooms().filter(
    r => r.kind === 'dm' && r.participants?.a === 'kai'
  );
  expect(kaiDms.map(r => [r.room, r.participants])).toEqual([
    ['dm-e41f7a3c68bd', { a: 'kai', b: 'remy', aName: 'kai', bName: 'remy' }],
    [
      'dm-2c9b7e41d0a5',
      { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
    ],
  ]);
  const rt = fixtureMessages('rt');
  expect(rt.filter(m => m.name === 'remy').map(m => m.handle)).toEqual([
    'remy',
    'remy.m2p4',
  ]);
  const welcome = rt.find(m => m.mentions.includes('remy.m2p4'))!;
  expect(welcome.mentionNames).toEqual(['remy']);
  expect(welcome.body).toContain('@remy ');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run --cwd apps/chat test src/server/inbox.test.ts src/server/chat.test.ts src/server/fixtures.test.ts`
Expected: FAIL: the card has no `name`; the DM tail has no `name`; the fixtures have one remy and four DMs. The two new `chat.test.ts` route tests for dm/open and buddies already pass (they pin today's pass-through).

- [ ] **Step 3: Name the inbox card**

In `apps/chat/src/server/inbox.ts`, replace the `InboxCard` interface's `participants` and `handle` lines:

```ts
export interface InboxCard {
  room: string;
  kind: 'room' | 'dm';
  participants?: RoomSummary['participants'];
  messageId: number;
  handle: string;
  name: string;
  postedAt: number;
  excerpt: string;
  reason: 'mention' | 'dm-turn' | 'open-ask';
}
```

and in `toCard`, after `handle: msg.handle,` add:

```ts
    name: msg.name ?? msg.handle,
```

- [ ] **Step 4: Name the DM tail**

In `apps/chat/src/server/chat.ts`:

```ts
interface DmLastMessage {
  handle: string;
  name: string;
  body: string;
}
```

and in `withDmLastMessage`, after `handle: message.handle,` add:

```ts
      name: message.name ?? message.handle,
```

In `apps/chat/src/app/FleetTree.tsx`, add `name?: string;` to `DmLastMessage` after `handle: string;`.

- [ ] **Step 5: Add the recycled remy to the fixtures**

In `apps/chat/src/server/fixtures.ts`:

Append to `FLEET` (after `wren`):

```ts
  {
    h: 'remy.m2p4',
    name: 'remy',
    repo: 'rt',
    branch: 'chat-identity',
    st: 'live',
    title: 'remy',
    pane: 'wC4:p2',
    seenAgo: 30 * S,
    cwd: '/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/gandalf',
  },
```

Append to `DMS`: `['kai', 'remy.m2p4', 2],`. Add to `DM_ROOM`: `'kai|remy.m2p4': 'dm-2c9b7e41d0a5',`.

Change `DM_LAST`'s type to `Record<string, { handle: string; name: string; body: string }>`, add `name` to each entry (`name: 'stan'`, `name: 'edie'`, `name: 'remy'`), and add:

```ts
  'kai|remy.m2p4': {
    handle: 'remy.m2p4',
    name: 'remy',
    body: 'picked up the chat identity lane',
  },
```

Change `fixtureRooms`' return type's `lastMessage?: { handle: string; body: string }` to `lastMessage?: { handle: string; name: string; body: string }`.

In `fixtureMessages('rt')`, append after message 606:

```ts
      {
        id: 607,
        room,
        handle: 'remy',
        body: 'the old tail daemon is mine, leaving it up until the swap.',
        postedAt: at(3),
        mentions: [],
      },
      {
        id: 608,
        room,
        handle: 'remy.m2p4',
        body: 'new here: picked up the chat identity lane from the plan.',
        postedAt: at(2),
        mentions: [],
      },
      {
        id: 609,
        room,
        handle: 'max',
        body: '@remy welcome, the viewer lane is yours. Ping me when the fixtures land.',
        postedAt: at(1),
        mentions: ['remy.m2p4'],
      },
```

Before the final default `return`, add the two kai DMs:

```ts
  if (room === DM_ROOM['kai|remy']) {
    return named([
      {
        id: 801,
        room,
        handle: 'remy',
        body: 'tail died again at 03:12, restarting the daemon',
        postedAt: now - 12 * M,
        mentions: [],
      },
    ]);
  }

  if (room === DM_ROOM['kai|remy.m2p4']) {
    return named([
      {
        id: 811,
        room,
        handle: 'kai',
        body: '@remy the lane plan is pinned in #rt',
        postedAt: now - 17 * H,
        mentions: ['remy.m2p4'],
      },
      {
        id: 812,
        room,
        handle: 'remy.m2p4',
        body: 'picked up the chat identity lane',
        postedAt: now - 2 * M,
        mentions: [],
      },
    ]);
  }
```

Replace the header comment's sentence "If build.py's tables change, change these with them." with:

```ts
 * the same content. If build.py's tables change, change these with them.
 * The one deliberate addition is the recycled `remy.m2p4` (its roster row,
 * its DM with kai, and #rt 607-609): two identities sharing one display name.
```

- [ ] **Step 6: Add `name` to every `InboxCard` literal the type check reports**

Run: `bun run chat:typecheck 2>&1 | grep "error TS"`
For each reported `InboxCard` literal (in `app/Reader.test.tsx`, `app/InboxCard.test.tsx`, `app/Inbox.test.tsx`, `app/App.test.tsx`), add `name:` equal to its `handle` right after `handle`. Example:

```ts
const mention: InboxCardData = {
  room: 'boxscore',
  kind: 'room',
  messageId: 412,
  handle: 'jay',
  name: 'jay',
  postedAt: NOW - 29 * 60_000,
  excerpt: '@matt metrics-hardening is ready for review: PR #12.',
  reason: 'mention',
};
```

Re-run until it prints nothing.

- [ ] **Step 7: Run the tests**

Run: `bun run --cwd apps/chat test src/server`
Expected: PASS.

Run: `bun run chat:typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add apps/chat/src
git commit -m "chat server: named inbox cards and DM tails, recycled-remy fixtures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Mentions and message headers

**Files:**
- Modify: `apps/chat/src/app/remark-mentions.ts`
- Modify: `apps/chat/src/app/MessageMarkdown.tsx`
- Modify: `apps/chat/src/app/Transcript.tsx` (`MessageBody` around line 265, `MessageRow` around line 398)
- Modify: `apps/chat/src/app/Reader.tsx` (phone header line 106, sender at 166, markdown at 184, composer prefill 271-272)
- Modify: `apps/chat/src/app/InboxCard.tsx` (`whereLabel`, `AgentName`, lead `aria-label`)
- Test: `MessageMarkdown.test.tsx`, `Transcript.test.tsx`, `Reader.test.tsx`, `InboxCard.test.tsx`

**Interfaces:**
- Consumes: `ChatMessage.name | mentionNames` (Task 1), `InboxCard.name` (Task 4), `dmPairLabel` (Task 3), `AgentNameProps.name` (Task 3).
- Produces: `MentionOptions.names?: string[]` (parallel to `handles`); `MessageMarkdownProps.mentionNames?: string[]`. A mention span's text is `@<name>` and its `data-mention` is the id.

- [ ] **Step 1: Write the failing tests**

In `apps/chat/src/app/MessageMarkdown.test.tsx`, extend the local `render` helper with a fourth parameter and pass it through:

```tsx
function render(
  body: string,
  mentions: string[] = [],
  humanHandle?: string,
  mentionNames?: string[]
) {
  return renderWithProviders(
    <div data-testid="body">
      <MessageMarkdown
        body={body}
        mentions={mentions}
        mentionNames={mentionNames}
        humanHandle={humanHandle}
      />
    </div>
  );
}
```

and append:

```tsx
test('a mention highlights by name and carries the id', () => {
  render('@remy can you look', ['remy.m2p4'], 'matt', ['remy']);
  const span = screen
    .getByTestId('body')
    .querySelector('[data-mention]')!;
  expect(span).toHaveTextContent('@remy');
  expect(span).toHaveAttribute('data-mention', 'remy.m2p4');
  expect(span).not.toHaveAttribute('data-me');
});
```

Append to `apps/chat/src/app/Transcript.test.tsx` (Review Focus 4, transcript half):

```tsx
test('two identities that share a name read the same and keep their own hue', () => {
  renderWithProviders(
    <Transcript
      room="rt"
      messages={[
        { id: 1, room: 'rt', handle: 'remy', name: 'remy', body: 'old tail is mine', mentions: [], mentionNames: [], postedAt: 1 },
        { id: 2, room: 'rt', handle: 'remy.m2p4', name: 'remy', body: 'new here', mentions: [], mentionNames: [], postedAt: 2 },
        { id: 3, room: 'rt', handle: 'max', name: 'max', body: '@remy welcome', mentions: ['remy.m2p4'], mentionNames: ['remy'], postedAt: 3 },
      ]}
    />
  );
  const chips = screen.getAllByTestId('speaker-chip');
  expect(chips[0]).toHaveTextContent(/^remy$/);
  expect(chips[1]).toHaveTextContent(/^remy$/);
  expect(screen.getByTestId('message-2')).not.toHaveTextContent('m2p4');
  const hue = (chip: HTMLElement) =>
    chip.style.getPropertyValue('--speaker-hue');
  expect(hue(chips[0]!)).not.toBe(hue(chips[1]!));
  const avatar = (chip: HTMLElement) =>
    chip.querySelector('svg')!.getAttribute('fill');
  expect(avatar(chips[0]!)).not.toBe(avatar(chips[1]!));
  const mention = screen
    .getByTestId('message-3')
    .querySelector('[data-mention]')!;
  expect(mention).toHaveTextContent('@remy');
  expect(mention).toHaveAttribute('data-mention', 'remy.m2p4');
});
```

Append to `apps/chat/src/app/Reader.test.tsx`:

```tsx
test('a reply to a recycled name tags the name in the text and the id in mentions', async () => {
  const recycled: InboxCardData = { ...card, handle: 'remy.m2p4', name: 'remy' };
  serveWindow([{ ...opened, handle: 'remy.m2p4', name: 'remy' }]);
  renderReader({ card: recycled });
  const message = await screen.findByTestId('reader-message-412');
  expect(message).not.toHaveTextContent('m2p4');
  const box = screen.getByRole('textbox');
  expect(box).toHaveValue('@remy ');
  await userEvent.type(box, 'thanks{Enter}');
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/post',
      expect.objectContaining({
        body: JSON.stringify({
          room: 'boxscore',
          body: '@remy thanks',
          mentions: ['remy.m2p4'],
        }),
      })
    )
  );
});
```

Append to `apps/chat/src/app/InboxCard.test.tsx`:

```tsx
test('a DM card reads names: the author and the pair, never an id', () => {
  const card: InboxCardData = {
    room: 'dm-2c9b7e41d0a5',
    kind: 'dm',
    participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
    messageId: 812,
    handle: 'remy.m2p4',
    name: 'remy',
    postedAt: NOW - 60_000,
    excerpt: 'picked up the chat identity lane',
    reason: 'dm-turn',
  };
  renderWithProviders(
    <InboxCard
      card={card}
      now={NOW}
      onOpen={vi.fn()}
      onMarkRead={vi.fn()}
      onOpenRoom={vi.fn()}
    />
  );
  const el = screen.getByTestId('inbox-card-812');
  expect(el).toHaveTextContent('kai ↔ remy');
  expect(el).not.toHaveTextContent('m2p4');
  expect(screen.getByTestId('card-lead-812')).toHaveAttribute(
    'aria-label',
    "Read remy's message in kai ↔ remy"
  );
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run --cwd apps/chat test src/app/MessageMarkdown.test.tsx src/app/Transcript.test.tsx src/app/Reader.test.tsx src/app/InboxCard.test.tsx`
Expected: FAIL: no mention span for `@remy`; the chips and the reader header read `remy.m2p4`; the reader prefill is `@remy.m2p4 `; the card reads `kai ↔ remy.m2p4`.

- [ ] **Step 3: Match mentions by name, mark them with the id**

Replace `MentionOptions` and the top of `remarkMentions` in `apps/chat/src/app/remark-mentions.ts`:

```ts
export interface MentionOptions {
  /** The message's own `mentions` ids: the only identities that count. */
  handles: string[];
  /** Display names parallel to `handles`; the body text carries these. */
  names?: string[];
  /** The human's id: its mention gets `meClassName` and `data-me`. */
  me?: string;
  className: string;
  meClassName: string;
}
```

```ts
export function remarkMentions(options: MentionOptions) {
  const { handles, names, me, className, meClassName } = options;
  if (handles.length === 0) return () => {};
  const idByName = new Map<string, string>();
  handles.forEach((id, i) => {
    const shown = names?.[i] ?? id;
    if (!idByName.has(shown)) idByName.set(shown, id);
  });
  const pattern = new RegExp(
    `@(${[...idByName.keys()].map(escapeForRegExp).join('|')})(?![a-z0-9._-])`,
    'g'
  );
```

and inside the match loop replace:

```ts
        const handle = match[1]!;
        const isMe = handle === me;
        parts.push({
          type: 'text',
          value: `@${handle}`,
          data: {
            hName: 'span',
            hProperties: {
              className: isMe ? [className, meClassName] : [className],
              'data-mention': handle,
```

with:

```ts
        const shown = match[1]!;
        const id = idByName.get(shown)!;
        const isMe = id === me;
        parts.push({
          type: 'text',
          value: `@${shown}`,
          data: {
            hName: 'span',
            hProperties: {
              className: isMe ? [className, meClassName] : [className],
              'data-mention': id,
```

- [ ] **Step 4: Thread `mentionNames` through `MessageMarkdown`**

In `MessageMarkdownProps` add after `mentions: string[];`:

```ts
  /** Parallel to `mentions`; unset matches the ids themselves (an older daemon). */
  mentionNames?: string[];
```

Destructure `mentionNames` in `MessageMarkdown`, pass `names: mentionNames,` after `handles: mentions,` in the plugin options, and change the memo deps to `[mentions, mentionNames, humanHandle]`.

- [ ] **Step 5: Names in the transcript and the reader**

`apps/chat/src/app/Transcript.tsx`: in `MessageBody`'s `<MessageMarkdown>` add `mentionNames={message.mentionNames}` after `mentions={message.mentions}`; in `MessageRow`'s `<AgentName>` add `name={message.name}` after `handle={message.handle}`.

`apps/chat/src/app/Reader.tsx`: the same two edits in its sender row and `<MessageMarkdown>`; the phone header text becomes `{card.name} needs you`; the composer's prefill and placeholder become:

```tsx
      prefill={{ body: `@${card.name} `, mentions: [card.handle] }}
      placeholder={`Reply in ${where} · @${card.name} is already tagged`}
```

- [ ] **Step 6: Names on the inbox card**

In `apps/chat/src/app/InboxCard.tsx`, import `dmPairLabel` from `./display-name` and replace `whereLabel` with:

```ts
export function whereLabel(card: InboxCardData): string {
  return card.kind === 'dm' && card.participants
    ? dmPairLabel(card.participants)
    : `#${card.room}`;
}
```

Add `name={card.name}` after `handle={card.handle}` on its `<AgentName>`, and change the lead's label to:

```tsx
        aria-label={`Read ${card.name}'s message in ${where}`}
```

- [ ] **Step 7: Run the tests**

Run: `bun run --cwd apps/chat test src/app/MessageMarkdown.test.tsx src/app/Transcript.test.tsx src/app/Reader.test.tsx src/app/InboxCard.test.tsx src/app/Inbox.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/chat/src/app
git commit -m "chat: names in message headers, mentions and inbox cards" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: DM labels, fleet rows, the page bar and the app shell

**Files:**
- Modify: `apps/chat/src/app/FleetTree.tsx` (`overflowLabel` ~168, `roomLabel` ~262, `WorkstreamRow` ~526-600, `OfflineRow` ~656-660, `DmRow` ~674-740, `FleetTree` ~839-905)
- Modify: `apps/chat/src/app/PageBar.tsx` (`roomTitle` ~106, member rows ~339-349)
- Modify: `apps/chat/src/app/App.tsx` (`useRoomMembers` ~236-276, `resultLine` ~318-322, `roomHeaderTitle` ~406-410, provider ~1277 and ~1372)
- Test: `FleetTree.test.tsx`, `PageBar.test.tsx`, `App.test.tsx`, `RoomRail.test.tsx`

**Interfaces:**
- Consumes: `dmPairLabel`, `displayName`, `BuddiesProvider.memberNames`, `AgentNameProps.name` (Task 3); `RoomSummary.participants.aName | bName`, `ChatMember.name`, `ChatPane.presence.name` (Task 1).
- Produces: `useRoomMembers(...)` returns `{ members: string[]; memberNames: ReadonlyMap<string, string>; refetchMembers }`; `DmRow` prop `withAvatars: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/chat/src/app/FleetTree.test.tsx` (Review Focus 4, sidebar half):

```tsx
test('Review Focus 4: two DM rows with kai stay distinct, read kai ↔ remy, and show different avatars', () => {
  renderTree({
    dms: [
      dm('kai', 'remy', { room: 'dm-e41f7a3c68bd' }),
      dm('kai', 'remy.m2p4', {
        room: 'dm-2c9b7e41d0a5',
        participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
      }),
      dm('jay', 'max'),
    ],
    buddies: [],
  });
  const legacy = screen.getByTestId('dm-row-dm-e41f7a3c68bd');
  const recycled = screen.getByTestId('dm-row-dm-2c9b7e41d0a5');
  expect(legacy).toHaveTextContent('kai ↔ remy');
  expect(recycled).toHaveTextContent('kai ↔ remy');
  expect(recycled).not.toHaveTextContent('m2p4');
  const fills = (row: HTMLElement) =>
    [...row.querySelectorAll('svg[shape-rendering="crispEdges"]')].map(svg =>
      svg.getAttribute('fill')
    );
  expect(fills(legacy)).toHaveLength(2);
  expect(fills(legacy)[0]).toBe(fills(recycled)[0]);
  expect(fills(legacy)[1]).not.toBe(fills(recycled)[1]);
  expect(fills(screen.getByTestId('dm-row-dm-jay-max'))).toEqual([]);
});

test('workstream and offline rows show names; the overflow line reads pairs by name', async () => {
  renderTree({
    rooms: [room('rt')],
    buddies: [
      buddy('remy.m2p4', 'rt', { name: 'remy', baseHandle: 'remy' }),
      buddy('kai.x9z1', 'rt', {
        name: 'kai',
        baseHandle: 'kai',
        status: 'offline',
        signedOutAt: NOW - 5 * M,
      }),
    ],
    dms: [
      dm('max', 'stan'),
      dm('jay', 'max'),
      dm('edie', 'stan'),
      dm('kai', 'max'),
      dm('kai', 'remy.m2p4', {
        participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
        unread: 2,
      }),
    ],
  });
  expect(screen.getByTestId('ws-remy.m2p4')).toHaveTextContent('remy');
  expect(screen.getByTestId('ws-remy.m2p4')).not.toHaveTextContent('m2p4');
  expect(screen.getByTestId('offline-rt')).toHaveTextContent('kai · ');
  expect(screen.getByTestId('offline-rt')).not.toHaveTextContent('x9z1');
  expect(screen.getByTestId('dm-more')).toHaveTextContent(
    '1 more · kai ↔ remy 2'
  );
});
```

Append to `apps/chat/src/app/PageBar.test.tsx`:

```tsx
test('a DM title reads the pair by name, never an id', () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'dm-2c9b7e41d0a5',
        memberCount: 3,
        unread: 0,
        mentions: 0,
        kind: 'dm',
        participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
      }}
      buddies={[]}
    />
  );
  expect(screen.getByText('kai ↔ remy')).toBeInTheDocument();
  expect(screen.queryByText(/m2p4/)).toBeNull();
});

test('member rows show names and stay keyed by id', async () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'rt', memberCount: 2, unread: 0, mentions: 0 }}
      buddies={[
        { handle: 'remy', name: 'remy', status: 'idle' },
        { handle: 'remy.m2p4', name: 'remy', status: 'live' },
      ]}
    />
  );
  await userEvent.click(screen.getByTestId('members-chip'));
  const recycled = await screen.findByTestId('members-row-remy.m2p4');
  expect(recycled).toHaveTextContent('remy');
  expect(recycled).not.toHaveTextContent('m2p4');
  expect(screen.getByTestId('members-row-remy')).toBeInTheDocument();
});
```

In `apps/chat/src/app/App.test.tsx`, change `import { App } from './App';` to `import { App, resultLine } from './App';` and append:

```tsx
test('the invite result line names a pane by its display name', () => {
  renderWithProviders(
    <div data-testid="line">
      {resultLine(
        [{ paneId: 'w9:p1', delivered: 'accepted' }],
        [
          {
            paneId: 'w9:p1',
            workspace: 'repo-tools',
            agentStatus: 'idle',
            presence: { handle: 'remy.m2p4', name: 'remy', status: 'live', rooms: [] },
          },
        ]
      )}
    </div>
  );
  expect(screen.getByTestId('line')).toHaveTextContent('remy accepted');
  expect(screen.getByTestId('line')).not.toHaveTextContent('m2p4');
});
```

Append to `apps/chat/src/app/RoomRail.test.tsx`:

```tsx
test('a drawer tap on a recycled name opens the DM by id and is labelled by name', async () => {
  const onOpenDm = vi.fn();
  renderWithProviders(
    <FleetDrawer
      opened
      onClose={vi.fn()}
      rooms={[{ room: 'rt', memberCount: 1, unread: 0, mentions: 0 }]}
      buddies={[
        {
          sessionId: 's-remy2',
          handle: 'remy.m2p4',
          baseHandle: 'remy',
          name: 'remy',
          repo: 'rt',
          signedInAt: 1,
          lastSeenAt: 1,
          status: 'live',
          rooms: ['rt'],
          pane: 'wC4:p2',
        },
      ]}
      onSelectRoom={vi.fn()}
      onOpenDm={onOpenDm}
    />
  );
  const row = screen.getByTestId('ws-remy.m2p4');
  expect(row).toHaveAttribute('aria-label', 'Message remy');
  await userEvent.click(row);
  expect(onOpenDm).toHaveBeenCalledWith('remy.m2p4');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run --cwd apps/chat test src/app/FleetTree.test.tsx src/app/PageBar.test.tsx src/app/App.test.tsx src/app/RoomRail.test.tsx`
Expected: FAIL: labels read `remy.m2p4`, DM rows render no avatars, the overflow line and offline row show ids, the result line reads `remy.m2p4 accepted`, the drawer row's label is `Message remy.m2p4`.

- [ ] **Step 3: FleetTree labels, rows and ambiguous DM avatars**

In `apps/chat/src/app/FleetTree.tsx`, add `import { displayName, dmPairLabel } from './display-name';` and replace `overflowLabel` and `roomLabel`:

```ts
function overflowLabel(hidden: FleetRoom[]): string {
  const pairs = hidden.map(
    d => `${dmPairLabel(d.participants!)}${d.unread > 0 ? ` ${d.unread}` : ''}`
  );
  return `${hidden.length} more · ${pairs.join(', ')}`;
}
```

```ts
function roomLabel(room: FleetRoom): string {
  return room.kind === 'dm' && room.participants
    ? dmPairLabel(room.participants)
    : `#${room.room}`;
}
```

In `WorkstreamRow`, after `const { handle, pane } = buddy;` add `const shown = displayName(buddy);`, and make the two visible labels use it:

```tsx
      aria-label={
        onSelectBuddy
          ? `Message ${shown}`
          : clickable
            ? `Focus ${shown}'s pane`
            : undefined
      }
```

In `OfflineRow`, replace the text expression with:

```tsx
        {only
          ? `${displayName(only)} · ${statusDetail(only, now)}`
          : `${offline.length} signed out · ${offline.map(b => displayName(b)).join(' ')}`}
```

In `DmRow`, add `withAvatars` to the props:

```tsx
function DmRow({
  room,
  active,
  withAvatars,
  onSelect,
  onClose,
  onMarkRead,
}: {
  room: FleetRoom;
  active: boolean;
  /** Set when another listed DM reads the same pair: the id-seeded avatars tell them apart. */
  withAvatars: boolean;
  onSelect?: () => void;
  onClose?: (room: string) => void;
  onMarkRead?: (room: string) => void;
}) {
```

and replace the two pair names:

```tsx
        <AgentName
          handle={pair.a}
          name={pair.aName}
          withCard={false}
          withAvatar={withAvatars}
        />{' '}
        <span style={{ color: 'var(--tk-text-purple-small)', flex: 'none' }}>
          ↔
        </span>{' '}
        <AgentName
          handle={pair.b}
          name={pair.bName}
          withCard={false}
          withAvatar={withAvatars}
        />
```

In `FleetTree`, after `const hiddenDms = ...;` add:

```ts
  const labelCounts = new Map<string, number>();
  for (const d of namedDms) {
    const label = dmPairLabel(d.participants!);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
```

and pass `withAvatars={(labelCounts.get(dmPairLabel(room.participants!)) ?? 0) > 1}` on `<DmRow>` after `active={...}`.

- [ ] **Step 4: PageBar title and members**

In `apps/chat/src/app/PageBar.tsx`, import `dmPairLabel` from `./display-name`, and in `roomTitle` replace the participants branch with:

```ts
    return room.participants
      ? dmPairLabel(room.participants)
      : 'Direct message';
```

On the member row's `<AgentName>` add `name={b.name}` after `handle={b.handle}`. (`PageBarBuddy` is `DoingInput`, which gained `name?` in Task 3.)

- [ ] **Step 5: App shell: header, result line, member names**

In `apps/chat/src/app/App.tsx`, import `dmPairLabel` from `./display-name`, and:

`roomHeaderTitle`:

```ts
function roomHeaderTitle(room: RoomSummary | undefined): string {
  if (!room) return '';
  return room.kind === 'dm' && room.participants
    ? dmPairLabel(room.participants)
    : `#${room.room}`;
}
```

`resultLine`'s `name`:

```ts
    const name =
      pane?.presence?.name ??
      pane?.presence?.handle ??
      (pane?.workspace ? `${pane.workspace} pane` : r.paneId);
```

`useRoomMembers`: change its return type to `{ members: string[]; memberNames: ReadonlyMap<string, string>; refetchMembers: () => void }`, and replace its final `return` with:

```ts
  const memberNames = useMemo(
    () => new Map(members.map(m => [m.handle, m.name ?? m.handle])),
    [members]
  );

  return {
    members: members.map(m => m.handle),
    memberNames,
    refetchMembers: fetchMembers,
  };
```

At the call site, destructure it:

```ts
  const {
    members: roomMembers,
    memberNames: roomMemberNames,
    refetchMembers,
  } = useRoomMembers(activeRoom, initialState?.members);
```

and pass `memberNames={roomMemberNames}` to `<BuddiesProvider>` after `roomMembers={roomMembers}`.

- [ ] **Step 6: Run the tests**

Run: `bun run --cwd apps/chat test src/app/FleetTree.test.tsx src/app/PageBar.test.tsx src/app/App.test.tsx src/app/RoomRail.test.tsx`
Expected: PASS.

Run: `bun run chat:typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/chat/src/app
git commit -m "chat: DM pairs and fleet rows by name, avatars on a repeated pair" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Composer autocomplete and the pane picker

**Files:**
- Modify: `apps/chat/src/app/Composer.tsx` (`ComposerBuddy`, `BuddyOption`, filter, `insertMention`, `insertMentionAtCaret`, DM placeholder, options render)
- Modify: `apps/chat/src/app/PanePicker/PaneRow.tsx:109-111,143,194-196`
- Modify: `apps/chat/src/app/PanePicker/PanePickerModal.tsx:35`
- Test: `Composer.test.tsx`, `PanePicker/PanePicker.test.tsx`

**Interfaces:**
- Consumes: `useBuddies().nameOf` (Task 3), `ChatPane.presence.name` (Task 1).
- Produces: `ComposerBuddy.name?: string`. `ComposerHandle.insertMention(handle)` still takes an id and now inserts `@<name>`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/chat/src/app/Composer.test.tsx`:

```tsx
test('autocomplete matches names, never ids, and posts the picked id', async () => {
  renderWithProviders(
    <Composer
      room="rt"
      roomMembers={['remy', 'remy.m2p4']}
      buddies={[
        { handle: 'remy', name: 'remy', status: 'idle' },
        { handle: 'remy.m2p4', name: 'remy', status: 'live' },
      ]}
    />
  );
  const box = screen.getByRole('textbox');
  // `remy.` prefixes the id but not the name, so it must match nothing.
  await userEvent.type(box, '@remy.');
  expect(screen.queryByTestId('composer-option-remy.m2p4')).toBeNull();
  await userEvent.clear(box);
  await userEvent.type(box, '@re');
  const recycled = await screen.findByTestId('composer-option-remy.m2p4');
  expect(recycled).toHaveTextContent('remy');
  expect(recycled).not.toHaveTextContent('m2p4');
  expect(screen.getByTestId('composer-option-remy')).toBeInTheDocument();
  await userEvent.click(recycled);
  expect(box).toHaveValue('@remy ');
  await userEvent.type(box, 'hi{Enter}');
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/post',
      expect.objectContaining({
        body: JSON.stringify({
          room: 'rt',
          body: '@remy hi',
          mentions: ['remy.m2p4'],
        }),
      })
    )
  );
});

test('a roster pick inserts the name and a DM placeholder reads names', () => {
  const ref = createRef<ComposerHandle>();
  renderWithProviders(
    <Composer
      ref={ref}
      room="dm-2c9b7e41d0a5"
      isDm
      roomMembers={['matt', 'remy.m2p4']}
      buddies={[{ handle: 'remy.m2p4', name: 'remy', status: 'live' }]}
    />
  );
  expect(screen.getByRole('textbox')).toHaveAttribute(
    'placeholder',
    'Message matt ↔ remy (both will wake)'
  );
  act(() => ref.current!.insertMention('remy.m2p4'));
  expect(screen.getByRole('textbox')).toHaveValue('@remy ');
  act(() => ref.current!.insertMention('remy.m2p4'));
  expect(screen.getByRole('textbox')).toHaveValue('@remy ');
});
```

Append to `apps/chat/src/app/PanePicker/PanePicker.test.tsx`:

```tsx
test('a pane row reads its display name, and a title equal to it is not repeated', async () => {
  route({
    'GET /api/panes': () =>
      json({
        available: true,
        panes: [
          {
            paneId: 'w9:p1',
            workspace: 'repo-tools',
            title: 'remy',
            cwd: '/r/rt',
            repo: 'repo-tools',
            branch: 'main',
            agentStatus: 'idle',
            presence: { handle: 'remy.m2p4', name: 'remy', status: 'live', rooms: [] },
          },
        ],
      }),
  });
  mount();
  await userEvent.click(screen.getByText('open'));
  const row = await screen.findByTestId('pane-row-w9:p1');
  expect(within(row).getByText('remy')).toBeInTheDocument();
  expect(row).not.toHaveTextContent('m2p4');
  expect(row).not.toHaveTextContent('repo-tools · remy');
  await userEvent.type(screen.getByTestId('pane-filter'), 'remy');
  expect(screen.getAllByTestId(/^pane-row-/)).toHaveLength(1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run --cwd apps/chat test src/app/Composer.test.tsx src/app/PanePicker/PanePicker.test.tsx`
Expected: FAIL: `@remy.` matches the id `remy.m2p4` and options show it; the inserted text is `@remy.m2p4 `; the placeholder reads `matt ↔ remy.m2p4`; the pane row shows `remy.m2p4` and `repo-tools · remy`.

- [ ] **Step 3: Composer: match and show names, store ids**

In `apps/chat/src/app/Composer.tsx`:

Add `import { useBuddies } from './buddies-context';`.

`ComposerBuddy` gains `name?: string;` after `handle: string;`.

`BuddyOption` gains a `name` prop and renders it:

```tsx
function BuddyOption({
  handle,
  name,
  status,
  inRoom,
  room,
  task,
  onSelect,
}: {
  handle: string;
  name: string;
  status: 'live' | 'idle';
  inRoom: boolean;
  room: string;
  task: DoingLine | null;
  onSelect: (handle: string, inRoom: boolean) => void;
}) {
```

and the option's name text becomes `{name}` (the `<Text component="span" size="sm" fw={600} truncate>` child). Its `data-testid` and `onSelect(handle, inRoom)` keep the id.

Inside `Composer`, after `useAutoGrowTextarea(textareaRef, value);` add:

```ts
    const ctx = useBuddies();
    const nameOf = (handle: string) =>
      buddies.find(b => b.handle === handle)?.name ??
      ctx?.nameOf(handle) ??
      handle;
```

Replace the filter:

```ts
    const filtered = query
      ? relevant.filter(b =>
          (b.name ?? b.handle).toLowerCase().startsWith(query)
        )
      : relevant;
```

Replace `insertMention`:

```ts
    function insertMention(handle: string) {
      const caret = replaceToken(`@${nameOf(handle)} `);
      setMentions(prev => (prev.includes(handle) ? prev : [...prev, handle]));
      closePopover();
      focusAt(caret);
    }
```

In `insertMentionAtCaret`, replace the three lines that build `escaped`, test it, and build `inserted`:

```ts
      const shown = nameOf(handle);
      const escaped = shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`@${escaped}(?![A-Za-z0-9._-])`).test(value)) {
        focusAt(caret);
        return;
      }
      const before = value.slice(0, caret);
      const after = value.slice(caret);
      const needsSpace = before.length > 0 && !/\s$/.test(before);
      const inserted = `${needsSpace ? ' ' : ''}@${shown} `;
```

In the placeholder, replace both `roomMembers.join(' ↔ ')` with `roomMembers.map(nameOf).join(' ↔ ')`.

In the options render, pass the name:

```tsx
                <BuddyOption
                  key={b.handle}
                  handle={b.handle}
                  name={b.name ?? b.handle}
```

- [ ] **Step 4: Pane rows and the filter by name**

In `apps/chat/src/app/PanePicker/PaneRow.tsx`, replace:

```ts
  const handle = pane.presence?.handle;
  const sub =
    handle && pane.title === handle
```

with:

```ts
  const name = pane.presence
    ? (pane.presence.name ?? pane.presence.handle)
    : undefined;
  const sub =
    name && pane.title === name
```

and replace the remaining uses: `aria-label={`select ${name ?? pane.paneId}`}`, `{name ? (` and the name text `{name}`.

In `apps/chat/src/app/PanePicker/PanePickerModal.tsx` `matchesFilter`, replace `pane.presence?.handle,` with:

```ts
    pane.presence?.name ?? pane.presence?.handle,
```

- [ ] **Step 5: Run the tests**

Run: `bun run --cwd apps/chat test src/app/Composer.test.tsx src/app/PanePicker/PanePicker.test.tsx src/app/Reader.test.tsx src/app/App.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/chat/src/app
git commit -m "chat: composer autocomplete and pane picker by name" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Viewer docs and the full gates

**Files:**
- Modify: `apps/chat/ARCHITECTURE.md` (lines 26-27, the API table's dm/open row, line 121, a new "Ids and names" section)
- Modify: `apps/chat/README.md:113`
- Modify: `apps/chat/design/ANATOMY.md` (lines 86-87, 181-182, 209, 255)

**Interfaces:**
- Consumes: everything above.
- Produces: docs that match the code; a green `chat:*` and rt-client suite.

- [ ] **Step 1: ARCHITECTURE.md**

Replace the bullet "The human's handle is `chat.humanHandle` ..." with:

```markdown
- The human is `chat.humanHandle` from the mattstack settings store, a fixed
  identity whose id is its name (it never mints), overridable per request
  with `?handle=` (`src/server/chat.ts`).
```

In the API table, change the dm/open row's description to:

```markdown
| `POST /api/chat/dm/open` `{ to }`                  | opens or reuses the DM room without posting; `to` is a name or an id, which the daemon resolves; the client navigates to it |
```

Replace the mentions bullet (line 121) with:

```markdown
- `@name` for the identities the message's `mentions` list names, matched on their `mentionNames` and marked with the id (`data-mention`), never a bare `@word` guess (`src/app/remark-mentions.ts`); an `@` inside code is never a mention
```

Add a section after "The API":

```markdown
## Ids and names

Every row the daemon returns keys on `handle`, an identity id (`remy.k3f9`;
a handle from before identities is its own id), and carries a display-name
sibling (`name`, `participants.aName`/`bName`, `mentionNames`). The viewer
shows names and acts on ids:

- `byHandle` in `buddies-context.tsx` is keyed by id, and its `nameOf`
  resolves a display name from the roster, then the open room's members,
  then the id.
- Hue (`speaker-hue.ts`) and avatar (`AgentName`) seed from the id, so two
  agents named `remy` render in their own colours.
- DM labels are `aName ↔ bName` (`dmPairLabel` in `display-name.ts`). Two
  DM rows that read the same pair show their avatars.
- The Composer's `@` autocomplete matches names and posts ids; the pane
  picker and `doing()` compare a pane title against the name.
- Fixtures (`CHAT_FIXTURES=1`) carry a legacy `remy` and a recycled
  `remy.m2p4`, both named `remy`, in `#rt` and in one DM each with kai.
```

- [ ] **Step 2: README.md**

Replace the `chat.humanHandle` row:

```markdown
| `chat.humanHandle` (rt setting) | The human's fixed identity (its id is its name); the viewer posts as it; overridable per request with `?handle=`. |
```

Then run `bun run --cwd apps/chat format` so prettier re-pads both tables (this one and ARCHITECTURE's API table), and check with `git status --short apps/chat` that it touched only the three doc files; revert anything else it rewrote.

- [ ] **Step 3: design/ANATOMY.md**

Replace lines 86-87:

```markdown
- line 1: the `.pair` (`aName ↔ bName`, both 600, `.arrows` in `--purple`),
  then the unread badge. **The hashed room name is never rendered.** When
  another listed DM reads the same pair (a recycled name), each name gets
  its id-seeded avatar so the two rows stay tellable apart.
```

In the `.hdr` paragraph (lines 180-184), replace the words "the handle as a `.hpill` chip in the speaker's hue" with "the display name as a `.hpill` chip in the speaker's hue (hue and sprite seed from the identity id, so two agents that share a name differ)", keeping the rest of the paragraph as is. Change the hover card's first line (209) to `A `.pop`, 300px: dot + `.hpill` (the display name) + status word header; then **the task line**`. Change "Handles in it are pool names." (255) to "Rows show display names; a pane title equal to the name is not repeated."

- [ ] **Step 4: Run every gate this lane touches**

Run: `bun run chat:typecheck`
Expected: exits 0.

Run: `bun run chat:lint`
Expected: exits 0.

Run: `bun run chat:test`
Expected: PASS (every file, including the new `display-name`, `AgentName` and Review Focus 4 tests).

Run: `bun run --cwd apps/chat format:check`
Expected: exits 0.

Run: `bun test packages/rt-client`
Expected: PASS, including `dist-freshness.test.ts` (rebuild with `bun run --cwd packages/rt-client build` if it names a stale dist).

Run: `bun run --cwd apps/chat build`
Expected: exits 0 (tsc plus vite).

- [ ] **Step 5: Commit**

```bash
git add apps/chat/ARCHITECTURE.md apps/chat/README.md apps/chat/design/ANATOMY.md
git commit -m "chat docs: ids and names" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: UI validation (mandatory; the lane is not done until the screenshots are reviewed)

Tests, contrast maths and a clean review do not catch "this reads wrong". This lane is not done until the viewer has been rendered against the fixtures in both colour schemes and a human-grade look at the screenshots has been written down, including anything that looks wrong.

The deck-served viewer (`deck list`) runs the shared checkout, not this branch, so serve this tree's build on a spare port instead.

**Files:** none (evidence only).

- [ ] **Step 1: Serve this tree's viewer on the fixtures**

Run: `bun run --cwd apps/chat build`
Expected: exits 0.

Run in the background (Bash `run_in_background: true`): `CHAT_FIXTURES=1 PORT=11092 bun run --cwd apps/chat serve`
Then check: `curl -s http://localhost:11092/api/health`
Expected: `{"ok":true,...}`.

- [ ] **Step 2: Drive the page through Fast Browser**

Spawn the Agent tool with `subagent_type: "fast-browser:browser-driver"` and this prompt:

```text
Open http://localhost:11092/r/rt in Fast Browser (this is a local dev server serving fixtures; no login). Use the fast-browsing skill: one browser_run_code_unsafe script per flow, waits baked in.

Capture these screenshots in LIGHT scheme, then switch to DARK (the rooms rail has a sun/moon toggle at the bottom; if it is not visible, emulate prefers-color-scheme: dark and reload) and capture the same set:
1. /r/rt scrolled to the bottom: messages 607 (remy), 608 (remy), 609 (max, "@remy welcome...") and the sidebar.
2. The sidebar's DIRECT section with the overflow expanded (click the "1 more" line) so both "kai ↔ remy" rows are visible.
3. Each of the two "kai ↔ remy" DM rooms opened (click each row), full page.
4. Hover the second "remy" sender chip in #rt until its hover card opens.

Return: the absolute path of every screenshot, plus these checks answered yes/no with one line each:
a) Does the text "m2p4" appear anywhere on any screen (use document.body.innerText)?
b) Do the two #rt "remy" sender chips have different colours (read the --speaker-hue custom property on each [data-testid="speaker-chip"])?
c) Do both DM rows read exactly "kai ↔ remy", and does each show two small sprite avatars whose fill colours differ between the rows for remy?
d) Is "@remy" in message 609 highlighted as a mention (a span with data-mention="remy.m2p4")?
e) Any console errors?
```

- [ ] **Step 3: Review the screenshots yourself**

Open every returned PNG with the Read tool. Write down plainly, in the lane report, what looks wrong in either scheme: legibility of the two chip hues against the wash, whether the DM-row avatars crowd the 34px row or push the unread badge, whether the two DM rows are obviously different at a glance, any stray id text, any layout shift. "Looks fine" is only acceptable after checking each of those. If anything is wrong, fix it in the owning task's files, rerun that task's tests, rebuild, and repeat Steps 2 and 3.

- [ ] **Step 4: Stop the server**

Stop the background `serve` task (TaskStop on its id, or kill the process listening on 11092 after confirming with `lsof -iTCP:11092 -sTCP:LISTEN` that it is this tree's `bun`).

- [ ] **Step 5: Report**

The lane report to the shepherd carries: the task list with commit hashes, the root-typecheck file list from Task 1 Step 5 (lane 1b's to fix), the screenshot paths with the Step 3 findings, and the PLAN NOTES above (fixture id `remy.m2p4` instead of `remy.k3f9`; DM-row avatars on a repeated pair; fixtures ahead of the artboards).
