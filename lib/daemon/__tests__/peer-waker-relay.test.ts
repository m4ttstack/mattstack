import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { childEnv } from "../../subprocess.ts";
import { switchboardUrl } from "../../../packages/rt-client/src/switchboard.ts";
import { PEER_INBOX_EVENT, startPeerWaker, type PeerWakerDeps } from "../peer-waker.ts";

const RELAY = join(import.meta.dir, "..", "..", "..", "apps", "board", "switchboard", "server.ts");
const ADMIN = "admin-secret";
const quiet = { debug() {}, info() {}, warn() {} } as unknown as PeerWakerDeps["log"];

let dir: string;
let proc: ReturnType<typeof Bun.spawn>;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "relay-"));
  proc = Bun.spawn([process.execPath, "run", RELAY], {
    env: { ...childEnv(), SWITCHBOARD_ADMIN_TOKEN: ADMIN, SWITCHBOARD_DB: join(dir, "sb.sqlite"), PORT: "0" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  let text = "";
  while (!/listening on :(\d+)/.test(text)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`relay exited: ${text}`);
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  base = `http://127.0.0.1:${/listening on :(\d+)/.exec(text)![1]}`;
});

afterAll(() => {
  proc.kill();
  rmSync(dir, { recursive: true, force: true });
});

async function register(username: string): Promise<string> {
  const res = await fetch(`${base}/boards`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  return ((await res.json()) as { token: string }).token;
}

// A publish that missed the held wait would land only when the wait times out.
const WAIT_SECONDS = 25;

test("a publish reaches the recipient's waker in seconds, long before its held wait times out", async () => {
  const ada = await register("ada");
  const grace = await register("grace");
  const woke: number[] = [];
  let waitOpened!: () => void;
  const opened = new Promise<void>((resolve) => { waitOpened = resolve; });
  let firstWaitAnswered = false;
  const waker = startPeerWaker({
    log: quiet,
    emit: (type) => {
      if (type === PEER_INBOX_EVENT) woke.push(Date.now());
    },
    readUrl: () => switchboardUrl({ RT_SWITCHBOARD_URL: base }),
    readToken: async () => ada,
    waitSeconds: WAIT_SECONDS,
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      const res = fetch(input, init);
      res.finally(() => { firstWaitAnswered = true; }).catch(() => {});
      waitOpened();
      return res;
    }) as typeof fetch,
  });
  await opened;
  // The relay reports no held waiters, so give the request time to reach it,
  // then check the wait is still held rather than already answered.
  await Bun.sleep(150);
  expect(firstWaitAnswered).toBe(false);
  const sent = Date.now();
  await fetch(`${base}/envelopes`, {
    method: "POST",
    headers: { authorization: `Bearer ${grace}`, "content-type": "application/json" },
    body: JSON.stringify({ id: "e1", to: "ada", type: "re-review-request", sentAt: sent, payload: {} }),
  });
  for (let i = 0; i < 500 && woke.length === 0; i++) await Bun.sleep(10);
  waker.stop();
  await waker.done;
  expect(woke).toHaveLength(1);
  expect(woke[0]! - sent).toBeLessThan(5_000);
}, 20_000);

test("a held wait outlasts Bun's default 10s idle timeout", async () => {
  const linus = await register("linus");
  const res = await fetch(`${base}/inbox/wait?since=0&timeout=12`, { headers: { authorization: `Bearer ${linus}` } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ woke: false, cursor: 0 });
}, 20_000);
