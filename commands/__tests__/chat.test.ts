/**
 * rt chat CLI (RT-48).
 *
 * runChat/runChatRaw invoke the `chat` export in-process against a temp
 * HOME, backed by a real (not stubbed) chat daemon: a Bun.serve unix socket
 * bound at the HOME's default rt.sock, dispatching to the REAL
 * createChatHandlers over a per-test state.db. This exercises the
 * actual join/member-count/unread rules, not a canned reply map.
 *
 * HERDR_PANE_ID is deliberately cleared for every test: this suite may
 * itself run inside a real herdr pane, and leaving it set would let
 * handle derivation spawn `herdr pane get` against the live session —
 * nondeterministic and slow. See commands/chat.ts's resolveHandle order.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { chat, __test__ } from "../chat.ts";
import { createChatHandlers } from "../../lib/daemon/handlers/chat.ts";
import { getStateDb, closeStateDb, type RegistryDeps } from "../../lib/state/index.ts";
import type { InboxBinding } from "../../lib/claude-registry.ts";
import { sessionFilePath } from "../../lib/chat-session.ts";
import { createSessionStore, listBindingsByNativeValue } from "../../lib/agent-integrations/session-store.ts";
import { presenceForSession } from "../../lib/state/presence-store.ts";
import { UserActionableError } from "../../lib/errors.ts";
import { AGENT_NAMES } from "../../lib/chat-names.ts";
import { setSetting } from "../../packages/rt-client/src/settings/write.ts";
import { drainNotifications, peekNotifications } from "../../lib/notifier.ts";
import { fakeHerdr, HerdrFakeError } from "../../lib/herdr/__tests__/fake-herdr.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import type { BuddyStatus, ChatMember, ChatMessage, PresenceRow } from "../../packages/rt-client/src/index.ts";


// ─── in-process CLI + fake daemon harness ───────────────────────────────────

let home = "";
let origHome: string | undefined;
let origPaneId: string | undefined;
let origSessionId: string | undefined;
let origBackoff: string | undefined;
let server: ReturnType<typeof Bun.serve> | null = null;
// Real child processes spawned by a test (e.g. a stdin-fed `post`); reaped in
// afterEach so a stray one can't outlive its test.
const children: Array<ReturnType<typeof Bun.spawn>> = [];
// Scripted replies for a command, consulted before the real handlers (for
// commands whose real handler has side effects a unit test must not trigger:
// chat:invite would actually type into a herdr pane). Reset every test.
let canned: Record<string, unknown> = {};
// Every command this fake daemon dispatched, in order, for asserting exactly
// what a verb sent the daemon.
let seen: Array<{ cmd: string; payload: unknown }> = [];
// Overrides the registry probe behind buddyStatus for one test at a time
// (undefined uses the real resolver). Bun's os.homedir() does not follow a
// runtime process.env.HOME change, so a fake ~/.claude/sessions file is not
// reachable from here — this seam is the only way a CLI-level test can make
// a handle read "live".
let registryDeps: RegistryDeps | undefined;

beforeEach(() => {
  origHome = process.env.HOME;
  origPaneId = process.env.HERDR_PANE_ID;
  origSessionId = process.env.CLAUDE_CODE_SESSION_ID;
  origBackoff = process.env.RT_CHAT_BACKOFF_MS;
  delete process.env.HERDR_PANE_ID;
  // This suite runs inside a real Claude Code session; a leaked id would sign
  // tests in against the developer's own session file. Every test below that
  // needs a session id passes --session explicitly.
  delete process.env.CLAUDE_CODE_SESSION_ID;
  // Keep the daemon-unreachable backoff short so the exit-69 path is fast.
  process.env.RT_CHAT_BACKOFF_MS = "150";

  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-chat-cli-")));
  process.env.HOME = home;

  const sockDir = join(home, ".mattstack", "rt");
  mkdirSync(sockDir, { recursive: true });

  canned = {};
  seen = [];
  registryDeps = undefined;

  server = Bun.serve({
    unix: join(sockDir, "rt.sock"),
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      const payload = req.method === "POST" ? await req.json() : {};
      seen.push({ cmd, payload });
      if (cmd in canned) return Response.json(canned[cmd]);
      const handlers = createChatHandlers({ db: getStateDb(), emitEvent: () => 0, registryDeps }) as unknown as Record<string, (p: unknown) => Promise<unknown>>;
      const handler = handlers[cmd];
      if (!handler) return Response.json({ ok: false, error: `unknown command: ${cmd}` });
      return Response.json(await handler(payload));
    },
  });
});

afterEach(async () => {
  for (const child of children) {
    try { child.kill(); } catch { /* already gone */ }
  }
  await Promise.all(children.map((c) => c.exited));
  children.length = 0;
  server?.stop(true);
  server = null;
  closeStateDb();
  if (home) rmSync(home, { recursive: true, force: true });
  process.env.HOME = origHome;
  if (origPaneId === undefined) delete process.env.HERDR_PANE_ID;
  else process.env.HERDR_PANE_ID = origPaneId;
  if (origSessionId === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = origSessionId;
  if (origBackoff === undefined) delete process.env.RT_CHAT_BACKOFF_MS;
  else process.env.RT_CHAT_BACKOFF_MS = origBackoff;
});


/**
 * Mirrors commands/__tests__/runs.test.ts's runExpectingCleanExit: mocks
 * process.exit to throw a sentinel so a `fail()` path never kills the real
 * test process, and reads the spies' recorded calls before mockRestore()
 * clears them.
 */
async function runChatRaw(args: string[], opts: { sock?: string; human?: boolean } = {}): Promise<{ code: number; stdout: string; stderr: string; rawStdout: string }> {
  if (opts.sock) args = [...args, "--sock", opts.sock];
  const io = captureOut();
  ui.__test__.setHuman(() => opts.human === true);
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });

  let code = 0;
  let rawStdout = "";
  let rawStderr = "";
  try {
    await chat(args);
  } catch (err) {
    if (err instanceof Error && err.message === "process.exit sentinel") {
      code = (exitSpy.mock.calls.at(-1)?.[0] as number | undefined) ?? 1;
    } else {
      throw err;
    }
  } finally {
    rawStdout = io.stdout();
    rawStderr = io.stderr();
    exitSpy.mockRestore();
    io.restore();
  }
  return { code, stdout: rawStdout.replace(/\n$/, ""), stderr: rawStderr.replace(/\n$/, ""), rawStdout };
}

async function runChat(args: string[]): Promise<string> {
  const { code, stdout, stderr } = await runChatRaw(args);
  if (code !== 0) throw new Error(`chat ${args.join(" ")} exited ${code}: ${stderr}`);
  return stdout;
}

/**
 * `rt chat sign-in --session <id>`, then sets CLAUDE_CODE_SESSION_ID so
 * subsequent calls in the same test resolve position 0 without repeating
 * `--session` — exactly how a real Claude Code session's own Bash calls
 * resolve it (env var, with `--session` as the documented override).
 * afterEach's existing CLAUDE_CODE_SESSION_ID restore cleans this up.
 */
async function signInInProcess(
  opts: { as: string; session: string; room?: string; noRoom?: boolean },
): Promise<{ home: string; handle: string }> {
  const args = ["sign-in", "--as", opts.as, "--session", opts.session];
  if (opts.room) args.push("--room", opts.room);
  if (opts.noRoom) args.push("--no-room");
  const out = await runChat(args);
  const handle = /signed in as (\S+)/.exec(out)?.[1] ?? opts.as;
  process.env.CLAUDE_CODE_SESSION_ID = opts.session;
  return { home, handle };
}

/**
 * Ages `baseHandle`'s presence row past both reclaim thresholds (mirrors
 * lib/daemon/__tests__/chat-handlers.test.ts's own `last_seen_at -
 * 7200000` pattern) and signs a second session in under the same base — the
 * daemon's own "the first reclaimable row, by suffix order" rule then hands
 * the base handle straight back to the new session rather than suffixing.
 */
async function reclaimViaHandlers(baseHandle: string, newSessionId: string): Promise<void> {
  getStateDb().run("UPDATE chat_presence SET last_seen_at = last_seen_at - 7200000 WHERE base_handle = ?", [baseHandle]);
  await runChat(["sign-in", "--as", baseHandle, "--session", newSessionId, "--no-room"]);
}

// ─── Step 1 (brief) ──────────────────────────────────────────────────────────

