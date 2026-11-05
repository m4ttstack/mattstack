/**
 * rt chat avatar, in-process against a temp HOME and a fake daemon socket.
 * The drawing is faked: WebKit is proved by hand on a Mac, not on CI.
 */
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { chatAvatarWith } from "../chat-avatar.ts";
import { TREE } from "../../lib/command-tree-def.ts";
import { MODULE_REGISTRY } from "../../lib/module-registry.ts";
import { chatFacesDir } from "../../lib/rt-paths.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import * as ui from "../../lib/ui/out.ts";
import { generatedFace } from "../../packages/rt-client/src/face-avatar.ts";
import { faceSeed, faceTiles, ownTile } from "../../packages/rt-client/src/face-tiles.ts";

const PICTURE = "/kept/U0TEST-abc.png";
const PNG = new Uint8Array([137, 80, 78, 71]);

let home = "";
let savedHome: string | undefined;
let server: ReturnType<typeof Bun.serve> | null = null;
let seen: Array<{ cmd: string; payload: Record<string, unknown> }> = [];
let status: Record<string, unknown> = { ok: true, data: { conversations: [], closed: [] } };
let drawn: Array<[string, number]> = [];

const render = async (svg: string, size: number) => {
  drawn.push([svg, size]);
  return PNG;
};

async function run(fn: () => Promise<void>) {
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  const exitSpy = spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit sentinel");
  }) as never);
  let code = 0;
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "process.exit sentinel") throw err;
    code = (exitSpy.mock.calls.at(-1)?.[0] as number | undefined) ?? 1;
  }
  const result = { code, stdout: io.stdout(), stderr: io.stderr() };
  exitSpy.mockRestore();
  io.restore();
  return result;
}

function avatar(...args: string[]) {
  return run(() => chatAvatarWith(args, { render }));
}

beforeEach(() => {
  savedHome = process.env.HOME;
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-chat-avatar-")));
  process.env.HOME = home;
  const sockDir = join(home, ".mattstack", "rt");
  mkdirSync(sockDir, { recursive: true });
  seen = [];
  drawn = [];
  status = { ok: true, data: { conversations: [], closed: [] } };
  server = Bun.serve({
    unix: join(sockDir, "rt.sock"),
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      const payload = (req.method === "POST" ? await req.json() : {}) as Record<string, unknown>;
      seen.push({ cmd, payload });
      if (cmd === "chat:slack-status") return Response.json(status);
      const person = payload.person;
      return Response.json({ ok: true, data: person === "U0TEST" ? { file: { path: PICTURE, contentType: "image/png" } } : {} });
    },
  });
});

