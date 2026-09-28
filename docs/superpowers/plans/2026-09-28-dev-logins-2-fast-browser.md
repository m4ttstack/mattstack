# Dev logins, plan 2: Fast Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fast Browser relays saved-login requests from its browser runtime to the rt daemon, keeps saved-login fills out of compiled flows, and teaches the `fast-browsing` skill the saved-login procedure.

**Architecture:** The launcher (`lib/runtime/launch.mjs`) spawns the runtime with an extra duplex stdio slot and the flag `--secrets-channel-fd=3`. A new relay (`lib/runtime/secrets-channel.mjs`) reads newline-delimited JSON requests from that socket, asks the rt daemon through a new hand-rolled unix-socket client (`lib/rt/login-fill-client.mjs`), validates the answer, and writes one reply per request. Only the local path wires the channel; the cloud path is byte-identical to today. Flow compile (`lib/flows/compile.mjs`) cuts saved-login segments out before segmentation.

**Tech Stack:** Node >= 20 ESM, `node:test`, `node:http` over a unix socket, `node:net`.

**Spec:** `docs/superpowers/specs/2026-09-28-dev-logins-design.md` in the rt repo (sections 4 and 5). Executors read both.

**Repo:** `/Users/matt/Documents/GitHub/fast-browser` (work in a worktree of it; this plan file lives in the rt repo). Read its `CLAUDE.md` before Task 1.

**Depends on:** plan 1 (the Playwright fork) has published a runtime release that accepts `--secrets-channel-fd`. Task 1 pins it. Do not start Task 4 before Task 1 lands: the currently pinned runtime rejects the unknown flag and would exit at launch.

**Execution order (this plan runs in parallel with plans 1 and 3):** run Tasks 2, 3, 5 and 6 first; none of them needs the new runtime. Then stop and wait for plan 1's runtime release, and run Tasks 1, 4 and 7 in that order. If the release is not out when Task 6 finishes, report "waiting on runtime release" and end rather than improvising a pin.

## Global Constraints

- Contract A (runtime <-> launcher channel, verbatim): runtime flag `--secrets-channel-fd=<n>` (launcher passes 3 via an extra 'pipe' stdio slot, which is a duplex socket); newline-delimited JSON. Request `{"id","name","frameOrigin","elementKind":"password"|"text"}`. Reply echoes id and name: success `{"id","name","origin","kind":"email"|"password","value"}`, refusal `{"id","name","refused":"unknown"|"mismatch"|"limited"|"unavailable","until"?: number}`.
- Contract B (launcher <-> rt daemon, verbatim): unix socket `~/.mattstack/rt/rt.sock` (override env `RT_DAEMON_SOCK`), `POST http://localhost/logins:fill` with JSON body `{"token","client":"fast-browser","pid","name","frameOrigin","elementKind"}`; token read from `~/.mattstack/rt/api-token` at call time. Response envelope `{"ok":true,"data":{...}}` where data is `{"origin","kind","value"}` or `{"refused","until"?}`; `{"ok":false,"error"}` for bad token or malformed input. No rt, missing token, socket down, ok:false, or non-JSON: the launcher replies `refused: "unavailable"`. Client is a hand-rolled `http.request({socketPath})`, no rt dependency.
- Contract C (verbatim): Reserved names `devlogin:<key>:email|password`; `rt logins list --json` returns `[{origin, email, fields:{email, password}}]` with those names.
- Contract D (verbatim): Skill outcomes returned to callers: `no-saved-login`, `saved-login-failed`, `login-limited` (with until), `needs-human`. On `limited`: reload once, re-run the signed-in check before giving up. Identifier-first pages handled on the same origin.
- Contract E (verbatim): Flow compile drops the whole saved-login segment: from the step that arrived on the filled page to the first step after the page left that origin (submit click included), noting the drop in review metadata.
- Values are never logged, written to disk, put in an env var, or passed through a macro or `browser_run_code_unsafe`. The relay holds a value only between the daemon answer and the socket write. Log lines name events, never names' values, emails or passwords.
- Fast Browser without rt behaves exactly as today: no token file or no socket means every request gets `unavailable`, and nothing else changes. The cloud path (`isCloudInvocation`) never gets a channel, so its runtime arguments and stdio stay identical.
- The launcher checks the daemon's answer too (defense in depth): a success whose `origin` is not exactly the request's `frameOrigin`, or whose `kind` is not the name's suffix, or a `password` answer for a `text` element, is replied as `refused: "mismatch"` and the value is dropped.
- Public repository: fixtures use neutral origins (`https://login.example.com`, `https://app.example.com`), never an employer name.
- No em dashes or en dashes anywhere (code, comments, skill text, commit messages).
- Clean-code comments: a comment states a constraint the code cannot show; no narration, no ticket or review references, no decision history.
- Every security test must fail when its protection is removed; each task's steps say which line to delete to watch it fail.
- Re-pinning uses `npm run pin-runtime`, never hand edits (repo `CLAUDE.md`). Never loosen `tests/unit/runtime-lock.test.mjs` or the `THIRD_PARTY_NOTICES.md` gate.
- The skill edit in Task 6 uses superpowers:writing-skills (RED baseline, then GREEN retest) and mattstack:process-digraphs for the graph.
- Suite baseline before any change: `npm test` green (repo `CLAUDE.md` says 1669/1669, 33 skipped). Record the actual count in Task 1 and compare against it after each task.

## Review Focus

1. A daemon that accepts the connection but never answers: the relay must reply `unavailable` before the runtime's 10 s wait expires (client timeout 8 s). Pinned in Task 2.
2. Two requests in flight at once, answered out of order: each reply must carry its own `id` and `name`. Pinned in Task 3.
3. Frames split across socket chunks, or several frames in one chunk: every complete line is handled exactly once. Pinned in Task 3.
4. An `api-token` file with a trailing newline, or an empty one: trimmed token used; empty means `unavailable`. Pinned in Task 2.
5. The runtime exits while a daemon call is still in flight: the late answer is dropped without an exception reaching the launcher process. Pinned in Task 3.

---

### Task 1: Pin the runtime that speaks the secrets channel

**Files:**
- Modify (by script only): `runtime-lock.json`, `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `THIRD_PARTY_NOTICES.md`, `tests/unit/runtime-lock.test.mjs`

**Interfaces:**
- Consumes: plan 1's published release `fast-browser-v<R>` on `m4ttheweric/playwright`, whose release notes say it adds `--secrets-channel-fd`.
- Produces: an installed-runtime lock whose runtime accepts `--secrets-channel-fd=<n>`. Plugin version `0.1.8`.

- [ ] **Step 1: Record the baseline**

Run: `npm test 2>&1 | tail -5`
Expected: all pass. Write the pass and skip counts into the task report.

- [ ] **Step 2: Find the runtime version plan 1 released**

Run: `gh release list --repo m4ttheweric/playwright --limit 5`
Pick the newest `fast-browser-v<R>` release, then confirm it is the channel release:
Run: `gh release view fast-browser-v<R> --repo m4ttheweric/playwright --json body --jq .body`
Expected: the notes mention `--secrets-channel-fd`. If no release mentions it, stop: plan 1 has not shipped.

- [ ] **Step 3: Pin it**

Run: `npm run pin-runtime -- --runtime <R> --plugin 0.1.8`
Expected: the script reports every file it wrote and exits 0. It derives each sha256 from the published release manifest and refuses to write when the published bytes do not hash to the manifest's values; do not work around a refusal.

- [ ] **Step 4: Reinstall the runtime locally and run the suite**

Run: `node bin/fast-browser.mjs setup --host both && npm test 2>&1 | tail -5`
Expected: same pass count as Step 1 (the pin script already updated the pinned literals).

- [ ] **Step 5: Confirm the pinned runtime knows the flag**

Run: `node ~/.fast-browser/runtime/<R>/fast-browser-mcp/cli.cjs --help | grep -c secrets-channel-fd`
Expected: `1`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "pin runtime <R> with the secrets channel; plugin 0.1.8"
```

