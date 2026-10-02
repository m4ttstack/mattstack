# rt Output Layer, Phase 6j (chat refusal codes and chat read) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three chat refusals the daemon makes by policy (a release by someone who neither holds the claim nor posted the message; an identity another session holds; an identity reserved for the human or the herd) carry a code on the wire, so `rt chat` draws them as `refused` notes instead of failures (5f2's decision 8). And `rt chat read` at a terminal shows each message's time in local time with its zone, with a blank row between messages. Off a terminal every `rt chat` byte stays as 5f2 froze it.

**Architecture:** Daemon side: a coded error (`Object.assign(new Error(message), { code })`) at the two throw sites in `lib/state/presence-store.ts`; the chat handlers that catch an error and return `{ ok: false, error }` now also return `failure: { code, message }` when the error has a code; `chat:release` returns `failure` for its `not-holder` reason; `CommandResult`'s failure branch gains the optional `failure` that `createHandleCommand` already passes through and `RtResponse` already declares. Every `error` string stays byte-identical (a sign-in retry and a SessionEnd hook match on "handle reclaimed"). CLI side: `unwrap` in `commands/chat.ts` draws a coded refusal through 5f2's `refuse`, still exit 1. `readBlocks` takes a clock and puts `out.blank()` between messages.

**Tech Stack:** Bun + TypeScript, `bun:test` (`lib/daemon/__tests__/chat-handlers.test.ts`'s `freshHandlers`, `commands/__tests__/chat.test.ts`'s fake daemon), the e2e chat suites, Fast Browser.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (RT-369), "Status set" (refused: rt chose not to, by policy), "Rules" 3. **Scoping:** `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`, "Chat" rows, shared item 7. **5f2's plan** (`docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5f2-chat.md`): decisions 8 and 9, the frozen-stdout fixture `commands/__tests__/fixtures/chat-bytes.json`, `refuse`, `show`, `readBlocks`.

**Size:** about 800 changed lines. One PR.

**What was run while writing this plan:** nothing was compiled. Written against `origin/main` at `658e704b9`.

## Global Constraints

- Never use em dashes or en dashes anywhere. Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show.
- Every daemon `error` string is byte-identical. `failure` is additive on the daemon reply (the reply is an internal wire, not a CLI `--json` envelope; MCP chat tools read `error` and ignore unknown keys).
- `rt chat` stdout off a terminal is frozen (5f2 ruling 1): `commands/__tests__/fixtures/chat-bytes.json` passes unchanged and is never regenerated. Its `--json` replies are unchanged; a refusal under `--json` writes nothing to stdout, as a failure does today.
- Exit codes do not change: a chat refusal exits 1, as the failure it replaces.
- Refusals by policy draw `refused` on stderr (`out.note`), never coral.
- Copy to "you", plainly; commands in a `next` callout; no handles or ids in titles.
- The frozen `read` line (`commands/chat.ts:516`) keeps its UTC `HH:MM`; only the human path's clock changes.
- Run `bun test` only from the repo root. Never run a built `rt` outside an isolated HOME.
- Git commands plain and alone from the worktree root. Never `git add -A`, `.` or `-u`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files this slice must not edit: every file another phase 6 slice owns (6e owns the other `lib/state` files); `lib/ui/**`; `packages/rt-client/**` (`RtResponse.failure` exists); `lib/mcp/**`; `plugins/herdr-chat/**`.
- UI validation is mandatory (Task 5).

## Review Focus

1. **A sign-in with `--as` naming an identity another session holds.** The daemon's own retry (`err.message.includes("handle reclaimed")`) must still fire for a typed name, and when it refuses, the CLI reads `refused` with `rt chat sign-in` as next. Pinned in Task 2 (`a held identity carries its code and keeps its wording`) and Task 3 (`a held identity is a refusal with the sign-in command`).
2. **The SessionEnd hook and agents that match "handle reclaimed".** The text is unchanged on every path. Pinned in Task 2 (the existing `handle reclaimed` assertions in `chat-handlers.test.ts` and `presence-store.test.ts`, untouched).
3. **`rt chat release` by an agent that neither holds nor posted the message.** `refused`, exit 1, stdout empty under `--json`. Pinned in Task 3 (`release of a claim you do not hold is a refusal`).
4. **An agent reading `rt chat read` off a terminal.** Bytes unchanged: UTC times, no blank rows. Pinned by the fixture test, untouched.
5. **A daemon reply with an unknown code.** Drawn as today's failure, in the daemon's words. Pinned in Task 3 (`an unknown code is a failure in the daemon's words`).

