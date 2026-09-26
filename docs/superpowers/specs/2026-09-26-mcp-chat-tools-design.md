# MCP tools for the rt chat verbs (RT-326 add-on)

## Goal

Every `rt chat` verb a skill routinely runs has an MCP tool on the
mattstack server, so the rt:chat skill and the chat plugin skills (join,
sign-in, sign-out, away) can stop calling `rt chat` through Bash. The
skill rewrites are a later wave; this lane ships the tools.

Parent spec: `2026-09-25-mcp-tools-over-bash-design.md` (the rule, the
three tool shapes, the fixed-environment caveat).

## What exists

`chat_post`, `chat_dm`, `chat_ack`, `chat_claim` and `chat_release`, in
`lib/mcp/tools.ts`. Each resolves the caller's handle with
`requireChatHandle`: the session file for the server's
`CLAUDE_CODE_SESSION_ID`, with no fallback, so an unsigned session is a
hard error rather than a derived handle.

## Why chat_* tools and not rt_verb

`chat` is one self-dispatching leaf in `lib/command-tree-def.ts`, not a
branch. `rt_verb` allows or refuses per leaf, so marking `chat` agent-safe
would expose every verb at once (`prune`, `--as`, `--pane` sign-in of
another session). Splitting the leaf into subcommands would touch the
picker, the usage string and every e2e assertion on it, for no gain over
direct tools. So every verb below becomes a `chat_*` tool, and
`agent-safe.test.ts` does not change.

## The tools (13 new)

All live in a new `lib/mcp/chat-tools.ts` (`chatToolDefs(deps)`), appended
to the end of the roster. `requireChatHandle` and its hint move to
`lib/mcp/shared.ts` so the existing five and the new module share them.

| Tool | Input | Acts as | Daemon command |
|---|---|---|---|
| `chat_sign_in` | `cwd?`, `as?`, `room?`, `noRoom?`, `status?` | this session | spawns `rt chat sign-in` (below) |
| `chat_sign_out` | none | this session | `chat:sign-out`, then deletes the session file |
| `chat_read` | `room?`, `limit?`, `since?`, `last?` | own handle | `chat:read`; `last` uses `chat:messages` then `chat:mark` |
| `chat_mark` | `room?`, `upto?` | own handle | `chat:mark` |
| `chat_rooms` | none | own handle | `chat:rooms` |
| `chat_who` | `room` | nobody (read) | `chat:who` |
| `chat_buddies` | none | nobody (read) | `chat:buddies` |
| `chat_join` | `room`, `wakeOn?`, `cwd?` | own handle | `chat:join` |
| `chat_leave` | `room` | own handle | `chat:leave` |
| `chat_away` | `text` | this session | `chat:away` |
| `chat_back` | none | this session | `chat:back` |
| `chat_archive` | `room`, `reopen?` | own handle | `chat:archive` |
| `chat_invite` | `pane`, `room`, `note?` | own handle as `from` | `chat:invite` |

Each tool returns the same body the CLI's `--json` prints (minus the
`ok: true` wrapper the server adds itself), so a skill moving from Bash
sees the same fields. No CLI JSON shape changes.

### Identity: this session only

- No tool takes a handle, a session id or a pane to act as. `--as`
  (per-call handle override) and `--pane` (sign another pane's session in
  or out) have no tool equivalent.
- Handle tools use `requireChatHandle`. Session tools (`chat_sign_in`,
  `chat_sign_out`, `chat_away`, `chat_back`) use the server's
  `CLAUDE_CODE_SESSION_ID` and refuse when it is unset.
- `chat_who` and `chat_buddies` read the fleet roster and need no
  identity, matching the CLI.
- `chat_invite` requires a signed-in session and sends that handle as
  `from`. The CLI's fallback to the `chat.humanHandle` setting is not
  carried over: a tool call must never speak as the human.
  `chat_sign_in` enforces the same rule on `as` (below).

### chat_sign_in