---

### Task 2: rt daemon client for saved-login fills

**Files:**
- Create: `lib/rt/login-fill-client.mjs`
- Test: `tests/unit/login-fill-client.test.mjs`

**Interfaces:**
- Produces:
  - `rtPaths({ homeDir: string, env?: object }) -> { socketPath: string, tokenFile: string }`
  - `requestLoginFill({ name: string, frameOrigin: string, elementKind: 'password'|'text', homeDir: string, env?: object, pid?: number, timeoutMs?: number }) -> Promise<object>` resolving to the daemon's `data` object (`{origin, kind, value}` or `{refused, until?}`) or to `{ refused: 'unavailable' }`. Never rejects.
  - `LOGIN_FILL_TIMEOUT_MS = 8000`

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/login-fill-client.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { requestLoginFill, rtPaths } from '../../lib/rt/login-fill-client.mjs';

const ORIGIN = 'https://login.example.com';
const NAME = 'devlogin:login.example.com:password';

// Unix socket paths cap at 104 bytes on macOS, so these live under /tmp.
async function fakeHome(t, { token = 'tok-1\n' } = {}) {
  const homeDir = await mkdtemp('/tmp/fb-lfc-');
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const rtDir = path.join(homeDir, '.mattstack', 'rt');
  await mkdir(rtDir, { recursive: true });
  if (token !== null) await writeFile(path.join(rtDir, 'api-token'), token);
  return homeDir;
}

async function fakeDaemon(t, homeDir, handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body: JSON.parse(body) });
      handler(req, res, seen.at(-1).body);
    });
  });
  const { socketPath } = rtPaths({ homeDir, env: {} });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return seen;
}

function reply(res, envelope) {
  res.setHeader('content-type', 'application/json');
  res.end(typeof envelope === 'string' ? envelope : JSON.stringify(envelope));
}

const call = (homeDir, extra = {}) => requestLoginFill({
  name: NAME, frameOrigin: ORIGIN, elementKind: 'password', homeDir, env: {}, pid: 4242, ...extra,
});

test('posts the contract body to /logins:fill with the trimmed token and returns data', async (t) => {
  const homeDir = await fakeHome(t);
  const seen = await fakeDaemon(t, homeDir, (req, res) => reply(res, {
    ok: true, data: { origin: ORIGIN, kind: 'password', value: 'v' },
  }));
  const data = await call(homeDir);
  assert.deepEqual(data, { origin: ORIGIN, kind: 'password', value: 'v' });
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/logins:fill');
  assert.deepEqual(seen[0].body, {
    token: 'tok-1', client: 'fast-browser', pid: 4242, name: NAME, frameOrigin: ORIGIN, elementKind: 'password',
  });
});

test('passes a daemon refusal through unchanged', async (t) => {
  const homeDir = await fakeHome(t);
  await fakeDaemon(t, homeDir, (req, res) => reply(res, { ok: true, data: { refused: 'limited', until: 1234 } }));
  assert.deepEqual(await call(homeDir), { refused: 'limited', until: 1234 });
});

test('no token file, an empty token, ok:false, non-JSON, and no socket are all unavailable', async (t) => {
  const noToken = await fakeHome(t, { token: null });
  assert.deepEqual(await call(noToken), { refused: 'unavailable' });

  const emptyToken = await fakeHome(t, { token: '\n' });
  assert.deepEqual(await call(emptyToken), { refused: 'unavailable' });

  const noSocket = await fakeHome(t);
  assert.deepEqual(await call(noSocket), { refused: 'unavailable' });

  const notOk = await fakeHome(t);
  await fakeDaemon(t, notOk, (req, res) => reply(res, { ok: false, error: 'bad token' }));
  assert.deepEqual(await call(notOk), { refused: 'unavailable' });

  const garbage = await fakeHome(t);
  await fakeDaemon(t, garbage, (req, res) => reply(res, 'not json'));
  assert.deepEqual(await call(garbage), { refused: 'unavailable' });
});

test('a daemon that never answers resolves unavailable within the timeout', async (t) => {
  const homeDir = await fakeHome(t);
  await fakeDaemon(t, homeDir, () => {});
  const started = Date.now();
  assert.deepEqual(await call(homeDir, { timeoutMs: 200 }), { refused: 'unavailable' });
  assert.ok(Date.now() - started < 2000);
});

test('RT_DAEMON_SOCK overrides the socket path', () => {
  const { socketPath, tokenFile } = rtPaths({ homeDir: '/h', env: { RT_DAEMON_SOCK: '/tmp/x.sock' } });
  assert.equal(socketPath, '/tmp/x.sock');
  assert.equal(tokenFile, '/h/.mattstack/rt/api-token');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/login-fill-client.test.mjs`
Expected: FAIL, `Cannot find module '../../lib/rt/login-fill-client.mjs'`.

- [ ] **Step 3: Implement**

```js
// lib/rt/login-fill-client.mjs
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

export const LOGIN_FILL_TIMEOUT_MS = 8000;

const UNAVAILABLE = Object.freeze({ refused: 'unavailable' });

export function rtPaths({ homeDir, env = process.env }) {
  const rtDir = path.join(homeDir, '.mattstack', 'rt');
  return {
    socketPath: env.RT_DAEMON_SOCK || path.join(rtDir, 'rt.sock'),
    tokenFile: path.join(rtDir, 'api-token'),
  };
}

function postJson({ socketPath, body, timeoutMs }) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        socketPath,
        method: 'POST',
        path: '/logins:fill',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        response.on('error', () => resolve(null));
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
    request.end(payload);
  });
}

export async function requestLoginFill({
  name,
  frameOrigin,
  elementKind,
  homeDir,
  env = process.env,
  pid = process.pid,
  timeoutMs = LOGIN_FILL_TIMEOUT_MS,
}) {
  const { socketPath, tokenFile } = rtPaths({ homeDir, env });
  let token;
  try {
    token = (await readFile(tokenFile, 'utf8')).trim();
  } catch {
    return UNAVAILABLE;
  }
  if (!token) return UNAVAILABLE;

  const text = await postJson({
    socketPath,
    body: { token, client: 'fast-browser', pid, name, frameOrigin, elementKind },
    timeoutMs,
  });
  if (text === null) return UNAVAILABLE;
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    return UNAVAILABLE;
  }
  if (envelope?.ok !== true || typeof envelope.data !== 'object' || envelope.data === null) return UNAVAILABLE;
  return envelope.data;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/login-fill-client.test.mjs`
Expected: PASS (5 tests). Then delete the `if (!token) return UNAVAILABLE;` line, re-run, and confirm the empty-token assertion fails; restore it.

- [ ] **Step 5: Commit**

```bash
git add lib/rt/login-fill-client.mjs tests/unit/login-fill-client.test.mjs
git commit -m "add the rt daemon client for saved-login fills"
```

---

### Task 3: The secrets channel relay

**Files:**
- Create: `lib/runtime/secrets-channel.mjs`
- Test: `tests/unit/secrets-channel.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 2 directly; the relay takes `fetchFill` as a parameter so it is testable without a daemon.
- Produces:
  - `DEVLOGIN_NAME = /^devlogin:[a-z0-9][a-z0-9._-]*:(email|password)$/`
  - `replyTo(request: object, fetchFill: (req) => Promise<object>) -> Promise<object|null>`: the reply for one parsed request, or `null` when the request has no usable `id` (nothing can be replied to).
  - `attachSecretsChannel({ socket: net.Socket, fetchFill, log?: (line: string) => void }) -> void`

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/secrets-channel.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';

