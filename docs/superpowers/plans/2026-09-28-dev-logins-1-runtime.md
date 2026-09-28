# Dev logins, plan 1: browser runtime (Playwright fork) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Fast Browser runtime fills a saved dev login only into the exact origin it belongs to, gets each value from its launcher one fill at a time, never types a `devlogin:` placeholder literally, blocks readback while the filled value sits in the page, and redacts every encoded form of a filled value from every output and file.

**Architecture:** All changes live in the MCP tool backend of `playwright-core` (`packages/playwright-core/src/tools/backend/`) plus one CLI flag in `tools/mcp/`. A new `SecretsChannel` speaks newline-delimited JSON over a socket fd the launcher hands in; `fillDevLogin` resolves one element handle, reads its frame origin from the browser's CDP frame tree through the in-process server objects, asks the channel, and fills that same handle. `Context` grows a filled-secret redaction table and a readback lock that `BrowserBackend.callTool` enforces before any readback tool runs.

**Tech Stack:** TypeScript, Playwright's in-process client/server, Chrome DevTools Protocol (`Page.getFrameTree`), Node `net.Socket`, the fork's MCP test suite (`tests/mcp/`, `npm run ctest-mcp`).

**Spec:** `docs/superpowers/specs/2026-09-28-dev-logins-design.md` in the rt repo (section 3 is this plan's scope). Plan 2 (`2026-09-28-dev-logins-2-fast-browser.md`) consumes this plan's release.

## Global Constraints

- Work on the fork's `fast-browser-runtime` branch, in the worktree `~/Documents/GitHub/playwright/.worktrees/fast-browser-runtime` (parked on `677504c52c664b930dc4757bf608efc94675135d`, the commit `runtime-lock.json` names). Never on `main` or `multi-connection-extension`: they lack the release tooling.
- Contract A, verbatim: Runtime <-> launcher channel: runtime flag `--secrets-channel-fd=<n>`; the fd is a duplex socket carrying newline-delimited JSON. Request `{"id": string, "name": string, "frameOrigin": string, "elementKind": "password"|"text"}`. Reply echoes id and name: success `{"id","name","origin","kind":"email"|"password","value"}`, refusal `{"id","name","refused":"unknown"|"mismatch"|"limited"|"unavailable","until"?: number (epoch ms)}`. Runtime waits 10 s; a reply with a non-pending id is dropped. Runtime-local refusal reasons (never sent): `opaque-origin`, `slow-typing`, `timeout`, `no-channel`, `recording`.
- Recording rule (spec section 3): while video recording is on (`--save-video`, or a `browser_start_video` recording in progress), a `devlogin:` fill is refused locally with `recording`; nothing is typed and nothing is sent over the channel.
- Wire format of `frameOrigin` (the daemon compares it to the saved origin by exact string match): exactly `new URL(securityOrigin).origin` form. Scheme and host in lowercase, default port dropped (no `:443` on https, no `:80` on http), no trailing slash, host in punycode. If CDP's `securityOrigin` ever deviates from that form, normalize it through `new URL(...).origin` before sending. Never send the raw frame URL.
- The element-kind check (`password` vs `text`) is extra protection on an origin that already matched, never a barrier on its own: a same-origin page controls its own DOM.
- Contract B, verbatim: Reserved placeholder names: any fill value starting with `devlogin:` (shape `devlogin:<key>:email|password`). Never typed literally. A `--secrets` file defining a `devlogin:` name is refused at load. Bare-name `--secrets` behavior is unchanged.
- Contract C, verbatim: Readback window: from a successful devlogin fill until the filled frame navigates or the filled element detaches, refuse browser_evaluate, browser_run_code_unsafe, browser_network_request, browser_network_requests, browser_take_screenshot.
- Contract D, verbatim: Redaction of filled values: raw, encodeURIComponent, form-encoding (+ for space), JSON-escaped, HTML-escaped forms, in all tool output and every file the runtime writes.
- Contract E, verbatim: Frame origin from CDP frame tree `securityOrigin`, never page JS or frame URL alone; opaque (`null`, about:blank, srcdoc, data:, sandboxed) refused. Fill via the single resolved elementHandle. browser_type with slowly:true refused for devlogin values.
- If any contract turns out unimplementable (for example CDP reports a non-opaque `securityOrigin` for a sandboxed frame), stop and report to the plan owner. Never substitute page JavaScript or the frame URL alone.
- The fork is a public repository: fixtures use neutral origins and names only (`login.example.com`, `devlogin:login.example.com:password`, the test server's own `localhost` origins). No employer names anywhere.
- No em dashes or en dashes in code, comments, tests, commit messages or release notes.
- Clean-code comments: a comment states only a constraint the code cannot show. No narration, no task numbers, no review history.
- Every security test must fail when the protection it covers is removed. Each task's Step 2 proves this by running the test before the code exists.
- A value is never logged, never written unredacted, never put in an env var, never passed to page JavaScript.
- `npm run flint` passes before every commit (the fork's `CLAUDE.md`).
- Runtime release version for this work: `0.1.2` (current lock: `0.1.1`). Do not bump Fast Browser's `runtime-lock.json`; that is plan 2's Task 1.

## Review Focus

1. **The extension relay and `--cdp-endpoint` attach paths.** Fast Browser drives the real Chrome through the extension relay, not a browser the runtime launched. A reasonable user expects the origin lock to work there, not only in the test launcher. Pinned by the `--cdp-endpoint` test in Task 4 and the `npm run test-extension` run in Task 6.
2. **Firefox and WebKit, which have no CDP frame tree.** A reasonable user expects a refusal (`opaque-origin`), never a fill and never a literal. Pinned by the non-Chromium test in Task 4.
3. **The page navigating while a reply is in flight.** The handle dies between the request and the fill. A reasonable user expects nothing typed anywhere and no readback lock left behind. Pinned by the navigation race test in Task 4.
4. **The launcher dying or closing the socket mid-session.** A reasonable user expects every pending and later request to fail fast as `no-channel`, not to hang for 10 s each. Pinned by the closed-channel test in Task 3.
5. **A secret echoed back in a binary-typed response body saved to a file.** `Response._writeFile` redacts strings only today. A reasonable user expects the saved file to be redacted too when it is text in disguise. Pinned by the octet-stream test in Task 1.

---

### Task 1: Redact every encoded form of a secret in every sink

**Files:**
- Create: `packages/playwright-core/src/tools/backend/devlogin.ts`
- Modify: `packages/playwright-core/src/tools/backend/context.ts` (`redactSecrets`, new `rememberFilledSecret`, around lines 503-519)
- Modify: `packages/playwright-core/src/tools/backend/response.ts` (`_writeFile`, around line 118)
- Modify: `packages/playwright-core/src/tools/backend/browserBackend.ts` (catch path and trace append, around lines 169-213)
- Modify: `packages/playwright-core/src/tools/backend/traceLog.ts` (`appendRecord`, line 361)
- Modify: `packages/playwright-core/src/tools/backend/sessionLog.ts` (`logResponse`, line 47)
- Test: `tests/mcp/devlogin-redaction.spec.ts`

**Interfaces:**
- Produces: `devlogin.ts` exports `DEVLOGIN_PREFIX = 'devlogin:'`, `isDevLoginName(value: string): boolean`, `secretVariants(value: string): string[]` (distinct, non-empty, longest first).
- Produces: `Context.rememberFilledSecret(name: string, value: string): void`; `Context.redactSecrets(text: string): string` now covers config secrets and filled secrets, every variant.
- Produces: `TraceLog.appendRecord(record: TraceRecord, redact: (text: string) => string): void`; `SessionLog.logResponse(toolName, toolArgs, responseObject, redact: (text: string) => string): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/devlogin-redaction.spec.ts`:

```ts
/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'node:fs';
import path from 'node:path';

import { test, expect } from './fixtures';

const VALUE = 'p@ss w&rd+%<>"x';
const VARIANTS = [
  VALUE,
  encodeURIComponent(VALUE),
  encodeURIComponent(VALUE).replace(/%20/g, '+'),
  new URLSearchParams({ v: VALUE }).toString().slice(2),
  JSON.stringify(VALUE).slice(1, -1),
  VALUE.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
];

function expectNoVariant(text: string) {
  for (const variant of VARIANTS)
    expect(text).not.toContain(variant);
}

function readTree(dir: string): string {
  let all = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    all += entry.isDirectory() ? readTree(full) : fs.readFileSync(full, 'utf8');
  }
  return all;
}

async function startWithSecret(startClient, outputDir: string, extraArgs: string[] = []) {
  const secretsFile = test.info().outputPath('secrets.env');
  await fs.promises.writeFile(secretsFile, `X-PASSWORD=${VALUE}`);
  return await startClient({ args: ['--secrets', secretsFile, `--output-dir=${outputDir}`, ...extraArgs] });
}

const PAGE = `<!DOCTYPE html>
  <form method="POST" action="/login">
    <input id="pw" name="pw" type="text" oninput="
      console.log('uri:' + encodeURIComponent(this.value));
      console.log('json:' + JSON.stringify({ v: this.value }));
      const span = document.createElement('span');
      span.title = this.value;
      console.log('html:' + span.outerHTML);
    ">
    <button id="go" type="submit">Go</button>
  </form>`;

test('encoded forms of a secret are redacted in console output', async ({ startClient, server }) => {
  const outputDir = test.info().outputPath('output');
  const { client } = await startWithSecret(startClient, outputDir);
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  await client.callTool({ name: 'browser_type', arguments: { element: 'pw', target: '#pw', text: 'X-PASSWORD' } });
  const response = await client.callTool({ name: 'browser_console_messages' });
  const text = JSON.stringify(response.content);
  expectNoVariant(text);
  expect(text).toContain('<secret>X-PASSWORD</secret>');
});

test('a form-encoded request body is redacted', async ({ startClient, server }) => {
  const outputDir = test.info().outputPath('output');
  const { client } = await startWithSecret(startClient, outputDir);
  server.setContent('/', PAGE, 'text/html');
  server.setContent('/login', 'ok', 'text/plain');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  await client.callTool({ name: 'browser_type', arguments: { element: 'pw', target: '#pw', text: 'X-PASSWORD' } });
  await client.callTool({ name: 'browser_click', arguments: { element: 'Go', target: '#go' } });
  const list = JSON.stringify((await client.callTool({ name: 'browser_network_requests', arguments: { static: true } })).content);
  const index = Number(/(\d+)\. \[POST\][^\n]*\/login/.exec(list)![1]);
  const body = await client.callTool({ name: 'browser_network_request', arguments: { index, part: 'request-body' } });
  const text = JSON.stringify(body.content);
  expectNoVariant(text);
  expect(text).toContain('<secret>X-PASSWORD</secret>');
});

test('an error message, the trace and the session log are redacted', async ({ startClient, server }) => {
  const outputDir = test.info().outputPath('output');
  const { client } = await startWithSecret(startClient, outputDir, ['--save-trace', '--save-session']);
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  await client.callTool({ name: 'browser_type', arguments: { element: 'pw', target: '#pw', text: 'X-PASSWORD' } });
  const failed = await client.callTool({
    name: 'browser_run_code_unsafe',
    arguments: { code: `async page => { throw new Error('leak:' + encodeURIComponent(await page.inputValue('#pw'))); }` },
  });
  expect(failed.isError).toBe(true);
  expectNoVariant(JSON.stringify(failed.content));
  await client.close();
  expectNoVariant(readTree(outputDir));
});

test('a text body saved from a binary-typed response is redacted', async ({ startClient, server }) => {
  const outputDir = test.info().outputPath('output');
  const { client } = await startWithSecret(startClient, outputDir);
  server.setRoute('/echo', (req, res) => {
    res.setHeader('content-type', 'application/octet-stream');
    res.end(VALUE);
  });
  server.setContent('/', `<button id="f" onclick="fetch('/echo')">f</button>`, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  await client.callTool({ name: 'browser_click', arguments: { element: 'f', target: '#f' } });
  const list = JSON.stringify((await client.callTool({ name: 'browser_network_requests', arguments: { static: true } })).content);
  const index = Number(/(\d+)\. \[GET\][^\n]*\/echo/.exec(list)![1]);
  await client.callTool({ name: 'browser_network_request', arguments: { index, part: 'response-body', filename: 'echo.bin' } });
  expectNoVariant(readTree(outputDir));
});
```

If `browser_network_requests` renders lines differently than `N. [METHOD] url`, adjust only the two regexes to the real line shape (read `renderRequestLine` in `network.ts`); do not change what is asserted.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run ctest-mcp devlogin-redaction`
Expected: FAIL. The console test finds `encodeURIComponent(VALUE)` in the output; the request-body test finds the form-encoded body; the trace test finds the raw value in `actions.jsonl` (`error` field) and in the error response; the octet-stream test finds the raw value in `echo.bin`.

- [ ] **Step 3: Write the implementation**

Create `packages/playwright-core/src/tools/backend/devlogin.ts` (Apache header as in sibling files):

```ts
export const DEVLOGIN_PREFIX = 'devlogin:';

export function isDevLoginName(value: string): boolean {
  return value.startsWith(DEVLOGIN_PREFIX);
}

export function secretVariants(value: string): string[] {
  const variants = new Set([
    value,
    encodeURIComponent(value),
    encodeURIComponent(value).replace(/%20/g, '+'),
    new URLSearchParams({ v: value }).toString().slice(2),
    JSON.stringify(value).slice(1, -1),
    htmlEscape(value),
  ]);
  variants.delete('');
  // Longest first: a shorter variant can be a substring of a longer one.
  return [...variants].sort((a, b) => b.length - a.length);
}

function htmlEscape(value: string): string {
  return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
}
```

In `context.ts`, add the import `import { secretVariants } from './devlogin';`, a field next to `_scriptTelemetry`:

```ts
  private _filledSecrets = new Map<string, string>();
```

and replace `redactSecrets` with:

```ts
  rememberFilledSecret(name: string, value: string) {
    if (value)
      this._filledSecrets.set(name, value);
  }

  redactSecrets(text: string): string {
    const entries: [string, string][] = [
      ...Object.entries(this.config.secrets ?? {}),
      ...this._filledSecrets.entries(),
    ];
    for (const [secretName, secretValue] of entries) {
      if (!secretValue)
        continue;
      for (const variant of secretVariants(secretValue))
        text = text.replaceAll(variant, `<secret>${secretName}</secret>`);
    }
    return text;
  }
```

In `response.ts`, replace `_writeFile`'s body with:

```ts
  private async _writeFile(resolvedFile: ResolvedFile, data: Buffer | string | null) {
    if (typeof data === 'string') {
      await fs.promises.writeFile(resolvedFile.fileName, this._context.redactSecrets(data), 'utf-8');
    } else if (data) {
      const asText = data.toString('utf8');
      if (Buffer.from(asText, 'utf8').equals(data))
        await fs.promises.writeFile(resolvedFile.fileName, this._context.redactSecrets(asText), 'utf-8');
      else
        await fs.promises.writeFile(resolvedFile.fileName, data);
    }
    this._writtenFiles.add(path.resolve(resolvedFile.fileName));
  }
```

In `traceLog.ts`, change `appendRecord`:

```ts
  appendRecord(record: TraceRecord, redact: (text: string) => string): void {
    const safeRecord: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record))
      safeRecord[key] = truncateOversizedValues(value, MAX_VALUE_BYTES);
    fs.appendFileSync(this._actionsFile, redact(JSON.stringify(safeRecord)) + '\n');
  }
```

(Keep the existing comment block above it unchanged.)

In `sessionLog.ts`, add the `redact` parameter and apply it to the joined text:

```ts
  logResponse(toolName: string, toolArgs: Record<string, any>, responseObject: any, redact: (text: string) => string) {
    // ...existing body unchanged up to the queue line...
    const text = redact(lines.join('\n'));
    this._sessionFileQueue = this._sessionFileQueue.then(() => fs.promises.appendFile(this._file, text)).catch(e => debug('pw:tools:error')(e));
  }
```

In `browserBackend.ts`, inside `callTool`:

```ts
      this._sessionLog?.logResponse(name, parsedArguments, responseObject, text => context.redactSecrets(text));
```

replace the catch block's two assignments with:

```ts
      traceError = context.redactSecrets(messages.join('\n\n'));
      responseObject = isCdpDisconnect(String(error))
        ? formatCdpDisconnect(name, urlBefore, context.redactSecrets(String(error)))
        : formatError(traceError);
```

and pass the redactor to the trace:

```ts
        traceLog?.appendRecord({
          // ...existing fields unchanged...
        }, text => context.redactSecrets(text));
```

`JSON.stringify` output is redacted after serialization on purpose: the JSON-escaped variant is exactly what a value looks like inside it, and `<secret>NAME</secret>` needs no escaping for the reserved name shape.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run ctest-mcp devlogin-redaction secrets`
Expected: PASS, including the existing `secrets.spec.ts`.

- [ ] **Step 5: Lint and commit**

Run: `npm run flint`
Expected: no errors.

```bash
git add packages/playwright-core/src/tools/backend/devlogin.ts packages/playwright-core/src/tools/backend/context.ts packages/playwright-core/src/tools/backend/response.ts packages/playwright-core/src/tools/backend/traceLog.ts packages/playwright-core/src/tools/backend/sessionLog.ts packages/playwright-core/src/tools/backend/browserBackend.ts tests/mcp/devlogin-redaction.spec.ts
git commit -m "mcp: redact encoded forms of secrets in output, errors, traces and saved files"
```

---

### Task 2: `devlogin:` values are never typed literally

**Files:**
- Modify: `packages/playwright-core/src/tools/backend/devlogin.ts` (add refusal types and error)
- Modify: `packages/playwright-core/src/tools/backend/form.ts` (textbox/slider branch, line 44-47)
- Modify: `packages/playwright-core/src/tools/backend/keyboard.ts` (`type` handler, line 97-124; `pressSequentially` handler)
- Modify: `packages/playwright-core/src/tools/mcp/config.ts` (`resolveCLIConfigForMCP`, line 122-141)
- Test: `tests/mcp/devlogin-reserved.spec.ts`

**Interfaces:**
- Consumes: `isDevLoginName`, `DEVLOGIN_PREFIX` (Task 1).
- Produces: `type DevLoginLocalRefusal = 'opaque-origin' | 'slow-typing' | 'timeout' | 'no-channel' | 'recording'`; `type DevLoginRemoteRefusal = 'unknown' | 'mismatch' | 'limited' | 'unavailable'`; `class DevLoginRefusedError extends Error { secretName: string; reason: DevLoginLocalRefusal | DevLoginRemoteRefusal; until?: number }`. Message shape: `Saved login devlogin:<key>:<kind> refused: <reason>[ until <ISO time>]. Nothing was typed.`
- Produces: `form.ts` and `keyboard.ts` each have exactly one `isDevLoginName(...)` branch that Task 3 replaces with a `fillDevLogin` call.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/devlogin-reserved.spec.ts` (Apache header as above):

```ts
import { test, expect } from './fixtures';

const NAME = 'devlogin:login.example.com:password';

const PAGE = `<!DOCTYPE html>
  <input id="pw" type="password" oninput="console.log('typed:' + this.value)">`;

async function typedLines(client) {
  const response = await client.callTool({ name: 'browser_console_messages' });
  return JSON.stringify(response.content).match(/typed:[^"\\]*/g) ?? [];
}

test('fill_form refuses a devlogin value with no channel and types nothing', async ({ client, server }) => {
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  expect(await client.callTool({
    name: 'browser_fill_form',
    arguments: { fields: [{ name: 'Password', type: 'textbox', target: '#pw', value: NAME }] },
  })).toHaveResponse({ isError: true, error: expect.stringContaining('refused: no-channel') });
  expect(await typedLines(client)).toEqual([]);
});

test('browser_type refuses a devlogin value with no channel and types nothing', async ({ client, server }) => {
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  expect(await client.callTool({
    name: 'browser_type',
    arguments: { element: 'Password', target: '#pw', text: NAME },
  })).toHaveResponse({ isError: true, error: expect.stringContaining('refused: no-channel') });
  expect(await typedLines(client)).toEqual([]);
});

test('browser_type slowly refuses a devlogin value before any request', async ({ client, server }) => {
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  expect(await client.callTool({
    name: 'browser_type',
    arguments: { element: 'Password', target: '#pw', text: NAME, slowly: true },
  })).toHaveResponse({ isError: true, error: expect.stringContaining('refused: slow-typing') });
  expect(await typedLines(client)).toEqual([]);
});

test('press_sequentially refuses a devlogin value', async ({ startClient, server }) => {
  const { client } = await startClient({ args: ['--caps=core-input'] });
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  await client.callTool({ name: 'browser_click', arguments: { element: 'Password', target: '#pw' } });
  const response = await client.callTool({ name: 'browser_press_sequentially', arguments: { text: NAME } });
  if (JSON.stringify(response.content).includes('not found'))
    test.skip(true, 'browser_press_sequentially is skill-only and not exposed over MCP');
  expect(response).toHaveResponse({ isError: true, error: expect.stringContaining('refused: slow-typing') });
  expect(await typedLines(client)).toEqual([]);
});

test('a config that defines a devlogin secret is refused at load', async ({ startClient }) => {
  await expect(startClient({ config: { secrets: { [NAME]: 'x' } } })).rejects.toThrow();
});

test('bare-name secrets keep working', async ({ startClient, server }) => {
  const fs = await import('node:fs');
  const secretsFile = test.info().outputPath('secrets.env');
  await fs.promises.writeFile(secretsFile, 'X-PASSWORD=password123');
  const { client } = await startClient({ args: ['--secrets', secretsFile] });
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  await client.callTool({ name: 'browser_type', arguments: { element: 'Password', target: '#pw', text: 'X-PASSWORD' } });
  expect(await typedLines(client)).toEqual(['typed:<secret>X-PASSWORD</secret>']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run ctest-mcp devlogin-reserved`
Expected: FAIL. The three refusal tests see `typed:devlogin:login.example.com:password` (typed literally) instead of an error; the config test starts a server that accepts the reserved name.

- [ ] **Step 3: Write the implementation**

Append to `devlogin.ts`:

```ts
export type DevLoginLocalRefusal = 'opaque-origin' | 'slow-typing' | 'timeout' | 'no-channel' | 'recording';
export type DevLoginRemoteRefusal = 'unknown' | 'mismatch' | 'limited' | 'unavailable';

export class DevLoginRefusedError extends Error {
  readonly secretName: string;
  readonly reason: DevLoginLocalRefusal | DevLoginRemoteRefusal;
  readonly until: number | undefined;

  constructor(secretName: string, reason: DevLoginLocalRefusal | DevLoginRemoteRefusal, until?: number) {
    const lifts = until ? ` until ${new Date(until).toISOString()}` : '';
    super(`Saved login ${secretName} refused: ${reason}${lifts}. Nothing was typed.`);
    this.secretName = secretName;
    this.reason = reason;
    this.until = until;
  }
}
```

In `form.ts`, import `{ isDevLoginName, DevLoginRefusedError } from './devlogin'` and replace the textbox/slider branch:

```ts
      if (field.type === 'textbox' || field.type === 'slider') {
        if (isDevLoginName(field.value))
          throw new DevLoginRefusedError(field.value, 'no-channel');
        const secret = tab.context.lookupSecret(field.value);
        await locator.fill(secret.value, tab.actionTimeoutOptions);
        response.addCode(`${locatorSource}.fill(${secret.code});`);
      }
```

In `keyboard.ts`, import the same two names. In the `type` handler, before `const secret = ...`:

```ts
    if (isDevLoginName(params.text))
      throw new DevLoginRefusedError(params.text, params.slowly ? 'slow-typing' : 'no-channel');
```

In the `pressSequentially` handler, as its first statement:

```ts
    if (isDevLoginName(params.text))
      throw new DevLoginRefusedError(params.text, 'slow-typing');
```

In `mcp/config.ts`, import `{ DEVLOGIN_PREFIX } from '../backend/devlogin'`, call `validateSecrets(result.secrets);` right after `validateOutputDir(result.outputDir);`, and add:

```ts
function validateSecrets(secrets: Record<string, string> | undefined) {
  for (const name of Object.keys(secrets ?? {})) {
    if (name.startsWith(DEVLOGIN_PREFIX))
      throw new Error(`secrets must not define "${name}": names starting with "${DEVLOGIN_PREFIX}" are reserved for saved logins.`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run ctest-mcp devlogin-reserved secrets`
Expected: PASS (the press_sequentially test either passes or skips with the skill-only reason).

- [ ] **Step 5: Lint and commit**

Run: `npm run flint`

```bash
git add packages/playwright-core/src/tools/backend/devlogin.ts packages/playwright-core/src/tools/backend/form.ts packages/playwright-core/src/tools/backend/keyboard.ts packages/playwright-core/src/tools/mcp/config.ts tests/mcp/devlogin-reserved.spec.ts
git commit -m "mcp: reserve devlogin: placeholders; never type them literally"
```

---

### Task 3: Secrets channel and the main-frame saved-login fill

**Files:**
- Create: `packages/playwright-core/src/tools/backend/secretsChannel.ts`
- Create: `packages/playwright-core/src/tools/backend/frameOrigin.ts`
- Create: `packages/playwright-core/src/tools/backend/devLoginFill.ts`
- Modify: `packages/playwright-core/src/tools/backend/context.ts` (`ContextConfig`: add `secretsChannelFd?: number`)
- Modify: `packages/playwright-core/src/tools/backend/form.ts`, `keyboard.ts` (replace Task 2's `no-channel` throws with `fillDevLogin`)
- Modify: `packages/playwright-core/src/tools/mcp/program.ts` (new option, after `--secrets` on line 72)
- Modify: `packages/playwright-core/src/tools/mcp/config.ts` (`CLIOptions.secretsChannelFd`, `configFromCLIOptions`)
- Modify: `packages/playwright-core/src/tools/mcp/config.d.ts` (`secretsChannelFd?: number` with a doc comment)
- Create: `tests/mcp/devlogin-channel-host.mjs`
- Modify: `tests/mcp/fixtures.ts` (`StartClient` option `devLogins`, `createTransport` host wrapper, `devLoginRequests` helper)
- Test: `tests/mcp/devlogin-channel.spec.ts`
- Test: `tests/mcp/devlogin-origin.spec.ts`

**Interfaces:**
- Consumes: `DevLoginRefusedError`, `isDevLoginName` (Task 2); `Context.rememberFilledSecret` (Task 1).
- Produces: `class SecretsChannel { constructor(fd: number); request(name: string, frameOrigin: string, elementKind: 'password' | 'text'): Promise<SecretReply | 'timeout' | 'no-channel'> }`; `secretsChannel(fd: number | undefined): SecretsChannel | undefined` (one shared instance per process).
- Produces: `frameSecurityOrigin(frame: playwright.Frame): Promise<string | undefined>` (undefined means opaque or unknown; Task 4 hardens it). Its result is always in wire format.
- Produces: `wireOrigin(securityOrigin: string | undefined): string | undefined`, exported from `frameOrigin.ts`: the one place a CDP `securityOrigin` becomes the `frameOrigin` string sent on the channel.
- Produces: `fillDevLogin(tab: Tab, locator: playwright.Locator, name: string): Promise<void>`, which Task 5 extends with the readback lock.
- Produces (tests): `StartClient` option `devLogins?: DevLoginFixture`; `devLoginRequests(): { id: string, name: string, frameOrigin: string, elementKind: string }[]`.

- [ ] **Step 1: Write the test host and fixture support**

Create `tests/mcp/devlogin-channel-host.mjs` (Apache header in a block comment). It stands in for the Fast Browser launcher: it spawns the real server with the channel on fd 3 and answers like the daemon would.

```js
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const fixture = JSON.parse(fs.readFileSync(process.env.DEVLOGIN_FIXTURE, 'utf8'));
const child = spawn(process.execPath, [...process.argv.slice(2), '--secrets-channel-fd=3'], {
  stdio: ['inherit', 'inherit', 'inherit', 'pipe'],
});
child.on('exit', code => process.exit(code ?? 0));
process.on('SIGTERM', () => child.kill());

const channel = child.stdio[3];
if (fixture.closeChannel)
  channel.destroy();

let buffer = '';
channel.on('data', chunk => {
  buffer += chunk.toString('utf8');
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    answer(JSON.parse(line));
  }
});

function answer(request) {
  fs.appendFileSync(fixture.requestLog, JSON.stringify(request) + '\n');
  const login = fixture.logins.find(l => l.name === request.name);
  let reply;
  if (!login)
    reply = { id: request.id, name: request.name, refused: fixture.refusal ?? 'unknown', until: fixture.until };
  else if (login.origin !== request.frameOrigin || (login.kind === 'password' && request.elementKind !== 'password'))
    reply = { id: request.id, name: request.name, refused: 'mismatch' };
  else
    reply = { id: request.id, name: request.name, origin: login.origin, kind: login.kind, value: login.value };
  setTimeout(() => {
    if (fixture.staleFirst)
      channel.write(JSON.stringify({ ...reply, id: `stale-${request.id}`, value: 'WRONG-VALUE' }) + '\n');
    channel.write(JSON.stringify(reply) + '\n');
  }, fixture.delayMs ?? 0);
}
```

In `tests/mcp/fixtures.ts`:

```ts
export type DevLoginFixture = {
  logins: { name: string, origin: string, kind: 'email' | 'password', value: string }[],
  refusal?: 'unknown' | 'mismatch' | 'limited' | 'unavailable',
  until?: number,
  delayMs?: number,
  staleFirst?: boolean,
  closeChannel?: boolean,
};
```

Add `devLogins?: DevLoginFixture,` to the `StartClient` options type. In `startClient`, before `createTransport`:

```ts
      let host: string | undefined;
      if (options?.devLogins) {
        const fixtureFile = testInfo.outputPath('devlogin-fixture.json');
        await fs.promises.writeFile(fixtureFile, JSON.stringify({ ...options.devLogins, requestLog: testInfo.outputPath('devlogin-requests.jsonl') }));
        env.DEVLOGIN_FIXTURE = fixtureFile;
        host = path.join(__dirname, 'devlogin-channel-host.mjs');
      }
```

and pass `host` through: `createTransport(mcpServerType, { args, env, cwd: ..., host })`. In `createTransport`, accept `host?: string` and build args as:

```ts
    args: [...(options.host ? [options.host] : []), ...(mcpServerType === 'test-mcp' ? testMcpServerPath : mcpServerPath), ...options.args],
```

Add the helper:

```ts
export function devLoginRequests(): { id: string, name: string, frameOrigin: string, elementKind: string }[] {
  const file = test.info().outputPath('devlogin-requests.jsonl');
  if (!fs.existsSync(file))
    return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/mcp/devlogin-channel.spec.ts` (Apache header):

```ts
import { test, expect, devLoginRequests } from './fixtures';

const EMAIL = 'devlogin:login.example.com:email';
const PASSWORD = 'devlogin:login.example.com:password';

const PAGE = `<!DOCTYPE html>
  <input id="email" type="text" oninput="console.log('typed:' + this.value)">
  <input id="pw" type="password" oninput="console.log('typed:' + this.value)">`;

async function typedLines(client) {
  const response = await client.callTool({ name: 'browser_console_messages' });
  return JSON.stringify(response.content).match(/typed:[^"\\]*/g) ?? [];
}

function logins(origin: string) {
  return [
    { name: EMAIL, origin, kind: 'email' as const, value: 'dev@example.com' },
    { name: PASSWORD, origin, kind: 'password' as const, value: 'Sup3r secret&+' },
  ];
}

test('fills both fields on the matching origin, one request each', async ({ startClient, server }) => {
  test.skip(test.info().project.name !== 'chrome', 'CDP frame tree');
  const origin = new URL(server.PREFIX).origin;
  const { client, stderr } = await startClient({ devLogins: { logins: logins(origin) } });
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  expect(await client.callTool({
    name: 'browser_fill_form',
    arguments: { fields: [
      { name: 'Email', type: 'textbox', target: '#email', value: EMAIL },
      { name: 'Password', type: 'textbox', target: '#pw', value: PASSWORD },
    ] },
  })).toHaveResponse({ code: expect.stringContaining(`fill(process.env['${PASSWORD}'])`) });
  const lines = await typedLines(client);
  expect(lines).toContain(`typed:<secret>${EMAIL}</secret>`);
  expect(lines).toContain(`typed:<secret>${PASSWORD}</secret>`);
  const requests = devLoginRequests();
  expect(requests.map(r => [r.name, r.frameOrigin, r.elementKind])).toEqual([
    [EMAIL, origin, 'text'],
    [PASSWORD, origin, 'password'],
  ]);
  expect(new Set(requests.map(r => r.id)).size).toBe(2);
  expect(stderr()).toContain(`filled saved login for ${origin}`);
  expect(stderr()).not.toContain('Sup3r');
});

test('a refusal from the channel types nothing and names the reason', async ({ startClient, server }) => {
  test.skip(test.info().project.name !== 'chrome', 'CDP frame tree');
  const until = Date.now() + 300_000;
  const { client } = await startClient({ devLogins: { logins: [], refusal: 'limited', until } });
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  expect(await client.callTool({
    name: 'browser_type',
    arguments: { element: 'Password', target: '#pw', text: PASSWORD },
  })).toHaveResponse({ isError: true, error: expect.stringContaining(`refused: limited until ${new Date(until).toISOString()}`) });
  expect(await typedLines(client)).toEqual([]);
});

test('a mismatch reply types nothing', async ({ startClient, server }) => {
  test.skip(test.info().project.name !== 'chrome', 'CDP frame tree');
  const { client } = await startClient({ devLogins: { logins: logins('https://login.example.com') } });
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  expect(await client.callTool({
    name: 'browser_type',
    arguments: { element: 'Password', target: '#pw', text: PASSWORD },
  })).toHaveResponse({ isError: true, error: expect.stringContaining('refused: mismatch') });
  expect(await typedLines(client)).toEqual([]);
});

test('a reply with a stale id is dropped, not used', async ({ startClient, server }) => {
  test.skip(test.info().project.name !== 'chrome', 'CDP frame tree');
  const origin = new URL(server.PREFIX).origin;
  const { client } = await startClient({ devLogins: { logins: logins(origin), staleFirst: true } });
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  await client.callTool({ name: 'browser_type', arguments: { element: 'Password', target: '#pw', text: PASSWORD } });
  const lines = await typedLines(client);
  expect(lines).toEqual([`typed:<secret>${PASSWORD}</secret>`]);
  expect(JSON.stringify(lines)).not.toContain('WRONG-VALUE');
});

test('no reply within 10 s refuses as timeout', async ({ startClient, server }) => {
  test.skip(test.info().project.name !== 'chrome', 'CDP frame tree');
  test.slow();
  const origin = new URL(server.PREFIX).origin;
  const { client } = await startClient({ devLogins: { logins: logins(origin), delayMs: 12_000 } });
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  expect(await client.callTool({
    name: 'browser_type',
    arguments: { element: 'Password', target: '#pw', text: PASSWORD },
  })).toHaveResponse({ isError: true, error: expect.stringContaining('refused: timeout') });
  expect(await typedLines(client)).toEqual([]);
});

test('a closed channel refuses fast as no-channel', async ({ startClient, server }) => {
  test.skip(test.info().project.name !== 'chrome', 'CDP frame tree');
  const origin = new URL(server.PREFIX).origin;
  const { client } = await startClient({ devLogins: { logins: logins(origin), closeChannel: true } });
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  const started = Date.now();
  expect(await client.callTool({
    name: 'browser_type',
    arguments: { element: 'Password', target: '#pw', text: PASSWORD },
  })).toHaveResponse({ isError: true, error: expect.stringContaining('refused: no-channel') });
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(await typedLines(client)).toEqual([]);
});
```

Add a wire-format case to `devlogin-channel.spec.ts`, navigating through a mixed-case host so the browser, not the test, produces the origin:

```ts
test('frameOrigin is sent in exact URL origin form', async ({ startClient, server }) => {
  test.skip(test.info().project.name !== 'chrome', 'CDP frame tree');
  const origin = new URL(server.PREFIX).origin;
  const { client } = await startClient({ devLogins: { logins: logins(origin) } });
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX.replace('localhost', 'LocalHost') + '/' } });
  await client.callTool({ name: 'browser_type', arguments: { element: 'Password', target: '#pw', text: PASSWORD } });
  const [request] = devLoginRequests();
  expect(request.frameOrigin).toBe(origin);
  expect(request.frameOrigin).toBe(new URL(request.frameOrigin).origin);
  expect(request.frameOrigin.endsWith('/')).toBe(false);
});
```

Create `tests/mcp/devlogin-origin.spec.ts` (Apache header) for the normalizer itself, where default ports and punycode can be exercised without a real host:

```ts
import { test, expect } from './fixtures';

// eslint-disable-next-line no-restricted-syntax -- exercises the built backend module directly; no MCP tool exposes the normalizer.
const { wireOrigin } = require('../../packages/playwright-core/lib/tools/backend/frameOrigin');

for (const [input, expected] of [
  ['https://login.example.com', 'https://login.example.com'],
  ['HTTPS://Login.Example.COM', 'https://login.example.com'],
  ['https://login.example.com:443', 'https://login.example.com'],
  ['http://localhost:80', 'http://localhost'],
  ['http://localhost:3000', 'http://localhost:3000'],
  ['https://login.example.com/', 'https://login.example.com'],
  ['https://bücher.example', 'https://xn--bcher-kva.example'],
  ['null', undefined],
  ['', undefined],
  ['about:blank', undefined],
  ['data:text/html,x', undefined],
  ['chrome-extension://abcdef', undefined],
] as const) {
  test(`wireOrigin(${JSON.stringify(input)})`, () => {
    expect(wireOrigin(input)).toBe(expected);
  });
}
```

If `lint-tests` refuses a `require` of `lib/`, move the table into a test that imports the module the way other tests in `tests/mcp/` reach built code (grep for `packages/playwright-core/lib` under `tests/`); keep every row.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run ctest-mcp devlogin-channel devlogin-origin`
Expected: FAIL. The server rejects the unknown `--secrets-channel-fd` option at startup (every channel test errors connecting), which proves the host wrapper really passes the flag; `devlogin-origin` fails to load `wireOrigin`.

- [ ] **Step 4: Write the implementation**

Create `secretsChannel.ts`:

```ts
import crypto from 'crypto';
import net from 'net';

export type SecretReply =
  | { id: string, name: string, origin: string, kind: 'email' | 'password', value: string }
  | { id: string, name: string, refused: 'unknown' | 'mismatch' | 'limited' | 'unavailable', until?: number };

const REPLY_TIMEOUT_MS = 10_000;

type Pending = {
  name: string;
  resolve: (reply: SecretReply | 'timeout' | 'no-channel') => void;
  timer: NodeJS.Timeout;
};

export class SecretsChannel {
  private _socket: net.Socket | undefined;
  private _buffer = '';
  private _pending = new Map<string, Pending>();

  constructor(fd: number) {
    const socket = new net.Socket({ fd, readable: true, writable: true });
    socket.setEncoding('utf8');
    socket.on('data', chunk => this._onData(String(chunk)));
    const closed = () => this._close();
    socket.on('end', closed);
    socket.on('close', closed);
    socket.on('error', closed);
    socket.unref();
    this._socket = socket;
  }

  request(name: string, frameOrigin: string, elementKind: 'password' | 'text'): Promise<SecretReply | 'timeout' | 'no-channel'> {
    const socket = this._socket;
    if (!socket || socket.destroyed || !socket.writable)
      return Promise.resolve('no-channel');
    const id = crypto.randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        resolve('timeout');
      }, REPLY_TIMEOUT_MS);
      this._pending.set(id, { name, resolve, timer });
      socket.write(JSON.stringify({ id, name, frameOrigin, elementKind }) + '\n');
    });
  }

  private _onData(chunk: string) {
    this._buffer += chunk;
    let newline: number;
    while ((newline = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, newline);
      this._buffer = this._buffer.slice(newline + 1);
      let reply: SecretReply;
      try {
        reply = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = typeof reply?.id === 'string' ? this._pending.get(reply.id) : undefined;
      if (!pending || reply.name !== pending.name)
        continue;
      this._pending.delete(reply.id);
      clearTimeout(pending.timer);
      pending.resolve(reply);
    }
  }

  private _close() {
    this._socket = undefined;
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve('no-channel');
    }
    this._pending.clear();
  }
}

let shared: SecretsChannel | undefined;

export function secretsChannel(fd: number | undefined): SecretsChannel | undefined {
  if (fd === undefined)
    return undefined;
  shared ??= new SecretsChannel(fd);
  return shared;
}
```

A malformed line is skipped without being logged: it may carry a value.

Create `frameOrigin.ts`:

```ts
import type * as playwright from '../../..';

type CdpFrame = { id: string, url: string, securityOrigin?: string };
type CdpFrameTree = { frame: CdpFrame, childFrames?: CdpFrameTree[] };

export async function frameSecurityOrigin(frame: playwright.Frame): Promise<string | undefined> {
  // eslint-disable-next-line no-restricted-syntax -- the browser's own frame origin is only reachable on the in-process server objects.
  const serverFrame = (frame as any)._connection?.toImpl?.(frame);
  const crPage = serverFrame?._page?.delegate;
  if (typeof crPage?._sessionForFrame !== 'function')
    return undefined;
  const session = crPage._sessionForFrame(serverFrame);
  const { frameTree } = await session._client.send('Page.getFrameTree') as { frameTree: CdpFrameTree };
  return wireOrigin(findFrame(frameTree, serverFrame._id)?.securityOrigin);
}

function findFrame(tree: CdpFrameTree, id: string): CdpFrame | undefined {
  if (tree.frame.id === id)
    return tree.frame;
  for (const child of tree.childFrames ?? []) {
    const found = findFrame(child, id);
    if (found)
      return found;
  }
  return undefined;
}

// The daemon compares this string to the saved origin byte for byte.
export function wireOrigin(securityOrigin: string | undefined): string | undefined {
  if (!securityOrigin || securityOrigin === 'null' || !URL.canParse(securityOrigin))
    return undefined;
  const url = new URL(securityOrigin);
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return undefined;
  return url.origin;
}
```

Create `devLoginFill.ts`:

```ts
import { DevLoginRefusedError } from './devlogin';
import { frameSecurityOrigin } from './frameOrigin';
import { secretsChannel } from './secretsChannel';

import type * as playwright from '../../..';
import type { Tab } from './tab';

export async function fillDevLogin(tab: Tab, locator: playwright.Locator, name: string): Promise<void> {
  const handle = await locator.elementHandle(tab.actionTimeoutOptions);
  try {
    await fillHandle(tab, handle, name);
  } catch (error) {
    await handle.dispose().catch(() => {});
    if (error instanceof DevLoginRefusedError)
      process.stderr.write(`saved login ${name} refused: ${error.reason}\n`);
    throw error;
  }
  await handle.dispose().catch(() => {});
}

async function fillHandle(tab: Tab, handle: playwright.ElementHandle, name: string) {
  const frame = await handle.ownerFrame();
  const frameOrigin = frame ? await frameSecurityOrigin(frame) : undefined;
  if (!frameOrigin)
    throw new DevLoginRefusedError(name, 'opaque-origin');
  const channel = secretsChannel(tab.context.config.secretsChannelFd);
  if (!channel)
    throw new DevLoginRefusedError(name, 'no-channel');
  const elementKind = await handle.evaluate(el => el.localName === 'input' && (el as HTMLInputElement).type === 'password') ? 'password' : 'text';
  const reply = await channel.request(name, frameOrigin, elementKind);
  if (reply === 'timeout' || reply === 'no-channel')
    throw new DevLoginRefusedError(name, reply);
  if ('refused' in reply)
    throw new DevLoginRefusedError(name, reply.refused, reply.until);
  if (reply.origin !== frameOrigin || (reply.kind === 'password' && elementKind !== 'password'))
    throw new DevLoginRefusedError(name, 'mismatch');
  tab.context.rememberFilledSecret(name, reply.value);
  await handle.fill(reply.value, tab.actionTimeoutOptions);
  process.stderr.write(`filled saved login for ${frameOrigin}\n`);
}
```

`rememberFilledSecret` runs before `fill` so an error thrown by the fill is already redacted. The element kind sent with the request is extra protection on an origin that already matched, never a barrier on its own (the page controls its own DOM); the origin check is what keeps a value off the wrong site.

Wire it in. `form.ts` textbox/slider branch:

```ts
      if (field.type === 'textbox' || field.type === 'slider') {
        if (isDevLoginName(field.value)) {
          await fillDevLogin(tab, locator, field.value);
          response.addCode(`${locatorSource}.fill(process.env['${field.value}']);`);
          continue;
        }
        const secret = tab.context.lookupSecret(field.value);
        await locator.fill(secret.value, tab.actionTimeoutOptions);
        response.addCode(`${locatorSource}.fill(${secret.code});`);
      }
```

(Drop the now-unused `DevLoginRefusedError` import from `form.ts`; import `fillDevLogin` from `./devLoginFill`.)

`keyboard.ts` `type` handler: replace Task 2's early throw with:

```ts
    if (isDevLoginName(params.text)) {
      if (params.slowly)
        throw new DevLoginRefusedError(params.text, 'slow-typing');
      response.addTextResult(`Typed into ${params.element || resolved}`);
      const fillAndSubmit = async () => {
        await fillDevLogin(tab, locator, params.text);
        response.addCode(`await page.${resolved}.fill(process.env['${params.text}']);`);
        if (params.submit) {
          response.setIncludeSnapshot();
          response.addCode(`await page.${resolved}.press('Enter');`);
          await locator.press('Enter', tab.actionTimeoutOptions);
        }
      };
      if (params.submit)
        await tab.waitForCompletion(fillAndSubmit);
      else
        await fillAndSubmit();
      return;
    }
```

This block goes after `const { locator, resolved } = await tab.targetLocator(...)` and before `lookupSecret`. `pressSequentially` keeps Task 2's `slow-typing` throw.

`context.ts` `ContextConfig`: add `secretsChannelFd?: number;` next to `secrets`.

`mcp/config.ts`: add `secretsChannelFd?: number;` to `CLIOptions`, and `secretsChannelFd: cliOptions.secretsChannelFd,` next to `secrets:` in `configFromCLIOptions`. `mcp/config.d.ts`, next to `secrets`:

```ts
  /**
   * File descriptor of a duplex socket to the launcher that answers saved-login
   * requests for `devlogin:` placeholders, one fill at a time.
   */
  secretsChannelFd?: number;
```

`mcp/program.ts`, after the `--secrets` option:

```ts
      .option('--secrets-channel-fd <fd>', 'file descriptor of a socket that answers saved-login requests for "devlogin:" values', numberParser)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run ctest-mcp devlogin`
Expected: PASS for `devlogin-channel`, `devlogin-reserved` and `devlogin-redaction`. If `cli-help.spec.ts` or a config snapshot lists every option, run `npm run ctest-mcp cli-help config` and update only the expected option list to include `--secrets-channel-fd`.

- [ ] **Step 6: Lint and commit**

Run: `npm run flint`

```bash
git add packages/playwright-core/src/tools/backend/secretsChannel.ts packages/playwright-core/src/tools/backend/frameOrigin.ts packages/playwright-core/src/tools/backend/devLoginFill.ts packages/playwright-core/src/tools/backend/context.ts packages/playwright-core/src/tools/backend/form.ts packages/playwright-core/src/tools/backend/keyboard.ts packages/playwright-core/src/tools/mcp/program.ts packages/playwright-core/src/tools/mcp/config.ts packages/playwright-core/src/tools/mcp/config.d.ts tests/mcp/devlogin-channel-host.mjs tests/mcp/fixtures.ts tests/mcp/devlogin-channel.spec.ts tests/mcp/devlogin-origin.spec.ts
git commit -m "mcp: fill devlogin: placeholders one at a time over --secrets-channel-fd"
```

---

### Task 4: Harden the frame lock and refuse while recording

**Files:**
- Modify: `packages/playwright-core/src/tools/backend/frameOrigin.ts`
- Modify: `packages/playwright-core/src/tools/backend/context.ts` (`ContextConfig.saveVideo`, new `isRecordingVideo`)
- Modify: `packages/playwright-core/src/tools/backend/devLoginFill.ts` (recording check in `fillHandle`)
- Test: `tests/mcp/devlogin-frames.spec.ts`

**Interfaces:**
- Consumes: `frameSecurityOrigin`, `fillDevLogin` (Task 3), the `devLogins` fixture and `devLoginRequests` (Task 3), `DevLoginRefusedError` with the `recording` reason (Task 2).
- Produces: `frameSecurityOrigin` returns an origin only when the CDP `securityOrigin` is a tuple origin AND the CDP frame URL is `http:`/`https:` with that same origin. `about:blank`, `about:srcdoc`, `data:`, `blob:` and sandboxed frames return `undefined`.
- Produces: `Context.isRecordingVideo(): boolean` (true when `config.saveVideo` is set or a `browser_start_video` recording is in progress). `fillHandle` refuses with `recording` before resolving the frame origin or touching the channel.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/devlogin-frames.spec.ts` (Apache header):

```ts
import { test, expect, devLoginRequests } from './fixtures';

const PASSWORD = 'devlogin:login.example.com:password';
const INPUT = `<input id="pw" type="password" aria-label="pw" oninput="console.log('typed:' + this.value)">`;

async function typedLines(client) {
  const response = await client.callTool({ name: 'browser_console_messages' });
  return JSON.stringify(response.content).match(/typed:[^"\\]*/g) ?? [];
}

async function frameRef(client) {
  const snapshot = JSON.stringify((await client.callTool({ name: 'browser_snapshot', arguments: {} })).content);
  return /textbox \\"pw\\" \[ref=(f\d+e\d+)\]/.exec(snapshot)![1];
}

function login(origin: string) {
  return [{ name: PASSWORD, origin, kind: 'password' as const, value: 'Sup3r secret&+' }];
}

async function fillInFrame(client) {
  return await client.callTool({
    name: 'browser_fill_form',
    arguments: { fields: [{ name: 'Password', type: 'textbox', target: await frameRef(client), value: PASSWORD }] },
  });
}

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'chrome', 'CDP frame tree');
});

test('a cross-origin iframe reports its own origin, not the page origin', async ({ startClient, server }) => {
  const pageOrigin = new URL(server.PREFIX).origin;
  const frameOrigin = new URL(server.CROSS_PROCESS_PREFIX).origin;
  const { client } = await startClient({ devLogins: { logins: login(pageOrigin) } });
  server.setContent('/frame.html', INPUT, 'text/html');
  server.setContent('/', `<iframe src="${server.CROSS_PROCESS_PREFIX}/frame.html"></iframe>`, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  expect(await fillInFrame(client)).toHaveResponse({ isError: true, error: expect.stringContaining('refused: mismatch') });
  expect(devLoginRequests().map(r => r.frameOrigin)).toEqual([frameOrigin]);
  expect(await typedLines(client)).toEqual([]);
});

for (const [kind, markup] of [
  ['sandboxed', (prefix: string) => `<iframe sandbox="allow-scripts" src="${prefix}/frame.html"></iframe>`],
  ['srcdoc', () => `<iframe srcdoc='${INPUT}'></iframe>`],
  ['about:blank', () => `<iframe id="f"></iframe><script>document.getElementById('f').contentDocument.body.innerHTML = ${JSON.stringify(INPUT)};</script>`],
] as const) {
  test(`a ${kind} frame is refused as opaque before any request`, async ({ startClient, server }) => {
    const origin = new URL(server.PREFIX).origin;
    const { client } = await startClient({ devLogins: { logins: login(origin) } });
    server.setContent('/frame.html', INPUT, 'text/html');
    server.setContent('/', markup(server.PREFIX), 'text/html');
    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
    expect(await fillInFrame(client)).toHaveResponse({ isError: true, error: expect.stringContaining('refused: opaque-origin') });
    expect(devLoginRequests()).toEqual([]);
    expect(await typedLines(client)).toEqual([]);
  });
}

test('a password placeholder on a text input sends elementKind text and is refused', async ({ startClient, server }) => {
  const origin = new URL(server.PREFIX).origin;
  const { client } = await startClient({ devLogins: { logins: login(origin) } });
  server.setContent('/', `<input id="t" type="text" oninput="console.log('typed:' + this.value)">`, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  expect(await client.callTool({
    name: 'browser_type',
    arguments: { element: 't', target: '#t', text: PASSWORD },
  })).toHaveResponse({ isError: true, error: expect.stringContaining('refused: mismatch') });
  expect(devLoginRequests().map(r => r.elementKind)).toEqual(['text']);
  expect(await typedLines(client)).toEqual([]);
});

test('the page navigating while a reply is in flight types nothing', async ({ startClient, server }) => {
  const origin = new URL(server.PREFIX).origin;
  const { client } = await startClient({ devLogins: { logins: login(origin), delayMs: 1_000 } });
  server.setContent('/next', `<p>next</p>`, 'text/html');
  server.setContent('/', `${INPUT}<script>document.getElementById('pw').addEventListener('focus', () => {}); setTimeout(() => location.href = '/next', 300);</script>`, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  const response = await client.callTool({ name: 'browser_type', arguments: { element: 'pw', target: '#pw', text: PASSWORD } });
  expect(response.isError).toBe(true);
  expect(await typedLines(client)).toEqual([]);
  expect(JSON.stringify(response.content)).not.toContain('Sup3r');
});

test('the lock works when attached over --cdp-endpoint', async ({ startClient, server, cdpServer }) => {
  await cdpServer.start();
  const origin = new URL(server.PREFIX).origin;
  const { client } = await startClient({ args: [`--cdp-endpoint=${cdpServer.endpoint}`], devLogins: { logins: login(origin) } });
  server.setContent('/', INPUT, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  await client.callTool({ name: 'browser_type', arguments: { element: 'pw', target: '#pw', text: PASSWORD } });
  expect(devLoginRequests().map(r => r.frameOrigin)).toEqual([origin]);
  expect(await typedLines(client)).toEqual([`typed:<secret>${PASSWORD}</secret>`]);
});
```

Append the recording tests to the same file (they run under the same Chromium `beforeEach`):

```ts
test('a fill with --save-video on is refused as recording and sends nothing', async ({ startClient, server }) => {
  const origin = new URL(server.PREFIX).origin;
  const { client } = await startClient({
    args: ['--save-video=800x600', `--output-dir=${test.info().outputPath('output')}`],
    devLogins: { logins: login(origin) },
  });
  server.setContent('/', INPUT, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  expect(await client.callTool({
    name: 'browser_type',
    arguments: { element: 'pw', target: '#pw', text: PASSWORD },
  })).toHaveResponse({ isError: true, error: expect.stringContaining('refused: recording') });
  expect(devLoginRequests()).toEqual([]);
  expect(await typedLines(client)).toEqual([]);
});

test('a fill during a browser_start_video recording is refused as recording', async ({ startClient, server }) => {
  const origin = new URL(server.PREFIX).origin;
  const { client } = await startClient({
    args: ['--caps=devtools', `--output-dir=${test.info().outputPath('output')}`],
    devLogins: { logins: login(origin) },
  });
  server.setContent('/', INPUT, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  const started = await client.callTool({ name: 'browser_start_video', arguments: {} });
  test.skip(!!started.isError, 'browser_start_video is not exposed with these capabilities');
  expect(await client.callTool({
    name: 'browser_type',
    arguments: { element: 'pw', target: '#pw', text: PASSWORD },
  })).toHaveResponse({ isError: true, error: expect.stringContaining('refused: recording') });
  expect(devLoginRequests()).toEqual([]);
  expect(await typedLines(client)).toEqual([]);
});
```

If `browser_start_video` needs a different capability than `devtools`, read its `capability` in `video.ts` and use that value in `--caps`; do not change the assertions.

Add a separate file-level test that runs on every project, outside the `beforeEach` skip, for Review Focus item 2. Put it in `tests/mcp/devlogin-reserved.spec.ts` (it needs no Chromium skip):

```ts
test('a browser without a CDP frame tree refuses instead of filling', async ({ startClient, server }) => {
  test.skip(test.info().project.name === 'chrome' || test.info().project.name === 'msedge' || test.info().project.name === 'chromium', 'covered by the Chromium tests');
  const origin = new URL(server.PREFIX).origin;
  const { client } = await startClient({ devLogins: { logins: [{ name: NAME, origin, kind: 'password', value: 'x' }] } });
  server.setContent('/', PAGE, 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  expect(await client.callTool({
    name: 'browser_type',
    arguments: { element: 'Password', target: '#pw', text: NAME },
  })).toHaveResponse({ isError: true, error: expect.stringContaining('refused: opaque-origin') });
  expect(await typedLines(client)).toEqual([]);
});
```

(Import `devLoginRequests` is not needed there; `startClient` already accepts `devLogins` after Task 3.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run ctest-mcp devlogin-frames`
Expected: FAIL for `srcdoc` and `about:blank`: those frames inherit the page's `securityOrigin`, so Task 3's code sends a request and fills. FAIL for both recording tests: Task 3's code sends a request and fills while video records. The `sandboxed` case must be refused. If CDP reports the page origin for the sandboxed frame too and the URL check below does not catch it (its URL is the page's own origin), stop and report: Contract E cannot be met from `Page.getFrameTree` alone.

- [ ] **Step 3: Write the implementation**

In `frameOrigin.ts`, replace the last line of `frameSecurityOrigin`:

```ts
  const cdpFrame = findFrame(frameTree, serverFrame._id);
  const origin = wireOrigin(cdpFrame?.securityOrigin);
  if (!origin || !cdpFrame || !URL.canParse(cdpFrame.url))
    return undefined;
  const url = new URL(cdpFrame.url);
  // about:blank and about:srcdoc inherit their creator's origin, so the origin alone does not prove the document came from it.
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== origin)
    return undefined;
  return origin;
```

In `context.ts`, add to `ContextConfig` next to `saveTrace` (the resolved config already carries it; the backend type just never named it):

```ts
  saveVideo?: { width: number, height: number };
```

and to `Context`:

```ts
  isRecordingVideo(): boolean {
    return !!this.config.saveVideo || !!this._video;
  }
```

In `devLoginFill.ts`, make the recording check the first statement of `fillHandle`, before the frame origin and the channel:

```ts
  if (tab.context.isRecordingVideo())
    throw new DevLoginRefusedError(name, 'recording');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run ctest-mcp devlogin`
Expected: PASS. Then run the non-Chromium case once: `npm run test-mcp devlogin-reserved -- --project=firefox`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

Run: `npm run flint`

```bash
git add packages/playwright-core/src/tools/backend/frameOrigin.ts packages/playwright-core/src/tools/backend/context.ts packages/playwright-core/src/tools/backend/devLoginFill.ts tests/mcp/devlogin-frames.spec.ts tests/mcp/devlogin-reserved.spec.ts
git commit -m "mcp: refuse saved logins in opaque frames and while video records"
```

---

### Task 5: Readback window after a saved-login fill

**Files:**
- Modify: `packages/playwright-core/src/tools/backend/context.ts` (lock state and methods)
- Modify: `packages/playwright-core/src/tools/backend/devLoginFill.ts` (hand the handle to the lock instead of disposing it on success)
- Modify: `packages/playwright-core/src/tools/backend/browserBackend.ts` (check before `tool.handle`)
- Test: `tests/mcp/devlogin-readback.spec.ts`

**Interfaces:**
- Consumes: `fillDevLogin` (Task 3).
- Produces: `Context.lockReadback(frame: playwright.Frame, handle: playwright.ElementHandle): void`, `Context.unlockReadback(): void`, `Context.isReadbackLocked(): Promise<boolean>`; `READBACK_TOOLS` set in `browserBackend.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/devlogin-readback.spec.ts` (Apache header):

```ts
import { test, expect } from './fixtures';

const PASSWORD = 'devlogin:login.example.com:password';
const READBACK = [
  { name: 'browser_evaluate', arguments: { function: '() => document.getElementById("pw")?.value' } },
  { name: 'browser_run_code_unsafe', arguments: { code: 'async page => page.inputValue("#pw")' } },
  { name: 'browser_network_requests', arguments: {} },
  { name: 'browser_network_request', arguments: { index: 1 } },
  { name: 'browser_take_screenshot', arguments: {} },
];

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'chrome', 'CDP frame tree');
});

async function filledClient(startClient, server, page: string) {
  const origin = new URL(server.PREFIX).origin;
  const { client } = await startClient({
    devLogins: { logins: [{ name: PASSWORD, origin, kind: 'password', value: 'Sup3r secret&+' }] },
  });
  server.setContent('/', page, 'text/html');
  server.setContent('/app', '<p>app</p><input id="pw" type="password">', 'text/html');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  await client.callTool({ name: 'browser_type', arguments: { element: 'pw', target: '#pw', text: PASSWORD } });
  return client;
}

test('readback tools are refused while the filled value is on the page', async ({ startClient, server }) => {
  const client = await filledClient(startClient, server, '<input id="pw" type="password">');
  for (const call of READBACK) {
    expect(await client.callTool(call), call.name).toHaveResponse({
      isError: true,
      error: expect.stringContaining('unavailable until the page leaves the saved login'),
    });
  }
});

test('readback is allowed again after the filled frame navigates, on the same origin', async ({ startClient, server }) => {
  const client = await filledClient(startClient, server, '<input id="pw" type="password">');
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/app' } });
  for (const call of READBACK)
    expect(JSON.stringify((await client.callTool(call)).content), call.name).not.toContain('unavailable until the page leaves');
});

test('readback is allowed again after the filled element detaches', async ({ startClient, server }) => {
  const client = await filledClient(startClient, server, '<input id="pw" type="password"><button id="rm" onclick="document.getElementById(\'pw\').remove()">rm</button>');
  await client.callTool({ name: 'browser_click', arguments: { element: 'rm', target: '#rm' } });
  const response = await client.callTool({ name: 'browser_evaluate', arguments: { function: '() => 1' } });
  expect(response.isError).toBeFalsy();
});

test('a same-document navigation keeps the lock', async ({ startClient, server }) => {
  const client = await filledClient(startClient, server, '<input id="pw" type="password"><button id="p" onclick="history.pushState({}, \'\', \'/step2\')">p</button>');
  await client.callTool({ name: 'browser_click', arguments: { element: 'p', target: '#p' } });
  expect(await client.callTool(READBACK[0])).toHaveResponse({ isError: true, error: expect.stringContaining('unavailable until the page leaves') });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run ctest-mcp devlogin-readback`
Expected: FAIL. `browser_evaluate` returns the value (redacted as `<secret>...</secret>`) instead of an error.

- [ ] **Step 3: Write the implementation**

In `context.ts`, add the field and methods:

```ts
  private _readbackLock: { frame: playwrightTypes.Frame, handle: playwrightTypes.ElementHandle } | undefined;

  lockReadback(frame: playwrightTypes.Frame, handle: playwrightTypes.ElementHandle) {
    this.unlockReadback();
    this._readbackLock = { frame, handle };
  }

  unlockReadback() {
    const lock = this._readbackLock;
    this._readbackLock = undefined;
    lock?.handle.dispose().catch(() => {});
  }

  // A same-document navigation keeps the filled element alive, so only a detached frame or element lifts the lock.
  async isReadbackLocked(): Promise<boolean> {
    const lock = this._readbackLock;
    if (!lock)
      return false;
    const alive = !lock.frame.isDetached() && await lock.handle.evaluate(el => el.isConnected).catch(() => false);
    if (!alive)
      this.unlockReadback();
    return alive;
  }
```

Also call `this.unlockReadback();` at the start of `dispose()`.

In `devLoginFill.ts`, change `fillDevLogin` so a successful fill hands the handle to the lock instead of disposing it:

```ts
export async function fillDevLogin(tab: Tab, locator: playwright.Locator, name: string): Promise<void> {
  const handle = await locator.elementHandle(tab.actionTimeoutOptions);
  let frame: playwright.Frame;
  try {
    frame = await fillHandle(tab, handle, name);
  } catch (error) {
    await handle.dispose().catch(() => {});
    if (error instanceof DevLoginRefusedError)
      process.stderr.write(`saved login ${name} refused: ${error.reason}\n`);
    throw error;
  }
  tab.context.lockReadback(frame, handle);
}
```

and make `fillHandle` return `frame` (typed `Promise<playwright.Frame>`, `return frame!;` after the stderr write; `frame` is non-null there because a null frame already threw `opaque-origin`).

In `browserBackend.ts`, above the class:

```ts
const READBACK_TOOLS = new Set([
  'browser_evaluate',
  'browser_run_code_unsafe',
  'browser_network_request',
  'browser_network_requests',
  'browser_take_screenshot',
]);
```

and in `callTool`, right after `const context = this._context!;`:

```ts
    if (READBACK_TOOLS.has(name) && await context.isReadbackLocked())
      return formatError(`${name} is unavailable until the page leaves the saved login it was just filled with.`);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run ctest-mcp devlogin`
Expected: PASS for every `devlogin-*` file.

- [ ] **Step 5: Lint and commit**

Run: `npm run flint`

```bash
git add packages/playwright-core/src/tools/backend/context.ts packages/playwright-core/src/tools/backend/devLoginFill.ts packages/playwright-core/src/tools/backend/browserBackend.ts tests/mcp/devlogin-readback.spec.ts
git commit -m "mcp: refuse readback tools while a saved login sits in the page"
```

---

### Task 6: Full verification and runtime release 0.1.2

**Files:**
- No source changes. Produces the release `fast-browser-v0.1.2` on `m4ttheweric/playwright`.

**Interfaces:**
- Produces: a published release whose notes name `--secrets-channel-fd` (plan 2's Task 1 checks for this), built from this branch's head commit, with `fast-browser-release-0.1.2.json`, the runtime tarball, the extension zip and crx, and their sha256 values in the manifest.

- [ ] **Step 1: Run the whole MCP suite on Chromium**

Run: `npm run ctest-mcp`
Expected: PASS. Any failure outside `devlogin-*` is a regression from this plan: fix it before continuing.

- [ ] **Step 2: Build and run the extension suite (real Chrome, the relay path)**

Run: `node utils/build/build.js && npm run test-extension`
Expected: PASS.

- [ ] **Step 3: Build the release artifacts**

Run: `node utils/fast_browser/build_artifacts.mjs --version 0.1.2 --out-dir fast-browser-dist`
Expected: `fast-browser-dist/` holds `fast-browser-mcp-0.1.2.tar.gz`, the extension zip and crx, and `fast-browser-release-0.1.2.json`.

- [ ] **Step 4: Confirm the built runtime exposes the flag**

Run: `mkdir -p /tmp/fb-check && tar -xzf fast-browser-dist/fast-browser-mcp-0.1.2.tar.gz -C /tmp/fb-check && node /tmp/fb-check/fast-browser-mcp/cli.cjs --help | grep -c secrets-channel-fd`
Expected: `1`.

- [ ] **Step 5: Publish**

Write the notes to `fast-browser-dist/NOTES.md`:

```markdown
Fast Browser runtime 0.1.2

- Adds `--secrets-channel-fd=<n>`: `devlogin:` placeholders are filled one at a time from the launcher, only into a frame whose browser-reported origin matches.
- `devlogin:` values are never typed literally; opaque and inherited-origin frames are refused, and so is any fill while video records.
- Readback tools are refused while a saved login sits in the page.
- Secrets are redacted in their URL-encoded, form-encoded, JSON-escaped and HTML-escaped forms, in errors, traces, session logs and saved files.
```

Run:

```bash
gh release create fast-browser-v0.1.2 --repo m4ttheweric/playwright --target "$(git rev-parse HEAD)" --title "Fast Browser 0.1.2" --notes-file fast-browser-dist/NOTES.md
gh release upload fast-browser-v0.1.2 fast-browser-dist/*.tar.gz fast-browser-dist/*.zip fast-browser-dist/*.crx fast-browser-dist/*.json --repo m4ttheweric/playwright
```

`--target` takes the full 40-character SHA; an abbreviated one is rejected.

Expected: `gh release view fast-browser-v0.1.2 --repo m4ttheweric/playwright` lists the four artifact kinds.

- [ ] **Step 6: Hand off**

Report the release tag and the head commit SHA to the plan 2 owner. Do not edit Fast Browser's `runtime-lock.json`.

---

## Self-Review

- **Spec coverage (section 3):** reserved names (Task 2), launcher channel with id and echoed name, 10 s wait, stale-id drop (Task 3), site lock before any value moves, keyed on the frame origin, with the element kind sent alongside as extra protection only (Tasks 3 and 4), opaque frames, `slowly` and video recording refused locally (Tasks 2 and 4), fill via one handle (Task 3), readback window tied to the filled document, including screenshots (Task 5), redaction of encoded forms in output and files (Task 1), logging without values (Task 3). The daemon-side `mismatch` and attempt limit are plan 3's; the test host here only imitates them.
- **Placeholder scan:** no TBD or "similar to"; every code step carries its code. Two steps allow a bounded adjustment (the network-request line regex, and a help-list snapshot) and name exactly what may change.
- **Type consistency:** `DevLoginRefusedError(secretName, reason, until?)`, `secretsChannel(fd)`, `SecretsChannel.request(name, frameOrigin, elementKind)`, `frameSecurityOrigin(frame)`, `wireOrigin(securityOrigin)`, `fillDevLogin(tab, locator, name)`, `Context.rememberFilledSecret`, `lockReadback`, `unlockReadback`, `isReadbackLocked`, `appendRecord(record, redact)`, `logResponse(..., redact)` are used with the same names and shapes in every task.
- **Review Focus:** each of the five lines has a test in its owning task (Task 4 `--cdp-endpoint` plus Task 6 extension run; Task 4 non-Chromium; Task 4 navigation race; Task 3 closed channel; Task 1 octet-stream).
