import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createSlackAvatars } from "../avatars.ts";
import type { SlackClient, SlackUser } from "../client.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const person = (id: string, avatar?: string): SlackUser => ({
  id,
  name: id,
  displayName: id,
  realName: id,
  title: "",
  deleted: false,
  isBot: false,
  ...(avatar ? { avatar } : {}),
});

function harness(users: SlackUser[], respond: (url: string) => Response = () => new Response("png", { headers: { "content-type": "image/png" } })) {
  const dir = mkdtempSync(join(tmpdir(), "slack-avatars-"));
  dirs.push(dir);
  const state = { at: 1000, users, reads: 0, downloads: 0 };
  const avatars = createSlackAvatars({
    client: async () =>
      ({
        listUsers: async () => {
          state.reads++;
          return state.users;
        },
      }) as unknown as SlackClient,
    log: { warn: () => undefined },
    now: () => state.at,
    fetchImpl: (async (url: string) => {
      state.downloads++;
      return respond(url);
    }) as unknown as typeof fetch,
    dir: () => dir,
  });
  return { avatars, state, dir };
}

const URL_A = "https://avatars.slack-edge.com/a.png";
const URL_B = "https://avatars.slack-edge.com/b.png";

test("a picture downloads once, however many apps ask", async () => {
  const { avatars, state } = harness([person("U1", URL_A)]);
  const [first, second] = await Promise.all([avatars.picture("U1"), avatars.picture("U1")]);
  expect(await avatars.picture("U1")).toEqual(first);
  expect(second).toEqual(first);
  expect(first?.contentType).toBe("image/png");
  expect(state.downloads).toBe(1);
});

test("a new URL replaces the old file after the hourly read", async () => {
  const { avatars, state, dir } = harness([person("U1", URL_A)]);
  await avatars.picture("U1");
  state.users = [person("U1", URL_B)];
  state.at += 2 * 60 * 60_000;
  await avatars.picture("U1");
  expect(state.downloads).toBe(2);
  expect(readdirSync(dir)).toHaveLength(1);
});

test("the directory is read once an hour", async () => {
  const { avatars, state } = harness([person("U1", URL_A)]);
  await avatars.people();
  avatars.version("U1");
  await avatars.people();
  expect(state.reads).toBe(1);
});

test("version answers without waiting, then changes with the picture", async () => {
  const { avatars, state } = harness([person("U1", URL_A)]);
  expect(avatars.version("U1")).toBeUndefined();
  await avatars.people();
  const first = avatars.version("U1");
  expect(first).toBeString();
  state.users = [person("U1", URL_B)];
  state.at += 2 * 60 * 60_000;
  await avatars.people();
  expect(avatars.version("U1")).not.toBe(first);
});

test("an SVG is refused and not retried until the wait is over", async () => {
  const { avatars, state } = harness([person("U1", URL_A)], () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }));
  expect(await avatars.picture("U1")).toBeNull();
  expect(await avatars.picture("U1")).toBeNull();
  expect(state.downloads).toBe(1);
});

test("a host outside Slack's and a malformed id are never fetched", async () => {
  const { avatars, state } = harness([person("U1", "https://evil.test/a.png")]);
  expect(await avatars.picture("U1")).toBeNull();
  expect(await avatars.picture("../../etc/passwd")).toBeNull();
  expect(state.downloads).toBe(0);
});

test("deleted people and bots are left out", async () => {
  const { avatars } = harness([person("U1", URL_A), { ...person("U2", URL_A), deleted: true }, { ...person("U3", URL_A), isBot: true }]);
  expect((await avatars.people()).map((p) => p.id)).toEqual(["U1"]);
});