import { attachSecretsChannel, replyTo } from '../../lib/runtime/secrets-channel.mjs';

const ORIGIN = 'https://login.example.com';
const PASSWORD = 'devlogin:login.example.com:password';
const EMAIL = 'devlogin:login.example.com:email';
const CANARY = 'c@n&ary+ 100%';

const request = (overrides = {}) => ({
  id: 'r1', name: PASSWORD, frameOrigin: ORIGIN, elementKind: 'password', ...overrides,
});
const granted = (kind = 'password', origin = ORIGIN) => async () => ({ origin, kind, value: CANARY });

test('a granted fill replies with id, name, origin, kind and value', async () => {
  assert.deepEqual(await replyTo(request(), granted()), {
    id: 'r1', name: PASSWORD, origin: ORIGIN, kind: 'password', value: CANARY,
  });
});

test('daemon refusals pass through with until; unknown refusal words become unavailable', async () => {
  assert.deepEqual(
    await replyTo(request(), async () => ({ refused: 'limited', until: 99 })),
    { id: 'r1', name: PASSWORD, refused: 'limited', until: 99 },
  );
  assert.deepEqual(
    await replyTo(request(), async () => ({ refused: 'surprise' })),
    { id: 'r1', name: PASSWORD, refused: 'unavailable' },
  );
});

test('the launcher refuses a value whose origin, kind or element does not match the request', async () => {
  const wrongOrigin = await replyTo(request(), granted('password', 'https://login.example.com.evil.test'));
  assert.deepEqual(wrongOrigin, { id: 'r1', name: PASSWORD, refused: 'mismatch' });

  const wrongKind = await replyTo(request(), granted('email'));
  assert.deepEqual(wrongKind, { id: 'r1', name: PASSWORD, refused: 'mismatch' });

  const passwordIntoText = await replyTo(request({ elementKind: 'text' }), granted('password'));
  assert.deepEqual(passwordIntoText, { id: 'r1', name: PASSWORD, refused: 'mismatch' });
});

test('a non-devlogin name is unknown and never reaches the daemon', async () => {
  let calls = 0;
  const reply = await replyTo(request({ name: 'APP_PASSWORD' }), async () => { calls += 1; return {}; });
  assert.deepEqual(reply, { id: 'r1', name: 'APP_PASSWORD', refused: 'unknown' });
  assert.equal(calls, 0);
});

test('malformed requests: no id is dropped, bad fields are unavailable, a throwing fetch is unavailable', async () => {
  assert.equal(await replyTo({ name: PASSWORD }, granted()), null);
  assert.deepEqual(
    await replyTo(request({ elementKind: 'checkbox' }), granted()),
    { id: 'r1', name: PASSWORD, refused: 'unavailable' },
  );
  assert.deepEqual(
    await replyTo(request({ frameOrigin: 'https://login.example.com/path' }), granted()),
    { id: 'r1', name: PASSWORD, refused: 'unavailable' },
  );
  assert.deepEqual(
    await replyTo(request(), async () => { throw new Error('boom'); }),
    { id: 'r1', name: PASSWORD, refused: 'unavailable' },
  );
});

// A real unix socket pair: `attachSecretsChannel` gets the server side, the
// test plays the runtime on the client side.
async function channelPair(t, { fetchFill, log }) {
  const dir = await mkdtemp('/tmp/fb-sc-');
  const socketPath = path.join(dir, 's.sock');
  const accepted = new Promise((resolve) => {
    const server = net.createServer((socket) => {
      attachSecretsChannel({ socket, fetchFill, log });
      resolve(socket);
    });
    server.listen(socketPath);
    t.after(async () => {
      server.close();
      await rm(dir, { recursive: true, force: true });
    });
  });
  const runtime = net.connect(socketPath);
  const relaySide = await accepted;
  const replies = [];
  let buffer = '';
  runtime.setEncoding('utf8');
  runtime.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      replies.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  t.after(() => runtime.destroy());
  return { runtime, relaySide, replies };
}

const until = async (predicate) => {
  for (let i = 0; i < 200 && !predicate(); i += 1) await new Promise((r) => setTimeout(r, 10));
  assert.ok(predicate(), 'condition not reached in time');
};

test('frames split across chunks and several frames in one chunk are each answered once', async (t) => {
  const { runtime, replies } = await channelPair(t, { fetchFill: granted('email') });
  const a = JSON.stringify(request({ id: 'a', name: EMAIL, elementKind: 'text' }));
  const b = JSON.stringify(request({ id: 'b', name: EMAIL, elementKind: 'text' }));
  runtime.write(a.slice(0, 10));
  runtime.write(`${a.slice(10)}\n${b}\n`);
  await until(() => replies.length === 2);
  assert.deepEqual(replies.map((r) => r.id).sort(), ['a', 'b']);
});

test('concurrent requests answered out of order keep their own id and name', async (t) => {
  const fetchFill = async (req) => {
    if (req.name === PASSWORD) await new Promise((r) => setTimeout(r, 100));
    return { origin: ORIGIN, kind: req.name.endsWith(':email') ? 'email' : 'password', value: `${req.name}-v` };
  };
  const { runtime, replies } = await channelPair(t, { fetchFill });
  runtime.write(`${JSON.stringify(request({ id: 'slow' }))}\n`);
  runtime.write(`${JSON.stringify(request({ id: 'fast', name: EMAIL, elementKind: 'text' }))}\n`);
  await until(() => replies.length === 2);
  assert.equal(replies[0].id, 'fast');
  assert.equal(replies[0].name, EMAIL);
  assert.equal(replies[1].id, 'slow');
  assert.equal(replies[1].name, PASSWORD);
});

test('a runtime that exits mid-call drops the late answer without throwing', async (t) => {
  let release;
  const fetchFill = () => new Promise((resolve) => { release = resolve; });
  const { runtime, relaySide } = await channelPair(t, { fetchFill });
  runtime.write(`${JSON.stringify(request())}\n`);
  await until(() => typeof release === 'function');
  runtime.destroy();
  await until(() => relaySide.destroyed);
  release({ origin: ORIGIN, kind: 'password', value: CANARY });
  await new Promise((r) => setTimeout(r, 50));
});