describe("rt chat CLI", () => {
  test("join prints the member count so a typo is visible", async () => {
    const out = await runChat(["join", "buidl"]);
    expect(out).toContain("1 member");
    expect(out).toContain("you are alone here");
  });

  test("post reports who was woken; a room with only the author says nobody", async () => {
    await runChat(["join", "r"]);
    expect(await runChat(["post", "r", "hello"])).toBe(
      "on the record for 0 members, woke nobody: @handle or @here wakes someone, rt chat dm reaches one\nposted → https://chat.mattstack/r/r#m-1",
    );
  });

  test("an invalid room name is rejected with the reason", async () => {
    const { code, stderr } = await runChatRaw(["join", "Bad/Name"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("lowercase letters, digits, dots, dashes and underscores");
  });

  test("--json emits a parseable object for every verb", async () => {
    await runChat(["join", "r"]);
    // The brief's literal `expect(() => JSON.parse(await runChat(...)))` is a
    // syntax error (`await` in a non-async arrow) — same assertion, fixed.
    const out = await runChat(["rooms", "--json"]);
    expect(() => JSON.parse(out)).not.toThrow();
  });
});

// ─── extra CLI-level coverage (not in the brief, but load-bearing) ──────────

describe("rt chat CLI — additional verb behavior", () => {
  test("join with --as uses the explicit handle instead of deriving one", async () => {
    const out = await runChat(["join", "r", "--as", "scout"]);
    expect(out).toContain("scout");
  });

  test("--as rejects an invalid handle the same way a bad room does", async () => {
    const { code, stderr } = await runChatRaw(["join", "r", "--as", "Bad Handle"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("lowercase letters, digits, dots, dashes and underscores");
  });

  test("post prints the viewer link when chat.viewerUrl is set, and --json carries it", async () => {
    setSetting("chat.viewerUrl", "https://chat.example/", "user");
    await runChat(["join", "r", "--as", "a"]);
    const out = await runChat(["post", "r", "hello", "--as", "a"]);
    expect(out).toMatch(/\nposted → https:\/\/chat\.example\/r\/r#m-\d+$/);
    const json = JSON.parse(await runChat(["post", "r", "again", "--as", "a", "--json"]));
    expect(json).toMatchObject({ ok: true, recipients: expect.any(Array) });
    expect(json.url).toBe(`https://chat.example/r/r#m-${json.id}`);
  });

  test("mark advances the cursor and prints nothing", async () => {
    await runChat(["join", "r", "--as", "a"]);
    expect(await runChat(["mark", "r", "--as", "a"])).toBe("");
  });

  test("mark --upto advances only to that message, leaving later ones unread; a bad --upto is refused", async () => {
    await runChat(["join", "r", "--as", "a"]);
    await runChat(["join", "r", "--as", "b"]);
    await runChat(["post", "r", "one", "--as", "a", "--json"]);
    const two = JSON.parse(await runChat(["post", "r", "two", "--as", "a", "--json"]));
    await runChat(["post", "r", "three", "--as", "a", "--json"]);
    await runChat(["mark", "r", "--upto", String(two.id), "--as", "b"]);
    const read = JSON.parse(await runChat(["read", "r", "--as", "b", "--json"]));
    expect(read.rooms[0].messages.map((m: { body: string }) => m.body)).toEqual(["three"]);

    const bad = await runChatRaw(["mark", "r", "--upto", "0", "--as", "b"]);
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toBe('"0" is not a message id\n  why: A message id is a positive whole number.\n  next: rt chat mark <room> --upto <messageId>');
  });

  test("post's body is every word after the room, joined back with spaces", async () => {
    await runChat(["join", "r", "--as", "a"]);
    await runChat(["join", "r", "--as", "b"]);
    expect(await runChat(["post", "r", "@b", "hello", "world"])).toBe("delivered to b\nposted → https://chat.mattstack/r/r#m-1");
    const read = JSON.parse(await runChat(["read", "r", "--as", "b", "--json"]));
    expect(read.rooms[0].messages[0].body).toBe("@b hello world");
  });

  test("an agent's post that names nobody tells the poster it woke nobody and how to wake someone", async () => {
    await runChat(["join", "r", "--as", "a"]);
    await runChat(["join", "r", "--as", "b"]);
    await runChat(["join", "r", "--as", "c"]);
    expect(await runChat(["post", "r", "status: lane at 60%", "--as", "a"])).toBe(
      "on the record for 2 members, woke nobody: @handle or @here wakes someone, rt chat dm reaches one\nposted → https://chat.mattstack/r/r#m-1",
    );
    await runChat(["join", "solo", "--as", "a"]);
    expect(await runChat(["post", "solo", "alone", "--as", "a"])).toBe(
      "on the record for 0 members, woke nobody: @handle or @here wakes someone, rt chat dm reaches one\nposted → https://chat.mattstack/r/solo#m-2",
    );
  });

  test("the human's post wakes every member without a mention", async () => {
    await runChat(["join", "r", "--as", "a"]);
    await runChat(["join", "r", "--as", "b"]);
    await runChat(["join", "r", "--as", "matt"]);
    expect(await runChat(["post", "r", "one of you: TLDR", "--as", "matt"])).toBe("delivered to a, b\nposted → https://chat.mattstack/r/r#m-1");
  });

  test("post --file reads the body from a file and keeps its line breaks", async () => {
    await runChat(["join", "r", "--as", "a"]);
    const path = join(home, "post.md");
    writeFileSync(path, "the ask first\n\n- one point\n- another\n");
    await runChat(["join", "r", "--as", "b"]);
    await runChat(["post", "r", "--file", path, "--as", "a"]);
    const out = JSON.parse(await runChat(["read", "r", "--as", "b", "--json"])) as {
      rooms: { messages: { body: string }[] }[];
    };
    const bodies = out.rooms.flatMap((r) => r.messages.map((m) => m.body));
    expect(bodies).toContain("the ask first\n\n- one point\n- another");
  });

  test("post --file refuses an empty file", async () => {
    await runChat(["join", "r", "--as", "a"]);
    const path = join(home, "empty.md");
    writeFileSync(path, "\n");
    const { code, stderr } = await runChatRaw(["post", "r", "--file", path, "--as", "a"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("is empty");
    writeFileSync(path, "\r\n");
    expect((await runChatRaw(["post", "r", "--file", path, "--as", "a"])).stderr).toContain("is empty");
  });

  test("post --file normalizes CRLF line endings", async () => {
    await runChat(["join", "r", "--as", "a"]);
    await runChat(["join", "r", "--as", "b"]);
    const path = join(home, "crlf.md");
    writeFileSync(path, "lede\r\n\r\n- one\r\n");
    await runChat(["post", "r", "--file", path, "--as", "a"]);
    const out = JSON.parse(await runChat(["read", "r", "--as", "b", "--json"])) as {
      rooms: { messages: { body: string }[] }[];
    };
    expect(out.rooms.flatMap((r) => r.messages.map((m) => m.body))).toContain("lede\n\n- one");
  });

  test("post with no text reads the body from piped stdin, as a bare heredoc does", async () => {
    await runChat(["join", "r", "--as", "a"]);
    await runChat(["join", "r", "--as", "b"]);
    const cliPath = join(import.meta.dir, "..", "..", "cli.ts");
    const proc = Bun.spawn(["bun", "run", cliPath, "chat", "post", "r", "--as", "a"], {
      env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin", RT_SKIP_SETUP: "1", CI: "true" },
      stdin: Buffer.from("the lede\n\n- one point\n- another\n"),
      stdout: "pipe",
      stderr: "pipe",
    });
    children.push(proc);
    const code = await proc.exited;
    expect(code).toBe(0);
    const out = JSON.parse(await runChat(["read", "r", "--as", "b", "--json"])) as {
      rooms: { messages: { body: string }[] }[];
    };
    expect(out.rooms.flatMap((r) => r.messages.map((m) => m.body))).toContain("the lede\n\n- one point\n- another");
  });

  test("post refuses a long single-line body with the heredoc hint; --as-is overrides", async () => {
    await runChat(["join", "r", "--as", "a"]);
    const wall = "x".repeat(520);
    const { code, stderr } = await runChatRaw(["post", "r", wall, "--as", "a"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("no line breaks");
    expect(stderr).toContain("<<'EOF'");
    expect(await runChat(["post", "r", wall, "--as", "a", "--as-is"])).toBe(
      "on the record for 0 members, woke nobody: @handle or @here wakes someone, rt chat dm reaches one\nposted → https://chat.mattstack/r/r#m-1",
    );
    const long = "y".repeat(300) + "\n" + "z".repeat(300);
    expect(await runChat(["post", "r", long, "--as", "a"])).toBe(
      "on the record for 0 members, woke nobody: @handle or @here wakes someone, rt chat dm reaches one\nposted → https://chat.mattstack/r/r#m-2",
    );
  });

  test("post with --as consumes the flag as the handle, not into the body", async () => {
    // resolveHandle reads --as from anywhere in args; the body must strip it
    // the same way, or the flag is spliced into the posted message text.
    await runChat(["join", "r", "--as", "poster"]);
    await runChat(["join", "r", "--as", "listener"]);
    expect(await runChat(["post", "r", "@listener", "ping", "--as", "poster"])).toBe("delivered to listener\nposted → https://chat.mattstack/r/r#m-1");
    const read = JSON.parse(await runChat(["read", "r", "--as", "listener", "--json"]));
    expect(read.rooms[0].messages[0].body).toBe("@listener ping");
    expect(read.rooms[0].messages[0].handle).toBe("poster");
  });

  test("who lists members of the given room", async () => {
    await runChat(["join", "r", "--as", "a"]);
    await runChat(["join", "r", "--as", "b"]);
    const out = await runChat(["who", "r"]);
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  test("a who the daemon turns down with no reason names the verb, not the room", async () => {
    canned["chat:who"] = { ok: false };
    const { code, stderr } = await runChatRaw(["who", "r"]);
    expect(code).not.toBe(0);
    expect(stderr).toBe("The chat who did not go through");
  });

  async function postedId(): Promise<number> {
    for (const h of ["asker", "b", "c"]) await runChat(["join", "r", "--as", h]);
    await runChat(["post", "r", "one", "of", "you:", "TLDR", "--as", "asker"]);
    const read = JSON.parse(await runChat(["read", "r", "--as", "b", "--json"]));
    return read.rooms[0].messages[0].id as number;
  }

  test("claim: the winner is told so, every later claimant is told who holds it, and both exit 0", async () => {
    const id = await postedId();
    expect(await runChat(["claim", String(id), "--as", "b"])).toBe(`claimed #${id} → asker`);
    const lost = await runChatRaw(["claim", String(id), "--as", "c"]);
    expect(lost.code).toBe(0);
    expect(lost.stdout).toMatch(new RegExp(`^#${id} already claimed by b \\d+s ago \\(claimable again in [0-9ms ]+\\)$`));
    expect(await runChat(["claim", String(id), "--as", "b"])).toBe(`you already hold #${id}`);
  });

  test("claim --json carries the outcome discriminator for every branch", async () => {
    const id = await postedId();
    expect(JSON.parse(await runChat(["claim", String(id), "--as", "b", "--json"]))).toEqual({ ok: true, id, outcome: "claimed", author: "asker", authorName: "asker", room: "r" });
    const lost = JSON.parse(await runChat(["claim", String(id), "--as", "c", "--json"]));
    expect(lost).toMatchObject({ ok: true, id, outcome: "lost", holder: "b" });
    expect(typeof lost.expiresAt).toBe("number");
  });

  test("release: the holder or the author frees the id; anyone else exits 1 with the reason", async () => {
    const id = await postedId();
    await runChat(["claim", String(id), "--as", "b"]);
    const refused = await runChatRaw(["release", String(id), "--as", "c"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("[refused] rt chat will not release a claim you do not hold");
    expect(await runChat(["release", String(id), "--as", "b"])).toBe(`released #${id} (was held by b)`);
    await runChat(["claim", String(id), "--as", "c"]);
    expect(await runChat(["release", String(id), "--as", "asker"])).toBe(`released #${id} (was held by c)`);
  });

  test("post, ack and release --json pair each identity with its display name", async () => {
    const id = await postedId();
    const posted = JSON.parse(await runChat(["post", "r", "hi @b", "--as", "asker", "--json"]));
    expect(posted.recipientNames).toEqual(posted.recipients);
    expect(JSON.parse(await runChat(["ack", String(id), "--as", "b", "--json"]))).toMatchObject({ author: "asker", authorName: "asker" });
    await runChat(["claim", String(id), "--as", "b"]);
    expect(JSON.parse(await runChat(["release", String(id), "--as", "b", "--json"]))).toMatchObject({ holder: "b", holderName: "b" });
  });

  test("claim and release refuse a non-id the same way ack does", async () => {
    const { code, stderr } = await runChatRaw(["claim", "m-412", "--as", "b"]);
    expect(code).toBe(1);
    expect(stderr).toContain("not a message id");
    expect((await runChatRaw(["release", "--as", "b"])).stderr).toContain("next: rt chat release <messageId>");
  });

  test("leave drops membership so rooms no longer lists it", async () => {
    await runChat(["join", "r", "--as", "solo"]);
    await runChat(["leave", "r", "--as", "solo"]);
    const rooms = JSON.parse(await runChat(["rooms", "--json", "--as", "solo"]));
    expect(rooms.rooms).toEqual([]);
  });

  test("archive hides the room from rooms until reopened; --json reports the stamp", async () => {
    await runChat(["join", "r", "--as", "a"]);
    const out = JSON.parse(await runChat(["archive", "r", "--json", "--as", "a"]));
    expect(out.ok).toBe(true);
    expect(out.room).toBe("r");
    expect(typeof out.archivedAt).toBe("number");
    expect(JSON.parse(await runChat(["rooms", "--json", "--as", "a"])).rooms).toEqual([]);

    const plain = await runChat(["archive", "r", "--reopen", "--as", "a"]);
    expect(plain).toContain("reopened #r");
    expect(JSON.parse(await runChat(["rooms", "--json", "--as", "a"])).rooms.map((x: { room: string }) => x.room)).toEqual(["r"]);
  });

  test("archive refuses a room that does not exist with exit 1", async () => {
    const { code, stderr } = await runChatRaw(["archive", "ghost", "--as", "a"]);
    expect(code).toBe(1);
    expect(stderr).toContain("no such room");
  });
});

// ─── sign-in / sign-out (presence) ──────────────────────────────────────────
//
// The flag-splice guard is exercised through `post`, not `dm`: post already
// has a body-splice test above (for `--as`); this one covers `--session`, the
// presence flag post itself reads. `--status` belongs to away/sign-in, so post
// now refuses it by name rather than quietly dropping its value into the body.

describe("rt chat CLI — sign-in / sign-out (presence)", () => {
  test("flag values never splice into a body: --session is FLAGS_WITH_VALUES", async () => {
    await runChat(["join", "r", "--as", "x"]);
    await runChat(["join", "r", "--as", "y"]);
    await runChat(["post", "r", "hello there", "--session", "s1", "--as", "x"]);
    const read = JSON.parse(await runChat(["read", "r", "--as", "y", "--json"]));
    expect(read.rooms[0].messages[0].body).toBe("hello there");
    const { code, stderr } = await runChatRaw(["post", "r", "hello there", "--status", "busy", "--as", "x"]);
    expect(code).toBe(1);
    expect(stderr).toContain("--status");
  });

  test("position 0: a signed-in session resolves the assigned handle for every verb", async () => {
    await signInInProcess({ as: "x", session: "s1" });
    await runChat(["join", "r"]); // no --as, no --session: resolves from the session file
    await runChat(["post", "r", "hello"]); // same — the session file, not the cwd-derived handle
    expect(await runChat(["who", "r"])).toContain("x");
  });

  test("--as while signed in is refused with the reason", async () => {
    await signInInProcess({ as: "x", session: "s1" });
    const { code, stderr } = await runChatRaw(["post", "r", "hi", "--as", "y", "--session", "s1"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("You are signed in as x");
    expect(stderr).toContain("rt chat sign-out");
  });

  test("deriveRoomForCwd: remote-kind, path-kind, not-a-worktree", () => {
    expect(__test__.roomForIdentity({ kind: "remote", id: "gitlab.example.com/acme/Acme-Dev" })).toBe("acme-dev");
    expect(__test__.roomForIdentity({ kind: "path", id: "/Users/m/pool/gamma" })).toBe("pool-gamma");

    // findGitRoot gate: a real (non-symlinked) tmpdir outside any git work tree.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-chat-noroom-")));
    try {
      expect(__test__.deriveRoomForCwd(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sign-in prints the identity line; --no-room and --room work", async () => {
    const out = await runChat(["sign-in", "--as", "x", "--room", "warroom", "--session", "s1"]);
    expect(out).toMatch(/signed in as x/);
    expect(out).toMatch(/#warroom/);
  });

  test("sign-in without --as draws a pool name and keeps the same identity on a repeat sign-in", async () => {
    const first = await runChat(["sign-in", "--no-room", "--session", "s7"]);
    const name = /signed in as (\S+)/.exec(first)?.[1] ?? "";
    expect(AGENT_NAMES).toContain(name);
    const id = JSON.parse(readFileSync(sessionFilePath("s7"), "utf8")).handle;
    const again = await runChat(["sign-in", "--no-room", "--session", "s7"]);
    expect(again).toMatch(new RegExp(`signed in as ${name}\\b`));
    expect(JSON.parse(readFileSync(sessionFilePath("s7"), "utf8")).handle).toBe(id);
  });

  test("integrations on: sign-in binds this Claude session to the identity it signed in as, and a repeat sign-in resolves that binding", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CODE_SESSION_ID = "s-bind-1";
    try {
      expect(await runChat(["sign-in", "--no-room"])).toMatch(/signed in as /);
      const handle = JSON.parse(readFileSync(sessionFilePath("s-bind-1"), "utf8")).handle;
      const bindings = listBindingsByNativeValue(getStateDb(), "s-bind-1");
      expect(bindings.map((b) => ({ identity: b.identity, native: b.native }))).toEqual([
        { identity: handle, native: { harness: "claude", profile: "default", kind: "id", value: "s-bind-1" } },
      ]);
      expect(await runChat(["sign-in", "--no-room"])).toMatch(/signed in as /);
      expect(listBindingsByNativeValue(getStateDb(), "s-bind-1")).toHaveLength(1);
    } finally {
      if (savedConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
    }
  });

  test("integrations on: a binding that fails after the daemon signed in signs the session back out, leaving no session file", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CODE_SESSION_ID = "s-conflict";
    try {
      // Live in Claude Code's registry (this test process stands in for it),
      // and bound to another identity that a /clear detached: the re-attach
      // is prepared before the daemon is asked, and refused once the daemon
      // names a different identity.
      const registry = join(home, ".claude", "sessions");
      mkdirSync(registry, { recursive: true });
      writeFileSync(join(registry, `${process.pid}.json`), JSON.stringify({ sessionId: "s-conflict", pid: process.pid, messagingSocketPath: join(home, "inbox.sock") }));
      const store = createSessionStore(getStateDb());
      const held = store.bind(store.reserve({ identity: "otto.0001" }), { harness: "claude", profile: "default", kind: "id", value: "s-conflict" }, { mode: "herdr", pid: process.pid });
      if (!held.ok) throw new Error(held.error.message);
      if (!store.detach(held.data.key, 1).ok) throw new Error("detach failed");

      const refused = await runChatRaw(["sign-in", "--no-room"]).catch((err: unknown) => err);
      expect(refused).toBeInstanceOf(UserActionableError);
      expect((refused as UserActionableError).why).toContain("already belongs to another identity");
      expect(seen.map((s) => s.cmd)).toEqual(["chat:sign-in", "chat:sign-out"]);
      expect(presenceForSession("s-conflict", getStateDb())?.signedOutAt).toBeDefined();
      expect(existsSync(sessionFilePath("s-conflict"))).toBe(false);
      expect(store.get(held.data.key)!.identity).toBe("otto.0001");
    } finally {
      if (savedConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
    }
  });

  test("integrations on: an explicit --session that no live Claude session answers to signs in unbound, as before bindings", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    expect(await runChat(["sign-in", "--no-room", "--session", "s-nowhere"])).toMatch(/signed in as /);
    expect(existsSync(sessionFilePath("s-nowhere"))).toBe(true);
    expect(listBindingsByNativeValue(getStateDb(), "s-nowhere")).toEqual([]);
    expect(presenceForSession("s-nowhere", getStateDb())?.signedOutAt).toBeUndefined();
  });

  test("resolveSignInRequest: --as continues, --name and chat.handle ask for a fresh identity with that name, neither draws", () => {
    expect(__test__.resolveSignInRequest(["--as", "kai"])).toEqual({ continue: "kai" });
    expect(__test__.resolveSignInRequest(["--name", "bob"])).toEqual({ baseHandle: "bob" });
    expect(__test__.resolveSignInRequest([])).toEqual({});
    setSetting("chat.handle", "picked", "user");
    expect(__test__.resolveSignInRequest([])).toEqual({ baseHandle: "picked" });
    expect(__test__.resolveSignInRequest(["--as", "kai"])).toEqual({ continue: "kai" });
  });

  test("sign-in never draws a name another live session holds", async () => {
    await runChat(["sign-in", "--as", "fred", "--no-room", "--session", "s8"]);
    for (let i = 0; i < 5; i++) {
      const out = await runChat(["sign-in", "--no-room", "--session", `s9-${i}`]);
      const handle = /signed in as (\S+)/.exec(out)?.[1] ?? "";
      expect(handle).not.toBe("fred");
      expect(handle).not.toMatch(/^fred-\d+$/);
    }
  });

  test("sign-in --json reports the handle and room, with no rename-related fields", async () => {
    const out = await runChat(["sign-in", "--no-room", "--session", "s10", "--json"]);
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({ ok: true, room: null });
    expect(parsed).not.toHaveProperty("renamed");
    expect(parsed).not.toHaveProperty("title");
  });

  test("the session-rename module is gone: sign-in never spawns a rename subprocess", () => {
    expect(existsSync(join(import.meta.dir, "..", "..", "lib", "chat-rename.ts"))).toBe(false);
  });

  test("sign-in --pane works with no CLAUDE_CODE_SESSION_ID or --session, skipping git derivation", async () => {
    canned["chat:sign-in"] = { ok: true, data: { handle: "kai", baseHandle: "kai", reclaimed: false, sessionId: "pane-sess-1", room: null } };
    const out = await runChat(["sign-in", "--pane", "w1:p1"]);
    expect(out).toMatch(/signed in as kai/);
    const call = seen.find((s) => s.cmd === "chat:sign-in");
    expect(call?.payload).toMatchObject({ pane: "w1:p1", viaPane: true });
    const payload = call?.payload as Record<string, unknown>;
    expect(payload.sessionId).toBeUndefined();
    expect(payload.cwd).toBeUndefined();
    expect(payload.repo).toBeUndefined();
    expect(payload.branch).toBeUndefined();
  });

  test("sign-in --pane --json reports the handle and room from the response, and writes the session file under the daemon-resolved sessionId", async () => {
    canned["chat:sign-in"] = { ok: true, data: { handle: "kai", baseHandle: "kai", reclaimed: false, sessionId: "pane-sess-2", room: "build" } };
    const out = await runChat(["sign-in", "--pane", "w1:p1", "--json"]);
    expect(JSON.parse(out)).toEqual({ ok: true, handle: "kai", name: "kai", room: "build", continued: false });
    expect(existsSync(sessionFilePath("pane-sess-2"))).toBe(true);
    expect(JSON.parse(readFileSync(sessionFilePath("pane-sess-2"), "utf8"))).toMatchObject({
      sessionId: "pane-sess-2",
      handle: "kai",
      baseHandle: "kai",
      name: "kai",
      room: "build",
    });
  });

  test("sign-in --pane resolves the pane's Claude session via herdr, and that session's own later commands then resolve the daemon-assigned handle (finding g)", async () => {
    const uuid = "55555555-5555-5555-5555-555555555555";
    const { sock: herdrSock, stop } = fakeHerdr((method) => {
      if (method !== "session.snapshot") return new HerdrFakeError("invalid_request", method);
      return {
        snapshot: {
          workspaces: [],
          panes: [
            {
              pane_id: "w1:p1",
              workspace_id: "w1",
              tab_id: "w1:t1",
              agent: "claude",
              agent_status: "idle",
              agent_session: { source: "claude", agent: "claude", kind: "id", value: uuid },
            },
          ],
        },
      };
    });
    const origSock = process.env.HERDR_SOCKET_PATH;
    process.env.HERDR_SOCKET_PATH = herdrSock;
    try {
      const out = await runChat(["sign-in", "--pane", "w1:p1"]);
      const handle = /signed in as (\S+)/.exec(out)?.[1] ?? "";
      expect(handle).not.toBe("");
      expect(existsSync(sessionFilePath(uuid))).toBe(true);

      // The pane's OWN later commands (its CLAUDE_CODE_SESSION_ID is the
      // uuid the daemon resolved) must resolve position 0 to that handle,
      // not fall through resolveBaseHandle's cwd/pane fallbacks.
      process.env.CLAUDE_CODE_SESSION_ID = uuid;
      await runChat(["join", "r"]);
      expect(await runChat(["who", "r"])).toContain(handle);
    } finally {
      stop();
      if (origSock === undefined) delete process.env.HERDR_SOCKET_PATH;
      else process.env.HERDR_SOCKET_PATH = origSock;
    }
  });

  test("sign-in --pane never draws baseHandle from chat.handle: with the setting pinned, the daemon still draws from the pool", async () => {
    const uuid = "66666666-6666-6666-6666-666666666666";
    const { sock: herdrSock, stop } = fakeHerdr((method) => {
      if (method !== "session.snapshot") return new HerdrFakeError("invalid_request", method);
      return {
        snapshot: {
          workspaces: [],
          panes: [
            {
              pane_id: "w1:p1",
              workspace_id: "w1",
              tab_id: "w1:t1",
              agent: "claude",
              agent_status: "idle",
              agent_session: { source: "claude", agent: "claude", kind: "id", value: uuid },
            },
          ],
        },
      };
    });
    const origSock = process.env.HERDR_SOCKET_PATH;
    process.env.HERDR_SOCKET_PATH = herdrSock;
    setSetting("chat.handle", "invoker-name", "user");
    try {
      const out = await runChat(["sign-in", "--pane", "w1:p1"]);
      const handle = /signed in as (\S+)/.exec(out)?.[1] ?? "";
      expect(handle).not.toBe("invoker-name");
      expect(AGENT_NAMES).toContain(handle);
      const call = seen.find((s) => s.cmd === "chat:sign-in");
      expect((call?.payload as Record<string, unknown>).baseHandle).toBeUndefined();
    } finally {
      stop();
      setSetting("chat.handle", "", "user");
      if (origSock === undefined) delete process.env.HERDR_SOCKET_PATH;
      else process.env.HERDR_SOCKET_PATH = origSock;
    }
  });

  test("sign-in --pane --no-room forwards noRoom rather than silently ignoring it", async () => {
    canned["chat:sign-in"] = { ok: true, data: { handle: "kai", baseHandle: "kai", reclaimed: false, sessionId: "pane-sess-4", room: null } };
    const out = await runChat(["sign-in", "--pane", "w1:p1", "--no-room"]);
    expect(out).toMatch(/no room joined/);
    const call = seen.find((s) => s.cmd === "chat:sign-in");
    expect((call?.payload as Record<string, unknown>).noRoom).toBe(true);
    expect((call?.payload as Record<string, unknown>).room).toBeUndefined();
  });

  test("sign-in --pane --room forwards the explicit room rather than silently ignoring it", async () => {
    canned["chat:sign-in"] = { ok: true, data: { handle: "kai", baseHandle: "kai", reclaimed: false, sessionId: "pane-sess-5", room: "warroom" } };
    const out = await runChat(["sign-in", "--pane", "w1:p1", "--room", "warroom"]);
    expect(out).toMatch(/joined #warroom/);
    const call = seen.find((s) => s.cmd === "chat:sign-in");
    expect((call?.payload as Record<string, unknown>).room).toBe("warroom");
    expect((call?.payload as Record<string, unknown>).noRoom).toBe(false);
  });

  test("sign-in --pane --room rejects an invalid room name locally, before contacting the daemon", async () => {
    const { code, stderr } = await runChatRaw(["sign-in", "--pane", "w1:p1", "--room", "Bad Room"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("lowercase letters, digits, dots, dashes and underscores");
    expect(seen.find((s) => s.cmd === "chat:sign-in")).toBeUndefined();
  });

  test("sign-in refuses --as with --name, before contacting the daemon", async () => {
    const { code, stderr } = await runChatRaw(["sign-in", "--as", "x", "--name", "y", "--no-room", "--session", "s1"]);
    expect(code).not.toBe(0);
    expect(stderr).toBe(
      "Continue an identity or start a new one, not both\n  why: You asked to pick up an identity you had and to start a fresh one under a new name.\n  next: rt chat sign-in --as <name> to continue, or rt chat sign-in --name <name> to start fresh",
    );
    expect(seen.find((s) => s.cmd === "chat:sign-in")).toBeUndefined();
  });

  test("sign-in --pane refuses --name, before contacting the daemon", async () => {
    const { code, stderr } = await runChatRaw(["sign-in", "--pane", "w1:p1", "--name", "y"]);
    expect(code).not.toBe(0);
    expect(stderr).toBe(
      "A pane sign-in continues an identity\n  why: Signing a pane in can pick up an identity it had, but cannot start a fresh one under a new name.\n  next: rt chat sign-in --pane <pane> --as <name>",
    );
    expect(seen.find((s) => s.cmd === "chat:sign-in")).toBeUndefined();
  });

  for (const argv of [
    ["sign-in", "--name", "", "--no-room", "--session", "s1"],
    ["sign-in", "--as", "", "--no-room", "--session", "s1"],
    ["sign-in", "--no-room", "--session", "s1", "--name"],
    ["sign-in", "--pane", "w1:p1", "--as", ""],
  ]) {
    test(`sign-in refuses an empty or missing identity flag value (${argv.join(" ")}), before contacting the daemon`, async () => {
      const { code, stderr } = await runChatRaw(argv);
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/--as|--name/);
      expect(seen.find((s) => s.cmd === "chat:sign-in")).toBeUndefined();
    });
  }

  test("--no-room signs in without joining any room", async () => {
    const out = await runChat(["sign-in", "--as", "y", "--no-room", "--session", "s2"]);
    expect(out).toMatch(/signed in as y/);
    expect(out).not.toContain("joined #");
  });

  test("sign-out deletes the session file and disarms", async () => {
    await signInInProcess({ as: "x", session: "s1", noRoom: true });
    const sessionPath = join(home, ".mattstack", "rt", "chat", "sessions", "s1.json");
    expect(existsSync(sessionPath)).toBe(true);

    await runChat(["sign-out", "--session", "s1"]);
    expect(existsSync(sessionPath)).toBe(false);

    const row = getStateDb()
      .query("SELECT signed_out_at FROM chat_presence WHERE session_id = ?")
      .get("s1") as { signed_out_at: number | null } | null;
    expect(row?.signed_out_at).not.toBeNull();
  });

  test("sign-out with the daemon unreachable still cleans up locally and exits 0", async () => {
    await signInInProcess({ as: "x", session: "s1", noRoom: true });
    const sessionPath = join(home, ".mattstack", "rt", "chat", "sessions", "s1.json");
    expect(existsSync(sessionPath)).toBe(true);

    server?.stop(true);
    server = null;

    const { code, stderr } = await runChatRaw(["sign-out", "--session", "s1"]);
    expect(code).toBe(0);
    expect(existsSync(sessionPath)).toBe(false);
    expect(stderr.startsWith("[warning] Signed out here, but the daemon did not hear it")).toBe(true);
  });

  test("sign-out --quiet prints nothing even when the daemon is unreachable", async () => {
    await signInInProcess({ as: "x", session: "s1", noRoom: true });

    server?.stop(true);
    server = null;

    const { code, stdout, stderr } = await runChatRaw(["sign-out", "--session", "s1", "--quiet"]);
    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  test("sign-out with no known session id is a refused no-op, not a crash", async () => {
    const { code, stderr } = await runChatRaw(["sign-out"]);
    expect(code).not.toBe(0);
    expect(stderr).toBe(
      "rt cannot tell which session this is\n  why: Chat needs a session id. Claude Code sets one for you; anywhere else, name the session yourself.\n  next: rt chat sign-out --session <id>",
    );
  });

  test("sign-in without a session id (no --session, no CLAUDE_CODE_SESSION_ID) refuses rather than inventing one", async () => {
    const { code, stderr } = await runChatRaw(["sign-in", "--as", "x", "--no-room"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("session id");
    expect(stderr).toContain("\n  next: rt chat sign-in --session <id>");
  });

  test("--as naming an id live in another session is refused with the sign-in command, and writes no session file", async () => {
    await runChat(["sign-in", "--name", "remy", "--session", "s1", "--no-room"]);
    const s1Handle = JSON.parse(readFileSync(join(home, ".mattstack", "rt", "chat", "sessions", "s1.json"), "utf8")).handle;

    const { code, stderr } = await runChatRaw(["sign-in", "--as", s1Handle, "--session", "s2", "--no-room"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("[refused] This session cannot use that identity");
    expect(existsSync(join(home, ".mattstack", "rt", "chat", "sessions", "s2.json"))).toBe(false);
  });

  test("--as naming the human's handle is refused", async () => {
    setSetting("chat.humanHandle", "matt", "user");
    const { code, stderr } = await runChatRaw(["sign-in", "--as", "matt", "--session", "s1", "--no-room"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("[refused] rt chat keeps that identity for the human or the herd");
  });

  test("sign-out --json reports a daemonError field rather than a bare {ok:true} when the daemon leg failed", async () => {
    await signInInProcess({ as: "x", session: "s1", noRoom: true });
    server?.stop(true);
    server = null;

    const out = await runChat(["sign-out", "--session", "s1", "--json"]);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(typeof parsed.daemonError).toBe("string");
  });

  test("sign-out --quiet with an invalid session id exits 0 silently, matching the missing-id case", async () => {
    const { code, stdout, stderr } = await runChatRaw(["sign-out", "--session", "bad/id", "--quiet"]);
    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  test("sign-out --pane with an inherited foreign CLAUDE_CODE_SESSION_ID signs out the pane's session, not the env one", async () => {
    const uuid = "77777777-7777-7777-7777-777777777777";
    const { sock: herdrSock, stop } = fakeHerdr((method) => {
      if (method !== "session.snapshot") return new HerdrFakeError("invalid_request", method);
      return {
        snapshot: {
          workspaces: [],
          panes: [
            {
              pane_id: "w1:p1",
              workspace_id: "w1",
              tab_id: "w1:t1",
              agent: "claude",
              agent_status: "idle",
              agent_session: { source: "claude", agent: "claude", kind: "id", value: uuid },
            },
          ],
        },
      };
    });
    const origSock = process.env.HERDR_SOCKET_PATH;
    process.env.HERDR_SOCKET_PATH = herdrSock;
    try {
      // The target pane's own session, signed in for real so it has a
      // session file and a live presence row to tear down.
      await signInInProcess({ as: "pane-agent", session: uuid, noRoom: true });
      const paneSessionPath = join(home, ".mattstack", "rt", "chat", "sessions", `${uuid}.json`);
      expect(existsSync(paneSessionPath)).toBe(true);

      // This process inherits a DIFFERENT session id -- the exact hazard
      // --pane sign-out must ignore rather than sign out.
      await signInInProcess({ as: "foreign", session: "foreign-sess", noRoom: true });
      const foreignSessionPath = join(home, ".mattstack", "rt", "chat", "sessions", "foreign-sess.json");
      expect(existsSync(foreignSessionPath)).toBe(true);
      expect(process.env.CLAUDE_CODE_SESSION_ID).toBe("foreign-sess");

      await runChat(["sign-out", "--pane", "w1:p1"]);

      expect(existsSync(paneSessionPath)).toBe(false);
      expect(existsSync(foreignSessionPath)).toBe(true);

      const paneRow = getStateDb()
        .query("SELECT signed_out_at FROM chat_presence WHERE session_id = ?")
        .get(uuid) as { signed_out_at: number | null } | null;
      expect(paneRow?.signed_out_at).not.toBeNull();

      const foreignRow = getStateDb()
        .query("SELECT signed_out_at FROM chat_presence WHERE session_id = ?")
        .get("foreign-sess") as { signed_out_at: number | null } | null;
      expect(foreignRow?.signed_out_at).toBeNull();
    } finally {
      stop();
      if (origSock === undefined) delete process.env.HERDR_SOCKET_PATH;
      else process.env.HERDR_SOCKET_PATH = origSock;
    }
  });

  test("sign-out --pane against an old daemon (no sessionId in the reply) fails loudly rather than reporting a false success", async () => {
    canned["chat:sign-out"] = { ok: true, data: {} };
    const { code, stdout, stderr } = await runChatRaw(["sign-out", "--pane", "w1:p1"]);
    expect(code).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("The rt daemon is too old to sign a pane out");
  });

  test("a new session in the same herdr pane signs in as a new identity", async () => {
    process.env.HERDR_PANE_ID = "wAR:p3";
    await runChat(["sign-in", "--no-room", "--session", "sp1"]);
    const first = JSON.parse(readFileSync(sessionFilePath("sp1"), "utf8"));
    await runChat(["sign-out", "--session", "sp1"]);
    await runChat(["sign-in", "--no-room", "--session", "sp2"]);
    const second = JSON.parse(readFileSync(sessionFilePath("sp2"), "utf8"));
    expect(second.handle).not.toBe(first.handle);
  });

  test("sign-in --as sends continue, never baseHandle, and the session file carries the name", async () => {
    const out = JSON.parse(await runChat(["sign-in", "--as", "remy", "--no-room", "--session", "s11", "--json"]));
    expect(out).toMatchObject({ ok: true, name: "remy", room: null, continued: false });
    const sent = seen.find((s) => s.cmd === "chat:sign-in")!.payload as Record<string, unknown>;
    expect(sent.continue).toBe("remy");
    expect(sent.baseHandle).toBeUndefined();
    expect(JSON.parse(readFileSync(sessionFilePath("s11"), "utf8"))).toMatchObject({ handle: out.handle, name: "remy" });
  });

  test("sign-in --name sends baseHandle, never continue", async () => {
    const out = JSON.parse(await runChat(["sign-in", "--name", "bob", "--no-room", "--session", "s13", "--json"]));
    expect(out).toMatchObject({ ok: true, name: "bob", continued: false });
    const sent = seen.find((s) => s.cmd === "chat:sign-in")!.payload as Record<string, unknown>;
    expect(sent.baseHandle).toBe("bob");
    expect(sent.continue).toBeUndefined();
  });

  test("every line the CLI prints about a minted identity shows its name, never its id", async () => {
    const out = await runChat(["sign-in", "--no-room", "--session", "s12"]);
    const session = JSON.parse(readFileSync(sessionFilePath("s12"), "utf8"));
    expect(session.handle).not.toBe(session.name);
    expect(out).toContain(`signed in as ${session.name}`);
    process.env.CLAUDE_CODE_SESSION_ID = "s12";
    const joined = await runChat(["join", "r"]);
    expect(joined).toContain(`as ${session.name}`);
    await runChat(["post", "r", "hello there"]);
    const who = await runChat(["who", "r"]);
    const read = await runChat(["read", "r", "--last", "1"]);
    const buddies = await runChat(["buddies"]);
    const left = await runChat(["leave", "r"]);
    expect(who).toContain(session.name);
    expect(read).toContain(`${session.name}: hello there`);
    for (const text of [out, joined, who, read, buddies, left]) expect(text).not.toContain(session.handle);
  });
});

// ─── buddies, away/back, dm, pulse ──────────────────────────────────────────

describe("rt chat CLI — buddies, away, back, dm", () => {
  test("buddies renders sections listening → idle → offline and names the away text", async () => {
    await signInInProcess({ as: "live1", session: "slv", noRoom: true });
    await signInInProcess({ as: "idle1", session: "sid", noRoom: true });
    await signInInProcess({ as: "off1", session: "soff", noRoom: true });

    const now = Date.now();
    const db = getStateDb();
    db.run("UPDATE chat_presence SET status_text = ? WHERE session_id = ?", ["rebasing #67", "sid"]);
    db.run("UPDATE chat_presence SET signed_out_at = ? WHERE session_id = ?", [now, "soff"]);

    // live1's session (sessionId "slv") resolves alive+busy; idle1's
    // (sessionId "sid") resolves alive but not busy. off1 gets no binding
    // at all, but its row is already signed out, which alone reads offline.
    const busyBinding: InboxBinding = { pid: process.pid, socketPath: "/fake.sock", status: "busy" };
    const idleBinding: InboxBinding = { pid: process.pid, socketPath: "/fake.sock", status: "idle" };
    const bindings = new Map<string, InboxBinding>([["slv", busyBinding], ["sid", idleBinding]]);
    registryDeps = { resolve: (sessionId) => bindings.get(sessionId) ?? null, alive: () => true, resolveAll: () => bindings };

    const out = await runChat(["buddies"]);

    const liveIdx = out.indexOf("live1");
    const idleIdx = out.indexOf("idle1");
    const offIdx = out.indexOf("off1");
    expect(liveIdx).toBeGreaterThanOrEqual(0);
    expect(idleIdx).toBeGreaterThan(liveIdx);
    expect(offIdx).toBeGreaterThan(idleIdx);

    expect(out).toMatch(/listening/); // live1
    expect(out).toMatch(/idle/); // idle1
    expect(out).toContain("rebasing #67"); // the away text
    // offline is collapsed to one line, however many offline buddies exist.
    expect(out.split("\n").filter((l) => l.includes("off1")).length).toBe(1);
  });

  test("bare who aliases buddies", async () => {
    await signInInProcess({ as: "x", session: "s1", noRoom: true });
    const out = await runChat(["who"]);
    expect(out).toContain("x");
    // No fake registryDeps: the default resolver finds nothing for this
    // test session id, which reads offline (unresolvable), not idle.
    expect(out).toMatch(/offline/);
  });

  test("away sets the status text (visible on buddies) and back clears it", async () => {
    await signInInProcess({ as: "x", session: "s1", noRoom: true });

    await runChat(["away", "brb", "lunch", "--session", "s1"]);
    const withAway = JSON.parse(await runChat(["buddies", "--json"]));
    expect(withAway.buddies[0]).toMatchObject({ statusText: "brb lunch" });

    await runChat(["back", "--session", "s1"]);
    const withoutAway = JSON.parse(await runChat(["buddies", "--json"]));
    expect(withoutAway.buddies[0].statusText).toBeUndefined();
  });

  test("away/back refuse without a session id rather than acting on a guessed handle", async () => {
    const away = await runChatRaw(["away", "brb"]);
    expect(away.code).not.toBe(0);
    expect(away.stderr).toContain("session id");
    expect(away.stderr).toContain("\n  next: rt chat away <text> --session <id>");

    const back = await runChatRaw(["back"]);
    expect(back.code).not.toBe(0);
    expect(back.stderr).toContain("session id");
    expect(back.stderr).toContain("\n  next: rt chat back --session <id>");
  });

  test("dm posts and the desk notifies when the recipient is the human", async () => {
    drainNotifications();
    await signInInProcess({ as: "agent", session: "s1", noRoom: true });
    await runChat(["dm", "matt", "you", "there?", "--session", "s1"]);
    expect(peekNotifications()).toHaveLength(1);
  });

  test("dm with no text reads the body from piped stdin, as a bare heredoc does (RT-185)", async () => {
    await signInInProcess({ as: "a", session: "s1", noRoom: true });
    await signInInProcess({ as: "b", session: "s2", noRoom: true });
    const cliPath = join(import.meta.dir, "..", "..", "cli.ts");
    const proc = Bun.spawn(["bun", "run", cliPath, "chat", "dm", "b", "--session", "s1"], {
      env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin", RT_SKIP_SETUP: "1", CI: "true" },
      stdin: Buffer.from("the lede\n\n- one point\n- another\n"),
      stdout: "pipe",
      stderr: "pipe",
    });
    children.push(proc);
    const code = await proc.exited;
    expect(code).toBe(0);
    const out = JSON.parse(await runChat(["read", "--session", "s2", "--json"])) as {
      rooms: { messages: { body: string }[] }[];
    };
    expect(out.rooms.flatMap((r) => r.messages.map((m) => m.body))).toContain("the lede\n\n- one point\n- another");
  });

  test("dm refuses an unknown flag by name instead of posting it as the body (RT-185)", async () => {
    await signInInProcess({ as: "a", session: "s1", noRoom: true });
    await signInInProcess({ as: "b", session: "s2", noRoom: true });
    const { code, stderr } = await runChatRaw(["dm", "b", "--herd", "gate-cleanup-1", "--session", "s1"]);
    expect(code).toBe(1);
    expect(stderr).toContain("--herd");
    const out = JSON.parse(await runChat(["read", "--session", "s2", "--json"])) as {
      rooms: { messages: { body: string }[] }[];
    };
    expect(out.rooms.flatMap((r) => r.messages.map((m) => m.body))).not.toContain("gate-cleanup-1");
  });

  test("post refuses an unknown flag by name too", async () => {
    await runChat(["join", "r", "--as", "a"]);
    const { code, stderr } = await runChatRaw(["post", "r", "hello", "--herd", "gate-cleanup-1", "--as", "a"]);
    expect(code).toBe(1);
    expect(stderr).toContain("--herd");
  });

  test("dm prints `dm → <handle> #<id>` plus the default viewer link on success (plain), and --json reports the room/recipients", async () => {
    await signInInProcess({ as: "a", session: "s1", noRoom: true });
    await signInInProcess({ as: "b", session: "s2", noRoom: true });

    const plain = await runChat(["dm", "b", "hi", "--session", "s1"]);
    const plainRooms = JSON.parse(await runChat(["rooms", "--json", "--session", "s1"]));
    const dmRoomName = plainRooms.rooms.find((r: { kind?: string }) => r.kind === "dm").room;
    expect(plain).toBe(`dm → b #1\nposted → https://chat.mattstack/r/${dmRoomName}#m-1`);

    const out = await runChat(["dm", "b", "again", "--json", "--session", "s1"]);
    const parsed = JSON.parse(out);
    const bId = JSON.parse(readFileSync(sessionFilePath("s2"), "utf8")).handle;
    expect(parsed).toMatchObject({ ok: true, room: dmRoomName, recipients: [bId], recipientNames: ["b"] });
  });

  test("dm's viewer link follows chat.viewerUrl, same as post", async () => {
    setSetting("chat.viewerUrl", "https://chat.example/", "user");
    await signInInProcess({ as: "a", session: "s1", noRoom: true });
    await signInInProcess({ as: "b", session: "s2", noRoom: true });

    const out = await runChat(["dm", "b", "hi", "--session", "s1"]);
    const rooms = JSON.parse(await runChat(["rooms", "--json", "--session", "s1"]));
    const dmRoomName = rooms.rooms.find((r: { kind?: string }) => r.kind === "dm").room;
    expect(out).toBe(`dm → b #1\nposted → https://chat.example/r/${dmRoomName}#m-1`);
  });

  test("rooms lists a DM room in a direct section after channels, headed a ↔ b, never the hashed room id", async () => {
    await signInInProcess({ as: "a", session: "s1", noRoom: true });
    await signInInProcess({ as: "b", session: "s2", noRoom: true });
    await runChat(["join", "general", "--session", "s1"]);
    await runChat(["dm", "b", "hi", "--session", "s1"]);

    const out = await runChat(["rooms", "--session", "s1"]);
    expect(out).toContain("a ↔ b");
    expect(out).not.toContain("#dm-");

    const lines = out.split("\n");
    const channelIdx = lines.findIndex((l) => l.startsWith("#general"));
    const directIdx = lines.indexOf("direct");
    const dmIdx = lines.findIndex((l) => l.startsWith("a ↔ b"));
    expect(channelIdx).toBeGreaterThanOrEqual(0);
    expect(directIdx).toBeGreaterThan(channelIdx);
    expect(dmIdx).toBeGreaterThan(directIdx);
  });

  test("who on a DM room lists the two participants and never the human", async () => {
    await signInInProcess({ as: "a", session: "s1", noRoom: true });
    await signInInProcess({ as: "b", session: "s2", noRoom: true });
    await runChat(["dm", "b", "hi", "--session", "s1"]);
    const rooms = JSON.parse(await runChat(["rooms", "--json", "--session", "s1"]));
    const dmRoom = rooms.rooms.find((r: { kind?: string }) => r.kind === "dm").room;

    const out = await runChat(["who", dmRoom]);
    expect(out).toContain("a");
    expect(out).toContain("b");
    expect(out).not.toContain("matt");
  });

  test("who on a DM room renders the a ↔ b heading, never the hashed room id", async () => {
    await signInInProcess({ as: "a", session: "s1", noRoom: true });
    await signInInProcess({ as: "b", session: "s2", noRoom: true });
    await runChat(["dm", "b", "hi", "--session", "s1"]);
    const rooms = JSON.parse(await runChat(["rooms", "--json", "--session", "s1"]));
    const dmRoom = rooms.rooms.find((r: { kind?: string }) => r.kind === "dm").room;

    const ids = ["s1", "s2"].map((s) => JSON.parse(readFileSync(sessionFilePath(s), "utf8")).handle as string);
    expect(ids.map((id) => id.split(".")[0])).toEqual(["a", "b"]);

    const out = await runChat(["who", dmRoom, "--session", "s1"]);
    const lines = out.split("\n");
    expect(lines[0]).toBe("a ↔ b");
    expect(lines.slice(1).map((l) => l.trim().split(/\s+/)[0])).toEqual(["a", "b"]);
    expect(out).not.toContain(`#${dmRoom}`);
    for (const id of ids) expect(out).not.toContain(id);
  });

  test("read renders a DM room's heading as a ↔ b, never the hashed room id", async () => {
    await signInInProcess({ as: "a", session: "s1", noRoom: true });
    await signInInProcess({ as: "b", session: "s2", noRoom: true });
    await runChat(["dm", "b", "hi", "--session", "s1"]);

    const out = await runChat(["read", "--session", "s2"]);
    expect(out).toContain("a ↔ b");
    expect(out).not.toContain("dm-");
  });
});

// ─── fixture-based derivation coverage ──────────────────────────────────────
//
// Builds real temp worktree structures (a `.git` FILE with a hand-written
// `gitdir:` pointer — never a real git spawn, matching commands/chat.ts's
// own resolution) plus a fixture repo index, and asserts DISTINCT,
// repo-naming handles for a pool slot, the main worktree, and a broken
// worktree. The failure this guards: a bare slot name like "main" or "beta"
// colliding machine-wide across every repo that has a slot by that name.

describe("chat handle derivation — worktree fixtures", () => {
  let root = "";

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "rt-chat-derive-")));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  /** A real main worktree: `.git` is an actual directory. */
  function makeMainWorktree(path: string): void {
    mkdirSync(join(path, ".git"), { recursive: true });
  }

  /** A linked worktree: `.git` is a FILE pointing at the main repo's `.git/worktrees/<slot>` — the real git layout, hand-written rather than spawned. */
  function makeLinkedWorktree(path: string, mainGitDir: string, slot: string): void {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, ".git"), `gitdir: ${join(mainGitDir, "worktrees", slot)}\n`);
  }

  test("a pool slot and the main worktree resolve to distinct, repo-naming handles", () => {
    const mainPath = join(root, "acme", "gamma");
    const slotPath = join(root, "acme", "beta");
    makeMainWorktree(mainPath);
    makeLinkedWorktree(slotPath, join(mainPath, ".git"), "beta");

    const index = { "acme-dev": mainPath };

    const mainHandle = __test__.deriveRepoDirHandle(mainPath, index);
    const slotHandle = __test__.deriveRepoDirHandle(slotPath, index);

    expect(mainHandle).toBe("acme-dev-gamma");
    expect(slotHandle).toBe("acme-dev-beta");
    expect(mainHandle).not.toBe(slotHandle);
    // The failure this guards: a bare slot name (no repo prefix) colliding
    // machine-wide across every repo that happens to have a slot with the
    // same name.
    expect(mainHandle).not.toBe("gamma");
    expect(slotHandle).not.toBe("beta");
    expect(mainHandle!.startsWith("acme-dev-")).toBe(true);
    expect(slotHandle!.startsWith("acme-dev-")).toBe(true);
  });

  test("an identity-keyed index row yields the repo's display label, never the wire form (handle charset forbids % and :)", () => {
    const mainPath = join(root, "acme", "gamma-id");
    makeMainWorktree(mainPath);
    const index = { "remote:gitlab.com%2Facme%2Facme-dev": mainPath };

    const handle = __test__.deriveRepoDirHandle(mainPath, index);

    expect(handle).toBe("acme-dev-gamma-id");
    expect(handle).not.toContain("%");
    expect(handle).not.toContain(":");
  });

  test("no collapse rule: an alias that prefixes the worktree dir is not deduplicated", () => {
    // The historical failure this guards: a "collapse" step that stripped the
    // <repo>- prefix from <dir> when dir already began with repo. That is what
    // let a slot reduce to a bare, machine-wide-colliding name. Ugly-and-unique
    // beats pretty-and-colliding, so acme + acme-web stays acme-acme-web.
    const mainPath = join(root, "acme", "acme-web");
    makeMainWorktree(mainPath);
    const index = { acme: mainPath };
    const handle = __test__.deriveRepoDirHandle(mainPath, index);
    expect(handle).toBe("acme-acme-web");
    expect(handle).not.toBe("acme-web");
  });

  test("an unresolvable worktree (stale/foreign gitdir pointer) falls through to null, not a bare directory name", () => {
    const brokenPath = join(root, "workforest-fixture", "feature");
    // A gitdir pointer into a home directory that doesn't exist on this
    // machine — the real-world failure mode ("fatal: not a git repository").
    makeLinkedWorktree(brokenPath, "/Users/nobody-on-this-machine/dead-repo/.git", "feature");

    const index = { "workforest-fixture": join(root, "workforest-fixture", "main") };

    const handle = __test__.deriveRepoDirHandle(brokenPath, index);
    expect(handle).toBeNull();

    // The derivation's own fallback (position 5: cwd relative to $HOME) is
    // what the caller uses when this is null — verify it produces something
    // usable and NOT the naive bare-directory-name or <user>-<host> forms.
    const fallback = __test__.cwdRelativeHandle(brokenPath, root);
    expect(fallback).not.toBe("feature");
    expect(fallback).not.toBe(__test__.userHostHandle());
    expect(fallback.length).toBeGreaterThan(0);
  });

  test("resolveMainWorktreePath: a directory .git is its own main worktree", () => {
    const mainPath = join(root, "solo-repo");
    makeMainWorktree(mainPath);
    expect(__test__.resolveMainWorktreePath(mainPath)).toBe(mainPath);
  });

  test("resolveMainWorktreePath: a linked worktree resolves to the main worktree it points at", () => {
    const mainPath = join(root, "pool", "main");
    const slotPath = join(root, "pool", "slot-a");
    makeMainWorktree(mainPath);
    makeLinkedWorktree(slotPath, join(mainPath, ".git"), "slot-a");
    expect(__test__.resolveMainWorktreePath(slotPath)).toBe(mainPath);
  });

  test("findGitRoot walks up from a subdirectory to the worktree root", () => {
    const mainPath = join(root, "walkup-repo");
    makeMainWorktree(mainPath);
    const nested = join(mainPath, "src", "deep", "dir");
    mkdirSync(nested, { recursive: true });
    expect(__test__.findGitRoot(nested)).toBe(mainPath);
  });

  test("slugify never produces a name outside ^[a-z0-9._-]+$", () => {
    expect(__test__.slugify("Acme/Dev Gamma!!")).toMatch(/^[a-z0-9._-]+$/);
    expect(__test__.slugify("   ")).toMatch(/^[a-z0-9._-]+$/);
  });
});

// ─── Task 9: `rt chat read --last N` and `rt chat invite <pane>` ───────────

describe("rt chat CLI: read --last, invite", () => {
  test("read --last N shows the newest N messages regardless of the cursor, then marks read", async () => {
    await runChat(["join", "build", "--as", "alice"]);
    await runChat(["post", "build", "seed one", "--as", "alice"]);
    await runChat(["post", "build", "seed two", "--as", "alice"]);
    await runChat(["join", "build", "--as", "bob"]);
    const nothing = await runChat(["read", "build", "--as", "bob", "--json"]);
    expect(JSON.parse(nothing).rooms[0]?.messages ?? []).toHaveLength(0);
    const last = await runChat(["read", "build", "--last", "5", "--as", "bob", "--json"]);
    expect(JSON.parse(last).rooms[0].messages.map((m: { body: string }) => m.body)).toEqual(["seed one", "seed two"]);
    const again = await runChat(["read", "build", "--as", "bob", "--json"]);
    expect(JSON.parse(again).rooms[0]?.messages ?? []).toHaveLength(0);
  });

  test("read --last refuses --since and a non-positive N", async () => {
    await runChat(["join", "build", "--as", "alice"]);
    const both = await runChatRaw(["read", "build", "--last", "5", "--since", "5m", "--as", "alice"]);
    expect(both.code).toBe(1);
    expect(both.stderr).toBe("Read the latest few messages or the ones since a time, not both\n  next: rt chat read <room> --last 10 or rt chat read <room> --since 5m");
    const zero = await runChatRaw(["read", "build", "--last", "0", "--as", "alice"]);
    expect(zero.code).toBe(1);
    expect(zero.stderr).toBe('"0" is not a number of messages\n  why: Say how many of the latest messages to read, as a positive whole number.\n  next: rt chat read <room> --last 10');
  });

  test("read refuses a limit that is not a positive number and a length of time it cannot read", async () => {
    await runChat(["join", "build", "--as", "alice"]);
    const limit = await runChatRaw(["read", "build", "--limit", "0", "--as", "alice"]);
    expect(limit.code).toBe(1);
    expect(limit.stderr).toBe('"0" is not a number of messages\n  why: The most messages to show is a positive number.\n  next: rt chat read <room> --limit 20');
    const since = await runChatRaw(["read", "build", "--since", "soon", "--as", "alice"]);
    expect(since.code).toBe(1);
    expect(since.stderr).toBe('"soon" is not a length of time\n  why: Give a length of time like 30s, 5m, 500ms or a number of seconds.\n  next: rt chat read <room> --since 5m');
  });

  test("read --last requires a room", async () => {
    expect((await runChatRaw(["read", "--last", "5", "--as", "alice"])).code).toBe(1);
  });

  test("invite sends the pane, room, note, the human handle when not signed in, and the caller pane", async () => {
    canned = { "chat:invite": { ok: true, data: { paneId: "w1:p1", delivered: "accepted" } } };
    process.env.HERDR_PANE_ID = "w9:p9";
    const out = await runChat(["invite", "w1:p1", "--room", "build", "--note", "take vite"]);
    expect(out).toContain("accepted");
    const sent = seen.find((s) => s.cmd === "chat:invite")!;
    expect(sent.payload).toEqual({ paneId: "w1:p1", room: "build", note: "take vite", from: "matt", callerPane: "w9:p9" });
  });

  test("invite uses the session's own handle when signed in, and reports refusals with exit 0", async () => {
    await runChat(["sign-in", "--as", "carol", "--session", "sess-c", "--no-room"]);
    canned = { "chat:invite": { ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "at a prompt" } } };
    const r = await runChatRaw(["invite", "w1:p1", "--room", "build", "--session", "sess-c"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("refused: at a prompt");
    const carolId = JSON.parse(readFileSync(sessionFilePath("sess-c"), "utf8")).handle;
    expect(carolId).not.toBe("carol");
    expect((seen.find((s) => s.cmd === "chat:invite")!.payload as { from: string }).from).toBe(carolId);
  });

  test("invite requires a pane and --room", async () => {
    expect((await runChatRaw(["invite"])).code).toBe(1);
    expect((await runChatRaw(["invite", "w1:p1"])).code).toBe(1);
  });
});

// ─── what a person at a terminal sees ───────────────────────────────────────

describe("rt chat at a terminal", () => {
  const cols = (cells: string[], widths: number[]): string => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join("  ");
  const at = Date.UTC(2026, 9, 1, 12, 4);
  const message = (over: Partial<ChatMessage>): ChatMessage => ({ id: 1, room: "build", handle: "ana.1", name: "ana", body: "hello", mentions: [], mentionNames: [], postedAt: at, ...over });
  const heading = (room: string): string => `#${room}`;

  test("rooms is one table: name, members, unread, last post", () => {
    const text = renderPlain(
      __test__.roomsBlocks([
        { room: "build-and-ship", memberCount: 3, unread: 2, mentions: 1, lastPostedAt: Date.now() - 65_000 },
        { room: "quiet", memberCount: 1, unread: 0, mentions: 0 },
      ]),
    );
    expect(text).toBe(
      cols(["#build-and-ship", "3 members", "2 unread (1 mention)", "last post 1m ago"], [15, 9, 20]) + "\n" + cols(["#quiet", "1 member", "nothing unread", "no posts yet"], [15, 9, 20]) + "\n",
    );
  });

  test("a direct room sits under its own label and shows two names, never its hashed id", () => {
    const text = renderPlain(
      __test__.roomsBlocks([
        { room: "build", memberCount: 2, unread: 0, mentions: 0 },
        { room: "dm-abc123", kind: "dm", participants: { a: "ana.1", b: "bo.2", aName: "ana", bName: "bo" }, memberCount: 2, unread: 1, mentions: 0 },
      ]),
    );
    const lines = text.split("\n");
    expect(lines[1]).toBe("direct:");
    expect(lines[2]).toMatch(/^ana ↔ bo +2 members +1 unread +no posts yet$/);
    expect(text).not.toContain("dm-abc123");
  });

  test("no rooms says so and names the join command", () => {
    expect(renderPlain(__test__.roomsBlocks([]))).toBe("[skipped] You are not in any room yet\n  next: rt chat join <room>\n");
  });

  test("read is a section per room: each message a name, a time and its body, with a blank row between messages", () => {
    const clock = () => "12:04 CDT";
    const text = renderPlain(__test__.readBlocks([{ room: "build", messages: [message({ body: "the lede\n\n- one point" }), message({ id: 2, name: "bo", body: "ok" })] }], false, heading, clock));
    expect(text).toBe("#build\nana  12:04 CDT\n    the lede\n  \n    - one point\n\nbo  12:04 CDT\n    ok\n");
    expect(renderPlain(__test__.readBlocks([], false, heading))).toBe("[skipped] Nothing unread\n");
  });

  test("the human clock is local time with its zone", () => {
    expect(__test__.localClock(Date.UTC(2026, 6, 1, 17, 4), "America/Chicago")).toBe("12:04 CDT");
    expect(__test__.localClock(Date.UTC(2026, 0, 1, 18, 4), "America/Chicago")).toBe("12:04 CST");
    expect(__test__.localClock(Date.UTC(2026, 0, 1, 0, 30), "UTC")).toBe("00:30 UTC");
  });

  test("a long body is cut at 200 characters unless the person asks for all of it", () => {
    const long = "x".repeat(300);
    const clock = () => "12:04";
    const cut = renderPlain(__test__.readBlocks([{ room: "r", messages: [message({ body: long })] }], false, heading, clock));
    expect(cut).toBe(`#r\nana  12:04\n    ${"x".repeat(199)}…\n`);
    const whole = renderPlain(__test__.readBlocks([{ room: "r", messages: [message({ body: long })] }], true, heading, clock));
    expect(whole).toBe(`#r\nana  12:04\n    ${long}\n`);
  });

  test("a message body cannot repaint the screen or forge a row", () => {
    const text = renderPlain(__test__.readBlocks([{ room: "r", messages: [message({ name: "mal", body: "hi\x1b[2Jthere\n[ok] forged" })] }], true, heading, () => "12:04"));
    expect(text).toBe("#r\nmal  12:04\n    hithere\n    [ok] forged\n");
  });

  test("who is the room's members, each with its status as a word", () => {
    const member = (over: Partial<ChatMember>): ChatMember => ({ room: "build", handle: "ana.1", name: "ana", joinedAt: 1, lastReadId: 0, wakeOn: "mention", status: "live", ...over });
    const text = renderPlain(__test__.whoBlocks("#build", [member({ cwd: "/code/sample-app", pane: "w1:p2" }), member({ handle: "bo.2", name: "bo", status: "offline", cwd: "/code/other" })]));
    expect(text).toBe("#build\n" + cols(["ana", "listening", "/code/sample-app  w1:p2"], [3, 9]) + "\n" + cols(["bo", "offline", "/code/other"], [3, 9]) + "\n");
    expect(renderPlain(__test__.whoBlocks("#empty", []))).toBe("#empty\n[skipped] No members\n");
  });

  test("buddies lists listening, then idle, then offline, each with what it is doing", () => {
    const now = Date.now();
    const buddy = (over: Partial<PresenceRow & { status: BuddyStatus }>): PresenceRow & { status: BuddyStatus } => ({ sessionId: "s", handle: "ana.1", baseHandle: "ana", name: "ana", signedInAt: now, lastSeenAt: now, status: "live", ...over });
    const text = renderPlain(
      __test__.buddiesBlocks([
        buddy({ handle: "cy.3", name: "cy", status: "offline", signedOutAt: now - 2 * 3_600_000 }),
        buddy({ handle: "bo.2", name: "bo", status: "idle", lastSeenAt: now - 180_000, statusText: "at lunch" }),
        buddy({ repo: "sample-app", branch: "main", pane: "w1:p2" }),
      ]),
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe(cols(["ana", "listening", "sample-app · main · pane w1:p2"], [3, 15]));
    expect(lines[1]).toBe(cols(["bo", "idle 3m", "at lunch"], [3, 15]));
    expect(lines[2]).toMatch(/^cy +offline, 2h ago\s*$/);
    expect(renderPlain(__test__.buddiesBlocks([]))).toBe("[skipped] Nobody is signed in\n");
  });

  test("offline draws dim, quieter than listening and idle, in buddies and who", () => {
    const now = Date.now();
    const buddy = (status: BuddyStatus): PresenceRow & { status: BuddyStatus } => ({ sessionId: "s", handle: `${status}.1`, baseHandle: status, name: status, signedInAt: now, lastSeenAt: now, status });
    const roles = (blocks: ReturnType<typeof __test__.buddiesBlocks>): unknown[] => {
      const table = blocks.flatMap((b) => (b.t === "section" ? b.blocks : [b])).find((b) => b.t === "table");
      return table?.t === "table" ? table.rows.map((r) => ("cells" in r ? r.cells[1]?.[0]?.role : undefined)) : [];
    };
    expect(roles(__test__.buddiesBlocks([buddy("live"), buddy("idle"), buddy("offline")]))).toEqual(["running", "pending", "dim"]);
    const member = (status: BuddyStatus): ChatMember => ({ room: "r", handle: `${status}.1`, name: status, joinedAt: 1, lastReadId: 0, wakeOn: "mention", status });
    expect(roles(__test__.whoBlocks("#r", [member("live"), member("offline")]))).toEqual(["running", "dim"]);
  });

  test("buddies cuts a long away message at 60 characters so it cannot wrap into a row of its own", () => {
    const now = Date.now();
    const away = `brb${" ".repeat(70)}fred  listening`;
    const text = renderPlain(__test__.buddiesBlocks([{ sessionId: "s", handle: "ana.1", baseHandle: "ana", name: "ana", signedInAt: now, lastSeenAt: now, status: "live", statusText: away }]));
    expect(text).toBe(cols(["ana", "listening", `${away.slice(0, 59)}…`], [3, 9]) + "\n");
    expect(text).not.toContain("fred");
  });

  test("sign-in is one done line, with the rest of today's line as its hint", () => {
    expect(renderPlain(__test__.signInBlocks("signed in as remy · sample-app · main · joined #sample-app (3 members)"))).toBe(
      "[ok] Signed in as remy  sample-app · main · joined #sample-app (3 members)\n",
    );
    expect(renderPlain(__test__.signInBlocks("signed in as remy"))).toBe("[ok] Signed in as remy\n");
  });

  test("help is a usage line and every verb with what it does", () => {
    const text = renderPlain(__test__.helpBlocks());
    expect(text.startsWith("usage: rt chat <verb>\n\nVerbs\n")).toBe(true);
    for (const verb of ["join", "post", "read", "dm", "sign-in", "invite"]) expect(text).toContain(`\n${verb} `);
    expect(text).toContain("send a message to a room");
    expect(text).toContain("invite an agent's pane into a room");
  });

  test("at a terminal rooms is drawn by rt-ui, and an agent verb still writes its frozen line", async () => {
    await runChat(["join", "r", "--as", "a"]);
    const dir = mkdtempSync(join(tmpdir(), "rt-chat-ui-"));
    const record = join(dir, "record.ndjson");
    process.env.RT_UI_BIN = join(import.meta.dir, "..", "..", "lib", "ui", "__tests__", "fake-rt-ui.ts");
    process.env.RT_UI_FAKE = JSON.stringify({ record });
    try {
      const styled = await runChatRaw(["rooms", "--as", "a"], { human: true });
      expect(styled.rawStdout).toBe("STYLED\n");
      const sent = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { t?: string });
      expect(sent.map((l) => l.t)).toEqual([undefined, "hello", "table"]);

      const posted = await runChatRaw(["post", "r", "hello", "--as", "a"], { human: true });
      expect(posted.stdout).toBe("on the record for 0 members, woke nobody: @handle or @here wakes someone, rt chat dm reaches one\nposted → https://chat.mattstack/r/r#m-1");

      const json = await runChatRaw(["rooms", "--as", "a", "--json"], { human: true });
      expect(JSON.parse(json.stdout).ok).toBe(true);

      const piped = await runChatRaw(["rooms", "--as", "a"]);
      expect(piped.stdout.startsWith("#r ")).toBe(true);
    } finally {
      delete process.env.RT_UI_BIN;
      delete process.env.RT_UI_FAKE;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── failures ───────────────────────────────────────────────────────────────

describe("rt chat failures", () => {
  test("a missing room asks which room and shows the command", async () => {
    const r = await runChatRaw(["join"]);
    expect(r.code).toBe(1);
    expect(r.rawStdout).toBe("");
    expect(r.stderr).toBe("Which room?\n  next: rt chat join <room>");
  });

  test("a failure under --json leaves stdout empty and exits 1", async () => {
    const r = await runChatRaw(["join", "Bad/Name", "--json"]);
    expect(r.code).toBe(1);
    expect(r.rawStdout).toBe("");
    expect(r.stderr).toBe('"Bad/Name" is not a valid room name\n  why: Names use lowercase letters, digits, dots, dashes and underscores.');
  });

  test("an unknown verb names the verbs and where help is", async () => {
    const r = await runChatRaw(["bogus"]);
    expect(r.code).toBe(1);
    expect(r.stderr.startsWith("rt chat has no verb called bogus\n  next: rt chat --help\n  Verbs: ack, claim, release, join, leave, ")).toBe(true);
  });

  test("no verb off a terminal asks which one", async () => {
    // A test run from an interactive terminal would otherwise open the verb picker and wait.
    const origBatch = process.env.RT_BATCH;
    process.env.RT_BATCH = "1";
    try {
      const r = await runChatRaw([]);
      expect(r.code).toBe(1);
      expect(r.stderr.startsWith("Which chat verb?\n  next: rt chat <join|leave|")).toBe(true);
    } finally {
      if (origBatch === undefined) delete process.env.RT_BATCH;
      else process.env.RT_BATCH = origBatch;
    }
  });

  test("a daemon refusal is the title, as the daemon worded it", async () => {
    const r = await runChatRaw(["archive", "ghost", "--as", "a"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no such room");
    expect(r.stderr.split("\n")).toHaveLength(1);
  });

  test("the long one-line refusal keeps its heredoc and its override", async () => {
    await runChat(["join", "r", "--as", "a"]);
    const r = await runChatRaw(["post", "r", "x".repeat(520), "--as", "a"]);
    expect(r.code).toBe(1);
    expect(r.rawStdout).toBe("");
    expect(r.stderr).toBe(
      "[refused] That message is 520 characters with no line breaks\n" +
        "  why: A long one-line message has usually lost its paragraphs on the way in.\n" +
        "  next: rt chat post <room> <<'EOF'\n" +
        "  note: Put the message on stdin from a heredoc so its paragraphs and lists survive.\n" +
        "        --as-is posts it as it is.",
    );
    const dm = await runChatRaw(["dm", "b", "x".repeat(520), "--as", "a"]);
    expect(dm.code).toBe(1);
    expect(dm.stderr).toContain("\n  next: rt chat dm <handle> <<'EOF'\n");
  });

  test("a second identity while signed in is refused with the sign-out command", async () => {
    await signInInProcess({ as: "x", session: "s1" });
    const r = await runChatRaw(["post", "r", "hi", "--as", "y", "--session", "s1"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("[refused] You are signed in as x\n  why: One session keeps one identity. Run it again without naming another one, or sign out to change it.\n  next: rt chat sign-out");
  });

  test("a flag post does not take is refused by name, with the usage as the command", async () => {
    await runChat(["join", "r", "--as", "a"]);
    const r = await runChatRaw(["post", "r", "hello", "--herd", "gate-cleanup-1", "--as", "a"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("rt chat post does not take --herd\n  next: rt chat post <room> <text | <<'EOF'> [--file <path>] [--as-is] [--quiet]");
  });
});

// ─── the bytes agents read ──────────────────────────────────────────────────

const BYTES_FIXTURE = join(import.meta.dir, "fixtures", "chat-bytes.json");

describe("rt chat stdout off a terminal (frozen for agents)", () => {
  test("every verb's stdout off a terminal matches the fixture captured before the output layer", async () => {
    const got: Record<string, { code: number; stdout: string }> = {};
    // Only what changes from run to run is replaced: the temp HOME, clock
    // values, and the random id behind a signed-in name.
    const stable = (text: string): string =>
      text
        .replaceAll(home, "<home>")
        .replace(/\b1\d{12}\b/g, "<ms>")
        .replace(/\[\d\d:\d\d\]/g, "[HH:MM]")
        .replace(/\b\d+[smhd] ago\b/g, "<age> ago")
        .replace(/claimable again in [0-9ms ]+\)/g, "claimable again in <dur>)")
        .replace(/\bidle \d+[smhd]\b/g, "idle <age>")
        .replace(/"(handle|baseHandle)":"remy[^"]*"/g, '"$1":"<id>"');
    const run = async (name: string, args: string[]): Promise<void> => {
      const r = await runChatRaw(args);
      got[name] = { code: r.code, stdout: stable(r.rawStdout) };
    };

    const origCwd = process.cwd();
    // Outside any repo, so sign-in prints no repo or branch of this checkout.
    process.chdir(home);
    try {
      await run("join-first-member", ["join", "r", "--as", "a"]);
      await run("join-json", ["join", "r", "--as", "b", "--json"]);
      await run("join-third-member", ["join", "r", "--as", "c"]);
      await run("post-woke-nobody", ["post", "r", "hello", "--as", "a"]);
      await run("post-mention", ["post", "r", "@b", "ping", "--as", "a"]);
      await run("post-quiet", ["post", "r", "fyi", "--quiet", "--as", "a"]);
      await run("post-json", ["post", "r", "again", "--as", "a", "--json"]);
      await run("rooms", ["rooms", "--as", "b"]);
      await run("rooms-json", ["rooms", "--as", "b", "--json"]);
      await run("who-room", ["who", "r", "--as", "b"]);
      await run("who-room-json", ["who", "r", "--json"]);
      await run("ack", ["ack", "1", "--as", "b"]);
      await run("ack-again", ["ack", "1", "--as", "b"]);
      await run("ack-json", ["ack", "2", "--as", "c", "--json"]);
      await run("claim-won", ["claim", "1", "--as", "b"]);
      await run("claim-held", ["claim", "1", "--as", "b"]);
      await run("claim-lost", ["claim", "1", "--as", "c"]);
      await run("claim-json", ["claim", "2", "--as", "c", "--json"]);
      await run("release", ["release", "1", "--as", "b"]);
      await run("release-json", ["release", "2", "--as", "c", "--json"]);
      await run("read", ["read", "r", "--as", "b"]);
      await run("read-nothing-unread", ["read", "r", "--as", "b"]);
      await run("read-last", ["read", "r", "--last", "2", "--as", "b"]);
      await run("read-last-json", ["read", "r", "--last", "1", "--as", "b", "--json"]);
      await run("read-json", ["read", "--as", "c", "--json"]);
      await run("mark-json", ["mark", "r", "--as", "b", "--json"]);
      await run("mark", ["mark", "r", "--as", "b"]);
      await run("dm", ["dm", "b", "hi", "there", "--as", "a"]);
      await run("dm-json", ["dm", "b", "again", "--as", "a", "--json"]);
      await run("rooms-with-a-direct-room", ["rooms", "--as", "b"]);
      await run("leave", ["leave", "r", "--as", "c"]);
      await run("leave-json", ["leave", "r", "--as", "b", "--json"]);
      await run("archive", ["archive", "r", "--as", "a"]);
      await run("archive-reopen", ["archive", "r", "--reopen", "--as", "a"]);
      await run("archive-json", ["archive", "r", "--as", "a", "--json"]);
      await run("prune", ["prune"]);
      await run("prune-json", ["prune", "--json"]);
      await run("buddies-nobody", ["buddies"]);
      await run("sign-in", ["sign-in", "--as", "remy", "--no-room", "--session", "s1"]);
      await run("sign-in-json", ["sign-in", "--as", "remy", "--no-room", "--session", "s1", "--json"]);
      await run("buddies", ["buddies"]);
      await run("buddies-json", ["buddies", "--json"]);
      await run("who-bare", ["who"]);
      await run("away", ["away", "brb", "lunch", "--session", "s1"]);
      await run("away-json", ["away", "afk", "--session", "s1", "--json"]);
      await run("back", ["back", "--session", "s1"]);
      await run("back-json", ["back", "--session", "s1", "--json"]);
      await run("sign-out", ["sign-out", "--session", "s1"]);
      await runChatRaw(["sign-in", "--as", "remy", "--no-room", "--session", "s2"]);
      await run("sign-out-json", ["sign-out", "--session", "s2", "--json"]);
      await run("sign-out-quiet", ["sign-out", "--session", "s2", "--quiet"]);
      // A room no earlier line touched: "r" is archived by now.
      await run("sign-in-room", ["sign-in", "--as", "remy", "--room", "fresh", "--session", "s3"]);
      canned = { "chat:sign-in": { ok: true, data: { handle: "kai", baseHandle: "kai", reclaimed: false, sessionId: "pane-sess-1", room: null } } };
      await run("sign-in-pane", ["sign-in", "--pane", "w1:p1"]);
      canned = { "chat:sign-in": { ok: true, data: { handle: "kai", baseHandle: "kai", reclaimed: false, sessionId: "pane-sess-1", room: "build" } } };
      await run("sign-in-pane-room", ["sign-in", "--pane", "w1:p1"]);
      canned = { "chat:sign-out": { ok: true, data: { sessionId: "pane-sess-1" } } };
      await run("sign-out-pane", ["sign-out", "--pane", "w1:p1"]);
      canned = { "chat:invite": { ok: true, data: { paneId: "w1:p1", delivered: "accepted" } } };
      await run("invite", ["invite", "w1:p1", "--room", "r"]);
      await run("invite-json", ["invite", "w1:p1", "--room", "r", "--json"]);
      canned = { "chat:invite": { ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "at a prompt" } } };
      await run("invite-refused", ["invite", "w1:p1", "--room", "r"]);
      canned = {};
      await run("help", ["join", "--help"]);
    } finally {
      process.chdir(origCwd);
    }

    if (process.env.RT_UPDATE_CHAT_BYTES) {
      mkdirSync(dirname(BYTES_FIXTURE), { recursive: true });
      // ASCII only: every character above 0x7f is written as its escape, so the
      // fixture holds no glyph an editor or a formatter could rewrite.
      const ascii = JSON.stringify(got, null, 2).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      writeFileSync(BYTES_FIXTURE, ascii + "\n");
      throw new Error(`${BYTES_FIXTURE} was rewritten. Only capture it from code whose stdout is meant to change, then rerun without RT_UPDATE_CHAT_BYTES.`);
    }
    expect(got).toEqual(JSON.parse(readFileSync(BYTES_FIXTURE, "utf8")));
  }, 60_000);
});


describe("daemon refusals by policy", () => {
  test("release of a claim you do not hold is a refusal", async () => {
    canned = { "chat:release": { ok: false, error: "you are neither the holder of #1 nor its author", failure: { code: "not-holder", message: "you are neither the holder of #1 nor its author" } } };
    for (const flags of [[], ["--json"]]) {
      const r = await runChatRaw(["release", "1", "--as", "b", ...flags]);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("[refused] rt chat will not release a claim you do not hold\n  why: Only the agent holding a claim, or the one who posted the message, can release it.");
    }
  });

  test.each([
    ["identity-held", "This session cannot use that identity", "This session is not signed in, or another session now holds its identity."],
    ["identity-fixed", "rt chat keeps that identity for the human or the herd", "Agents sign in under names of their own."],
  ])("%s is a refusal with the sign-in command", async (code, title, why) => {
    canned = { "chat:sign-in": { ok: false, error: "daemon wording", failure: { code, message: "daemon wording" } } };
    for (const flags of [[], ["--json"]]) {
      const r = await runChatRaw(["sign-in", "--as", "remy.1", "--no-room", "--session", "s9", ...flags]);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe(`[refused] ${title}\n  why: ${why}\n  next: rt chat sign-in`);
    }
  });

  test.each(["something-new", "toString", "__proto__"])("unknown code %s is a failure in the daemon's words", async (code) => {
    canned = { "chat:release": { ok: false, error: "no message #9", failure: { code, message: "different failure message" } } };
    for (const flags of [[], ["--json"]]) {
      const r = await runChatRaw(["release", "9", "--as", "b", ...flags]);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("no message #9");
    }
  });

  test("sign-out cleans up locally when the daemon returns a coded refusal", async () => {
    await signInInProcess({ as: "x", session: "s1", noRoom: true });
    canned = { "chat:sign-out": { ok: false, error: "handle reclaimed", failure: { code: "identity-held", message: "handle reclaimed" } } };
    const r = await runChatRaw(["sign-out", "--session", "s1", "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, daemonError: "handle reclaimed" });
    expect(r.stderr).toContain("[warning] Signed out here, but the daemon did not hear it");
    expect(existsSync(join(home, ".mattstack", "rt", "chat", "sessions", "s1.json"))).toBe(false);
  });
});


describe("missing chat presence", () => {
  test.each(["away", "back"])("%s explains that the session may not be signed in", async (verb) => {
    for (const flags of [[], ["--json"]]) {
      const args = verb === "away" ? [verb, "lunch"] : [verb];
      const r = await runChatRaw([...args, "--session", "never-signed-in", ...flags]);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("[refused] This session cannot use that identity\n  why: This session is not signed in, or another session now holds its identity.\n  next: rt chat sign-in");
    }
  });
});

describe("a signed-in pane whose session id changed", () => {
  const PANE = "wMP:p17";
  const live: InboxBinding = { pid: process.pid, socketPath: "/fake.sock", status: "busy" };

  async function signInPaneThenFork(): Promise<{ tyler: string }> {
    await signInInProcess({ as: "kai", session: "s-kai", noRoom: true });
    process.env.HERDR_PANE_ID = PANE;
    await signInInProcess({ as: "tyler", session: "orig", noRoom: true });
    process.env.CLAUDE_CODE_SESSION_ID = "forked";
    return { tyler: JSON.parse(readFileSync(sessionFilePath("orig"), "utf8")).handle };
  }

  function authors(): string[] {
    return (getStateDb().query("SELECT handle FROM chat_messages ORDER BY id").all() as { handle: string }[]).map((r) => r.handle);
  }

  test("posts and DMs as the identity the pane is signed in as", async () => {
    const { tyler } = await signInPaneThenFork();
    registryDeps = { resolve: (s) => (s === "orig" ? live : null), alive: () => true, resolveAll: () => new Map([["orig", live]]) };
    await runChat(["join", "r"]);
    await runChat(["post", "r", "hello"]);
    expect(await runChat(["dm", "kai", "hi"])).toMatch(/^dm → kai #\d+/);
    expect(authors()).toEqual([tyler, tyler]);
  });

  test("--as alongside the pane's identity is refused", async () => {
    await signInPaneThenFork();
    registryDeps = { resolve: (s) => (s === "orig" ? live : null), alive: () => true, resolveAll: () => new Map([["orig", live]]) };
    const r = await runChatRaw(["post", "r", "hello", "--as", "scout"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toStartWith("[refused] You are signed in as tyler");
  });

  test("a pane whose signed-in session is gone falls through to the old chain", async () => {
    await signInPaneThenFork();
    await runChat(["join", "r", "--as", "scout"]);
    await runChat(["post", "r", "hello", "--as", "scout"]);
    expect(authors()).toEqual(["scout"]);
  });

  test("a pane with no presence row falls through to the old chain", async () => {
    process.env.HERDR_PANE_ID = "w5:p5";
    process.env.CLAUDE_CODE_SESSION_ID = "unsigned";
    await runChat(["join", "r", "--as", "scout"]);
    await runChat(["post", "r", "hello", "--as", "scout"]);
    expect(authors()).toEqual(["scout"]);
  });

  test("a daemon that cannot list presence falls through to the old chain", async () => {
    await signInPaneThenFork();
    canned["chat:buddies"] = { ok: false, error: "unknown command: chat:buddies" };
    await runChat(["join", "r", "--as", "scout"]);
    await runChat(["post", "r", "hello", "--as", "scout"]);
    expect(authors()).toEqual(["scout"]);
  });

  test("post and dm tell the daemon which pane they came from", async () => {
    await signInPaneThenFork();
    await runChat(["join", "r", "--as", "scout"]);
    await runChat(["post", "r", "hello", "--as", "scout"]);
    await runChat(["dm", "kai", "hi", "--as", "scout"]);
    expect(seen.find((s) => s.cmd === "chat:post")!.payload).toMatchObject({ pane: PANE });
    expect(seen.find((s) => s.cmd === "chat:dm")!.payload).toMatchObject({ pane: PANE });
  });

  test("the daemon's refusal of an unreachable sender is a refused note naming the identity", async () => {
    canned["chat:post"] = { ok: false, error: "chat: This pane is signed in as tyler; post as tyler", failure: { code: "pane-signed-in", message: "This pane is signed in as tyler; post as tyler" } };
    for (const flags of [[], ["--json"]]) {
      const r = await runChatRaw(["post", "r", "hello", "--as", "scout", ...flags]);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toStartWith("[refused] This pane is signed in as tyler; post as tyler");
    }
  });

  test("integrations on: a forked session no binding names keeps the pane's identity", async () => {
    const { tyler } = await signInPaneThenFork();
    setSetting("agent.integrations.enabled", true, "machine");
    registryDeps = { resolve: (s) => (s === "orig" ? live : null), alive: () => true, resolveAll: () => new Map([["orig", live]]) };
    await runChat(["join", "r"]);
    await runChat(["post", "r", "hello"]);
    expect(authors()).toEqual([tyler]);
  });

  test("integrations on: a session a binding names is never given the pane's identity", async () => {
    const { tyler } = await signInPaneThenFork();
    setSetting("agent.integrations.enabled", true, "machine");
    registryDeps = { resolve: (s) => (s === "orig" ? live : null), alive: () => true, resolveAll: () => new Map([["orig", live]]) };
    const store = createSessionStore(getStateDb());
    const bound = store.bind(store.reserve({ identity: "nova.0001" }), { harness: "claude", profile: "default", kind: "id", value: "forked" }, { mode: "herdr", pane: PANE });
    if (!bound.ok) throw new Error(bound.error.message);
    await runChatRaw(["join", "r"]).catch(() => undefined);
    await runChatRaw(["post", "r", "hello"]).catch(() => undefined);
    expect(authors()).not.toContain(tyler);
  });
});

describe("integrations on: chat follows the harness session", () => {
  const SHIMS = mkdtempSync(join(tmpdir(), "rt-chat-shims-"));
  const CALLS = join(SHIMS, "calls.log");
  for (const bin of ["herdr", "claude", "codex", "cswap"]) {
    writeFileSync(join(SHIMS, bin), `#!/bin/sh\necho "${bin} $*" >> "${CALLS}"\nexit 1\n`, { mode: 0o755 });
  }
  let origPath: string | undefined;
  beforeEach(() => {
    origPath = process.env.PATH;
    process.env.PATH = `${SHIMS}:${process.env.PATH}`;
    writeFileSync(CALLS, "");
  });
  afterEach(() => {
    process.env.PATH = origPath;
    expect(readFileSync(CALLS, "utf8")).toBe("");
  });

  const bindClaude = (session: string, pane: string, identity = "nova.0001") => {
    const store = createSessionStore(getStateDb());
    const bound = store.bind(store.reserve({ identity }), { harness: "claude", profile: "default", kind: "id", value: session }, { mode: "herdr", pane });
    if (!bound.ok) throw new Error(bound.error.message);
    return bound.data;
  };
  const bindingOf = (session: string) => listBindingsByNativeValue(getStateDb(), session)[0]!;
  const handleIn = (session: string): string => JSON.parse(readFileSync(sessionFilePath(session), "utf8")).handle;

  test("a bound session with no session file is told to sign in, as its tools are, whatever --as says", async () => {
    setSetting("agent.integrations.enabled", true, "machine");
    bindClaude("bound-1", "w1:p1");
    for (const extra of [[], ["--as", "scout"]]) {
      const r = await runChatRaw(["post", "r", "hello", "--session", "bound-1", ...extra]);
      expect(r.code).toBe(1);
      expect(r.stderr).toStartWith("This session is not signed in to chat");
      expect(r.stderr).toContain("rt chat sign-in");
    }
    expect(seen.map((s) => s.cmd)).not.toContain("chat:post");
  });

  test("with the switch off the same session still posts under the handle it derives", async () => {
    bindClaude("bound-1", "w1:p1");
    await runChat(["join", "r", "--as", "scout", "--session", "bound-1"]);
    await runChat(["post", "r", "hello", "--as", "scout", "--session", "bound-1"]);
    expect(seen.find((s) => s.cmd === "chat:post")!.payload).toMatchObject({ handle: "scout" });
  });

  test("rooms --session answers for another signed-in session that no binding names, and only rooms does", async () => {
    await signInInProcess({ as: "ivy", session: "ivy-1", room: "build" });
    delete process.env.CLAUDE_CODE_SESSION_ID;
    setSetting("agent.integrations.enabled", true, "machine");
    const listed = await runChatRaw(["rooms", "--session", "ivy-1", "--json"]);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout).rooms.map((r: { room: string }) => r.room)).toEqual(["build"]);
    await expect(runChatRaw(["post", "build", "hi", "--session", "ivy-1"])).rejects.toBeInstanceOf(UserActionableError);
    await expect(runChatRaw(["rooms", "--session", "nobody-1", "--json"])).rejects.toBeInstanceOf(UserActionableError);
  });

  test("a SessionEnd from a pane the session has left signs nothing out; one from its own pane signs it out", async () => {
    await signInInProcess({ as: "remy", session: "s-end", noRoom: true });
    delete process.env.CLAUDE_CODE_SESSION_ID;
    setSetting("agent.integrations.enabled", true, "machine");
    bindClaude("s-end", "w2:p1", handleIn("s-end"));

    process.env.HERDR_PANE_ID = "w1:p1";
    const stale = await runChatRaw(["sign-out", "--quiet", "--session", "s-end", "--ended"]);
    expect(stale).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(existsSync(sessionFilePath("s-end"))).toBe(true);
    expect(presenceForSession("s-end", getStateDb())?.signedOutAt).toBeUndefined();

    process.env.HERDR_PANE_ID = "w2:p1";
    const own = await runChatRaw(["sign-out", "--quiet", "--session", "s-end", "--ended"]);
    expect(own).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(existsSync(sessionFilePath("s-end"))).toBe(false);
    expect(presenceForSession("s-end", getStateDb())?.signedOutAt).toBeDefined();
    expect(seen.map((s) => s.cmd)).not.toContain("chat:sign-out");
  });

  test("with the switch off --ended signs out exactly as the hook always has", async () => {
    await signInInProcess({ as: "remy", session: "s-end", noRoom: true });
    delete process.env.CLAUDE_CODE_SESSION_ID;
    bindClaude("s-end", "w2:p1");
    process.env.HERDR_PANE_ID = "w1:p1";
    const r = await runChatRaw(["sign-out", "--quiet", "--session", "s-end", "--ended"]);
    expect(r).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(seen.filter((s) => s.cmd === "chat:sign-out").map((s) => s.payload)).toEqual([{ sessionId: "s-end" }]);
    expect(existsSync(sessionFilePath("s-end"))).toBe(false);
  });

  test("lifecycle resume moves a bound session's attachment and presence to the reporting pane, and only with the switch on", async () => {
    await signInInProcess({ as: "remy", session: "s-res", noRoom: true });
    delete process.env.CLAUDE_CODE_SESSION_ID;
    const bound = bindClaude("s-res", "w1:p1", handleIn("s-res"));
    process.env.HERDR_PANE_ID = "w2:p1";
    const before = seen.length;

    const off = await runChatRaw(["lifecycle", "resume", "--session", "s-res"]);
    expect(off).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(bindingOf("s-res").attachment).toMatchObject({ generation: bound.attachment.generation, pane: "w1:p1" });

    setSetting("agent.integrations.enabled", true, "machine");
    const on = await runChatRaw(["lifecycle", "resume", "--session", "s-res"]);
    expect(on).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(bindingOf("s-res").attachment).toMatchObject({ generation: bound.attachment.generation + 1, pane: "w2:p1" });
    expect(presenceForSession("s-res", getStateDb())?.pane).toBe("w2:p1");
    expect(seen.length).toBe(before);
  });

  test("lifecycle is hidden: absent from the usage line and the verb list, and it names its usage", async () => {
    expect((await runChatRaw(["--help"])).stdout).not.toContain("lifecycle");
    expect((await runChatRaw(["nope"])).stderr).not.toContain("lifecycle");
    const bad = await runChatRaw(["lifecycle", "nap"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("rt chat lifecycle <resume|compact>");
  });
});