Sign-in derives the repo room from the working tree (git root, repo
identity, branch) and resolves the base handle through the CLI's own
chain, all in `commands/chat.ts`, which `lib/mcp` may not import. So the
tool spawns the CLI with a fixed argv:

`rt chat sign-in --json --session <CLAUDE_CODE_SESSION_ID>` plus `--as`,
`--room`, `--no-room`, `--status` when given.

**The spawn.** `runRtVerb` cannot carry it: it refuses any leaf without
`agentSafe`, and `chat` stays unsafe. The spawn-and-parse half of
`runRtVerb` is lifted into a helper in `lib/mcp/rt-verb.ts`,
`spawnRtJson(path, rest, { cwd, timeoutMs }, deps)`, which `runRtVerb`
then calls after its leaf and flag checks. The helper keeps every safety
property the runner has today:

- argv starts with `rtSelfArgv()`, which pins the bunfig and
  `--no-env-file`, so a caller-chosen `cwd` holding a `bunfig.toml` or
  `.env` runs no code;
- env is `{ RT_BATCH: "1", RT_SKIP_SETUP: "1" }` over the server's own
  environment (which carries `HERDR_PANE_ID` for the pane reference);
- args with a control character are refused;
- the same exit-code and JSON-envelope mapping (124 is a timeout, exit 2
  with an envelope returns its message).

`chat_sign_in` calls the helper directly with the path `["chat",
"sign-in"]`. It is the only caller that bypasses the leaf gate, and its
argv is built here, never from caller-supplied flags.

**Inputs.**

- `--pane` is never passed; the argv is built from named inputs only, so
  no caller string reaches it as a flag. Values starting with `-` and
  control characters are refused.
- `cwd` is an absolute existing directory (the checkout the agent works
  in), because the server's own working directory is fixed at session
  start. Omitted, the CLI runs in the server's directory.
- `room` with `noRoom: true` is an input error.
- `as` names this session's base handle. The daemon only hands out a seat
  that is free or reclaimable (signed out or stale), so it cannot take a
  live session's handle. The human has no presence row, so their handle
  would be a free seat, and a post from it counts as the human's (the
  daemon adds `here`). So `as` equal to the `chat.humanHandle` setting,
  or to the reserved mention `here`, is refused before any spawn.
- Timeout: the `rt_verb` default (30s).
- Returns `{handle, room}`.

**Replaced sessions.** Before spawning, the tool checks that the
server's session id still resolves to a live Claude Code session
(`resolveInbox` plus `inboxAlive`, `lib/claude-registry.ts`). After a
`/clear` the old id no longer resolves, and signing it in would create a
presence row that receives nothing and that no SessionEnd hook will ever
remove. The tool refuses with: this session was replaced (`/clear`);
run `rt chat sign-in` in Bash.

### chat_sign_out

In-process, mirroring `runSignOut`: `chatSignOut({sessionId})` with the
CLI's 3s budget, then `deleteChatSession(sessionId)` regardless of the
daemon result. A daemon error comes back as `daemonError` in an ok body,
as the CLI's `--json` reports it.

### chat_read

In-process over `chatRead`, `chatMessages` and `chatMark`, with the CLI's
rules: `limit` positive (default 20), `since` in the CLI's duration syntax
(`30s`, `5m`, `500ms`, bare seconds) as a non-advancing peek, `last` a
positive integer that needs a room and excludes `since`. A plain read
advances only the caller's own cursor, as the CLI does.

`since` is parsed with the CLI's own `parseDuration`, imported from
`commands/events.ts` (a light module that imports only the daemon
client; `run-tools.ts` already imports from `commands/`), so the grammar
cannot drift. Lifting it into `lib/` is outside this lane's write fence.

### chat_join

`cwd` is sent as the membership's cwd, as the CLI sends its own. Omitted,
the server's cwd is sent. `pane` is `selfPaneRef()` over the server's
environment. `wakeOn` is `mention`, `all` or `none`.

### chat_archive and chat_invite

Both reach beyond the caller, and the operator chose to make both tools
anyway:

- `chat_archive` hides a room from every member until someone posts into
  it. The daemon checks no membership, so the tool adds one: it reads
  `chat:who <room>` (which answers for an archived room by name, so
  `reopen` works too) and refuses unless the caller's handle is a
  member. The CLI keeps its current behavior.
- `chat_invite` types `/chat:join <room>` (plus `note from <handle>:
  <note>`) into the target pane. The daemon collapses newlines in the
  note, refuses panes it cannot deliver to, and reports
  `accepted | queued | refused`. The tool refuses a note holding any
  other control character (C0 or DEL, e.g. ESC or Ctrl-C, which would
  reach the other agent's prompt as keystrokes) and a note over 300
  characters. `pane` must be a pane reference shape (letters, digits,
  `.`, `_`, `:`, `-`, not starting with `-`). `callerPane` is the
  server's own pane.

## Input checks

Every tool validates its own input (the server does not enforce
`inputSchema`), using `checkRequired`, `checkOptional` and a room/handle
shape check matching the CLI's `requireValidName`. Room names, pane ids
and message ids reach the daemon only after that check.

## Known limit: /clear

The server's `CLAUDE_CODE_SESSION_ID` is fixed at session start, as the
parent spec notes. After a `/clear`, the Bash CLI sees the new session
while these tools still act as the pre-clear one, whose file the
SessionEnd hook deletes; the handle tools then report no signed-in
session for the rest of that session. The existing five chat tools
already behave this way, and no tool can act as the new id without
taking a caller-supplied session id, which this lane rules out.

So the shared hint (`SIGN_IN_HINT`, used by all 18 chat tools) names
both paths: call `chat_sign_in`, or, if this session was `/clear`ed, run
`rt chat sign-in` and the other chat verbs in Bash. `chat_sign_in`
itself refuses a replaced session (above), so the tool path can never
sign in a dead id.

## Not in this lane

- Skill rewrites (rt:chat, the chat plugin skills).
- `rt chat tail` and `rt pane send` stay on Bash. (`commands/chat.ts` has
  no `tail` verb today; delivery is pushed into the session. Nothing to
  build.)
- The rt:chat skill's other pane verbs: `pane list` and `pane peek` are
  already reachable through `rt_verb` (agent-safe); `pane spawn`,
  `pane accounts` and `pane directories` stay on Bash.
- `rt chat prune` (no skill runs it) and `--as` / `--pane` forms.
- `buddy` and `session` are not chat verbs.

## Testing

- **Unit** (`lib/mcp/__tests__/chat-tools.test.ts`, fake deps as in
  `herd-tools.test.ts`): per tool, the argument checks, that the payload
  carries the session's own handle or session id and never a caller one,
  the unsigned-session error, and daemon error mapping. `chat_sign_in`:
  the exact argv (never `--pane`, `--session` from the environment), that
  the argv prefix is `selfArgv()` and the env carries `RT_BATCH`, `cwd`
  refused when relative or missing, `room` with `noRoom` refused, a value
  starting with `-` refused, `as` equal to the human handle or `here`
  refused with no spawn, a session id that no longer resolves (or is not
  alive) refused with no spawn. `chat_sign_out`: the file is deleted when
  the daemon fails. `chat_read`: `last` with `since`, `last` without a
  room, a bad `since`. `chat_archive`: a non-member refused, a member
  allowed, `reopen` by a member of an archived room allowed.
  `chat_invite`: refused unsigned, `from` is the session handle, a note
  with ESC or Ctrl-C refused, a note over 300 characters refused, a
  malformed pane refused.
- **rt_verb** (`rt-verb.test.ts`): the existing suite passes unchanged
  over the lifted `spawnRtJson`.
- **Roster**: the 13 names appended to `NAMES` (`tools.test.ts`),
  `EXPECTED_TOOL_NAMES` and `PUBLISHED` (`e2e/tests/mcp-serve.test.ts`).
- **e2e**: `mcp-serve.test.ts` against a freshly built `dist/rt`.
- **Gates**: `bun run test`, `bunx tsc --noEmit`, `bun run picker:check`,
  `bash scripts/repo-purity.sh`.