test('no log line ever carries a value, and unparseable frames are logged without their content', async (t) => {
  const lines = [];
  const { runtime, replies } = await channelPair(t, { fetchFill: granted(), log: (line) => lines.push(line) });
  runtime.write(`not json ${CANARY}\n`);
  runtime.write(`${JSON.stringify(request())}\n`);
  await until(() => replies.length === 1);
  assert.ok(lines.length >= 1);
  for (const line of lines) assert.ok(!line.includes(CANARY), `log leaked the canary: ${line}`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/secrets-channel.test.mjs`
Expected: FAIL, `Cannot find module '../../lib/runtime/secrets-channel.mjs'`.

- [ ] **Step 3: Implement**

```js
// lib/runtime/secrets-channel.mjs
export const DEVLOGIN_NAME = /^devlogin:[a-z0-9][a-z0-9._-]*:(email|password)$/;

const ELEMENT_KINDS = new Set(['password', 'text']);
const DAEMON_REFUSALS = new Set(['unknown', 'mismatch', 'limited']);
// A request line is a few hundred bytes; anything this long without a
// newline is not a request and must not grow the buffer without bound.
const MAX_PENDING_BYTES = 16 * 1024;

function refusal(id, name, refused, until) {
  const reply = { id, name, refused };
  if (Number.isFinite(until)) reply.until = until;
  return reply;
}

function isOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

export async function replyTo(request, fetchFill) {
  const id = request?.id;
  if ((typeof id !== 'string' || id === '') && !Number.isInteger(id)) return null;
  const { name, frameOrigin, elementKind } = request;
  if (typeof name !== 'string' || !DEVLOGIN_NAME.test(name)) return refusal(id, name, 'unknown');
  if (!ELEMENT_KINDS.has(elementKind) || !isOrigin(frameOrigin)) return refusal(id, name, 'unavailable');

  let answer;
  try {
    answer = await fetchFill({ name, frameOrigin, elementKind });
  } catch {
    return refusal(id, name, 'unavailable');
  }
  if (typeof answer?.refused === 'string') {
    return DAEMON_REFUSALS.has(answer.refused)
      ? refusal(id, name, answer.refused, answer.until)
      : refusal(id, name, 'unavailable');
  }
  const expectedKind = DEVLOGIN_NAME.exec(name)[1];
  if (typeof answer?.value !== 'string') return refusal(id, name, 'unavailable');
  if (
    answer.origin !== frameOrigin
    || answer.kind !== expectedKind
    || (answer.kind === 'password' && elementKind !== 'password')
  ) {
    return refusal(id, name, 'mismatch');
  }
  return { id, name, origin: answer.origin, kind: answer.kind, value: answer.value };
}

export function attachSecretsChannel({ socket, fetchFill, log = () => {} }) {
  let pending = '';
  socket.setEncoding('utf8');
  socket.on('error', () => {});

  const handleLine = async (line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      log('fast-browser-mcp: secrets channel ignored an unparseable frame');
      return;
    }
    const reply = await replyTo(request, fetchFill);
    if (reply === null) {
      log('fast-browser-mcp: secrets channel ignored a frame with no id');
      return;
    }
    if (socket.destroyed || !socket.writable) return;
    socket.write(`${JSON.stringify(reply)}\n`);
  };

  socket.on('data', (chunk) => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.trim() !== '') void handleLine(line);
    }
    if (pending.length > MAX_PENDING_BYTES) {
      pending = '';
      log('fast-browser-mcp: secrets channel dropped an oversized frame');
    }
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/secrets-channel.test.mjs`
Expected: PASS (9 tests). Then replace the `answer.origin !== frameOrigin` condition with `false`, re-run, and confirm the wrong-origin assertion fails; restore it. Repeat with `(answer.kind === 'password' && elementKind !== 'password')` removed.

- [ ] **Step 5: Commit**

```bash
git add lib/runtime/secrets-channel.mjs tests/unit/secrets-channel.test.mjs
git commit -m "add the secrets channel relay between runtime and rt daemon"
```

---

### Task 4: Wire the channel into the local launch path

**Files:**
- Modify: `lib/runtime/launch.mjs` (`launchRuntime`, the spawn call around lines 165-171)
- Modify: `lib/runtime/entry.mjs` (local branch of `startRuntime`)
- Modify: `tests/unit/runtime-lock.test.mjs` (new tests only; existing ones stay byte-identical)
- Modify: `tests/unit/entry.test.mjs` (new tests)
- Create: `tests/integration/secrets-channel.test.mjs`

**Interfaces:**
- Consumes: `attachSecretsChannel` (Task 3), `requestLoginFill` (Task 2).
- Produces:
  - `SECRETS_CHANNEL_FD = 3` exported from `lib/runtime/launch.mjs`
  - `launchRuntime({ ..., secretsChannel?: { attach(socket: net.Socket): void } | null })`: when given, adds `--secrets-channel-fd=3` after the `runtimeArgs` list, spawns with `stdio: ['inherit', 'inherit', 'inherit', 'pipe']`, and calls `secretsChannel.attach(child.stdio[3])`. When absent, spawn arguments and stdio are exactly as today.
  - `startRuntime` passes a `secretsChannel` on the local path only; `deps.secretsChannel` overrides it in tests.

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/runtime-lock.test.mjs` (it already defines `installedLauncher`, `launcherConfig`, `exitingSpawn`, `runtimeArgs`):

```js
test('a secrets channel adds the fd flag, a fourth pipe slot, and attaches the socket', async () => {
  const { paths, lock, cli } = await installedLauncher();
  const captured = [];
  const socket = { fake: true };
  const attached = [];
  const spawn = (command, args, options) => {
    captured.push({ command, args, options });
    const child = new EventEmitter();
    child.stdio = [null, null, null, socket];
    process.nextTick(() => child.emit('exit', 0, null));
    return child;
  };
  await launchRuntime({
    config: launcherConfig('safe', 'manual'),
    paths,
    lock,
    spawn,
    secretsChannel: { attach: (s) => attached.push(s) },
  });
  assert.deepEqual(captured[0].args, [
    cli,
    ...runtimeArgs({ config: launcherConfig('safe', 'manual'), paths, lock }),
    '--secrets-channel-fd=3',
  ]);
  assert.deepEqual(captured[0].options.stdio, ['inherit', 'inherit', 'inherit', 'pipe']);
  assert.deepEqual(attached, [socket]);
});

test('without a secrets channel the spawn is exactly as before', async () => {
  const { paths, lock, cli } = await installedLauncher();
  const captured = [];
  await launchRuntime({
    config: launcherConfig('safe', 'manual'),
    paths,
    lock,
    spawn: exitingSpawn(0, captured),
  });
  assert.deepEqual(captured[0].args, [cli, ...runtimeArgs({ config: launcherConfig('safe', 'manual'), paths, lock })]);
  assert.equal(captured[0].options.stdio, 'inherit');
});
```

Append to `tests/unit/entry.test.mjs`:

```js
test('the local path hands launchRuntime a secrets channel', async () => {
  let channel;
  await startRuntime({
    env: {},
    paths: { ...paths, homeDir: '/synthetic-home' },
    lock,
    deps: deps({ launchRuntime: async (args) => { channel = args.secretsChannel; return 0; } }),
  });
  assert.equal(typeof channel?.attach, 'function');
});

test('the cloud path never gets a secrets channel', async () => {
  let sawKey = true;
  await startRuntime({
    env: CLOUD_ENV,
    paths,
    lock,
    deps: deps({ launchRuntime: async (args) => { sawKey = 'secretsChannel' in args; return 0; } }),
  });
  assert.equal(sawKey, false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/unit/runtime-lock.test.mjs tests/unit/entry.test.mjs`
Expected: FAIL on the two channel tests (args lack the flag; `channel` undefined). The "exactly as before" and cloud tests pass already.

- [ ] **Step 3: Implement in `lib/runtime/launch.mjs`**

Add the export near the top:

```js
export const SECRETS_CHANNEL_FD = 3;
```

Change the signature and the spawn block of `launchRuntime`:

```js
export async function launchRuntime({
  config,
  paths,
  lock,
  readToken = async () => null,
  spawn = nodeSpawn,
  secretsChannel = null,
}) {
  // ...unchanged validation and token handling...

  const args = [runtimeCli, ...runtimeArgs({ config, paths, lock })];
  if (secretsChannel) args.push(`--secrets-channel-fd=${SECRETS_CHANNEL_FD}`);

  let child;
  try {
    child = spawn(process.execPath, args, {
      stdio: secretsChannel ? ['inherit', 'inherit', 'inherit', 'pipe'] : 'inherit',
      shell: false,
      env,
    });
  } catch (error) {
    throw doctorError(`unable to start fast-browser runtime (${error.code ?? 'spawn failed'})`);
  }
  const channelSocket = child.stdio?.[SECRETS_CHANNEL_FD];
  if (secretsChannel && channelSocket) secretsChannel.attach(channelSocket);

  // ...unchanged exit/error promise...
}
```

- [ ] **Step 4: Implement in `lib/runtime/entry.mjs`**

Add imports:

```js
import os from 'node:os';

import { requestLoginFill } from '../rt/login-fill-client.mjs';
import { attachSecretsChannel } from './secrets-channel.mjs';
```

In `startRuntime`, after `const warn = ...`, add:

```js
  const makeSecretsChannel = deps.secretsChannel ?? (() => ({
    attach: (socket) => attachSecretsChannel({
      socket,
      fetchFill: (request) => requestLoginFill({
        ...request,
        homeDir: paths.homeDir ?? os.homedir(),
        env,
      }),
      log: warn,
    }),
  }));
```

and change the local launch line (the cloud `return launchRuntime({ config, paths, lock })` stays exactly as is):

```js
  const code = await launchRuntime({ config, paths, lock, readToken, secretsChannel: makeSecretsChannel() });
```

In `tests/unit/entry.test.mjs` the `deps()` helper does not set `secretsChannel`, so the default factory runs; that is what the new local-path test checks.

- [ ] **Step 5: Run the unit tests**

Run: `node --test tests/unit/runtime-lock.test.mjs tests/unit/entry.test.mjs`
Expected: PASS.

- [ ] **Step 6: Write the failing integration test**

This drives the real launcher with a fake runtime (written as the installed `cli.cjs`) and a fake rt daemon, and checks the canary never lands in the fake home.

```js
// tests/integration/secrets-channel.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { buildContentManifestDigest } from '../../lib/core/content-manifest.mjs';
import { launchRuntime } from '../../lib/runtime/launch.mjs';
import { attachSecretsChannel } from '../../lib/runtime/secrets-channel.mjs';
import { requestLoginFill } from '../../lib/rt/login-fill-client.mjs';

const ORIGIN = 'https://login.example.com';
const CANARY = 'c@n&ary+ 100%';

const FAKE_RUNTIME = `
const net = require('node:net');
const fs = require('node:fs');
const out = process.env.FB_FAKE_RUNTIME_OUT;
const flag = process.argv.find((a) => a.startsWith('--secrets-channel-fd='));
if (!flag) { fs.writeFileSync(out, JSON.stringify({ noChannel: true })); process.exit(0); }
const socket = new net.Socket({ fd: Number(flag.split('=')[1]), readable: true, writable: true });
const requests = JSON.parse(process.env.FB_FAKE_RUNTIME_REQUESTS);
const replies = [];
let buffer = '';
socket.setEncoding('utf8');
socket.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\\n')) !== -1) {
    replies.push(JSON.parse(buffer.slice(0, i)));
    buffer = buffer.slice(i + 1);
  }
  if (replies.length === requests.length) {
    fs.writeFileSync(out, JSON.stringify({ replies }));
    process.exit(0);
  }
});
for (const r of requests) socket.write(JSON.stringify(r) + '\\n');
`;

function fixtureLock() {
  return {
    schemaVersion: 1,
    productVersion: '0.1.0-alpha.1',
    sourceCommit: '0123456789abcdef',
    protocolVersion: 2,
    runtime: { url: 'http://127.0.0.1:1/r.tgz', file: 'r.tgz', sha256: 'a'.repeat(64), node: '>=20' },
    extension: {
      url: 'http://127.0.0.1:1/e.zip', file: 'e.zip', sha256: 'b'.repeat(64),
      id: 'abcdefghijklmnopabcdefghijklmnop', version: '0.2.1',
    },
  };
}

function identity(lock) {
  return {
    schemaVersion: lock.schemaVersion,
    productVersion: lock.productVersion,
    sourceCommit: lock.sourceCommit,
    protocolVersion: lock.protocolVersion,
    runtime: { file: lock.runtime.file, sha256: lock.runtime.sha256, node: lock.runtime.node },
    extension: {
      file: lock.extension.file, sha256: lock.extension.sha256,
      id: lock.extension.id, version: lock.extension.version,
    },
  };
}

async function setup(t) {
  const root = await mkdtemp('/tmp/fb-sci-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const dataDir = path.join(homeDir, '.fast-browser');
  const paths = { homeDir, dataDir, runtimeDir: path.join(dataDir, 'runtime'), outputDir: path.join(dataDir, 'output') };
  const lock = fixtureLock();
  const cli = path.join(paths.runtimeDir, lock.productVersion, 'fast-browser-mcp', 'cli.cjs');
  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(cli, FAKE_RUNTIME);
  const contentDigest = await buildContentManifestDigest(path.dirname(cli));
  await writeFile(
    path.join(paths.runtimeDir, lock.productVersion, 'installed.json'),
    JSON.stringify({ schemaVersion: 1, lock: identity(lock), contentDigest }),
  );
  const rtDir = path.join(homeDir, '.mattstack', 'rt');
  await mkdir(rtDir, { recursive: true });
  await writeFile(path.join(rtDir, 'api-token'), 'tok-1\n');

  const seen = [];
  const daemon = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const payload = JSON.parse(body);
      seen.push(payload);
      const data = payload.frameOrigin === ORIGIN
        ? { origin: ORIGIN, kind: payload.name.endsWith(':email') ? 'email' : 'password', value: CANARY }
        : { refused: 'mismatch' };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, data }));
    });
  });
  const socketPath = path.join(rtDir, 'rt.sock');
  await new Promise((resolve) => daemon.listen(socketPath, resolve));
  t.after(() => new Promise((resolve) => daemon.close(resolve)));

  const out = path.join(root, 'runtime-out.json');
  return { root, homeDir, paths, lock, out, seen };
}

async function filesUnder(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) found.push(path.join(entry.parentPath ?? entry.path, entry.name));
  }
  return found;
}

test('the real launcher relays runtime requests to the daemon and back, leaving no value on disk', async (t) => {
  const { homeDir, paths, lock, out, seen } = await setup(t);
  const requests = [
    { id: 'e', name: 'devlogin:login.example.com:email', frameOrigin: ORIGIN, elementKind: 'text' },
    { id: 'p', name: 'devlogin:login.example.com:password', frameOrigin: ORIGIN, elementKind: 'password' },
    { id: 'x', name: 'devlogin:login.example.com:password', frameOrigin: 'https://login.example.com.evil.test', elementKind: 'password' },
  ];
  const saved = { ...process.env };
  process.env.FB_FAKE_RUNTIME_OUT = out;
  process.env.FB_FAKE_RUNTIME_REQUESTS = JSON.stringify(requests);
  t.after(() => { process.env = saved; });
  const logged = [];
  const secretsChannel = {
    attach: (socket) => attachSecretsChannel({
      socket,
      fetchFill: (request) => requestLoginFill({ ...request, homeDir, env: {} }),
      log: (line) => logged.push(line),
    }),
  };

  const code = await launchRuntime({
    config: { profile: 'safe', connection: { mode: 'manual' }, sessions: { enabled: false } },
    paths,
    lock,
    secretsChannel,
  });

  assert.equal(code, 0);
  const { replies } = JSON.parse(await readFile(out, 'utf8'));
  const byId = Object.fromEntries(replies.map((r) => [r.id, r]));
  assert.equal(byId.e.value, CANARY);
  assert.equal(byId.p.value, CANARY);
  assert.equal(byId.x.refused, 'mismatch');
  assert.equal(seen.length, 3);
  assert.ok(seen.every((payload) => payload.token === 'tok-1' && payload.client === 'fast-browser'));
  for (const file of await filesUnder(homeDir)) {
    if (file.endsWith('rt.sock')) continue;
    assert.ok(!(await readFile(file, 'utf8')).includes(CANARY), `value written to ${file}`);
  }
  for (const line of logged) assert.ok(!line.includes(CANARY));
});

test('with no rt token every request is unavailable and the runtime still runs', async (t) => {
  const { homeDir, paths, lock, out } = await setup(t);
  await rm(path.join(homeDir, '.mattstack', 'rt', 'api-token'));
  const saved = { ...process.env };
  process.env.FB_FAKE_RUNTIME_OUT = out;
  process.env.FB_FAKE_RUNTIME_REQUESTS = JSON.stringify([
    { id: 'p', name: 'devlogin:login.example.com:password', frameOrigin: ORIGIN, elementKind: 'password' },
  ]);
  t.after(() => { process.env = saved; });
  const code = await launchRuntime({
    config: { profile: 'safe', connection: { mode: 'manual' }, sessions: { enabled: false } },
    paths,
    lock,
    secretsChannel: {
      attach: (socket) => attachSecretsChannel({
        socket, fetchFill: (request) => requestLoginFill({ ...request, homeDir, env: {} }),
      }),
    },
  });
  assert.equal(code, 0);
  const { replies } = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual(replies, [{ id: 'p', name: 'devlogin:login.example.com:password', refused: 'unavailable' }]);
});
```