## Readers

| Reader | Reads | After |
|---|---|---|
| `lib/daemon/handlers/chat.ts` sign-in retry | `err.message.includes("handle reclaimed")` | unchanged message |
| the SessionEnd hook, agents (`skills/rt-chat`) | "handle reclaimed" in replies and stderr | unchanged on the wire; the CLI's human stderr reads the refusal copy instead |
| `lib/mcp/chat-tools.ts` | daemon replies' `error` | unchanged; `failure` ignored |
| `plugins/herdr-chat/src/rt.rs` | `rt chat` stdout and whole stderr on failure | stdout unchanged; stderr reads the refusal copy (shown whole, never parsed: 5f2's readers table) |
| `e2e/tests/chat-inbox-delivery.test.ts`, `chat-presence-roster.test.ts` | the binary | must pass untouched |

## Copy table

| Code (daemon) | Where it is made | CLI blocks (`refuse`, stderr, exit 1) |
|---|---|---|
| `not-holder` | `chat:release` (`lib/daemon/handlers/chat.ts:1043-1050`) | `line("refused", "rt chat will not release a claim you do not hold")`, `callout("why", "Only the agent holding a claim, or the one who posted the message, can release it.")` |
| `identity-held` | `heldByAnotherSession` (`lib/state/presence-store.ts:260`), and `assertSessionSignedIn`'s reclaimed throw (`:456`) | `line("refused", "Another session is using that identity")`, `callout("why", "Another session signed in as it, so this one no longer speaks for it.")`, `callout("next", cmd("rt chat sign-in"))` |
| `identity-fixed` | `continuationTarget`'s fixed-identity throw (`lib/state/presence-store.ts:268-270`) | `line("refused", "rt chat keeps that identity for the human or the herd")`, `callout("why", "Agents sign in under names of their own.")`, `callout("next", cmd("rt chat sign-in"))` |

`chat read` at a terminal: each message's header row is `[strong(name), dim("<HH:MM> <zone>")]` in the machine's local time zone (for example `12:04 CDT`), and an `out.blank()` sits between two messages in a room (none before the first or after the last).

## File Structure

| File | Responsibility |
|---|---|
| `lib/state/presence-store.ts` | the coded errors |
| `lib/daemon/handlers/types.ts` | `CommandResult` carries an optional `failure` |
| `lib/daemon/handlers/chat.ts` | `failureFrom`, the three catch sites, `assertionError`, `chat:release` |
| `commands/chat.ts` | `CHAT_REFUSALS`, `unwrap`, `localClock`, `readBlocks` |
| `lib/state/__tests__/presence-store.test.ts`, `lib/daemon/__tests__/chat-handlers.test.ts`, `commands/__tests__/chat.test.ts` | tests |

---

### Task 1: Confirm the base

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`.
- [ ] **Step 2:** Run each alone: `grep -n "failure?: { code: string; message: string }" packages/rt-client/src/transport.ts` (one line); `grep -n "function refuse" commands/chat.ts` (one line); `grep -n "export function blank" lib/ui/out.ts` (one line). Any empty: **stop** and report.
- [ ] **Step 3:** Run `bun test lib/state/__tests__/presence-store.test.ts lib/daemon/__tests__/chat-handlers.test.ts lib/daemon/__tests__/chat-identity-incident.test.ts commands/__tests__/chat.test.ts`. PASS (the fixture test included), or stop and report.

---

### Task 2: The daemon codes its three policy refusals

**Interfaces:**
- Produces: `CommandResult<K>`'s failure branch `{ ok: false; error: string; failure?: { code: string; message: string } }`; `failureFrom(err: unknown): { ok: false; error: string; failure?: { code: string; message: string } }` in `lib/daemon/handlers/chat.ts`.

- [ ] **Step 1: Failing tests.**

`lib/state/__tests__/presence-store.test.ts` (it has `fresh()`, `mustSignIn` and `now`), beside the `handle reclaimed` tests:

```ts
test("the held-identity errors carry identity-held and keep their words", () => {
  const db = fresh();
  const { handle } = mustSignIn({ sessionId: "s1", baseHandle: "x", now }, db);
  const codeOf = (fn: () => unknown): { message: string; code?: string } => {
    try {
      fn();
    } catch (err) {
      return err as { message: string; code?: string };
    }
    throw new Error("did not throw");
  };
  const owned = codeOf(() => assertSessionOwnsHandle(handle, "s2", db));
  expect(owned.message).toMatch(/handle reclaimed/);
  expect(owned.code).toBe("identity-held");
  const away = codeOf(() => assertSessionSignedIn("ghost", db));
  expect(away.message).toMatch(/handle reclaimed/);
  expect(away.code).toBe("identity-held");
});
```

and, for the fixed identity, a test that signs in with `continueId` set to the human's handle (the file's other fixed-identity tests show how it reads `chat.humanHandle`; find them with `grep -n "speaks for the human" lib/state/__tests__/presence-store.test.ts`) and expects the thrown error's `message` to start `chat: may not continue` and its `code` to be `identity-fixed`.

`lib/daemon/__tests__/chat-handlers.test.ts`:

```ts
test("a held identity carries its code and keeps its wording", async () => {
  const h = freshHandlers();
  const a = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "remy" });
  if (!a.ok) throw new Error(a.error);
  const b = await h["chat:sign-in"]({ sessionId: "s2", continue: a.data.handle });
  expect(b.ok).toBe(false);
  if (b.ok) throw new Error("unreachable");
  expect(b.error).toContain("handle reclaimed");
  expect(b.failure).toEqual({ code: "identity-held", message: b.error });
});