afterEach(() => {
  server?.stop(true);
  server = null;
  process.env.HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

test("an agent's handle gets its generated face, without asking the daemon", async () => {
  const res = await avatar("remy.a1b2", "--json");
  expect(res.code).toBe(0);
  const envelope = JSON.parse(res.stdout);
  expect(Object.keys(envelope).sort()).toEqual(["kind", "ok", "path"]);
  expect(envelope).toMatchObject({ ok: true, kind: "generated" });
  expect(envelope.path.startsWith(chatFacesDir())).toBe(true);
  expect(readFileSync(envelope.path)).toEqual(Buffer.from(PNG));
  expect(res.stderr).toBe("");
  expect(seen).toEqual([]);
});

test("the face is the chat app's: its seed on its own tile", async () => {
  await avatar("remy.a1b2", "--json");
  const seed = faceSeed("remy.a1b2");
  expect(drawn[0]![0]).toBe(generatedFace(seed, ownTile(seed)).toString());
});

test("--size sets the picture's size, and it defaults to 64", async () => {
  await avatar("remy.a1b2", "--json");
  await avatar("kit.c3d4", "--size", "44", "--json");
  expect(drawn.map(([, size]) => size)).toEqual([64, 44]);
});

test("the handle may follow the flags", async () => {
  await avatar("--size", "44", "remy.a1b2", "--json");
  expect(drawn[0]![1]).toBe(44);
});

const GROUP = ["kit.c3d4", "remy.a1b2", "remy.e5f6"];

test("--alongside gives each handle the tile the chat app gives it in that group", async () => {
  const tiles = faceTiles(GROUP);
  for (const handle of GROUP) {
    drawn = [];
    await avatar(handle, "--alongside", GROUP.filter((h) => h !== handle).join(","), "--json");
    expect(drawn[0]![0]).toBe(generatedFace(faceSeed(handle), tiles.get(handle)!).toString());
  }
});

test("two people with one name stay apart with --alongside", async () => {
  await avatar("remy.a1b2", "--alongside", "remy.e5f6", "--json");
  await avatar("remy.e5f6", "--alongside", "remy.a1b2", "--json");
  expect(drawn[0]![0]).not.toBe(drawn[1]![0]);
});

test("--alongside may repeat the handle itself", async () => {
  await avatar("remy.a1b2", "--alongside", "remy.a1b2", "--json");
  const seed = faceSeed("remy.a1b2");
  expect(drawn[0]![0]).toBe(generatedFace(seed, ownTile(seed)).toString());
});

test("a Slack handle with a picture gets the photo and draws nothing", async () => {
  status = { ok: true, data: { conversations: [{ handle: "slack.t1.u1", avatarId: "U0TEST" }], closed: [] } };
  const res = await avatar("slack.t1.u1", "--json");
  expect(JSON.parse(res.stdout)).toEqual({ ok: true, kind: "slack", path: PICTURE });
  expect(seen.find((s) => s.cmd === "chat:slack-avatar-file")!.payload).toEqual({ person: "U0TEST" });
  expect(drawn).toEqual([]);
});

test("a closed Slack chat keeps the photo", async () => {
  status = { ok: true, data: { conversations: [], closed: [{ handle: "slack.t1.u1", avatarId: "U0TEST" }] } };
  const res = await avatar("slack.t1.u1", "--json");
  expect(JSON.parse(res.stdout)).toEqual({ ok: true, kind: "slack", path: PICTURE });
});

test.each([
  ["no chat holds it", { ok: true, data: { conversations: [], closed: [] } }],
  ["its picture isn't known yet", { ok: true, data: { conversations: [{ handle: "slack.t1.u1" }], closed: [] } }],
  ["the daemon has no picture", { ok: true, data: { conversations: [{ handle: "slack.t1.u1", avatarId: "U0NONE" }], closed: [] } }],
  ["the daemon refuses", { ok: false, error: "unknown command" }],
] as [string, Record<string, unknown>][])("a Slack handle gets the generated face when %s", async (_name, answer) => {
  status = answer;
  const res = await avatar("slack.t1.u1", "--json");
  expect(JSON.parse(res.stdout)).toMatchObject({ ok: true, kind: "generated" });
  expect(drawn).toHaveLength(1);
});

test("a person reads the kind and the file", async () => {
  const res = await avatar("remy.a1b2");
  expect(res.stdout).toContain("Generated");
  expect(res.stdout).toContain(chatFacesDir());
});

const refuseToDraw = () => Promise.reject(new Error("no window server"));

test("a draw that fails stays in the envelope under --json", async () => {
  const res = await run(() => chatAvatarWith(["remy.a1b2", "--json"], { render: refuseToDraw }));
  expect(JSON.parse(res.stdout)).toEqual({ ok: false, error: "no window server" });
  expect(res.code).toBe(1);
});

test("a draw that fails is a failure for a person", async () => {
  const res = await run(() => chatAvatarWith(["remy.a1b2"], { render: refuseToDraw }));
  expect(res.stderr.startsWith("The face could not be drawn")).toBe(true);
  expect(res.code).toBe(1);
});

test.each([
  ["no handle", ["--json"], "Whose face do you want?"],
  ["a size that isn't a number", ["remy.a1b2", "--size", "big"], "The size must be a whole number"],
  ["a size too small", ["remy.a1b2", "--size", "2"], "The size must be a whole number"],
  ["a size too large", ["remy.a1b2", "--size", "9000"], "The size must be a whole number"],
  ["--alongside with no handles", ["remy.a1b2", "--alongside", "--json"], "--alongside needs"],
] as [string, string[], string][])("%s is a usage failure, and nothing is drawn", async (_name, args, message) => {
  const res = await avatar(...args);
  expect(res.stderr).toContain(message);
  expect(res.code).toBe(1);
  expect(drawn).toEqual([]);
});

test("the verb is registered for the compiled binary and hidden from people", async () => {
  const node = TREE.chat!.subcommands!.avatar!;
  expect(node.hidden).toBe(true);
  const mod = await MODULE_REGISTRY[node.module!]!();
  expect(typeof (mod as Record<string, unknown>)[node.fn!]).toBe("function");
});