- [ ] **Step 7: Run it**

Run: `node --test tests/integration/secrets-channel.test.mjs`
Expected: PASS (2 tests). Then remove the `if (secretsChannel && channelSocket) secretsChannel.attach(channelSocket);` line in `launch.mjs`, re-run, and confirm the first test fails (the fake runtime never gets replies and the test times out or the out file is missing); restore it.

- [ ] **Step 8: Run the whole suite**

Run: `npm test 2>&1 | tail -5`
Expected: baseline count plus the new tests, all green.

- [ ] **Step 9: Commit**

```bash
git add lib/runtime/launch.mjs lib/runtime/entry.mjs tests/unit/runtime-lock.test.mjs tests/unit/entry.test.mjs tests/integration/secrets-channel.test.mjs
git commit -m "wire the secrets channel into the local launch path"
```

---

### Task 5: Flow compile drops saved-login segments

**Files:**
- Modify: `lib/flows/compile.mjs` (`compileSession`, plus a new helper above it)
- Test: `tests/unit/flows-compile.test.mjs` (new tests at the end; reuse its `record`, `traceTarget` and `meta` helpers)

**Interfaces:**
- Consumes: `DEVLOGIN_NAME` from `lib/runtime/secrets-channel.mjs` (Task 3).
- Produces: `compileSession` report entries `{ reason: 'saved-login', seqRange: [first, last] }` in `report.skipped` for every dropped login segment; the records on either side compile as independent spans.