test("a release by neither holder nor author carries not-holder", async () => {
  const h = freshHandlers();
  const remy = await h["chat:sign-in"]({ sessionId: "s1", baseHandle: "remy" });
  const kai = await h["chat:sign-in"]({ sessionId: "s2", baseHandle: "kai" });
  const eli = await h["chat:sign-in"]({ sessionId: "s3", baseHandle: "eli" });
  if (!remy.ok || !kai.ok || !eli.ok) throw new Error("sign-in failed");
  for (const who of [remy, kai, eli]) await h["chat:join"]({ room: "build", handle: who.data.handle });
  const posted = await h["chat:post"]({ room: "build", handle: kai.data.handle, body: "who takes this?", mentions: [remy.data.handle] });
  if (!posted.ok) throw new Error(posted.error);
  const claimed = await h["chat:claim"]({ id: posted.data.id, handle: remy.data.handle });
  if (!claimed.ok) throw new Error(claimed.error);
  const res = await h["chat:release"]({ id: posted.data.id, handle: eli.data.handle });
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("unreachable");
  expect(res.error).toBe(`you are neither the holder of #${posted.data.id} nor its author`);
  expect(res.failure).toEqual({ code: "not-holder", message: res.error });
});
```

And `chat:dm refuses a reclaimed sender` (`lib/daemon/__tests__/chat-handlers.test.ts:1154`) gains `expect(res.failure?.code).toBe("identity-held")`.

- [ ] **Step 2:** Run both files: FAIL (`code` and `failure` are undefined).
- [ ] **Step 3: Implement.**

`lib/state/presence-store.ts`:

```ts
/** A policy refusal the CLI draws as refused; the message is matched by the sign-in retry and the SessionEnd hook, so it never changes. */
function refusal(code: "identity-held" | "identity-fixed", message: string): Error {
  return Object.assign(new Error(message), { code });
}