- [ ] **Step 1: Write the failing tests**

```js
// appended to tests/unit/flows-compile.test.mjs
const APP = 'https://app.example.com';
const LOGIN = 'https://login.example.com';

function savedLoginTrace({ identifierFirst = false, endsOnLogin = false } = {}) {
  const records = [
    record({ seq: 1, tool: 'browser_navigate', params: { url: `${APP}/cases` }, urlBefore: 'about:blank', urlAfter: `${APP}/cases` }),
    record({ seq: 2, tool: 'browser_click', targets: [traceTarget({ name: 'Open case' })], urlBefore: `${APP}/cases`, urlAfter: `${APP}/cases/1` }),
    record({ seq: 3, tool: 'browser_click', targets: [traceTarget({ name: 'Documents' })], urlBefore: `${APP}/cases/1`, urlAfter: `${LOGIN}/u/login` }),
    record({
      seq: 4,
      tool: 'browser_fill_form',
      targets: [traceTarget({ name: 'Email', role: 'textbox' })].concat(identifierFirst ? [] : [traceTarget({ name: 'Password', role: 'textbox' })]),
      params: {
        fields: [{ name: 'Email', type: 'textbox', value: 'devlogin:login.example.com:email' }].concat(
          identifierFirst ? [] : [{ name: 'Password', type: 'textbox', value: 'devlogin:login.example.com:password' }],
        ),
      },
      urlBefore: `${LOGIN}/u/login`,
      urlAfter: `${LOGIN}/u/login`,
    }),
  ];
  let seq = 5;
  if (identifierFirst) {
    records.push(record({ seq: seq++, tool: 'browser_click', targets: [traceTarget({ name: 'Continue' })], urlBefore: `${LOGIN}/u/login`, urlAfter: `${LOGIN}/u/login/password` }));
    records.push(record({
      seq: seq++,
      tool: 'browser_type',
      targets: [traceTarget({ name: 'Password', role: 'textbox' })],
      params: { text: 'devlogin:login.example.com:password' },
      urlBefore: `${LOGIN}/u/login/password`,
      urlAfter: `${LOGIN}/u/login/password`,
    }));
  }
  if (endsOnLogin) return records;
  records.push(record({ seq: seq++, tool: 'browser_click', targets: [traceTarget({ name: 'Continue' })], urlBefore: `${LOGIN}/u/login`, urlAfter: `${APP}/cases/1/documents` }));
  records.push(record({ seq: seq++, tool: 'browser_click', targets: [traceTarget({ name: 'Upload' })], urlBefore: `${APP}/cases/1/documents`, urlAfter: `${APP}/cases/1/documents` }));
  records.push(record({ seq: seq++, tool: 'browser_click', targets: [traceTarget({ name: 'Save' })], urlBefore: `${APP}/cases/1/documents`, urlAfter: `${APP}/cases/1/documents` }));
  return records;
}

function stepValues(flows) {
  return flows.flatMap((flow) => flow.steps).map((step) => JSON.stringify(step));
}

test('a saved-login segment is dropped whole, from the arriving click through the submit', () => {
  const result = compileSession({ records: savedLoginTrace(), meta, traceDir: '/t' });
  assert.deepEqual(
    result.report.skipped.filter((s) => s.reason === 'saved-login'),
    [{ reason: 'saved-login', seqRange: [3, 5] }],
  );
  for (const step of stepValues(result.flows)) {
    assert.ok(!step.includes('devlogin:'), `a devlogin placeholder reached a flow: ${step}`);
    assert.ok(!step.includes('login.example.com'), `a login-page step reached a flow: ${step}`);
  }
});

test('identifier-first logins drop both screens and the submit', () => {
  const result = compileSession({ records: savedLoginTrace({ identifierFirst: true }), meta, traceDir: '/t' });
  assert.deepEqual(
    result.report.skipped.filter((s) => s.reason === 'saved-login'),
    [{ reason: 'saved-login', seqRange: [3, 7] }],
  );
  for (const step of stepValues(result.flows)) assert.ok(!step.includes('devlogin:'));
});

test('a trace that ends on the login page drops to the end', () => {
  const result = compileSession({ records: savedLoginTrace({ endsOnLogin: true }), meta, traceDir: '/t' });
  assert.deepEqual(
    result.report.skipped.filter((s) => s.reason === 'saved-login'),
    [{ reason: 'saved-login', seqRange: [3, 4] }],
  );
});

test('a bare-name secrets login (no devlogin prefix) compiles as before', () => {
  const records = savedLoginTrace().map((r) => (r.tool === 'browser_fill_form'
    ? { ...r, params: { fields: r.params.fields.map((f) => ({ ...f, value: f.value.replace(/^devlogin:login\.example\.com:/, 'APP_').toUpperCase() })) } }
    : r));
  const result = compileSession({ records, meta, traceDir: '/t' });
  assert.equal(result.report.skipped.filter((s) => s.reason === 'saved-login').length, 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/unit/flows-compile.test.mjs`
Expected: the three saved-login tests FAIL (no `saved-login` skip entries; placeholder steps present). The bare-name test passes.

- [ ] **Step 3: Implement**

Add the import at the top of `lib/flows/compile.mjs`:

```js
import { DEVLOGIN_NAME } from '../runtime/secrets-channel.mjs';
```

Add above `compileSession`:

```js
function fillsSavedLogin(record) {
  if (record.tool === 'browser_type') return DEVLOGIN_NAME.test(record.params?.text ?? '');
  if (record.tool === 'browser_fill_form') {
    const fields = Array.isArray(record.params?.fields) ? record.params.fields : [];
    return fields.some((field) => typeof field?.value === 'string' && DEVLOGIN_NAME.test(field.value));
  }
  return false;
}

// Splits records into spans, cutting out every saved-login segment: from the
// record that arrived on the login origin through the record that left it.
// The submit click must go with the fill, or a replay submits an empty login.
function cutSavedLoginSegments(records) {
  const spans = [];
  let cursor = 0;
  let index = 0;
  while (index < records.length) {
    if (!fillsSavedLogin(records[index])) {
      index += 1;
      continue;
    }
    const loginOrigin = safeOrigin(records[index].urlBefore) ?? safeOrigin(records[index].urlAfter);
    let start = index;
    while (start > cursor && safeOrigin(records[start - 1].urlAfter) === loginOrigin) start -= 1;
    let end = index;
    while (end + 1 < records.length && safeOrigin(records[end].urlAfter) === loginOrigin) end += 1;
    spans.push({ type: 'records', records: records.slice(cursor, start) });
    spans.push({ type: 'saved-login', seqRange: toSeqRange(records.slice(start, end + 1)) });
    cursor = end + 1;
    index = end + 1;
  }
  spans.push({ type: 'records', records: records.slice(cursor) });
  return spans;
}
```

Replace the body of `compileSession` from `const units = splitIntoUnits(allRecords);` through the end of the loop with:

```js
  const flows = [];
  const skipped = [];
  let segmentIndex = 0;

  for (const span of cutSavedLoginSegments(allRecords)) {
    if (span.type === 'saved-login') {
      skipped.push({ reason: 'saved-login', seqRange: span.seqRange });
      continue;
    }
    for (const unit of splitIntoUnits(span.records)) {
      if (unit.type === 'error') {
        skipped.push({ reason: 'error-truncated', seqRange: [toSeqValue(unit.record.seq), toSeqValue(unit.record.seq)] });
        continue;
      }
      const outcome = compileSegment(
        unit.records,
        { meta, fallbackOrigin: origin, traceDir, now, segmentIndex },
        unit.truncatedByError,
      );
      if (outcome.flow) flows.push(outcome.flow);
      else skipped.push(outcome.skip);
      segmentIndex += 1;
    }
  }
```

The `end` loop stops at the first record whose `urlAfter` leaves the login origin and includes it, which is the submit click. A trace ending on the login page runs `end` to the last record.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/unit/flows-compile.test.mjs`
Expected: PASS, including every pre-existing golden test unchanged. Then change the `end` loop's condition to `false` (so only the fill record is cut), re-run, and confirm the first saved-login test fails on the seqRange and the submit click; restore it.

- [ ] **Step 5: Commit**

```bash
git add lib/flows/compile.mjs tests/unit/flows-compile.test.mjs
git commit -m "flows: never compile a saved-login segment"
```

---

### Task 6: The fast-browsing saved-login procedure

**Files:**
- Modify: `skills/fast-browsing/SKILL.md` (the graph around lines 67-74 and 191-209, the `### Secrets file and operator-named secrets for this site?` and `### Ask the human to log in in Chrome` sections, plus four new sections)
- Test: `tests/unit/skills.test.mjs` (one new pin)

**Interfaces:**
- Consumes: contract C (`rt logins list --json` shape and names), contract D (outcomes), the runtime refusal words from contract A.
- Produces: the four caller outcomes, named exactly `no-saved-login`, `saved-login-failed`, `login-limited`, `needs-human`, which plan 4's evidence skill maps to gates.

REQUIRED SUB-SKILLS: superpowers:writing-skills (run the RED baseline before editing and the GREEN retest after), mattstack:process-digraphs (the graph edit).

- [ ] **Step 1: RED baseline**

Dispatch a fresh subagent with the current `skills/fast-browsing/SKILL.md` loaded and this scenario, and record its answer verbatim in the task report:

> You are driving a browser for an evidence capture. After clicking into a case, the page is now `https://login.example.com/u/login` with an email field, a password field and a Continue button. `rt logins list --json` prints `[{"origin":"https://login.example.com","email":"dev@example.com","fields":{"email":"devlogin:login.example.com:email","password":"devlogin:login.example.com:password"}}]`. What exactly do you do next? List the tool calls.

Expected baseline: it refuses to fill and asks the human to log in (the current STOP rule), or it guesses at secret names. Either shows the gap.

- [ ] **Step 2: Write the failing pin**

```js
// appended to tests/unit/skills.test.mjs
test('fast-browsing runs a saved dev login by devlogin names only and returns the contract outcomes', async () => {
  const text = await readFile(path.join(pluginRoot, 'skills/fast-browsing/SKILL.md'), 'utf8');
  assert.match(text, /`rt logins list --json`/);
  assert.match(text, /`devlogin:`/);
  for (const outcome of ['no-saved-login', 'saved-login-failed', 'login-limited', 'needs-human']) {
    assert.match(text, new RegExp(`\`${outcome}\``), `missing outcome ${outcome}`);
  }
  assert.match(text, /"Saved login for this origin\?" \[shape=diamond\]/);
  assert.match(text, /reload once/);
  assert.doesNotMatch(text, /\u2014|\u2013/);
});
```

Run: `node --test tests/unit/skills.test.mjs`
Expected: FAIL on the first assertion.

- [ ] **Step 3: Edit the graph**

In the node declarations (after `"Login screens this task = 2?" [shape=diamond];`), add:

```dot
    "Saved login for this origin?" [shape=diamond];
    "STOP: never type a credential yourself; only devlogin: names" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Page shows 2FA, a captcha or an account chooser?" [shape=diamond];
    "browser_fill_form {fields: devlogin: names for the fields shown}" [shape=plaintext];
    "Fill answer?" [shape=diamond];
    "browser_click {target: <submit>}: the saved login" [shape=plaintext];
    "A password screen on the same origin, after an email-only fill?" [shape=diamond];
    "browser_find {text: <what only a signed-in page shows>}: after the saved login" [shape=plaintext];
    "Left the login origin and signed in?" [shape=diamond];
    "browser_navigate {url: <the page's own url>}: reload once" [shape=plaintext];
    "browser_find {text: <what only a signed-in page shows>}: after the reload" [shape=plaintext];
    "Signed in after the reload?" [shape=diamond];
    "Hand back the login outcome" [shape=box];