function heldByAnotherSession(handle: string): Error {
  return refusal("identity-held", `chat: handle reclaimed: "${handle}" is now held by another session; sign in again`);
}
```

`continuationTarget`: `if (refusal) throw refusal("identity-fixed", \`chat: may not continue ${JSON.stringify(x)}: ${refusal}\`);` (rename the local `refusal` there to `reason` so it does not shadow the helper). `assertSessionSignedIn`'s first throw: `throw refusal("identity-held", "chat: handle reclaimed while you were away; sign in again");`.

`lib/daemon/handlers/types.ts`:

```ts
export type CommandResult<K extends CommandName> =
  | { ok: true; data: Commands[K]["data"] }
  | { ok: false; error: string; failure?: { code: string; message: string } };
```

`lib/daemon/handlers/chat.ts`:

```ts
function failureFrom(err: unknown): { ok: false; error: string; failure?: { code: string; message: string } } {
  const error = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? { ok: false, error, failure: { code, message: error } } : { ok: false, error };
}

function assertionError(fn: () => void): ReturnType<typeof failureFrom> | null {
  try {
    fn();
    return null;
  } catch (err) {
    return failureFrom(err);
  }
}
```

Each `const err = assertionError(...); if (err) return { ok: false, error: err };` becomes `const refused = assertionError(...); if (refused) return refused;`. The three `catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }` sites (`lib/daemon/handlers/chat.ts:929`, `:1221`, `:1355`) return `failureFrom(err)`. `assertionError` is at `:102`. `failureFrom` attaches a `failure` to any error with a string `code`, not only the three set here (a SQLite `SQLITE_BUSY` carries one too); the CLI draws only the codes in `CHAT_REFUSALS` as refusals and every other code as today's failure in the daemon's words, so that is harmless. `chat:release`:

```ts
      if (!res.ok) {
        const why = { "unknown-message": `no message #${id}`, "not-claimed": `#${id} is not claimed`, "not-holder": `you are neither the holder of #${id} nor its author` }[res.reason];
        return res.reason === "not-holder" ? { ok: false, error: why, failure: { code: "not-holder", message: why } } : { ok: false, error: why };
      }
```

- [ ] **Step 4:** Run `bun test lib/state/__tests__/presence-store.test.ts lib/daemon/__tests__/chat-handlers.test.ts lib/daemon/__tests__/chat-identity-incident.test.ts lib/daemon/__tests__/chat-delivery.test.ts lib/mcp`. PASS, every existing `handle reclaimed` assertion unchanged. `bun run typecheck` clean.
- [ ] **Step 5:** Commit, message `chat daemon: the three policy refusals carry codes; every error string unchanged`.

---

### Task 3: `rt chat` draws a coded refusal as refused

**Interfaces:**
- Produces: `CHAT_REFUSALS: Record<string, () => Block[]>` in `commands/chat.ts`, added to `__test__`.

- [ ] **Step 1: Failing tests** (append to `commands/__tests__/chat.test.ts`, which runs verbs against a fake daemon through `canned` replies and `runChatRaw`):

```ts
describe("daemon refusals by policy", () => {
  test("release of a claim you do not hold is a refusal", async () => {
    canned = { "chat:release": { ok: false, error: "you are neither the holder of #1 nor its author", failure: { code: "not-holder", message: "you are neither the holder of #1 nor its author" } } };
    const r = await runChatRaw(["release", "1", "--as", "b"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("[refused] rt chat will not release a claim you do not hold\n  why: Only the agent holding a claim, or the one who posted the message, can release it.");
    const json = await runChatRaw(["release", "1", "--as", "b", "--json"]);
    expect(json.stdout).toBe("");
    expect(json.code).toBe(1);
    canned = {};
  });

  test("a held identity is a refusal with the sign-in command", async () => {
    canned = { "chat:sign-in": { ok: false, error: 'chat: handle reclaimed: "remy.1" is now held by another session; sign in again', failure: { code: "identity-held", message: "x" } } };
    const r = await runChatRaw(["sign-in", "--as", "remy.1", "--no-room", "--session", "s9"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("[refused] Another session is using that identity");
    expect(r.stderr).toContain("next: rt chat sign-in");
    canned = {};
  });

  test("an unknown code is a failure in the daemon's words", async () => {
    canned = { "chat:release": { ok: false, error: "no message #9", failure: { code: "something-new", message: "no message #9" } } };
    const r = await runChatRaw(["release", "9", "--as", "b"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("no message #9");
    canned = {};
  });
});
```

(`canned` replies are served as-is by the file's fake daemon; check that it passes a reply's extra keys through unchanged, as it does for `data`, and adjust the fake if it rebuilds replies.)

Three existing tests in `commands/__tests__/chat.test.ts` read today's failure words for these refusals and change on purpose, to the refusal copy, in this step:

- `:422-430` (`release: the holder or the author frees the id; anyone else exits 1 with the reason`): `:427`'s `toContain("neither the holder")` becomes `toContain("[refused] rt chat will not release a claim you do not hold")`; the exit code stays 1.
- `:795-802` (the held-identity sign-in): `:800`'s `toContain("handle reclaimed")` becomes `toContain("[refused] Another session is using that identity")`. The wire error still says "handle reclaimed" (the sign-in retry and the SessionEnd hook match it); only the person's stderr changes.
- `:804-809` (`--as naming the human's handle is refused`): `:807`'s `toContain("matt")` becomes `toContain("[refused] rt chat keeps that identity for the human or the herd")`.

- [ ] **Step 2:** Run: FAIL (today the refusals print as failures in the daemon's words; the three updated tests fail the same way).
- [ ] **Step 3: Implement** in `commands/chat.ts`:

```ts
/** Daemon refusals by policy, by the code the daemon gives them: rt declining, never a failure. */
const CHAT_REFUSALS: Record<string, () => Block[]> = {
  "not-holder": () => [
    out.line("refused", "rt chat will not release a claim you do not hold"),
    out.callout("why", "Only the agent holding a claim, or the one who posted the message, can release it."),
  ],
  "identity-held": () => [
    out.line("refused", "Another session is using that identity"),
    out.callout("why", "Another session signed in as it, so this one no longer speaks for it."),
    out.callout("next", out.cmd("rt chat sign-in")),
  ],
  "identity-fixed": () => [
    out.line("refused", "rt chat keeps that identity for the human or the herd"),
    out.callout("why", "Agents sign in under names of their own."),
    out.callout("next", out.cmd("rt chat sign-in")),
  ],
};

function unwrap<T>(res: RtResponse<T>, label: string): T {
  if (!res.ok || res.data === undefined) {
    const refusal = res.failure ? CHAT_REFUSALS[res.failure.code] : undefined;
    if (refusal) refuse(...refusal());
    fail({ title: res.error ?? `The chat ${label} did not go through` });
  }
  return res.data;
}
```

Any other place in `commands/chat.ts` that reads `res.ok === false` and calls `fail` with `res.error` directly (not through `unwrap`) gets the same two lines; find them with `grep -n "res.error" commands/chat.ts`. Add `CHAT_REFUSALS` to `__test__`.

- [ ] **Step 4:** Run `bun test commands/__tests__/chat.test.ts`. PASS, the fixture test included and the fixture file untouched (`git diff --stat commands/__tests__/fixtures/chat-bytes.json` prints nothing).
- [ ] **Step 5:** Commit, message `chat: a coded daemon refusal reads as refused, with the command that unsticks it`.

---

### Task 4: `chat read` at a terminal: local time with a zone, a gap between messages

**Interfaces:**
- Produces: `localClock(ms: number, timeZone?: string): string`; `readBlocks(rooms, full, headingFor, clock = localClock)`.

- [ ] **Step 1: Failing tests.** In `commands/__tests__/chat.test.ts`, the `read is a section per room` test passes a fixed clock and expects a blank row between the two messages:

```ts
  test("read is a section per room: each message a name, a time and its body, a blank row between messages", () => {
    const clock = () => "12:04 CDT";
    const text = renderPlain(__test__.readBlocks([{ room: "build", messages: [message({ body: "the lede\n\n- one point" }), message({ id: 2, name: "bo", body: "ok" })] }], false, heading, clock));
    expect(text).toBe("#build\nana  12:04 CDT\n    the lede\n  \n    - one point\n\nbo  12:04 CDT\n    ok\n");
    expect(renderPlain(__test__.readBlocks([], false, heading))).toBe("[skipped] Nothing unread\n");
  });

  test("the human clock is local time with its zone", () => {
    expect(__test__.localClock(Date.UTC(2026, 9, 1, 17, 4), "America/Chicago")).toBe("12:04 CDT");
    expect(__test__.localClock(Date.UTC(2026, 0, 1, 0, 30), "UTC")).toBe("00:30 UTC");
  });
```

(The plain renderer's `blank` is one empty row; inside a `section`, check whether it indents the empty row and match the expected string to `renderPlain`'s real output before trusting it.) The other `readBlocks` tests (`a long body is cut ...`, `a message body cannot repaint the screen ...`) pass `() => "12:04"` as the clock so their expected strings keep `12:04`, or update them to a fixed clock of your choosing; the frozen fixture is untouched.

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.**

```ts
/** A person's clock: local time with its zone. The frozen read line keeps UTC for agents. */
function localClock(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short", ...(timeZone ? { timeZone } : {}) }).formatToParts(ms);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")} ${part("timeZoneName")}`;
}

function readBlocks(rooms: { room: string; messages: ChatMessage[] }[], full: boolean, headingFor: (room: string) => string, clock: (ms: number) => string = (ms) => localClock(ms)): Block[] {
  if (rooms.length === 0) return [out.line("skipped", "Nothing unread")];
  return rooms.map((r) =>
    out.section(
      headingFor(r.room),
      undefined,
      ...r.messages.flatMap((m, i) => [
        ...(i > 0 ? [out.blank()] : []),
        out.table([[out.strong(m.name ?? m.handle), out.dim(clock(m.postedAt))]]),
        out.paragraph(indentBody(full ? m.body : truncate(m.body, 200))),
      ]),
    ),
  );
}
```

Add `localClock` to `__test__`.

- [ ] **Step 4:** Run `bun test commands/__tests__/chat.test.ts`. PASS; the fixture untouched.
- [ ] **Step 5:** Commit, message `chat read: local time with its zone and a blank row between messages, for a person only`.

---

### Task 5: Renders, AGENTS.md and every gate

- [ ] **Step 1:** `bun run ui:build`. In the scratchpad, `blocks-6j.ts` imports `__test__` from `<repo>/commands/chat.ts` and emits `readBlocks` for a room with three messages (one multi-paragraph) with the real `localClock`, then each of the three `CHAT_REFUSALS` blocks, then a failure in the daemon's words (`out.failure({ title: "no message #9" })`). Copy 5f2's `ansi-page.ts`.
- [ ] **Step 2:** Render at width 100, dark and light.
- [ ] **Step 3:** Screenshot both into `docs/design/output-layer/6j-chat-dark.png` and `-light.png`. Write down plainly what reads wrong: the three refusals read as rt declining, not coral, and visibly differ from the failure; the time and zone are quiet beside the name; the blank rows separate messages without separating a message from its header. Fix and re-render.
- [ ] **Step 4:** README row: `| \`6j-chat-dark.png\`, \`6j-chat-light.png\` | \`rt chat read\` with local times and gaps, the three daemon refusals drawn as refused, and a daemon failure. Off a terminal chat prints what it printed before |`.
- [ ] **Step 5:** AGENTS.md (append to "Output layer"): `A daemon handler that declines by policy returns \`failure: { code, message }\` beside its \`error\` (\`CommandResult\`), and the CLI maps known codes to \`refused\` notes; the \`error\` string itself never changes, since hooks and the daemon's own retries match on it.`
- [ ] **Step 6:** Gates, one at a time: `bun run ui:build`, `bun run typecheck`, `bun run test`, `bun run test:e2e` (the chat suites must pass untouched), `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`. All pass.
- [ ] **Step 7:** Commit, message `docs: chat refusal and read renders`.

---

### Task 6: Ship

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`; merge `AGENTS.md` and the README by hand.
- [ ] **Step 2:** The eight gates again; the chat fixture passes as committed.
- [ ] **Step 3:** `git diff --shortstat origin/main...HEAD`; about 800 lines.
- [ ] **Step 4:** Push with `git_push`; body in `<scratchpad>/pr-body-6j.md` (framing; **Daemon codes** (three, error strings unchanged), **CLI refusals**, **chat read**; renders; gates; last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`); `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 6j, chat-codes" --body-file <scratchpad>/pr-body-6j.md`.
- [ ] **Step 5:** Report URL, gates, size, renders. Do not merge.

---

## Decisions this plan made

1. **Codes ride beside the error string, never in it.** The sign-in retry and the SessionEnd hook match on "handle reclaimed"; changing the words would break them.
2. **`assertSessionSignedIn`'s "reclaimed while you were away" is `identity-held` too:** the same fact (another session has the identity) reached from `away` or `back`.
3. **An unknown code stays a failure in the daemon's words,** so an older CLI and a newer daemon degrade to today's behavior.
4. **The human clock uses the machine's time zone;** the frozen line keeps UTC for agents (5f2's decision 9 stands).

## Self-Review

**Spec coverage.** 5f2's decision 8 (three refusals by meaning, now by code): Tasks 2 and 3. Status set (refused, not coral): Task 3. The two chat read follow-ups: Task 4. Shared item 7 (`CommandResult.failure`): Task 2. The frozen fixture: every task.

**Placeholders.** The fixed-identity test reads how the file's own fixed-identity tests set the human's handle (a named `grep`); every other test is written out.

**Type consistency.** `failureFrom`, `assertionError` returning a result, `CHAT_REFUSALS`, `localClock(ms, timeZone?)`, `readBlocks(..., clock)` match across tasks.

**Review Focus.** Five lines, each pinned by a named test.