```

Replace the edge `"Login screens this task = 2?" -> "Secrets file and operator-named secrets for this site?" [label="no"];` with:

```dot
    "Login screens this task = 2?" -> "Saved login for this origin?" [label="no"];
    "Saved login for this origin?" -> "Secrets file and operator-named secrets for this site?" [label="no: rt missing, or the origin is not listed"];
    "Saved login for this origin?" -> "Page shows 2FA, a captcha or an account chooser?" [label="yes"];
    "Saved login for this origin?" -> "STOP: never type a credential yourself; only devlogin: names" [label="tempted to type a value, or a name rt logins list did not print"];
    "STOP: never type a credential yourself; only devlogin: names" -> "Ask the human to log in in Chrome";
    "Page shows 2FA, a captcha or an account chooser?" -> "Ask the human to log in in Chrome" [label="yes: needs-human"];
    "Page shows 2FA, a captcha or an account chooser?" -> "browser_fill_form {fields: devlogin: names for the fields shown}" [label="no"];
    "browser_fill_form {fields: devlogin: names for the fields shown}" -> "Fill answer?";
    "Fill answer?" -> "browser_click {target: <submit>}: the saved login" [label="filled"];
    "Fill answer?" -> "browser_navigate {url: <the page's own url>}: reload once" [label="refused: limited"];
    "Fill answer?" -> "Ask the human to log in in Chrome" [label="refused: unknown or unavailable: no-saved-login"];
    "Fill answer?" -> "Ask the human to log in in Chrome" [label="refused: mismatch: needs-human"];
    "browser_click {target: <submit>}: the saved login" -> "A password screen on the same origin, after an email-only fill?";
    "A password screen on the same origin, after an email-only fill?" -> "browser_fill_form {fields: devlogin: names for the fields shown}" [label="yes, the first time: fill the password screen"];
    "A password screen on the same origin, after an email-only fill?" -> "browser_find {text: <what only a signed-in page shows>}: after the saved login" [label="no"];
    "browser_find {text: <what only a signed-in page shows>}: after the saved login" -> "Left the login origin and signed in?";
    "Left the login origin and signed in?" -> "Known origin, page not yet scouted?" [label="yes"];
    "Left the login origin and signed in?" -> "Hand back the login outcome" [label="no: saved-login-failed, never retry"];
    "browser_navigate {url: <the page's own url>}: reload once" -> "browser_find {text: <what only a signed-in page shows>}: after the reload";
    "browser_find {text: <what only a signed-in page shows>}: after the reload" -> "Signed in after the reload?";
    "Signed in after the reload?" -> "Known origin, page not yet scouted?" [label="yes: another run logged in"];
    "Signed in after the reload?" -> "Hand back the login outcome" [label="no: login-limited, with until"];
    "Hand back the login outcome" -> "Handed back with what is done";
```

Render the graph (`dot -Tsvg -o /tmp/fast-browsing.svg` on the extracted block) and confirm every new node is reachable and every diamond has a labelled edge per answer.

- [ ] **Step 4: Add the prose sections**

Insert before `### Secrets file and operator-named secrets for this site?`:

```markdown
### Saved login for this origin?

Run `rt logins list --json` and look for an entry whose `origin` is exactly the
login page's origin. Yes only on an exact match. A missing `rt`, a command
error, or no matching entry is `no`, which falls through to today's path.

A matching entry gives the two names to use, `fields.email` and
`fields.password`. Both start with `devlogin:`. They are the only credential
text you ever put in a tool call, and only in `browser_fill_form` or a plain
`browser_type` (never with `slowly`). The runtime swaps in the value on the
right origin and refuses anywhere else; you never see it.

### Page shows 2FA, a captcha or an account chooser?

A saved login covers email and password only. A code prompt, a captcha, or a
list of accounts to pick from is `needs-human`: go to the human with that word
and the origin.

### Fill answer?

Fill every field the page shows, in one `browser_fill_form`: the email field
with `fields.email`, the password field with `fields.password`. An
identifier-first page shows only the email field; fill it, submit, and fill
the password screen once when it appears on the same origin.

- `filled`: submit, then run the signed-in check.
- `refused: limited`: another run on this machine tried this login in the last
  few minutes and its session may already cover you. Reload once and run the
  signed-in check; never fill again.
- `refused: unknown` or `unavailable`: rt has no login for this name, or is not
  running. That is `no-saved-login`.
- `refused: mismatch`: the field is not on the saved origin (a frame, a
  lookalike). That is `needs-human`.

A failed signed-in check after a fill is `saved-login-failed`. Never retry it:
a second wrong password is a step toward locking the account.

### Hand back the login outcome

Stop the task and return the outcome word with the origin and what is done so
far: `saved-login-failed`, or `login-limited` with the `until` time the fill
refusal named. A calling skill turns the word into its own question for the
human; when there is no caller, say it to the human in one sentence.
```

In `### Secrets file and operator-named secrets for this site?`, change the bullet that begins `- Never guess a secret name. An unmatched name is filled in literally` so its first sentence reads:

```markdown
- Never guess a secret name. An unmatched bare name is filled in literally
  (a `devlogin:` name never is; the runtime refuses it instead)
```

and keep the rest of that bullet unchanged.

In `### Ask the human to log in in Chrome`, append:

```markdown
When you arrive here from the saved-login path, lead with the outcome word
(`no-saved-login` or `needs-human`) and the origin, so a calling skill can
offer to save a login for that origin.
```

- [ ] **Step 5: Run the pins and the suite**

Run: `node --test tests/unit/skills.test.mjs && npm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 6: GREEN retest**

Dispatch a fresh subagent with the edited skill and the Step 1 scenario, verbatim. Expected: it calls `browser_fill_form` with the two `devlogin:` names as field values, clicks Continue, runs a `browser_find` for a signed-in marker, and states it will not retry on failure. Also run two variants and record both answers:
- the same scenario with `rt logins list --json` printing `[]` (expected: asks the human, leading with `no-saved-login`);
- the same scenario where the fill returns `refused: limited, until 1790000000000` (expected: one reload, the signed-in check, then `login-limited` with the until time if still signed out).
If any answer deviates, tighten the wording and repeat this step.

- [ ] **Step 7: Commit**

```bash
git add skills/fast-browsing/SKILL.md tests/unit/skills.test.mjs
git commit -m "fast-browsing: log in with a saved dev login by devlogin names"
```

---

### Task 7: Final verification

**Files:** none new.

- [ ] **Step 1: Full suite**

Run: `npm test 2>&1 | tail -5`
Expected: Task 1's baseline count plus every test this plan added, all green.

- [ ] **Step 2: Dash and neutral-fixture scan**

Run: `git diff main --name-only | xargs grep -nP "[\x{2013}\x{2014}]" ; echo "dashes exit: $?"`
Expected: no matches (`dashes exit: 1`).
Run: `git diff main | grep -iE "^\+.*(assured|claimview)" ; echo "names exit: $?"`
Expected: no matches (`names exit: 1`).

- [ ] **Step 3: Values stay out of the launcher's own logs**

Run: `grep -nE "log\(|warn\(|stderr" lib/runtime/secrets-channel.mjs lib/rt/login-fill-client.mjs`
Expected: only the three fixed `fast-browser-mcp: secrets channel ...` strings in `secrets-channel.mjs`; none interpolates a request or answer field.

- [ ] **Step 4: Package contents**

Run: `npm pack --dry-run 2>&1 | grep -E "lib/rt/login-fill-client.mjs|lib/runtime/secrets-channel.mjs"`
Expected: both files listed (`lib/` is in `files`).

- [ ] **Step 5: Commit any fixes from this task, then hand off**

```bash
git status --short
```

Expected: clean. The rt repo's plan 3 and the team pack's plan 4 depend on the outcome words and names exactly as Task 6 wrote them.
