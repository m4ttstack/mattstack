# Composed Evidence, Milestone 2: Capture As A Fork Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture becomes a tool in the Fast Browser runtime (`browser_capture_evidence`) that screenshots at 2x, writes its own sidecar and cannot hang, and `fast-browser compose` lays a 2x capture out exactly like its 1x twin.

**Architecture:** The fork gains one backend tool beside `browser_take_screenshot`. It is a port of the shipped `capture-evidence` macro's rules, plus a 2x screenshot sent as `Page.captureScreenshot` on the page's existing CDP session (reached through the in-process server object, the pattern `frameOrigin.ts` already uses), plus a deadline on every browser call. The relay's one `send` gains a timeout. In fast-browser, compose multiplies a capture's CSS-pixel frame and boxes by `scale` at load and threads the same factor through the layout's source-pixel constants; the macro stops being a built-in and becomes a test helper; `--seal` goes away because the tool seals its own capture.

**Tech Stack:** TypeScript in the Playwright fork (`packages/playwright-core/src/tools/`), `@playwright/test` and `node --test` for the fork's suites, Node >= 20 ES modules and `node:test` in fast-browser, the pinned `chromium-headless-shell`, `gh` for releases.

**Spec:** `docs/superpowers/specs/2026-10-10-composed-evidence-design.md` (this repo), section "Milestone 2: capture as a fork tool", its "Parked from milestone 1" list, "Files both milestones touch" and "Working rules from M1". Read-only.

**Trees.**

- Fork: `/Users/matt/.mattstack/rt/worktrees/gh-m4ttheweric-playwright/eager-kettle`, branch `m2-capture`, already reset onto `origin/fast-browser-runtime` (`5cbbc25f6`) and built. PR base: `fast-browser-runtime`.
- fast-browser: `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-fast-browser/deft-feather`, branch `m2-capture`, from `main` at `a2ba811`. Run `npm ci` there before Task 7.
- The shared checkouts `~/Documents/GitHub/fast-browser`, `~/Documents/GitHub/playwright` and the fork tree `.worktrees/fast-browser-runtime` are never edited.

## Decisions this plan makes (for the plan review)

Each is the plan's to settle under the spec; say so at review if any should go the other way.

1. **Tool name:** `browser_capture_evidence`.
2. **Where captures land.** The runtime is only told `--output-dir` (`~/.fast-browser/output`), so it cannot find the screenshots folder the spec names. The fork gains `--capture-dir <path>` (falls back to the output directory); fast-browser's launcher passes `--capture-dir=~/.fast-browser/screenshots`. That is one line in `lib/runtime/launch.mjs`, a file outside the spec's Milestone 2 list (not a Milestone 3 file).
3. **2x strategy.** A planning probe on this machine (display DPR 1) showed `clip.scale: 2` byte-identical to a metrics-override capture in headed and headless Chromium over direct CDP, and different from an upscaled 1x. The tool uses `clip.scale` (`2 / device scale`, so a DPR 2 display yields native pixels) when the device scale is exactly 1 or 2, and the spec's fallback, the temporary `Emulation.setDeviceMetricsOverride`, at any other device scale, where `2 / device scale` could round the image a pixel off. `PLAYWRIGHT_MCP_CAPTURE_2X=clip|override` forces one. Task 5 proves both through `chrome.debugger`; `override` becomes the default everywhere only if `clip` fails there.
4. **Relay timeouts.** Every relay send times out: 30 s by default, 10 minutes for the commands whose duration belongs to the page (`Runtime.evaluate`, `Runtime.callFunctionOn`, `Runtime.awaitPromise`, `Page.navigate`, `Page.reload`, `Page.printToPDF`), so a long `page.evaluate` or a slow navigation is not cut short. The capture tool adds its own 10 s deadline on every browser call, which is what makes a capture return quickly.
5. **Parked: the card rule's 64 px floor.** Kept at 64, as section 1 of the spec states it. Lowering it lets a thin toolbar strip qualify as a card for any small target, which is the case the floor exists to stop. A fixture pins what happens to a compact card (it is skipped; the next qualifying ancestor or the union is used) and the skill already tells the driver to pass a frame selector on `union`.
6. **Parked: a frame selector that does not fit the viewport** now fails with `failedStep: "frame"` and captures nothing, instead of being clipped silently.
7. **Parked: renderer install.** Two tests are added, and the swap becomes rename-aside, rename-in, with the marker written inside the staging tree so "ready" flips at one rename.
8. **Files outside the spec's lists.** `lib/compose/page.mjs` (Milestone 3's file) gets one field, `scale`, in the data it hands the page; `lib/runtime/launch.mjs` gets the `--capture-dir` argument; `lib/macros/install.mjs` loses one name from `BUILTIN_NAMES`; `lib/compose/renderer.mjs` gets the atomic swap. Unit tests follow their sources. `tests/e2e/helpers/invariants.mjs` and every golden are left alone.
9. **Not done: removing the retired macro from machines that already installed it.** The installer has no delete path, so a machine that ran setup on plugin 0.1.11 keeps `~/.fast-browser/macros/capture-evidence.js` and its index section. It is harmless (the skill no longer points at it) and is noted in the report.
10. **Order.** The blind eval and the live smoke run on a locally built runtime before anything is published, so a failed eval never costs a public release. Then: fork PR, merge (Matt), release (asked), pin (asked).
11. **Versions.** Runtime `0.1.3`, plugin `0.1.12`. The extension is unchanged, so its manifest and package versions stay at `0.2.11`.

## Global Constraints

- **Public repos.** The fork, fast-browser and this plan carry no employer names, URLs, data, ticket ids or wording from the employer's business domain, in code, fixtures, commit messages or PR text. Test pages use a made-up project tracker. The blind eval's brief and boards live only under `~/.fast-browser/composed-evidence-eval/` and are never copied into a repo.
- **Never over the relay:** `newCDPSession`, `locator.elementHandle`, `evaluateHandle`, or a held element handle. The tool uses only `locator.count`, `locator.evaluate`, `locator.first().waitFor`, `page.evaluate`, and raw commands on the page's existing session.
- **Capture rules are section 1 of the spec, exactly:** the `missed` reasons `no-match`, `ambiguous` (with `count`), `not-visible`, `out-of-view`; the `failedStep` values `args`, `resolve`, `frame`, `measure`; frame snap `card` (pad 12), `union` (pad 24), `selector` (pad 12), `too-large`; screenshot then measure with nothing page-changing between; `dark` below luminance 110.
- **Sidecar shape:** `{ schemaVersion: "capture-evidence/1", source: "live", image, frame, frameSnap, boxes, missed, dark, scale, digest }`. `frame` and `boxes` are CSS pixels. `digest` is SHA-256 over the PNG bytes then `JSON.stringify({ frame, boxes })`.
- **Compose accepts `scale` 1 and 2 and refuses anything else.**
- **Milestone 3 runs in parallel in fast-browser.** In `lib/compose/page-layout.js` and `lib/compose/page-geometry.js` thread one `scale` factor through the source-pixel constants and change nothing else. In `skills/composing-evidence/SKILL.md` rewrite only pipeline steps 2, 3 and 4. In `tests/e2e/compose-fixtures.test.mjs` change only the line that loads the capture script and the lines that turn its return into a sidecar. Add no golden and change none.
- **Fork rules:** GitHub Actions stays disabled. Never change the extension manifest `key`. No `Co-Authored-By` and no "Generated with" in fork commits or its PR. Never amend a fork commit. Commit messages are `label(scope): description`. Run `node utils/build/build.js` before any test (no watcher runs in this worktree) and `npm run flint` before each commit. Stage files by explicit path: `.superpowers/` and `fast-browser-dist/` are untracked and must stay that way.
- **fast-browser rules:** `package.json` `dependencies` stays `{}`. Re-pin only with `npm run pin-runtime`. Lock gates are updated to the new values, never loosened or deleted. Error messages never echo a user-supplied value.
- **Asking first (herd_ask), every time:** merging into `fast-browser-runtime`; creating or uploading a fork release; pinning the runtime; anything that opens or drives Matt's real Chrome; a Chrome extension reload; any write outside the two trees and the plan file (the side-by-side runtime install in Task 14, the eval run folder in Task 11).
- **Processes:** stop only processes you started, by PID. Never `pkill -f` or `killall`.
- **Models:** Sonnet for implementers and task reviews, Opus for the final whole-branch review, with model and effort named on every spawn. Reviewers run the tests themselves.
- **Comments** state only a constraint the code cannot show.
- **Squash before any push** to either public repo, after a purity scan of the diff.

## Review Focus

1. **A target below the fold.** The capture scrolls the frame to the centre, so the clip must start at the scroll offset. Expected: the box a sidecar reports for a swatch lands on that swatch's colour in the PNG. Test in Task 3.
2. **A selector that is not valid selector syntax.** The spec only names selectors that match zero, one or several elements. Expected: the call fails with the selector error, no tag is left on the page, and the next capture works. Test in Task 2.
3. **A saved login is on the page.** A capture is a screenshot. Expected: the tool is refused exactly as `browser_take_screenshot` is while a filled saved-login value remains. Test in Task 4.
4. **A fractional device scale** (browser zoom, or a 1.5x display). Expected: the PNG is still exactly twice the CSS viewport and the sidecar says `scale: 2`; if the image comes back another size, or the page lays out differently while it is captured, the tool fails loudly instead of writing a misaligned sidecar. Test in Task 3.
5. **A sidecar that says `scale: 2` over a 1x image** (the field is not covered by the digest). Expected: compose refuses it as not matching its image, because the scaled frame falls outside the PNG. Test in Task 7.

---

## Phase A: the fork

Every Phase A task runs in the fork tree. Build with `node utils/build/build.js` before running a test.

### Task 0: Baselines (controller, not delegated)

**Files:**
- Create: `.superpowers/sdd/baseline.md` (untracked ledger file)

- [ ] **Step 1: Baseline the extension suite and the relay node tests on the untouched branch**

```bash
cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttheweric-playwright/eager-kettle
git status --short            # expect: nothing tracked is modified
npm run test-extension 2>&1 | tail -40
node --test tests/extension/*.node.test.mjs 2>&1 | tail -15
```

`npm run test-extension` opens headed test Chromium windows with a temporary profile; it does not touch Matt's Chrome. Expected: the known pre-existing failures (`cli.spec.ts › attach <url> --extension` at least).

- [ ] **Step 2: Record the result**

Write the exact failing test titles and the pass/fail counts of both commands into `.superpowers/sdd/baseline.md`. Every later "matches the baseline" check compares against this file.

- [ ] **Step 3: Baseline fast-browser**

```bash
cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-fast-browser/deft-feather
npm ci
npm test 2>&1 | tail -8
npm run test:compose 2>&1 | tail -8
```

Append both summaries to the same baseline file. Expected: green (`npm test` 0 failures; compose suite all passing).

### Task 1: A timeout on every relay send

**Files:**
- Modify: `packages/playwright-core/src/tools/mcp/cdpRelay.ts` (the `sendCommand` closure in the constructor, lines 88-92; `ExtensionConnection.send`, `_handleParsedMessage` and `_dispose`, lines 332-416)
- Test: `tests/extension/relay-send-timeout.node.test.mjs`

**Interfaces:**
- Produces: `ExtensionConnection.send(method, params, timeoutMs)` rejects with `Error("Relay timeout: <method> got no reply from the extension within <ms>ms")`. Environment overrides read once per relay: `PLAYWRIGHT_MCP_RELAY_SEND_TIMEOUT` (default 30000) and `PLAYWRIGHT_MCP_RELAY_PAGE_PACED_TIMEOUT` (default 600000), both in milliseconds.

- [ ] **Step 1: Write the failing test**

Copy the `loadCdpRelayServer` and `listeningServer` helpers verbatim from `tests/extension/cdp-relay-stop.node.test.mjs` (change the cache directory prefix to `relay-send-timeout-`), set the two environment variables before the relay is loaded, then:

```js
// tests/extension/relay-send-timeout.node.test.mjs  (after the licence header and the copied helpers)
import { WebSocket } from 'ws';

process.env.PLAYWRIGHT_MCP_RELAY_SEND_TIMEOUT = '300';
process.env.PLAYWRIGHT_MCP_RELAY_PAGE_PACED_TIMEOUT = '1200';

const CDPRelayServer = await loadCdpRelayServer();

function open(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

// A fake extension that completes the tab attach handshake and then replies
// only to the CDP methods named in `answers`; every other command stalls.
async function stalledRelay(answers = {}) {
  const server = await listeningServer();
  const relay = new CDPRelayServer(server, 'chrome', undefined, 'test-extension-id');
  const extension = await open(relay.extensionEndpoint());
  const stalled = [];
  extension.on('message', raw => {
    const { id, method, params } = JSON.parse(raw.toString());
    if (method === 'chrome.debugger.attach')
      return extension.send(JSON.stringify({ id, result: {} }));
    const cdpMethod = method === 'chrome.debugger.sendCommand' ? params[1] : method;
    if (cdpMethod === 'Target.getTargetInfo')
      return extension.send(JSON.stringify({ id, result: { targetInfo: { targetId: 'T1', type: 'page', url: 'about:blank', title: '' } } }));
    if (cdpMethod in answers)
      return extension.send(JSON.stringify({ id, result: answers[cdpMethod] }));
    stalled.push({ id, cdpMethod });
  });
  extension.send(JSON.stringify({ method: 'chrome.tabs.onCreated', params: [{ id: 7, index: 0, windowId: 1, active: true, pinned: false }] }));
  extension.send(JSON.stringify({ method: 'extension.initialized', params: [] }));

  const cdp = await open(relay.cdpEndpoint());
  const inbox = [];
  cdp.on('message', raw => inbox.push(JSON.parse(raw.toString())));
  const next = async (match, withinMs) => {
    const deadline = Date.now() + withinMs;
    for (;;) {
      const hit = inbox.find(match);
      if (hit)
        return hit;
      if (Date.now() > deadline)
        throw new Error('the relay never answered: the send hung');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  let lastId = 0;
  const send = (method, sessionId, params) => {
    const id = ++lastId;
    cdp.send(JSON.stringify({ id, method, sessionId, params }));
    return id;
  };
  send('Target.setAutoAttach', undefined, { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  const attached = await next(m => m.method === 'Target.attachedToTarget', 5000);
  return {
    extension, stalled, send, next, sessionId: attached.params.sessionId,
    close: () => { cdp.close(); extension.close(); relay.stop(); server.close(); },
  };
}

test('a command the extension never answers fails with a relay timeout, not a hang', async () => {
  const relay = await stalledRelay();
  try {
    const started = Date.now();
    const id = relay.send('Page.captureScreenshot', relay.sessionId, { format: 'png' });
    const reply = await relay.next(m => m.id === id, 3000);
    assert.match(reply.error.message, /Relay timeout: Page\.captureScreenshot got no reply from the extension within 300ms/);
    assert.ok(Date.now() - started >= 250, 'the timeout is not immediate');
  } finally { relay.close(); }
});

test('a browser-level attach, the command the spike saw hang, fails the same way', async () => {
  const relay = await stalledRelay();
  try {
    const id = relay.send('Target.attachToBrowserTarget');
    const reply = await relay.next(m => m.id === id, 3000);
    assert.match(reply.error.message, /Relay timeout: Target\.attachToBrowserTarget/);
  } finally { relay.close(); }
});

test('a page-paced command gets the longer ceiling and still fails in the end', async () => {
  const relay = await stalledRelay();
  try {
    const started = Date.now();
    const id = relay.send('Runtime.evaluate', relay.sessionId, { expression: 'new Promise(() => {})', awaitPromise: true });
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.equal(await relay.next(m => m.id === id, 1).catch(() => 'pending'), 'pending', 'it outlives the 300ms command timeout');
    const reply = await relay.next(m => m.id === id, 3000);
    assert.match(reply.error.message, /Relay timeout: Runtime\.evaluate got no reply from the extension within 1200ms/);
    assert.ok(Date.now() - started >= 1100);
  } finally { relay.close(); }
});

test('a timed-out send does not poison the connection, and its late reply is ignored', async () => {
  const relay = await stalledRelay({ 'Page.getLayoutMetrics': { cssVisualViewport: { clientWidth: 10, clientHeight: 10 } } });
  try {
    const stuck = relay.send('Page.captureScreenshot', relay.sessionId, { format: 'png' });
    await relay.next(m => m.id === stuck, 3000);
    relay.extension.send(JSON.stringify({ id: relay.stalled[0].id, result: { data: 'late' } }));
    const id = relay.send('Page.getLayoutMetrics', relay.sessionId);
    const reply = await relay.next(m => m.id === id, 3000);
    assert.equal(reply.result.cssVisualViewport.clientWidth, 10);
  } finally { relay.close(); }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/extension/relay-send-timeout.node.test.mjs`
Expected: FAIL with "the relay never answered: the send hung" in the first three tests.

- [ ] **Step 3: Implement**

In `cdpRelay.ts`, above the `CDPRelayServer` class:

```ts
const DEFAULT_SEND_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_PACED_TIMEOUT_MS = 600_000;
// These run for as long as the page's own script or load takes, and Playwright bounds them itself.
const PAGE_PACED_METHODS = new Set(['Runtime.evaluate', 'Runtime.callFunctionOn', 'Runtime.awaitPromise', 'Page.navigate', 'Page.reload', 'Page.printToPDF']);

function envMilliseconds(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
```

Replace the `sendCommand` closure in the constructor:

```ts
    const sendTimeout = envMilliseconds('PLAYWRIGHT_MCP_RELAY_SEND_TIMEOUT', DEFAULT_SEND_TIMEOUT_MS);
    const pagePacedTimeout = Math.max(sendTimeout, envMilliseconds('PLAYWRIGHT_MCP_RELAY_PAGE_PACED_TIMEOUT', DEFAULT_PAGE_PACED_TIMEOUT_MS));
    const sendCommand = (method: string, params: any): Promise<any> => {
      if (!this._extensionConnection)
        throw new Error('Extension not connected');
      const cdpMethod = method === 'chrome.debugger.sendCommand' ? params?.[1] : undefined;
      const timeout = PAGE_PACED_METHODS.has(cdpMethod) ? pagePacedTimeout : sendTimeout;
      return this._extensionConnection.send(method as keyof ExtensionCommandV2, params, timeout);
    };
```

In `ExtensionConnection`, give each pending callback its timer and clear it wherever the callback leaves the map:

```ts
  private readonly _callbacks = new Map<number, { resolve: (o: any) => void, reject: (e: Error) => void, error: Error, timer: NodeJS.Timeout }>();

  async send<M extends keyof ExtensionCommandV2>(method: M, params: ExtensionCommandV2[M]['params'], timeoutMs: number): Promise<any> {
    if (this._ws.readyState !== ws.OPEN)
      throw new Error(`Unexpected WebSocket state: ${this._ws.readyState}`);
    const id = ++this._lastId;
    this._ws.send(JSON.stringify({ id, method, params }));
    const error = new Error(`Protocol error: ${method}`);
    const label = method === 'chrome.debugger.sendCommand' ? (params as any[])[1] : method;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._callbacks.delete(id);
        reject(new Error(`Relay timeout: ${label} got no reply from the extension within ${timeoutMs}ms`));
      }, timeoutMs);
      this._callbacks.set(id, { resolve, reject, error, timer });
    });
  }
```

In `_handleParsedMessage`, after `this._callbacks.delete(object.id);` add `clearTimeout(callback.timer);`. In `_dispose`, call `clearTimeout(callback.timer);` for each callback before rejecting it. A reply for an id that already timed out falls into the existing "unexpected response" branch, which only logs.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/extension/relay-send-timeout.node.test.mjs tests/extension/cdp-relay-stop.node.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run flint
git add packages/playwright-core/src/tools/mcp/cdpRelay.ts tests/extension/relay-send-timeout.node.test.mjs
git commit -m "fix(mcp): time out every relay send instead of hanging the session"
```

### Task 2: The capture tool, at 1x: rules, sidecar and where it writes

A straight port of the shipped macro's rules into a tool that writes its own PNG and sidecar. The screenshot is still `page.screenshot({ scale: 'css' })` here; Task 3 makes it 2x.

**Files:**
- Create: `packages/playwright-core/src/tools/backend/captureEvidence.ts`
- Modify: `packages/playwright-core/src/tools/backend/tools.ts` (import and spread `captureEvidence` beside `screenshot`)
- Modify, adding `captureDir` wherever `outputDir` is declared or copied: `packages/playwright-core/src/tools/backend/context.ts:49`, `packages/playwright-core/src/tools/mcp/config.ts:65`, `:394` (`captureDir: cliOptions.captureDir`), `:448` (`options.captureDir = envToString(e.PLAYWRIGHT_MCP_CAPTURE_DIR);`), `packages/playwright-core/src/tools/mcp/config.d.ts:183`, `packages/playwright-core/src/tools/mcp/configIni.ts:163`, `packages/playwright-core/src/tools/mcp/program.ts:62`
- Modify: `tests/mcp/capabilities.spec.ts` (add `'browser_capture_evidence'` to the core tool set)
- Test: `tests/mcp/capture-evidence.spec.ts`

**Interfaces:**
- Produces: the MCP tool `browser_capture_evidence` with arguments `{ targets: Record<string, string>, frame?: "auto" | string, out: string }`. Its text result is one JSON object: on success the sidecar's fields plus `png` and `sidecar` (absolute paths); on a rule failure `{ failedStep, error?, missed?, frameSnap? }`.
- Produces: `--capture-dir <path>` / `PLAYWRIGHT_MCP_CAPTURE_DIR` / config `captureDir`; unset means the output directory.
- Produces for Task 3: `async function shoot(page): Promise<{ png: Buffer, scale: 1 | 2, width: number, height: number }>` and `function bounded<T>(step: string, work: Promise<T>): Promise<T>` inside `captureEvidence.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mcp/capture-evidence.spec.ts  (after the licence header)
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { test, expect, parseResponse } from './fixtures';

const CARD = `<body style="margin:0;font:14px/1.4 Helvetica,Arial,sans-serif;background:#f4f5f7">
  <main style="padding:24px">
    <section data-testid="card" style="width:420px;padding:16px;background:#fff;border:1px solid #ccd;border-radius:8px">
      <h3 data-testid="heading" style="margin:0 0 8px">Release checklist</h3>
      <p data-testid="owner">Owner: Avery Quinn</p>
      <p data-testid="reviewer">Reviewer: Blake Imani</p>
      <span data-testid="badge" style="display:inline-block;width:12px;height:12px;border-radius:6px;background:#2563eb"></span>
    </section>
    <ul><li><button>Edit</button> <span>Alpha</span></li><li data-testid="row-b"><button>Edit</button> <span>Bravo</span></li></ul>
  </main></body>`;

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"></head>${body}</html>`;

async function start(startClient: any, server: any, testInfo: any, html = CARD, extra: { args?: string[], env?: Record<string, string> } = {}) {
  const captureDir = testInfo.outputPath('captures');
  server.setContent('/', page(html), 'text/html');
  const { client } = await startClient({
    args: [`--output-dir=${testInfo.outputPath('output')}`, `--capture-dir=${captureDir}`, '--viewport-size=1000x700', ...(extra.args ?? [])],
    env: extra.env,
  });
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  const capture = async (args: Record<string, unknown>) => {
    const response = await client.callTool({ name: 'browser_capture_evidence', arguments: args });
    const text = (response.content as any[]).find(c => c.type === 'text').text as string;
    if (response.isError)
      return { isError: true, text };
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  };
  return { client, capture, captureDir };
}

test('auto frame snaps to the card, and the tool writes the png and a sidecar compose accepts', async ({ startClient, server }, testInfo) => {
  const { capture, captureDir } = await start(startClient, server, testInfo);
  const result = await capture({ targets: { owner: '[data-testid=owner]', reviewer: '[data-testid=reviewer]' }, out: 'board.c1' });
  expect(result.failedStep).toBeUndefined();
  expect(result.schemaVersion).toBe('capture-evidence/1');
  expect(result.source).toBe('live');
  expect(result.frameSnap).toBe('card');
  expect(result.image).toBe('board.c1.png');
  expect(result.png).toBe(path.join(captureDir, 'board.c1.png'));
  expect(result.sidecar).toBe(path.join(captureDir, 'board.c1.capture.json'));
  expect(Object.keys(result.boxes).sort()).toEqual(['owner', 'reviewer']);
  expect(result.frame[2]).toBeLessThan(1000);
  expect(result.missed).toEqual([]);
  expect(result.dark).toBe(false);

  const sidecar = JSON.parse(fs.readFileSync(result.sidecar, 'utf8'));
  expect(Object.keys(sidecar).sort()).toEqual(['boxes', 'dark', 'digest', 'frame', 'frameSnap', 'image', 'missed', 'schemaVersion', 'scale', 'source']);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(result.png))
      .update(JSON.stringify({ frame: sidecar.frame, boxes: sidecar.boxes })).digest('hex');
  expect(sidecar.digest).toBe(digest);
});

test('a selector that is not valid syntax fails the call, and the next capture still works', async ({ startClient, server }, testInfo) => {
  const { client, capture } = await start(startClient, server, testInfo);
  const bad = await capture({ targets: { owner: '[data-testid=owner]', bad: 'nope=anything' }, out: 'bad' });
  expect(bad.isError).toBe(true);
  expect(bad.text).toContain('nope');
  const left = await client.callTool({ name: 'browser_evaluate', arguments: { function: '() => document.querySelectorAll("[data-ev-key],[data-ev-frame]").length' } });
  expect(parseResponse(left).result).toContain('0');
  const ok = await capture({ targets: { owner: '[data-testid=owner]' }, out: 'bad' });
  expect(Object.keys(ok.boxes)).toEqual(['owner']);
});

test('an ambiguous selector and a selector with no match are missed, never guessed', async ({ startClient, server }, testInfo) => {
  const { capture } = await start(startClient, server, testInfo);
  const result = await capture({ targets: { edit: 'button', gone: '[data-testid=nothing]', bravo: '[data-testid=row-b] >> text=Bravo' }, out: 'missed' });
  expect(result.missed).toEqual([{ key: 'edit', reason: 'ambiguous', count: 2 }, { key: 'gone', reason: 'no-match' }]);
  expect(Object.keys(result.boxes)).toEqual(['bravo']);
});

test('no selector matching one element fails at resolve and writes nothing', async ({ startClient, server }, testInfo) => {
  const { capture, captureDir } = await start(startClient, server, testInfo);
  const result = await capture({ targets: { edit: 'button' }, out: 'none' });
  expect(result).toEqual({ failedStep: 'resolve', missed: [{ key: 'edit', reason: 'ambiguous', count: 2 }] });
  expect(fs.existsSync(path.join(captureDir, 'none.png'))).toBe(false);
});

test('bad arguments fail at args', async ({ startClient, server }, testInfo) => {
  const { capture } = await start(startClient, server, testInfo);
  expect(await capture({ targets: { owner: '[data-testid=owner]' }, out: '../escape' })).toEqual({ failedStep: 'args', error: 'out must be a simple file name' });
  expect(await capture({ targets: {}, out: 'empty' })).toEqual({ failedStep: 'args', error: 'targets is required' });
});

test('a dark surface is reported as dark', async ({ startClient, server }, testInfo) => {
  const { capture } = await start(startClient, server, testInfo, `<body style="margin:0;background:#0b0920;color:#fff">
    <section style="margin:24px;padding:16px;width:400px;border:1px solid #445;min-height:80px"><p data-testid="value">Status: shipped</p></section></body>`);
  expect((await capture({ targets: { value: '[data-testid=value]' }, out: 'dark' })).dark).toBe(true);
});

test('a heading-only strip is not a frame: the union is used and reported', async ({ startClient, server }, testInfo) => {
  const { capture } = await start(startClient, server, testInfo, `<body style="margin:0">
    <div style="background:#eef;padding:8px 24px"><h2 data-testid="heading" style="margin:0;font-size:22px">Milestones</h2></div>
    <p style="padding:24px">Body text</p></body>`);
  expect((await capture({ targets: { heading: '[data-testid=heading]' }, out: 'strip' })).frameSnap).toBe('union');
});

test('a card under 64px tall is skipped and the next ancestor that qualifies is the frame', async ({ startClient, server }, testInfo) => {
  const { capture } = await start(startClient, server, testInfo, `<body style="margin:0">
    <section data-testid="list" style="margin:24px;padding:12px;width:400px;border:1px solid #ccd">
      <div data-testid="row" style="height:46px;border:1px solid #dde;padding:0 8px;display:flex;align-items:center">
        <span data-testid="chip" style="font-size:12px">Blocked</span></div>
      <div style="height:46px;border:1px solid #dde">Second task</div>
    </section></body>`);
  const result = await capture({ targets: { chip: '[data-testid=chip]' }, out: 'compact' });
  expect(result.frameSnap).toBe('card');
  expect(result.frame[3]).toBeGreaterThan(100);
});

test('targets too far apart for one frame capture nothing', async ({ startClient, server }, testInfo) => {
  const { capture, captureDir } = await start(startClient, server, testInfo, `<body style="margin:0">
    <p data-testid="top">Top</p><div style="height:3000px"></div><p data-testid="bottom">Bottom</p></body>`);
  const result = await capture({ targets: { top: '[data-testid=top]', bottom: '[data-testid=bottom]' }, out: 'far' });
  expect(result).toEqual({ failedStep: 'frame', frameSnap: 'too-large', error: 'the targets cannot share one viewport-sized frame' });
  expect(fs.existsSync(path.join(captureDir, 'far.png'))).toBe(false);
});

test('a tiny badge is measured', async ({ startClient, server }, testInfo) => {
  const { capture } = await start(startClient, server, testInfo);
  const result = await capture({ targets: { badge: '[data-testid=badge]', heading: '[data-testid=heading]' }, out: 'badge' });
  expect(result.boxes.badge[2]).toBe(12);
  expect(result.boxes.badge[3]).toBe(12);
});

test('a target clipped by the viewport edge is missed as out-of-view', async ({ startClient, server }, testInfo) => {
  const { capture } = await start(startClient, server, testInfo, `<body style="margin:0;overflow:hidden">
    <p data-testid="inside" style="margin:24px 24px 24px 300px">Inside</p>
    <p data-testid="clipped" style="position:absolute;top:60px;left:940px;width:100px;margin:0">Clipped</p></body>`);
  const result = await capture({ targets: { inside: '[data-testid=inside]', clipped: '[data-testid=clipped]' }, out: 'clip' });
  expect(result.missed).toEqual([{ key: 'clipped', reason: 'out-of-view' }]);
  expect(Object.keys(result.boxes)).toEqual(['inside']);
});

test('a hidden target is missed as not-visible', async ({ startClient, server }, testInfo) => {
  const { capture } = await start(startClient, server, testInfo, `<body><p data-testid="shown">Shown</p><p data-testid="hidden" style="display:none">Hidden</p></body>`);
  const result = await capture({ targets: { shown: '[data-testid=shown]', hidden: '[data-testid=hidden]' }, out: 'hidden' });
  expect(result.missed).toEqual([{ key: 'hidden', reason: 'not-visible' }]);
});

test('a frame selector must match one element, contain every target and fit the viewport', async ({ startClient, server }, testInfo) => {
  const { capture } = await start(startClient, server, testInfo, `<body style="margin:0">
    <section data-testid="panel" style="margin:24px;padding:16px;width:300px;border:1px solid #ccd"><p data-testid="in">In</p></section>
    <p data-testid="out" style="margin:24px">Out</p>
    <section data-testid="tall" style="margin:24px;padding:16px;width:300px;height:1200px;border:1px solid #ccd"><p data-testid="deep">Deep</p></section></body>`);
  expect(await capture({ frame: '[data-testid=nothing]', targets: { in: '[data-testid=in]' }, out: 'f1' }))
      .toEqual({ failedStep: 'frame', error: 'the frame selector must match exactly one element' });
  expect(await capture({ frame: '[data-testid=panel]', targets: { in: '[data-testid=in]', out: '[data-testid=out]' }, out: 'f2' }))
      .toEqual({ failedStep: 'frame', error: 'the frame selector does not contain every target' });
  expect(await capture({ frame: '[data-testid=tall]', targets: { deep: '[data-testid=deep]' }, out: 'f3' }))
      .toEqual({ failedStep: 'frame', error: 'the frame selector is larger than the viewport' });
  const ok = await capture({ frame: '[data-testid=panel]', targets: { in: '[data-testid=in]' }, out: 'f4' });
  expect(ok.frameSnap).toBe('selector');
});

test('a failed call leaves no tags behind for the next call on the same page', async ({ startClient, server }, testInfo) => {
  const { client, capture } = await start(startClient, server, testInfo);
  const first = await capture({ frame: '[data-testid=nothing]', targets: { owner: '[data-testid=owner]' }, out: 'tags' });
  expect(first.failedStep).toBe('frame');
  const second = await capture({ targets: { reviewer: '[data-testid=reviewer]' }, out: 'tags' });
  expect(Object.keys(second.boxes)).toEqual(['reviewer']);
  expect(second.frameSnap).not.toBe('selector');
  const left = await client.callTool({ name: 'browser_evaluate', arguments: { function: '() => document.querySelectorAll("[data-ev-key],[data-ev-frame]").length' } });
  expect(parseResponse(left).result).toContain('0');
});

test('capturing again with the same out replaces both files with a matching pair', async ({ startClient, server }, testInfo) => {
  const { client, capture } = await start(startClient, server, testInfo);
  await capture({ targets: { owner: '[data-testid=owner]' }, out: 'again' });
  await client.callTool({ name: 'browser_evaluate', arguments: { function: '() => { document.querySelector("[data-testid=owner]").textContent = "Owner: Casey Lund"; }' } });
  const result = await capture({ targets: { owner: '[data-testid=owner]' }, out: 'again' });
  const sidecar = JSON.parse(fs.readFileSync(result.sidecar, 'utf8'));
  const digest = crypto.createHash('sha256').update(fs.readFileSync(result.png))
      .update(JSON.stringify({ frame: sidecar.frame, boxes: sidecar.boxes })).digest('hex');
  expect(sidecar.digest).toBe(digest);
});

test('without --capture-dir the capture lands in the output directory', async ({ startClient, server }, testInfo) => {
  server.setContent('/', page(CARD), 'text/html');
  const outputDir = testInfo.outputPath('output');
  const { client } = await startClient({ args: [`--output-dir=${outputDir}`] });
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  await client.callTool({ name: 'browser_capture_evidence', arguments: { targets: { owner: '[data-testid=owner]' }, out: 'default' } });
  expect(fs.existsSync(path.join(outputDir, 'default.capture.json'))).toBe(true);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node utils/build/build.js && npx playwright test --config=tests/mcp/playwright.config.ts --project=chromium capture-evidence`
Expected: FAIL, the server rejects the unknown option `--capture-dir` or reports the tool as not found.

- [ ] **Step 3: Add the `captureDir` option**

At each location listed under Files, add the option beside `outputDir` in the same form that line uses. The CLI line in `program.ts`:

```ts
      .option('--capture-dir <path>', 'path to the directory browser_capture_evidence writes its png and sidecar into. Defaults to the output directory.')
```

The documentation comment in `config.d.ts`:

```ts
  /**
   * The directory browser_capture_evidence writes captures into. Defaults to the output directory.
   */
  captureDir?: string;
```

- [ ] **Step 4: Write the tool**

```ts
// packages/playwright-core/src/tools/backend/captureEvidence.ts  (after the licence header used by screenshot.ts)
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import * as z from 'zod';

import { outputDir } from './context';
import { defineTabTool } from './tool';

import type * as playwright from '../../..';
import type { Tab } from './tab';

const SCHEMA = 'capture-evidence/1';
const OUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CALL_TIMEOUT_MS = 10_000;
const SETTLE_MS = 350;

type Box = [number, number, number, number];
type Missed = { key: string, reason: 'no-match' | 'ambiguous' | 'not-visible' | 'out-of-view', count?: number };
type Failure = { failedStep: 'args' | 'resolve' | 'frame' | 'measure', error?: string, missed?: Missed[], frameSnap?: 'too-large' };
type Shot = { png: Buffer, scale: 1 | 2, width: number, height: number };

const captureSchema = z.object({
  targets: z.record(z.string(), z.string()).describe('Elements to measure: a short key for each, mapped to a selector that matches exactly one element.'),
  frame: z.string().default('auto').describe('"auto" crops to the nearest card that holds every target. A selector crops to that element instead; it must match one element, contain every target and fit the viewport.'),
  out: z.string().describe('Base file name of the capture, for example "board.c1". The tool writes <out>.png and <out>.capture.json.'),
});

function callTimeout(): number {
  const value = Number(process.env.PLAYWRIGHT_MCP_CAPTURE_TIMEOUT);
  return Number.isFinite(value) && value > 0 ? value : CALL_TIMEOUT_MS;
}

// Every browser call in a capture goes through here, so no relay stall can hang the tool.
export async function bounded<T>(step: string, work: Promise<T>): Promise<T> {
  const ms = callTimeout();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`capture timed out after ${ms}ms at ${step}`)), ms);
  });
  // The call may still fail after the deadline has already been reported.
  work.catch(() => {});
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

// The four functions below are serialized into the page: each may reference nothing outside its own body.

function clearTags() {
  document.querySelectorAll('[data-ev-key]').forEach(e => e.removeAttribute('data-ev-key'));
  document.querySelectorAll('[data-ev-frame]').forEach(e => e.removeAttribute('data-ev-frame'));
}

function checkFrame() {
  const f = document.querySelector('[data-ev-frame]')!.getBoundingClientRect();
  const contains = Array.from(document.querySelectorAll('[data-ev-key]')).every(e => {
    const r = e.getBoundingClientRect();
    return r.left >= f.left - 1 && r.top >= f.top - 1 && r.right <= f.right + 1 && r.bottom <= f.bottom + 1;
  });
  return { contains, fits: f.width <= innerWidth && f.height <= innerHeight };
}

function placeFrame() {
  const elements = Array.from(document.querySelectorAll('[data-ev-key]'));
  const rects = elements.map(e => e.getBoundingClientRect());
  const x = Math.min(...rects.map(r => r.left)); const y = Math.min(...rects.map(r => r.top));
  const u = { w: Math.max(...rects.map(r => r.right)) - x, h: Math.max(...rects.map(r => r.bottom)) - y };
  if (u.w > innerWidth || u.h > innerHeight * 0.9)
    return { snap: 'too-large' as const };
  let chosen = document.querySelector('[data-ev-frame]');
  let snap: 'selector' | 'card' | 'union' = chosen ? 'selector' : 'card';
  if (!chosen) {
    const chain = (e: Element) => { const list: Element[] = []; for (let n: Element | null = e; n; n = n.parentElement) list.push(n); return list; };
    const common = chain(elements[0]).find(n => elements.every(e => n.contains(e)));
    for (let n: Element | null | undefined = common; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n); const r = n.getBoundingClientRect();
      const edged = parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderBottomWidth) > 0 || s.boxShadow !== 'none'
        || (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent');
      // A heading-only strip is not a card: require room for content beyond the targets themselves.
      const roomy = r.height >= Math.max(64, u.h + 24) && r.width >= 120;
      if (edged && roomy && r.width <= innerWidth && r.height <= innerHeight * 0.9) { chosen = n; break; }
    }
    if (!chosen)
      snap = 'union';
  }
  if (chosen) { chosen.setAttribute('data-ev-frame', ''); chosen.scrollIntoView({ block: 'center', inline: 'nearest' }); } else { elements[0].scrollIntoView({ block: 'center', inline: 'nearest' }); }
  return { snap };
}

function measureTagged() {
  const rect = (e: Element) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
  const boxes = Array.from(document.querySelectorAll('[data-ev-key]')).map(e => [e.getAttribute('data-ev-key'), rect(e)]);
  const f = document.querySelector('[data-ev-frame]');
  let dark = false;
  for (let n: Element | null = f ?? document.querySelector('[data-ev-key]'); n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor.match(/[\d.]+/g);
    if (c && (c.length < 4 || +c[3] > 0.5)) { dark = (0.299 * +c[0] + 0.587 * +c[1] + 0.114 * +c[2]) < 110; break; }
  }
  return { boxes, frame: f ? rect(f) : null, dark };
}

function pngSize(png: Buffer) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export async function shoot(page: playwright.Page): Promise<Shot> {
  const png = await bounded('screenshot', page.screenshot({ type: 'png', scale: 'css' }));
  return { png, scale: 1, ...pngSize(png) };
}

function captureDirectory(tab: Tab): string {
  const configured = tab.context.config.captureDir;
  return configured ? path.resolve(configured) : outputDir(tab.context.options);
}

async function writeAtomic(file: string, data: Buffer | string) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temp, data);
  await fs.promises.rename(temp, file);
}

async function captureEvidence(tab: Tab, params: z.output<typeof captureSchema>): Promise<Failure | Record<string, unknown>> {
  const { targets, frame, out } = params;
  if (!OUT_NAME.test(out))
    return { failedStep: 'args', error: 'out must be a simple file name' };
  const keys = Object.keys(targets);
  if (!keys.length)
    return { failedStep: 'args', error: 'targets is required' };
  const page = tab.page;
  // Tags left by an earlier call on this page would corrupt this one.
  await bounded('cleanup', page.evaluate(clearTags));
  try {
    await bounded('resolve', page.locator(targets[keys[0]]).first().waitFor({ timeout: 5000 }).catch(() => {}));
    const missed: Missed[] = [];
    let tagged = 0;
    for (const key of keys) {
      const locator = page.locator(targets[key]);
      const count = await bounded('resolve', locator.count());
      if (count !== 1) {
        missed.push(count === 0 ? { key, reason: 'no-match' } : { key, reason: 'ambiguous', count });
        continue;
      }
      await bounded('resolve', locator.evaluate((element, k) => element.setAttribute('data-ev-key', k), key, { timeout: 2000 }));
      ++tagged;
    }
    if (!tagged)
      return { failedStep: 'resolve', missed };

    if (frame !== 'auto') {
      const frameLocator = page.locator(frame);
      if (await bounded('frame', frameLocator.count()) !== 1)
        return { failedStep: 'frame', error: 'the frame selector must match exactly one element' };
      await bounded('frame', frameLocator.evaluate(element => element.setAttribute('data-ev-frame', ''), undefined, { timeout: 2000 }));
      const fit = await bounded('frame', page.evaluate(checkFrame));
      if (!fit.contains)
        return { failedStep: 'frame', error: 'the frame selector does not contain every target' };
      if (!fit.fits)
        return { failedStep: 'frame', error: 'the frame selector is larger than the viewport' };
    }
    const placed = await bounded('frame', page.evaluate(placeFrame));
    if (placed.snap === 'too-large')
      return { failedStep: 'frame', frameSnap: 'too-large', error: 'the targets cannot share one viewport-sized frame' };
    const frameSnap = frame !== 'auto' ? 'selector' : placed.snap;
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));

    // Screenshot first, then measure, with nothing page-changing in between.
    const shot = await shoot(page);
    const measured = await bounded('measure', page.evaluate(measureTagged));
    const viewport = { w: shot.width / shot.scale, h: shot.height / shot.scale };
    const boxes: Record<string, Box> = {};
    for (const [key, box] of measured.boxes as [string, Box][]) {
      if (box[2] <= 0 || box[3] <= 0) { missed.push({ key, reason: 'not-visible' }); continue; }
      if (box[0] < 0 || box[0] + box[2] > viewport.w || box[1] < 0 || box[1] + box[3] > viewport.h) { missed.push({ key, reason: 'out-of-view' }); continue; }
      boxes[key] = box;
    }
    const values = Object.values(boxes);
    if (!values.length)
      return { failedStep: 'measure', missed };
    const left = Math.min(...values.map(b => b[0])); const top = Math.min(...values.map(b => b[1]));
    const base = (measured.frame as Box | null) ?? [left, top,
      Math.max(...values.map(b => b[0] + b[2])) - left, Math.max(...values.map(b => b[1] + b[3])) - top];
    const pad = frameSnap === 'union' ? 24 : 12;
    const fx = Math.max(0, base[0] - pad); const fy = Math.max(0, base[1] - pad);
    const frameBox: Box = [fx, fy,
      Math.min(viewport.w, base[0] + base[2] + pad) - fx, Math.min(viewport.h, base[1] + base[3] + pad) - fy];

    const image = `${out}.png`;
    const digest = crypto.createHash('sha256').update(shot.png).update(JSON.stringify({ frame: frameBox, boxes })).digest('hex');
    const body = { schemaVersion: SCHEMA, source: 'live', image, frame: frameBox, frameSnap, boxes, missed, dark: measured.dark, scale: shot.scale, digest };
    const dir = captureDirectory(tab);
    await fs.promises.mkdir(dir, { recursive: true });
    const pngPath = path.join(dir, image);
    const sidecarPath = path.join(dir, `${out}.capture.json`);
    await writeAtomic(pngPath, shot.png);
    await writeAtomic(sidecarPath, `${JSON.stringify(body, null, 2)}\n`);
    return { ...body, png: pngPath, sidecar: sidecarPath };
  } finally {
    await bounded('cleanup', page.evaluate(clearTags)).catch(() => {});
  }
}

const captureEvidenceTool = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_capture_evidence',
    title: 'Capture evidence',
    description: 'Screenshot the viewport and measure named elements for `fast-browser compose`. Writes the PNG and its capture sidecar, and returns the sidecar fields with both paths. A selector that matches no element, or several, is listed in `missed` and never guessed.',
    inputSchema: captureSchema,
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    response.addTextResult(JSON.stringify(await captureEvidence(tab, params), null, 2));
  },
});

export default [
  captureEvidenceTool,
];
```

Register it in `tools.ts`: `import captureEvidence from './captureEvidence';` as the first tool import and `...captureEvidence,` as the first entry of `browserTools` (both lists are alphabetical). If `tsc` rejects DOM globals in the page functions, follow how `devLoginFill.ts` types its serialized function.

- [ ] **Step 5: Run the tests**

Run: `node utils/build/build.js && npx playwright test --config=tests/mcp/playwright.config.ts --project=chromium capture-evidence capabilities`
Expected: PASS. If the compact-card or strip page snaps differently than asserted, fix the page's HTML so it exercises the rule as named; do not change the rule.

- [ ] **Step 6: Lint and commit**

```bash
npm run flint
git add packages/playwright-core/src/tools/backend/captureEvidence.ts packages/playwright-core/src/tools/backend/tools.ts \
  packages/playwright-core/src/tools/backend/context.ts packages/playwright-core/src/tools/mcp/config.ts \
  packages/playwright-core/src/tools/mcp/config.d.ts packages/playwright-core/src/tools/mcp/configIni.ts \
  packages/playwright-core/src/tools/mcp/program.ts tests/mcp/capture-evidence.spec.ts tests/mcp/capabilities.spec.ts
git commit -m "feat(mcp): add browser_capture_evidence, a capture tool that writes its own sidecar"
```

If `npm run flint` regenerates a file (CLI help, config docs), stage that file too.

### Task 3: 2x through the page's existing session

**Files:**
- Modify: `packages/playwright-core/src/tools/backend/captureEvidence.ts` (replace `shoot`)
- Test: `tests/mcp/capture-evidence.spec.ts` (append)

**Interfaces:**
- Consumes: `bounded`, `pngSize`, the `Shot` type from Task 2.
- Produces: `shoot(page)` returns `scale: 2` and a PNG exactly twice the CSS viewport on Chromium, `scale: 1` on other browsers. `PLAYWRIGHT_MCP_CAPTURE_2X=override` selects the metrics-override strategy.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mcp/capture-evidence.spec.ts`:

```ts
import { PNG } from '../../packages/playwright-core/lib/utilsBundle';

const SHARP = `<body style="margin:0;background:#fff;font:14px/1.4 Helvetica,Arial,sans-serif">
  <section data-testid="card" style="margin:24px;padding:16px;width:420px;border:1px solid #ccd;border-radius:8px">
    <h3 style="margin:0 0 8px">Release checklist</h3>
    <p data-testid="line">The quick brown fox jumps over the lazy dog, 0123456789.</p>
    <p style="font-size:11px;color:#555">Small print: reviewers Avery, Blake and Casey signed off.</p>
  </section></body>`;

function differing(a: any, b: any) {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > 16 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 16 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 16)
      ++count;
  }
  return count;
}

function upscaled(image: any) {
  const out = new PNG({ width: image.width * 2, height: image.height * 2 });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const from = ((y >> 1) * image.width + (x >> 1)) * 4;
      image.data.copy(out.data, (y * out.width + x) * 4, from, from + 4);
    }
  }
  return out;
}

for (const strategy of ['clip', 'override']) {
  test(`a 2x capture (${strategy}) matches a native DPR 2 render, and an upscaled 1x does not`, async ({ startClient, server, mcpBrowser }, testInfo) => {
    test.skip(!['chromium', 'chrome'].includes(mcpBrowser!), 'the 2x path is Chromium only');
    const { client, capture } = await start(startClient, server, testInfo, SHARP, { env: { PLAYWRIGHT_MCP_CAPTURE_2X: strategy } });
    const result = await capture({ targets: { line: '[data-testid=line]' }, out: 'sharp' });
    expect(result.scale).toBe(2);
    const tool = PNG.sync.read(fs.readFileSync(result.png));
    expect([tool.width, tool.height]).toEqual([2000, 1400]);

    const onePath = testInfo.outputPath('output', 'one.png');
    await client.callTool({ name: 'browser_take_screenshot', arguments: { filename: 'one.png', scale: 'css' } });
    const control = upscaled(PNG.sync.read(fs.readFileSync(onePath)));

    const { client: native } = await startClient({
      args: [`--output-dir=${testInfo.outputPath('native')}`],
      config: { browser: { contextOptions: { viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 } } },
    });
    await native.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
    await native.callTool({ name: 'browser_take_screenshot', arguments: { filename: 'native.png', scale: 'device' } });
    const reference = PNG.sync.read(fs.readFileSync(testInfo.outputPath('native', 'native.png')));

    const controlDiff = differing(control, reference);
    expect(controlDiff, 'the page has enough text for an upscale to show').toBeGreaterThan(2000);
    expect(differing(tool, reference) * 50).toBeLessThanOrEqual(controlDiff);
  });
}

test('after an override capture the page is back at its own device scale', async ({ startClient, server, mcpBrowser }, testInfo) => {
  test.skip(!['chromium', 'chrome'].includes(mcpBrowser!), 'the 2x path is Chromium only');
  const { client, capture } = await start(startClient, server, testInfo, SHARP, { env: { PLAYWRIGHT_MCP_CAPTURE_2X: 'override' } });
  await capture({ targets: { line: '[data-testid=line]' }, out: 'restore' });
  const ratio = await client.callTool({ name: 'browser_evaluate', arguments: { function: '() => `dpr=${devicePixelRatio} width=${innerWidth}`' } });
  expect(parseResponse(ratio).result).toContain('dpr=1 width=1000');
});

test('a fractional device scale still yields exactly twice the viewport', async ({ startClient, server, mcpBrowser }, testInfo) => {
  test.skip(!['chromium', 'chrome'].includes(mcpBrowser!), 'the 2x path is Chromium only');
  server.setContent('/', page(SHARP), 'text/html');
  const captureDir = testInfo.outputPath('captures');
  const { client } = await startClient({
    args: [`--output-dir=${testInfo.outputPath('output')}`, `--capture-dir=${captureDir}`],
    config: { browser: { contextOptions: { viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1.5 } } },
  });
  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX } });
  await client.callTool({ name: 'browser_capture_evidence', arguments: { targets: { line: '[data-testid=line]' }, out: 'fraction' } });
  const sidecar = JSON.parse(fs.readFileSync(path.join(captureDir, 'fraction.capture.json'), 'utf8'));
  const image = PNG.sync.read(fs.readFileSync(path.join(captureDir, 'fraction.png')));
  expect(sidecar.scale).toBe(2);
  expect([image.width, image.height]).toEqual([2000, 1400]);
});

test('a target below the fold: the reported box lands on the element in the image', async ({ startClient, server, mcpBrowser }, testInfo) => {
  test.skip(!['chromium', 'chrome'].includes(mcpBrowser!), 'the 2x path is Chromium only');
  const { capture } = await start(startClient, server, testInfo, `<body style="margin:0;background:#fff">
    <div style="height:2400px"></div>
    <section style="margin:24px;padding:16px;width:300px;height:120px;border:1px solid #ccd">
      <div data-testid="swatch" style="width:40px;height:40px;background:rgb(200,30,60)"></div></section>
    <div style="height:2400px"></div></body>`);
  const result = await capture({ targets: { swatch: '[data-testid=swatch]' }, out: 'fold' });
  expect(result.scale).toBe(2);
  const [x, y, w, h] = result.boxes.swatch;
  const image = PNG.sync.read(fs.readFileSync(result.png));
  const at = (2 * Math.round(y + h / 2) * image.width + 2 * Math.round(x + w / 2)) * 4;
  expect([image.data[at], image.data[at + 1], image.data[at + 2]]).toEqual([200, 30, 60]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node utils/build/build.js && npx playwright test --config=tests/mcp/playwright.config.ts --project=chromium capture-evidence -g "2x|fractional|below the fold|override"`
Expected: FAIL on `expect(result.scale).toBe(2)`.

- [ ] **Step 3: Implement**

Replace `shoot` in `captureEvidence.ts`:

```ts
type FrameSession = { _client: { send: (method: string, params?: object) => Promise<any> }, _metricsOverride?: Record<string, unknown> & { deviceScaleFactor?: number } };

function chromiumFrameSession(page: playwright.Page): FrameSession | undefined {
  // eslint-disable-next-line no-restricted-syntax -- the page's existing CDP session is only reachable on the in-process server objects; a new session would kill the extension relay.
  const serverPage = (page as any)._connection?.toImpl?.(page);
  const frameSession = serverPage?.delegate?._mainFrameSession;
  return typeof frameSession?._client?.send === 'function' ? frameSession : undefined;
}

export async function shoot(page: playwright.Page): Promise<Shot> {
  const frameSession = chromiumFrameSession(page);
  if (!frameSession) {
    const png = await bounded('screenshot', page.screenshot({ type: 'png', scale: 'css' }));
    return { png, scale: 1, ...pngSize(png) };
  }
  const client = frameSession._client;
  const metrics = await bounded('screenshot', client.send('Page.getLayoutMetrics'));
  const view = metrics.cssVisualViewport;
  const clip = { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight };
  const override = frameSession._metricsOverride;
  // Same rule as CRPage.takeScreenshot: an emulated device scale does not show in the layout metrics.
  const deviceScale = override?.deviceScaleFactor || metrics.contentSize.width / metrics.cssContentSize.width || 1;
  const take = async (scale: number) => {
    const result = await bounded('screenshot', client.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale }, captureBeyondViewport: false }));
    return Buffer.from(result.data, 'base64');
  };
  const forced = process.env.PLAYWRIGHT_MCP_CAPTURE_2X;
  // 2 / deviceScale is exact only at 1 and 2; at any other scale the image could round a pixel off.
  const useOverride = forced === 'override' || (forced !== 'clip' && deviceScale !== 1 && deviceScale !== 2);
  let png: Buffer;
  if (useOverride) {
    await bounded('screenshot', client.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, mobile: false, ...override, deviceScaleFactor: 2 }));
    try {
      png = await take(1);
      // The boxes are measured after the override is gone, so the page must not have laid out differently under it.
      const during = (await bounded('screenshot', client.send('Page.getLayoutMetrics'))).cssVisualViewport;
      if (during.clientWidth !== clip.width || during.clientHeight !== clip.height)
        throw new Error('the page lays out differently at 2x; reset the browser zoom to 100% and capture again');
    } finally {
      await bounded('screenshot', override ? client.send('Emulation.setDeviceMetricsOverride', override) : client.send('Emulation.clearDeviceMetricsOverride')).catch(() => {});
    }
  } else {
    png = await take(2 / deviceScale);
  }
  const size = pngSize(png);
  if (size.width !== Math.round(clip.width * 2) || size.height !== Math.round(clip.height * 2))
    throw new Error(`the capture came back at ${size.width}x${size.height}, not twice the ${clip.width}x${clip.height} viewport; reset the browser zoom to 100% and capture again`);
  return { png, scale: 2, ...size };
}
```

Update the tool description's first sentence to "Screenshot the viewport at 2x and measure named elements for `fast-browser compose`."

- [ ] **Step 4: Run the whole spec**

Run: `node utils/build/build.js && npx playwright test --config=tests/mcp/playwright.config.ts --project=chromium capture-evidence`
Expected: PASS, including the Task 2 tests, whose boxes stay in CSS pixels. If a strategy's sharpness test fails, report the two differing counts; do not widen the ratio.

- [ ] **Step 5: Lint and commit**

```bash
npm run flint
git add packages/playwright-core/src/tools/backend/captureEvidence.ts tests/mcp/capture-evidence.spec.ts
git commit -m "feat(mcp): capture evidence at 2x on the page's existing session"
```

### Task 4: No capture can hang, and a capture is a readback

**Files:**
- Modify: `packages/playwright-core/src/tools/backend/browserBackend.ts:31-41` (`READBACK_TOOLS`)
- Modify: `tests/mcp/devlogin-readback.spec.ts:23-29` (the `READBACK` list)
- Test: `tests/mcp/capture-evidence.spec.ts` (append)

**Interfaces:**
- Consumes: `bounded` and `PLAYWRIGHT_MCP_CAPTURE_TIMEOUT` from Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mcp/capture-evidence.spec.ts`:

```ts
test('a page that stalls mid-capture returns an error within the deadline, not a hang', async ({ startClient, server }, testInfo) => {
  test.setTimeout(30_000);
  const { capture } = await start(startClient, server, testInfo, `<body><p data-testid="a">One</p><p data-testid="b">Two</p>
    <script>new MutationObserver(() => { for (;;) {} }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-ev-key'] });</script></body>`,
  { env: { PLAYWRIGHT_MCP_CAPTURE_TIMEOUT: '1500' } });
  const started = Date.now();
  const result = await capture({ targets: { a: '[data-testid=a]', b: '[data-testid=b]' }, out: 'stall' });
  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/capture timed out after 1500ms at (resolve|frame|measure|screenshot)/);
  expect(Date.now() - started).toBeLessThan(10_000);
});
```

In `tests/mcp/devlogin-readback.spec.ts`, add one entry to the `READBACK` list, after the `browser_take_screenshot` entry:

```ts
  { name: 'browser_capture_evidence', arguments: { targets: { field: '#pw' }, out: 'readback' } },
```

- [ ] **Step 2: Run them**

Run: `node utils/build/build.js && npx playwright test --config=tests/mcp/playwright.config.ts --project=chrome devlogin-readback && npx playwright test --config=tests/mcp/playwright.config.ts --project=chromium capture-evidence -g stalls`
Expected: the readback tests FAIL for `browser_capture_evidence` (the capture is allowed while the saved login is on the page). The stall test should already PASS from Task 2's `bounded`; if it hangs or fails, the deadline has a hole and this task fixes it. The `chrome` project launches the installed Chrome headless with a temporary profile, as the existing devlogin specs do.

- [ ] **Step 3: Implement**

Add `'browser_capture_evidence',` to `READBACK_TOOLS` in `browserBackend.ts`, after `'browser_take_screenshot',`.

Then audit `captureEvidence.ts`: every `await` that reaches the browser (`page.evaluate`, `locator.count`, `locator.evaluate`, `waitFor`, `page.screenshot`, every `client.send`) must be the argument of `bounded(...)`. List each one with its line in the task report.

- [ ] **Step 4: Run the tests**

Run: the two commands from Step 2.
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run flint
git add packages/playwright-core/src/tools/backend/browserBackend.ts tests/mcp/devlogin-readback.spec.ts tests/mcp/capture-evidence.spec.ts
git commit -m "fix(mcp): refuse evidence capture while a saved login is on the page, and prove a stalled page cannot hang it"
```

### Task 5: Sharpness through chrome.debugger, in the extension suite

This is the proof the spec asks for before anything depends on 2x: the capture runs through the real extension, the real relay and `chrome.debugger`, at a forced device scale of 1, and is compared with a metrics-override capture of the same tab.

**Files:**
- Modify: `tests/extension/extension-fixtures.ts` (`BrowserWithExtension.launch` gains a second parameter)
- Test: `tests/extension/capture-evidence.spec.ts`
- Possibly modify: `packages/playwright-core/src/tools/backend/captureEvidence.ts` (the default strategy, one line; see Step 5)

**Interfaces:**
- Produces: `launch(mode?: 'disable-extension', extraArgs: string[] = [])` on the `browserWithExtension` fixture.

- [ ] **Step 1: Extend the fixture**

In `extension-fixtures.ts` change the type to `launch: (mode?: 'disable-extension', extraArgs?: string[]) => Promise<BrowserContext>;` and the implementation to accept `extraArgs: string[] = []` and append `...extraArgs` after the two `--load-extension` arguments (and to the empty list in `disable-extension` mode).

- [ ] **Step 2: Write the failing test**

```ts
// tests/extension/capture-evidence.spec.ts  (after the licence header)
import fs from 'fs';

import { PNG } from '../../packages/playwright-core/lib/utilsBundle';
import { test, expect, connectAndNavigate, startWithExtensionFlag } from './extension-fixtures';

const SHARP = `<!doctype html><html><body style="margin:0;background:#fff;font:14px/1.4 Helvetica,Arial,sans-serif">
  <section data-testid="card" style="margin:24px;padding:16px;width:420px;border:1px solid #ccd;border-radius:8px">
    <h3 style="margin:0 0 8px">Release checklist</h3>
    <p data-testid="line">The quick brown fox jumps over the lazy dog, 0123456789.</p>
    <p style="font-size:11px;color:#555">Small print: reviewers Avery, Blake and Casey signed off.</p>
  </section></body></html>`;

function differing(a: any, b: any) {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > 16 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 16 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 16)
      ++count;
  }
  return count;
}

function upscaled(image: any) {
  const out = new PNG({ width: image.width * 2, height: image.height * 2 });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const from = ((y >> 1) * image.width + (x >> 1)) * 4;
      image.data.copy(out.data, (y * out.width + x) * 4, from, from + 4);
    }
  }
  return out;
}

// A capture that hangs must fail this test fast instead of running out the suite timeout.
function within<T>(ms: number, work: Promise<T>): Promise<T> {
  return Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no reply in ${ms}ms: the capture hung`)), ms))]);
}

for (const strategy of ['clip', 'override']) {
  test(`a 2x capture through chrome.debugger (${strategy}) is sharp`, async ({ browserWithExtension, startClient, server }, testInfo) => {
    test.setTimeout(90_000);
    server.setContent('/sharp.html', SHARP, 'text/html');
    const url = server.PREFIX + '/sharp.html';
    const browserContext = await browserWithExtension.launch(undefined, ['--force-device-scale-factor=1']);
    const client = await startWithExtensionFlag(browserWithExtension, startClient, {
      PLAYWRIGHT_MCP_CAPTURE_2X: strategy,
      PLAYWRIGHT_MCP_CAPTURE_DIR: testInfo.outputPath('captures'),
    });
    await connectAndNavigate(browserContext, client, url);

    const response = await within(20_000, client.callTool({ name: 'browser_capture_evidence', arguments: { targets: { line: '[data-testid=line]' }, out: 'sharp' } }));
    const text = (response.content as any[]).find(c => c.type === 'text').text as string;
    expect(response.isError, text).toBeFalsy();
    const result = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    expect(result.scale).toBe(2);
    const tool = PNG.sync.read(fs.readFileSync(result.png));

    // The reference comes from the test's own connection to the same tab, so headed rasterisation is compared with itself.
    const tab = browserContext.pages().find(p => p.url() === url)!;
    const cdp = await browserContext.newCDPSession(tab);
    const view = (await cdp.send('Page.getLayoutMetrics')).cssVisualViewport;
    const clip = { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight, scale: 1 };
    const shot = async () => PNG.sync.read(Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false })).data, 'base64'));
    const control = upscaled(await shot());
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 2, mobile: false });
    const reference = await shot();
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    expect([tool.width, tool.height]).toEqual([reference.width, reference.height]);
    const controlDiff = differing(control, reference);
    expect(controlDiff, 'the page has enough text for an upscale to show').toBeGreaterThan(2000);
    expect(differing(tool, reference) * 50).toBeLessThanOrEqual(controlDiff);
  });
}
```

- [ ] **Step 3: Run it**

Run: `node utils/build/build.js && npx playwright test --config=tests/extension/playwright.config.ts capture-evidence`
Expected: this opens a headed test Chromium with a temporary profile. With Tasks 2 to 4 in place both strategies should PASS; before the fixture change the file does not compile.

- [ ] **Step 4: If both pass, the default stays `clip`**

Nothing to change in the tool. Record both differing counts in the task report.

- [ ] **Step 5: If `clip` fails and `override` passes, make `override` the default**

In `captureEvidence.ts` change `useOverride` to `forced !== 'clip'`, rebuild, and re-run both this spec and `tests/mcp/capture-evidence.spec.ts`. If both strategies fail through `chrome.debugger`, stop and report the counts: that is a design question for Matt, not something to tune.

- [ ] **Step 6: Run the rest of the extension suite against the baseline**

Run: `npm run test-extension 2>&1 | tail -40 && node --test tests/extension/*.node.test.mjs 2>&1 | tail -15`
Expected: the same failures as `.superpowers/sdd/baseline.md` and no new one.

- [ ] **Step 7: Lint and commit**

```bash
npm run flint
git add tests/extension/extension-fixtures.ts tests/extension/capture-evidence.spec.ts
git commit -m "test(extension): prove 2x evidence capture is sharp through chrome.debugger"
```

Add `packages/playwright-core/src/tools/backend/captureEvidence.ts` to the commit if Step 5 changed it.

### Task 6: The fork's whole-suite check and a local build (controller)

**Files:** none committed.

- [ ] **Step 1: Full build, lint and the MCP suite's affected specs**

```bash
node utils/build/build.js
npm run flint
npx playwright test --config=tests/mcp/playwright.config.ts --project=chromium capture-evidence capabilities screenshot fast-browser-contract fast-browser-artifacts config
npx playwright test --config=tests/mcp/playwright.config.ts --project=chrome devlogin-readback
npm run test-extension 2>&1 | tail -40
node --test tests/extension/*.node.test.mjs
```

Expected: all green except the baseline failures.

- [ ] **Step 2: Build the artifacts locally, without publishing**

```bash
node utils/fast_browser/build_artifacts.mjs --version 0.1.3 --out-dir fast-browser-dist
ls fast-browser-dist
```

Expected: `fast-browser-mcp-0.1.3.tar.gz`, the extension zip and crx, and `fast-browser-release-0.1.3.json`. Nothing is uploaded. Extract the runtime for the next phase:

```bash
mkdir -p .superpowers/local-runtime && tar -xzf fast-browser-dist/fast-browser-mcp-0.1.3.tar.gz -C .superpowers/local-runtime
ls .superpowers/local-runtime/fast-browser-mcp/cli.cjs
```

`LOCAL_CLI` below means the absolute path of that `cli.cjs`.

---

## Phase B: fast-browser, before the pin

Every Phase B task runs in the fast-browser tree. Tests that need the tool run against the local build through `FAST_BROWSER_TEST_RUNTIME_CLI=<LOCAL_CLI>` until Task 14 pins the release.

### Task 7: Compose accepts a 2x capture and lays it out like its 1x twin

**Files:**
- Modify: `lib/compose/capture.mjs` (`loadCapture`, lines 57-77)
- Modify: `lib/commands/compose.mjs:57-62` (the scale refusal)
- Modify: `lib/compose/page.mjs:40` (one field)
- Modify: `lib/compose/page-geometry.js` (wrap the body in a factory; scale the source-pixel constants)
- Modify: `lib/compose/page-layout.js` (lines 19-24, 45, 71, 124, and one report field)
- Create: `tests/e2e/helpers/capture-sidecar.mjs`
- Test: `tests/unit/compose-capture.test.mjs`, `tests/unit/compose-command.test.mjs`, `tests/unit/compose-geometry.test.mjs`, `tests/e2e/capture-evidence.test.mjs`

**Interfaces:**
- Produces: `loadCapture` returns `frame` and `boxes` already multiplied by `scale`, and `scale` itself.
- Produces: `globalThis.__composeGeometry.withScale(scale)` returns the same API with the source-pixel constants multiplied; `__composeGeometry` itself is `withScale(1)`.
- Produces: the layout report gains `scale`. `frame`, `cleanFrame`, `lifts[].source`, `lifts[].grown` and `lifts[].pad` stay in image pixels, so they are twice as large for a 2x capture; everything positioned on the board is unchanged.
- Produces: `writeSidecar(captureReturn) -> Promise<{ sidecar, png }>` in `tests/e2e/helpers/capture-sidecar.mjs`, used again by Tasks 10 and 15.

- [ ] **Step 1: Write the sidecar helper**

```js
// tests/e2e/helpers/capture-sidecar.mjs
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CAPTURE_SCHEMA, captureDigest } from '../../../lib/compose/capture.mjs';

// The capture tool writes this file itself. Suites that capture headless with
// the helper script have no tool to call, so they write the same shape here.
export async function writeSidecar(captureReturn) {
  const png = captureReturn.png;
  const sidecar = path.join(path.dirname(png), `${path.basename(png).replace(/\.png$/i, '')}.capture.json`);
  const body = {
    schemaVersion: CAPTURE_SCHEMA, source: 'live', image: path.basename(png),
    frame: captureReturn.frame, frameSnap: captureReturn.frameSnap ?? 'card', boxes: captureReturn.boxes,
    missed: captureReturn.missed ?? [], dark: Boolean(captureReturn.dark), scale: captureReturn.scale ?? 1,
  };
  body.digest = captureDigest(await readFile(png), { frame: body.frame, boxes: body.boxes });
  await writeFile(sidecar, `${JSON.stringify(body, null, 2)}\n`);
  return { sidecar, png };
}
```

- [ ] **Step 2: Write the failing unit tests**

In `tests/unit/compose-capture.test.mjs` add (the file's `setup()` and `PNG`, a 1x1 image, already exist):

```js
import { writeSidecar } from '../e2e/helpers/capture-sidecar.mjs';

test('a 2x capture loads with its frame and boxes in image pixels', async () => {
  const { home, captureReturn } = await setup();
  try {
    // The 1x1 test image holds a half-pixel CSS frame at 2x.
    const { sidecar } = await writeSidecar({ ...captureReturn, frame: [0, 0, 0.5, 0.5], boxes: { a: [0, 0, 0.5, 0.5] }, scale: 2 });
    const capture = await loadCapture({ sidecarPath: sidecar, fail });
    assert.equal(capture.scale, 2);
    assert.deepEqual(capture.frame, [0, 0, 1, 1]);
    assert.deepEqual(capture.boxes, { a: [0, 0, 1, 1] });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a sidecar that says scale 2 over a 1x image is refused', async () => {
  const { home, captureReturn } = await setup();
  try {
    const { sidecar } = await writeSidecar({ ...captureReturn, scale: 2 });
    await assert.rejects(() => loadCapture({ sidecarPath: sidecar, fail }), /a capture sidecar does not match its image/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
```

In `tests/unit/compose-command.test.mjs` replace the test `render refuses a capture taken at a scale other than 1` with:

```js
test('render refuses a capture taken at a scale other than 1 or 2', async () => {
  const { home, paths, ret } = await world(3);
  try {
    const { sidecar } = await compose({ command: 'compose', seal: ret, spec: null }, { paths });
    const specPath = path.join(paths.screenshotsDir, 'spec.json');
    await writeFile(specPath, JSON.stringify({ state: 'AFTER', title: 'T', out: 'o.png',
      panels: [{ capture: path.basename(sidecar), marks: [] }] }));
    await assert.rejects(() => compose({ command: 'compose', spec: specPath, seal: null }, {
      paths, renderBoard: async () => { throw new Error('must not render'); },
    }), /panels\[0\]\.capture was taken at a scale this version cannot compose/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
```

In `tests/unit/compose-geometry.test.mjs` add (the file's `canvas`, `INK` and `sandbox` already exist):

```js
// Pixel replication: what a 2x capture of the same page looks like to the geometry.
function doubled(px) {
  const out = canvas(px.width * 2, px.height * 2);
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const from = ((y >> 1) * px.width + (x >> 1)) * 4;
      out.data.set(px.data.subarray(from, from + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}
const times2 = (box) => box.map((n) => n * 2);

test('at scale 2 a lift grows to twice what it grows to at scale 1', () => {
  const px = canvas(200, 60).fill(45, 24, 55, 4, INK);
  const two = sandbox.__composeGeometry.withScale(2);
  const one = growBox(px, [40, 20, 30, 12], 96).box;
  assert.deepEqual([...two.growBox(doubled(px), times2([40, 20, 30, 12]), 192).box], times2(one));
});

test('at scale 2 a crop lands on twice the crop at scale 1', () => {
  const px = canvas(600, 400).fill(250, 180, 60, 12, INK);
  const two = sandbox.__composeGeometry.withScale(2);
  const one = cropToMarks(px, [0, 0, 600, 400], [250, 180, 60, 12]).box;
  assert.deepEqual([...two.cropToMarks(doubled(px), [0, 0, 1200, 800], times2([250, 180, 60, 12])).box], times2(one));
});

test('withScale(1) is the default geometry', () => {
  const px = canvas(200, 60).fill(45, 24, 55, 4, INK);
  assert.deepEqual([...sandbox.__composeGeometry.withScale(1).growBox(px, [40, 20, 30, 12], 96).box], growBox(px, [40, 20, 30, 12], 96).box);
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `node --test tests/unit/compose-capture.test.mjs tests/unit/compose-command.test.mjs tests/unit/compose-geometry.test.mjs`
Expected: FAIL (`capture.frame` is unscaled, `withScale is not a function`). The scale 3 refusal already passes: it pins the case that must stay refused.

- [ ] **Step 4: Implement the loader and the command**

In `lib/compose/capture.mjs`, replace the tail of `loadCapture` from the digest check onward:

```js
  if (captureDigest(png, { frame: body.frame, boxes: body.boxes }) !== body.digest) {
    throw fail('a capture sidecar does not match its image');
  }
  const { width, height } = readPngSize(png);
  const scale = body.scale ?? 1;
  // The digest covers frame and boxes as written, in CSS pixels; the layout
  // works in the image's own pixels, so they are scaled only after the check.
  const toImage = (box) => (COMPOSABLE_SCALES.includes(scale) && isBox(box) ? box.map((n) => n * scale) : box);
  const frame = toImage(body.frame);
  if (isBox(frame) && COMPOSABLE_SCALES.includes(scale)
    && (frame[0] < 0 || frame[1] < 0 || frame[0] + frame[2] > width || frame[1] + frame[3] > height)) {
    throw fail('a capture sidecar does not match its image');
  }
  const boxes = Object.fromEntries(Object.entries(body.boxes ?? {}).map(([key, box]) => [key, toImage(box)]));
  return {
    sidecarPath, pngPath, png, size: [width, height],
    frame, frameSnap: body.frameSnap, boxes,
    missed: body.missed ?? [], dark: Boolean(body.dark), scale,
  };
```

and export the list near the top: `export const COMPOSABLE_SCALES = Object.freeze([1, 2]);`.

In `lib/commands/compose.mjs` import `COMPOSABLE_SCALES` from `../compose/capture.mjs` and replace lines 57-62:

```js
  // Frame and boxes were scaled to image pixels at load; no other scale has a layout.
  captures.forEach((capture, index) => {
    if (capture && !COMPOSABLE_SCALES.includes(capture.scale)) {
      problems.push(`panels[${index}].capture was taken at a scale this version cannot compose`);
    }
  });
```

In `lib/compose/page.mjs` line 40, add the one field: `size: c.size, scale: c.scale ?? 1, frame: c.frame, boxes: c.boxes, dark: c.dark,`.

- [ ] **Step 5: Implement the geometry factory**

In `lib/compose/page-geometry.js`:

- Line 5, `(function () {` becomes `(function () { function build(scale) {`.
- Multiply these constants by `scale`, changing nothing else on their lines: `BAND` (line 8), `CORNER` (10), `LIFT_BAND` (16), `RULE_THICKNESS` (42), `RULE_LENGTH` (43), `CROP_MARGIN_X` (234), `CROP_MARGIN_Y` (235), `CROP_SNAP` (236), `FRAME_REACH` (274), `FRAME_MARGIN` (275), `FRAME_CUSHION` (278), `CLUSTER_GAP` (347). Example: `const BAND = 6 * scale;`.
- Leave alone: `TOLERANCE` and `SLIGHT` (colours), `RULE_RUNS` and `LEADER_THROUGH` (counts), `CLUSTER_HOLE` (a ratio), `LIFT_RING`, `LIFT_COLLIDE_GAP`, `DOT_STEP`, `DOT_INSET` (board pixels).
- Replace the last two lines of the file:

```js
    return { growBox, edgeIsClean, cleanPad, cropToMarks, cleanFrame, clusterBoxes, pickLeaderSide, collidingLifts, slideDot, hits, union, components, TOLERANCE, LIFT_RING, LIFT_BAND, LEADER_THROUGH };
  }

  globalThis.__composeGeometry = build(1);
  globalThis.__composeGeometry.withScale = build;
}());
```

- [ ] **Step 6: Thread the factor through the layout**

In `lib/compose/page-layout.js`:

- Line 19: read the scale and take the geometry at that scale.

```js
  const SCALE = (window.__composeData.captures[0] || {}).scale || 1;
  const { growBox, cleanPad, cropToMarks, cleanFrame, clusterBoxes, pickLeaderSide, collidingLifts, slideDot, hits, union, components, TOLERANCE, LIFT_RING, LIFT_BAND, LEADER_THROUGH } = globalThis.__composeGeometry.withScale(SCALE);
```

- Line 20: `const GROW_LIMIT = 96 * SCALE;`. Line 24: `const PAD = 4 * SCALE;`. `MIN_LIFT_HEIGHT`, `MAX_K`, `BASE_K` and every dot and label constant stay as they are.
- Line 45: `for (const [x, y, w, h] of regions) ctx.fillRect(x - 2 * SCALE, y - 2 * SCALE, w + 4 * SCALE, h + 4 * SCALE);`
- Line 71: `const fillRects = redactBoxes.map((r) => [r[0] - 2 * SCALE, r[1] - 2 * SCALE, r[2] + 4 * SCALE, r[3] + 4 * SCALE]);`
- Line 124, the board's zoom, is chosen from the CSS width and then divided by the scale so image pixels map onto the same board pixels:

```js
      const S = Math.min(1.25, Math.max(0.55, 560 / (fw / SCALE))) / SCALE;
```

- Where the report is filled (beside `report.frame = frame;`): add `report.scale = SCALE;`.

- [ ] **Step 7: Run the unit tests and the existing compose suite**

Run: `node --test tests/unit/compose-*.test.mjs && npm run test:compose`
Expected: PASS, and every golden still matches (scale 1 multiplies by one). A golden that moves means a constant was scaled that should not have been. If a doubled-geometry test is off by a pixel or two, find the single-pixel step that was left unscaled and name it in the task report; do not relax the assertion without the controller.

- [ ] **Step 8: Write the twin test**

Append to `tests/e2e/capture-evidence.test.mjs` (its `renderer`, `skip`, `macro` and `pageUrl` already exist; add the imports):

```js
import { readdir, writeFile } from 'node:fs/promises';

import { compose } from '../../lib/commands/compose.mjs';
import { renderBoard } from '../../lib/compose/engine.mjs';
import { resolvePaths } from '../../lib/core/paths.mjs';
import { writeSidecar } from './helpers/capture-sidecar.mjs';

const specDir = path.resolve('tests/fixtures/evidence/specs');

async function boardReport({ file, deviceScaleFactor }) {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-twin-'));
  try {
    const paths = resolvePaths({ homeDir: home, pluginRoot: path.resolve('.') });
    const fixture = JSON.parse(await readFile(path.join(specDir, file), 'utf8'));
    const stem = path.basename(file, '.json');
    const { chromium } = await import(renderer.playwrightCore);
    const browser = await chromium.launch({ headless: true, executablePath: renderer.executablePath });
    let captureReturn;
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor });
      await page.goto(pageUrl(fixture.page ?? stem));
      captureReturn = await macro(page, { targets: fixture.targets, out: `${stem}.c1`, home, frame: fixture.frame });
      assert.equal(captureReturn.failedStep, undefined);
      if (deviceScaleFactor === 2) {
        // The script leaves the page where it measured it; the same view at device pixels is the 2x twin.
        await page.screenshot({ path: captureReturn.png, scale: 'device' });
        captureReturn.scale = 2;
      }
    } finally { await browser.close(); }
    const { sidecar } = await writeSidecar(captureReturn);
    const spec = { ...fixture, panels: [{ ...fixture.panels[0], capture: path.basename(sidecar) }] };
    delete spec.targets; delete spec.page; delete spec.expect; delete spec.frame;
    const specPath = path.join(paths.screenshotsDir, `${stem}.spec.json`);
    await writeFile(specPath, JSON.stringify(spec));
    let report;
    await compose({ command: 'compose', spec: specPath, seal: null }, {
      paths, rendererLocation: async () => renderer,
      renderBoard: async (args) => { const r = await renderBoard(args); report = r.report; return r; },
    });
    return report;
  } finally { await rm(home, { recursive: true, force: true }); }
}

const near = (a, b, tolerance, what) => a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) <= tolerance, `${what}: ${a} against ${b}`));

for (const file of (await readdir(specDir)).filter((f) => f.endsWith('.json'))) {
  test(`fixture ${file}: a 2x capture composes to the same layout as its 1x twin`, { skip }, async () => {
    const one = await boardReport({ file, deviceScaleFactor: 1 });
    const two = await boardReport({ file, deviceScaleFactor: 2 });
    assert.equal(one.scale, 1);
    assert.equal(two.scale, 2);
    for (const list of ['lifts', 'labels', 'dots', 'leaders', 'connectors', 'redactions']) {
      assert.equal(two[list].length, one[list].length, `${list} count`);
    }
    assert.deepEqual(two.frameEdges, one.frameEdges);
    assert.equal(two.cropped, one.cropped);
    assert.deepEqual(two.cropEdges, one.cropEdges);
    assert.deepEqual(two.warnings, one.warnings);
    // Board pixels: the same picture. Image pixels: twice as many.
    near(two.stage, one.stage, 2, 'stage');
    near(two.capture, one.capture, 2, 'capture');
    near(two.frame.map((n) => n / 2), one.frame, 1, 'frame');
    near(two.cleanFrame.map((n) => n / 2), one.cleanFrame, 1, 'cleanFrame');
    one.lifts.forEach((lift, i) => {
      near(two.lifts[i].rect, lift.rect, 2, 'lift rect');
      near(two.lifts[i].source.map((n) => n / 2), lift.source, 1, 'lift source');
      near(two.lifts[i].grown.map((n) => n / 2), lift.grown, 1, 'lift growth');
      assert.ok(Math.abs(two.lifts[i].k - lift.k) < 0.05, 'lift zoom');
    });
    one.labels.forEach((label, i) => near(two.labels[i].rect, label.rect, 2, 'label rect'));
    one.dots.forEach((dot, i) => near(two.dots[i].center, dot.center, 2, 'dot'));
    one.redactions.forEach((redaction, i) => near(two.redactions[i].rect, redaction.rect, 2, 'redaction'));
  });
}
```

- [ ] **Step 9: Run it**

Run: `node --test tests/e2e/capture-evidence.test.mjs`
Expected: PASS for every fixture. If a fixture differs beyond these tolerances, do not widen them: report the fixture, the field and both values. A discrete difference (an edge that finds a clean band at one scale and not the other) is a finding for the controller.

- [ ] **Step 10: Look at one 2x board**

Compose one fixture from a 2x capture into a scratch home, open the PNG with the image-reading tool beside its golden, and say in the task report what reads differently (sharper text is expected; anything misplaced is a bug).

- [ ] **Step 11: Commit**

```bash
npm test 2>&1 | tail -6
git add lib/compose/capture.mjs lib/commands/compose.mjs lib/compose/page.mjs lib/compose/page-geometry.js lib/compose/page-layout.js \
  tests/e2e/helpers/capture-sidecar.mjs tests/unit/compose-capture.test.mjs tests/unit/compose-command.test.mjs \
  tests/unit/compose-geometry.test.mjs tests/e2e/capture-evidence.test.mjs
git commit -m "compose: accept 2x captures and lay them out like their 1x twins"
```

### Task 8: Renderer install: the parked tests and an atomic swap

**Files:**
- Modify: `lib/compose/renderer.mjs:66-98` (`installRenderer`)
- Test: `tests/unit/compose-renderer.test.mjs`, `tests/unit/commands.test.mjs` (near the existing `installRenderer` stubs at lines 3997-4190)

**Interfaces:**
- Consumes: `installRenderer({ lock, paths, fetch, platform, force })`, `rendererStatus({ lock, paths, platform })`, the test file's `fakeShellZip(dir, platform)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/compose-renderer.test.mjs` (add `readdir` to the `node:fs/promises` import):

```js
test('a forced install replaces what is there, not just the marker', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-rend-'));
  try {
    const paths = resolvePaths({ homeDir: home });
    const artifact = await fakeShellZip(home, 'mac-arm64');
    const lock = { renderer: { revision: '1243', platforms: { 'mac-arm64': artifact } } };
    const first = await installRenderer({ lock, paths, platform: 'mac-arm64' });
    const stale = path.join(path.dirname(first.executable), 'stale.txt');
    await writeFile(stale, 'left by the old install');
    await writeFile(first.executable, '#!/bin/sh\necho broken\n');
    await installRenderer({ lock, paths, platform: 'mac-arm64', force: true });
    await assert.rejects(() => readFile(stale), { code: 'ENOENT' });
    assert.match(await readFile(first.executable, 'utf8'), /echo fake/);
    assert.equal(await rendererStatus({ lock, paths, platform: 'mac-arm64' }), 'ready');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('an install leaves no staging or set-aside tree behind', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-rend-'));
  try {
    const paths = resolvePaths({ homeDir: home });
    const artifact = await fakeShellZip(home, 'mac-arm64');
    const lock = { renderer: { revision: '1243', platforms: { 'mac-arm64': artifact } } };
    const first = await installRenderer({ lock, paths, platform: 'mac-arm64' });
    await installRenderer({ lock, paths, platform: 'mac-arm64', force: true });
    const platformDir = path.dirname(path.dirname(first.executable));
    assert.deepEqual(await readdir(path.dirname(platformDir)), [path.basename(platformDir)]);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('the marker arrives with the tree, so a half-finished swap never reads ready', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-rend-'));
  try {
    const paths = resolvePaths({ homeDir: home });
    const artifact = await fakeShellZip(home, 'mac-arm64');
    const lock = { renderer: { revision: '1243', platforms: { 'mac-arm64': artifact } } };
    const first = await installRenderer({ lock, paths, platform: 'mac-arm64' });
    const platformDir = path.dirname(path.dirname(first.executable));
    // What a crash between the two renames leaves: the old tree set aside, nothing in place.
    await rename(platformDir, `${platformDir}.old-crashed`);
    assert.equal(await rendererStatus({ lock, paths, platform: 'mac-arm64' }), 'missing');
    await installRenderer({ lock, paths, platform: 'mac-arm64' });
    assert.equal(await rendererStatus({ lock, paths, platform: 'mac-arm64' }), 'ready');
    assert.deepEqual(await readdir(path.dirname(platformDir)), [path.basename(platformDir)], 'the next install sweeps the leftover');
  } finally { await rm(home, { recursive: true, force: true }); }
});
```

(`rename` joins the `node:fs/promises` import too.)

In `tests/unit/commands.test.mjs`, beside the existing setup test that records `forces` (around line 4187), add one test for each setup path that must not force. Use that test's own harness and stub shape, changing only the scenario and the assertion:

```js
// first install: the path through setup.mjs's `installRendererOptionally(deps, lock)` with no options
assert.deepEqual(forces, [false], 'a first install does not force the renderer');
// upgrade: the same call on the upgrade path
assert.deepEqual(forces, [false], 'an upgrade does not force the renderer');
```

Build them by copying the first-install test at line 3997 and the upgrade test at line 4037 whole, renaming each, declaring `const forces = [];`, and replacing its stub with `installRenderer: async (options) => { events.push('renderer'); forces.push(options.force); return { installed: true }; }`. Keep each copied test's own assertions and add the one above.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/unit/compose-renderer.test.mjs tests/unit/commands.test.mjs`
Expected: the "sweeps the leftover" assertion FAILS (the `.old-crashed` tree survives). The forced-replace and no-force tests may already pass: they pin behaviour that had no test.

- [ ] **Step 3: Implement the swap**

In `installRenderer`, replace the `try` block's body from the unzip onward:

```js
  try {
    await writeFile(zipPath, bytes, { mode: 0o600 });
    await execFile('/usr/bin/unzip', ['-qq', zipPath, '-d', staging]);
    // The marker travels inside the staged tree, so "ready" flips at one rename.
    await writeFile(path.join(staging, path.basename(markerPath(paths, lock, platform))),
      `${JSON.stringify({ schemaVersion: 1, revision: lock.renderer.revision, sha256: artifact.sha256 })}\n`, { mode: 0o600 });
    const aside = `${target}.old-${crypto.randomUUID()}`;
    let setAside = false;
    try { await rename(target, aside); setAside = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      await rename(staging, target);
    } catch (error) {
      if (setAside) await rename(aside, target).catch(() => {});
      throw error;
    }
    await sweepLeftovers(target);
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(zipPath, { force: true });
  }
```

and add above `installRenderer`:

```js
const STALE_STAGING_MS = 60 * 60 * 1000;

// A crash mid-swap leaves a set-aside or staging tree beside the install; nothing
// reads them. A young staging tree may belong to another setup still running.
async function sweepLeftovers(target) {
  const parent = path.dirname(target);
  const prefix = `${path.basename(target)}.`;
  for (const name of await readdir(parent)) {
    const leftover = path.join(parent, name);
    const setAside = name.startsWith(`${prefix}old-`);
    const staleStaging = name.startsWith(`${prefix}staging-`)
      && Date.now() - (await stat(leftover)).mtimeMs > STALE_STAGING_MS;
    if (setAside || staleStaging) await rm(leftover, { recursive: true, force: true });
  }
}
```

Add `readdir` (and `stat`, if the file does not import it yet) to the file's `node:fs/promises` import. Check that `markerPath(paths, lock, platform)` is a file directly inside `platformDir(...)` (it is `installed.json` there); if the marker sits elsewhere, keep its relative position when writing it into the staging tree. The sweep runs after the new tree is in place, so the staging tree of the install in progress is already gone by then.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/unit/compose-renderer.test.mjs tests/unit/commands.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/compose/renderer.mjs tests/unit/compose-renderer.test.mjs tests/unit/commands.test.mjs
git commit -m "renderer: swap an install in one rename and test forced and unforced installs"
```

### Task 9: The skill's capture steps, rewritten for the tool

Only pipeline steps 2, 3 and 4 of `skills/composing-evidence/SKILL.md` change. Milestone 3 owns the rest of the file.

**Files:**
- Modify: `skills/composing-evidence/SKILL.md:17-46`
- Modify: `tests/unit/skills.test.mjs:880-928` (the composing-evidence block)
- Modify: `tests/skills/composing-evidence/red.md`, `green.md` (the record of the skill's RED and GREEN runs)

Load `superpowers:writing-skills` before editing; this is a skill change.

- [ ] **Step 1: Change the test first**

In the composing-evidence block of `tests/unit/skills.test.mjs` replace the four assertions at lines 891-894 (the macro path, `with ~ written out`, `home: "<your absolute home directory>"`, `fast-browser compose --seal <file>`) with:

```js
  assert.match(text, /`browser_capture_evidence`/);
  assert.match(text, /targets: \{ <key>: "<selector>" \}, frame: "auto", out: "<board>\.c1"/);
  assert.doesNotMatch(text, /browser_run_code_unsafe/);
  assert.doesNotMatch(text, /--seal/);
  assert.doesNotMatch(text, /capture-evidence\.js/);
  assert.match(text, /Never edit the sidecar/);
  assert.match(text, /the frame selector is larger than the viewport/);
```

and change the assertion on the phrase `Never edit the return` to the phrase `Never edit the sidecar`. Every other assertion in the block stays, including the count of two `` `fast-browser setup` `` mentions.

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/unit/skills.test.mjs`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Rewrite steps 2, 3 and 4**

Replace lines 17-46 of the skill (steps 2, 3 and 4 of the pipeline list) with:

```markdown
2. **Capture.** Call `browser_capture_evidence` with
   `{ targets: { <key>: "<selector>" }, frame: "auto", out: "<board>.c1" }`.
   `out` is a plain file name. The tool screenshots the viewport at 2x,
   measures each target, and writes `<board>.c1.png` and
   `<board>.c1.capture.json` (the sidecar) into `~/.fast-browser/screenshots/`.
   If the tool is not in your tool list, run `fast-browser setup`, then
   capture.
3. **Check the return.** Never edit the sidecar. Fix the cause and capture
   again:
   - It has `failedStep`: fix what that step names (`args`, `resolve`,
     `frame`, `measure`).
   - `failedStep: "frame"` with `frameSnap: "too-large"`: the targets cannot
     share one viewport-sized frame. Enlarge the viewport with
     `browser_resize`, or split them into separate boards.
   - `failedStep: "frame"` saying the frame selector is larger than the
     viewport: pick a smaller element, or enlarge the viewport with
     `browser_resize`.
   - A key is in `missed` as `no-match` or `ambiguous`: the selector is
     wrong. Fix it, scoping to a unique container.
   - A key is in `missed` as `not-visible` (zero-size box): the element is
     collapsed or hidden. Open, expand or reveal it first.
   - A key is in `missed` as `out-of-view`: it fell outside the viewport once
     the frame was centred, so the targets are too far apart for one view.
     Pass a tighter `frame`, enlarge the viewport with `browser_resize`, or
     split into separate boards.
   - `frameSnap` is `union`, or `frame` is a thin strip (far wider than it is
     tall, or cutting through the card): pass `frame: "<selector>"` for the
     card that holds the targets.
   - The call fails saying it timed out: the page or the connection stalled.
     Capture again once; if it times out again, report it and stop.
4. **Keep the sidecar.** The return carries its path as `sidecar`. There is
   nothing to seal: the tool wrote it, and compose refuses one that was
   changed afterwards.
```

Steps 5 to 7 keep their numbers and their text.

- [ ] **Step 4: Run the test**

Run: `node --test tests/unit/skills.test.mjs`
Expected: PASS.

- [ ] **Step 5: Bring the skill's RED and GREEN record up to date**

In `tests/skills/composing-evidence/red.md` and `green.md`, add a dated section "Milestone 2: capture is a tool" stating what changed (steps 2 to 4 name `browser_capture_evidence`; sealing is gone) and that the pressure run for this wording is the blind eval of Task 11. Leave the Milestone 1 record as it is.

- [ ] **Step 6: Commit**

```bash
git add skills/composing-evidence/SKILL.md tests/unit/skills.test.mjs tests/skills/composing-evidence/red.md tests/skills/composing-evidence/green.md
git commit -m "composing-evidence: capture with the browser_capture_evidence tool"
```

### Task 10: The capture suite drives the tool

`tests/e2e/capture-evidence.test.mjs` keeps the twin tests from Task 7, and its macro tests become tool tests: the same assertions against `browser_capture_evidence`, plus sharpness, plus the live smoke.

**Files:**
- Create: `tests/e2e/helpers/capture-tool.mjs`, `tests/e2e/helpers/sharpness.mjs`
- Modify: `tests/e2e/capture-evidence.test.mjs`

**Interfaces:**
- Consumes: the tool's result JSON (Task 2), `rendererForTests()` (returns `{ executablePath, playwrightCore }`).
- Produces: `startCaptureTool({ home, renderer, mode, env })` and `comparePngs({ tool, reference, oneX, renderer })`.
- The runtime under test is `FAST_BROWSER_TEST_RUNTIME_CLI` when set, otherwise the installed pinned runtime's `cli.cjs` beside its `playwright-core`.

- [ ] **Step 1: Write the two helpers**

```js
// tests/e2e/helpers/capture-tool.mjs
import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { loadRuntimeLock } from '../../../lib/runtime/lock.mjs';

const pagesDir = path.resolve('tests/fixtures/evidence/pages');

export function runtimeCli(renderer) {
  return process.env.FAST_BROWSER_TEST_RUNTIME_CLI
    ?? path.join(path.dirname(path.dirname(renderer.playwrightCore)), 'cli.cjs');
}

// The synthetic fixture pages over http: the runtime does not navigate to file URLs.
export async function servePages() {
  const server = http.createServer(async (request, response) => {
    const name = path.basename(new URL(request.url, 'http://localhost').pathname);
    try {
      response.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(path.join(pagesDir, name)));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: (page) => `http://127.0.0.1:${server.address().port}/${page}.html`, close: () => new Promise((resolve) => server.close(resolve)) };
}

// mode 'headless' launches the pinned renderer; mode 'extension' attaches to the real Chrome through the relay.
export async function startCaptureTool({ home, renderer, mode = 'headless', env = {} }) {
  const outputDir = path.join(home, '.fast-browser', 'output');
  const captureDir = path.join(home, '.fast-browser', 'screenshots');
  await mkdir(outputDir, { recursive: true });
  const lock = await loadRuntimeLock({ bundledPath: path.resolve('runtime-lock.json') });
  const engine = mode === 'extension'
    ? ['--extension', `--extension-id=${lock.extension.id}`]
    : ['--headless', '--isolated', `--executable-path=${renderer.executablePath}`, '--viewport-size=1000x700'];
  const client = new Client({ name: 'capture-evidence-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [runtimeCli(renderer), ...engine, '--snapshot-mode=none', '--codegen=none', '--timeout-settle=200',
      `--output-dir=${outputDir}`, `--capture-dir=${captureDir}`],
    cwd: outputDir, stderr: 'pipe', env: { ...process.env, ...env },
  });
  transport.stderr?.resume();
  await client.connect(transport);
  const text = (result) => result.content.find((c) => c.type === 'text')?.text ?? '';
  // A hung call must fail the test, not sit until the suite's timeout.
  const call = (name, args, withinMs = 30_000) => Promise.race([
    client.callTool({ name, arguments: args }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} did not return within ${withinMs}ms`)), withinMs)),
  ]);
  return {
    captureDir, outputDir, call, text,
    capture: async (args) => {
      const result = await call('browser_capture_evidence', args);
      const body = text(result);
      if (result.isError) throw new Error(body);
      return JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
    },
    close: () => client.close(),
  };
}
```

```js
// tests/e2e/helpers/sharpness.mjs
// Compares a 2x capture with a 2x reference, and with the 1x image blown up
// without smoothing: a sharp capture is close to the reference while the
// blown-up image is not, so an upscaled capture cannot pass.
export async function comparePngs({ tool, reference, oneX, renderer }) {
  const { chromium } = await import(renderer.playwrightCore);
  const browser = await chromium.launch({ headless: true, executablePath: renderer.executablePath });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ({ tool, reference, oneX }) => {
      const load = async (base64) => { const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode(); return image; };
      const [a, b, c] = await Promise.all([load(tool), load(reference), load(oneX)]);
      if (a.width !== b.width || a.height !== b.height) return { sameSize: false, tool: [a.width, a.height], reference: [b.width, b.height] };
      const pixels = (image, width, height) => {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0, width, height);
        return context.getImageData(0, 0, width, height).data;
      };
      const count = (left, right) => {
        let differing = 0;
        for (let i = 0; i < left.length; i += 4) {
          if (Math.abs(left[i] - right[i]) > 16 || Math.abs(left[i + 1] - right[i + 1]) > 16 || Math.abs(left[i + 2] - right[i + 2]) > 16) differing += 1;
        }
        return differing;
      };
      const ref = pixels(b, b.width, b.height);
      return { sameSize: true, differing: count(pixels(a, a.width, a.height), ref), upscaledDiffering: count(pixels(c, b.width, b.height), ref), total: b.width * b.height };
    }, { tool: tool.toString('base64'), reference: reference.toString('base64'), oneX: oneX.toString('base64') });
  } finally { await browser.close(); }
}
```

- [ ] **Step 2: Replace the macro tests with tool tests**

In `tests/e2e/capture-evidence.test.mjs` delete the `run` helper and the eleven macro tests (lines 18-103 of the shipped file; the `macro` constant stays, the twin tests use it), and add:

```js
import { comparePngs } from './helpers/sharpness.mjs';
import { servePages, startCaptureTool } from './helpers/capture-tool.mjs';

async function withTool(pageName, body, options = {}) {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-captool-'));
  const pages = await servePages();
  const tool = await startCaptureTool({ home, renderer, ...options });
  try {
    await tool.call('browser_navigate', { url: pages.url(pageName) });
    return await body({ tool, home, pages });
  } finally {
    await tool.close().catch(() => {});
    await pages.close();
    await rm(home, { recursive: true, force: true });
  }
}

test('the tool: auto frame snaps to the card, at 2x, with a sidecar compose loads', { skip }, async () => {
  await withTool('nested-cards', async ({ tool }) => {
    const result = await tool.capture({ targets: { owner: '[data-testid=owner]', reviewer: '[data-testid=reviewer]' }, out: 'cap' });
    assert.equal(result.schemaVersion, 'capture-evidence/1');
    assert.equal(result.frameSnap, 'card');
    assert.equal(result.scale, 2);
    assert.ok(result.frame[2] < 1000 && result.frame[3] < 700);
    assert.deepEqual(Object.keys(result.boxes).sort(), ['owner', 'reviewer']);
    assert.equal(result.png, path.join(tool.captureDir, 'cap.png'));
    const capture = await loadCapture({ sidecarPath: result.sidecar, fail: (message) => new Error(message) });
    assert.deepEqual(capture.size, [2000, 1400]);
    assert.deepEqual(capture.frame, result.frame.map((n) => n * 2));
  });
});

test('the tool: an ambiguous selector is missed, never guessed', { skip }, async () => {
  await withTool('repeated-rows', async ({ tool }) => {
    const result = await tool.capture({ targets: { edit: 'button', bravo: '[data-testid=row-b] >> text=Bravo' }, out: 'cap' });
    assert.deepEqual(result.missed, [{ key: 'edit', reason: 'ambiguous', count: 3 }]);
    assert.ok(result.boxes.bravo);
  });
});

test('the tool: a dark surface is reported as dark', { skip }, async () => {
  await withTool('dark-surface', async ({ tool }) => {
    assert.equal((await tool.capture({ targets: { value: '[data-testid=value]' }, out: 'cap' })).dark, true);
  });
});

test('the tool: a heading-only strip is not a frame', { skip }, async () => {
  await withTool('heading-strip', async ({ tool }) => {
    assert.equal((await tool.capture({ targets: { heading: '[data-testid=heading]' }, out: 'cap' })).frameSnap, 'union');
  });
});

test('the tool: targets too far apart capture nothing', { skip }, async () => {
  await withTool('far-targets', async ({ tool }) => {
    const result = await tool.capture({ targets: { top: '[data-testid=top]', bottom: '[data-testid=bottom]' }, out: 'cap' });
    assert.equal(result.failedStep, 'frame');
    assert.equal(result.frameSnap, 'too-large');
  });
});

test('the tool: a tiny badge is measured in CSS pixels', { skip }, async () => {
  await withTool('tiny-badge', async ({ tool }) => {
    const result = await tool.capture({ targets: { badge: '[data-testid=badge]', title: '[data-testid=title]' }, out: 'cap' });
    assert.equal(result.boxes.badge[2], 12);
  });
});

test('the tool: a failed call leaves no tags for the next call on the same page', { skip }, async () => {
  await withTool('nested-cards', async ({ tool }) => {
    const first = await tool.capture({ frame: '[data-testid=nothing]', targets: { owner: '[data-testid=owner]' }, out: 'cap' });
    assert.equal(first.failedStep, 'frame');
    const second = await tool.capture({ targets: { contact: '[data-testid=contact]' }, out: 'cap' });
    assert.deepEqual(Object.keys(second.boxes), ['contact']);
    assert.notEqual(second.frameSnap, 'selector');
  });
});

for (const [edge, fixture] of [['right', 'off-right-edge'], ['left', 'off-left-edge']]) {
  test(`the tool: a target clipped by the ${edge} edge is missed as out-of-view`, { skip }, async () => {
    await withTool(fixture, async ({ tool }) => {
      const result = await tool.capture({ targets: { inside: '[data-testid=inside]', clipped: '[data-testid=clipped]' }, out: 'cap' });
      assert.deepEqual(result.missed, [{ key: 'clipped', reason: 'out-of-view' }]);
      assert.deepEqual(Object.keys(result.boxes), ['inside']);
    });
  });
}

test('the tool: an explicit frame that does not contain every target fails', { skip }, async () => {
  await withTool('frame-misses-target', async ({ tool }) => {
    const result = await tool.capture({ frame: '[data-testid=panel]', targets: { in: '[data-testid=in]', out: '[data-testid=out]' }, out: 'cap' });
    assert.deepEqual(result, { failedStep: 'frame', error: 'the frame selector does not contain every target' });
  });
});

test('the tool: a 2x capture matches a native DPR 2 render, and an upscaled 1x does not', { skip }, async () => {
  await withTool('nested-cards', async ({ tool, pages }) => {
    const result = await tool.capture({ targets: { owner: '[data-testid=owner]' }, out: 'sharp' });
    assert.equal(result.scale, 2);
    await tool.call('browser_take_screenshot', { filename: 'one.png', scale: 'css' });
    const scroll = JSON.parse(tool.text(await tool.call('browser_evaluate', { function: '() => JSON.stringify([scrollX, scrollY])' })).match(/\[\d+,\s*\d+\]/)[0]);
    const { chromium } = await import(renderer.playwrightCore);
    const browser = await chromium.launch({ headless: true, executablePath: renderer.executablePath });
    let reference;
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
      await page.goto(pages.url('nested-cards'));
      await page.evaluate(([x, y]) => scrollTo(x, y), scroll);
      reference = await page.screenshot({ scale: 'device' });
    } finally { await browser.close(); }
    const verdict = await comparePngs({ tool: await readFile(result.png), reference, oneX: await readFile(path.join(tool.outputDir, 'one.png')), renderer });
    assert.equal(verdict.sameSize, true);
    assert.ok(verdict.upscaledDiffering > 1000, 'the page has enough text for an upscale to show');
    assert.ok(verdict.differing * 50 <= verdict.upscaledDiffering, `${verdict.differing} pixels differ from the native render; an upscale differs by ${verdict.upscaledDiffering}`);
  });
});

const live = process.env.FAST_BROWSER_LIVE_E2E === '1' ? false : 'live only: set FAST_BROWSER_LIVE_E2E=1 (drives the real Chrome)';

// The reference is a metrics-override capture of the same page in the same
// Chrome: headed and headless Chromium rasterise text differently.
test('live: a 2x capture through the real relay is sharp and returns in time', { skip: live }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-caplive-'));
  const pages = await servePages();
  const env = process.env.FAST_BROWSER_LIVE_EXTENSION_TOKEN ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: process.env.FAST_BROWSER_LIVE_EXTENSION_TOKEN } : {};
  try {
    const run = async (strategy, out, alsoOneX) => {
      const tool = await startCaptureTool({ home, renderer, mode: 'extension', env: { ...env, PLAYWRIGHT_MCP_CAPTURE_2X: strategy } });
      try {
        // Navigation waits for the connection to be allowed in Chrome when no token is set.
        await tool.call('browser_navigate', { url: pages.url('nested-cards') }, 120_000);
        const started = Date.now();
        const result = await Promise.race([
          tool.capture({ targets: { owner: '[data-testid=owner]' }, out }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('the capture did not return within 20s')), 20_000)),
        ]);
        if (alsoOneX) await tool.call('browser_take_screenshot', { filename: 'one.png', scale: 'css' });
        return { result, ms: Date.now() - started };
      } finally { await tool.close().catch(() => {}); }
    };
    const clip = await run('clip', 'live-clip', true);
    const override = await run('override', 'live-override', false);
    assert.equal(clip.result.scale, 2);
    assert.deepEqual(clip.result.frame, override.result.frame, 'both captures saw the same layout');
    const verdict = await comparePngs({
      tool: await readFile(clip.result.png), reference: await readFile(override.result.png),
      oneX: await readFile(path.join(home, '.fast-browser', 'output', 'one.png')), renderer,
    });
    assert.equal(verdict.sameSize, true);
    assert.ok(verdict.upscaledDiffering > 1000, 'the page has enough text for an upscale to show');
    assert.ok(verdict.differing * 50 <= verdict.upscaledDiffering, `${verdict.differing} pixels differ from the override capture; an upscale differs by ${verdict.upscaledDiffering}`);
  } finally {
    await pages.close();
    await rm(home, { recursive: true, force: true });
  }
});
```

Add `import { loadCapture } from '../../lib/compose/capture.mjs';` to the file's imports.

- [ ] **Step 3: Run the suite against the local build**

Run: `FAST_BROWSER_TEST_RUNTIME_CLI=<LOCAL_CLI> node --test tests/e2e/capture-evidence.test.mjs`
Expected: PASS; the live test reports as skipped. If a fixture page's expected value differs from the macro's (for example the ambiguous count), the page decides: read the fixture page and assert what it holds.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers/capture-tool.mjs tests/e2e/helpers/sharpness.mjs tests/e2e/capture-evidence.test.mjs
git commit -m "capture-evidence tests: drive the capture tool, check 2x sharpness, add the live smoke"
```

### Task 11: Live smoke and blind eval on the local build (controller, gated)

Nothing here is delegated except the blind driver itself. Nothing here runs before Matt says yes.

- [ ] **Step 1: Ask (herd_ask)**

One gate, asked before any of the steps below. Context: the live smoke and the blind eval drive Matt's real Chrome through the installed extension, using the locally built runtime 0.1.3 (nothing published); they write under `~/.fast-browser/screenshots/` and `~/.fast-browser/composed-evidence-eval/runs/<date>/`. Without a token in `FAST_BROWSER_LIVE_EXTENSION_TOKEN`, each run opens the extension's connect tab and waits for "Allow". Options: run both now with a headless Sonnet driver wired to the local build (recommended); run only the live smoke now and hold the eval; hold both.

- [ ] **Step 2: Live smoke**

```bash
cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-fast-browser/deft-feather
FAST_BROWSER_LIVE_E2E=1 FAST_BROWSER_TEST_RUNTIME_CLI=<LOCAL_CLI> node --test --test-name-pattern='^live:' tests/e2e/capture-evidence.test.mjs
```

Expected: PASS. Record both capture times and the two differing counts in the ledger. A failure here is fixed in the fork before anything is published.

- [ ] **Step 3: Blind eval, Sonnet**

The method is the one in `~/.fast-browser/composed-evidence-eval/runs/2026-10-11/` (`BRIEF-e.md`, `score.md`): the same cases, a fresh driver given only the brief and the current skill text. Write the run's brief to `~/.fast-browser/composed-evidence-eval/runs/<today>/BRIEF.md`, changed in two places only: the capture step is the tool, and compose runs as `node <fast-browser tree>/bin/fast-browser.mjs compose`. The brief and everything it produces stay out of every repo.

The driver is a headless `claude -p --model sonnet` process with `--strict-mcp-config` and an MCP config (written to the scratchpad, never committed) that starts `<LOCAL_CLI> --extension --extension-id=<lock.extension.id> --snapshot-mode=none --codegen=none --timeout-settle=200 --output-dir=$HOME/.fast-browser/output --capture-dir=$HOME/.fast-browser/screenshots`, allowed only that server's tools, `Read`, `Write` and `Bash(node:*)`. Its prompt is the brief followed by the full text of `skills/composing-evidence/SKILL.md` from the fast-browser tree.

- [ ] **Step 4: Score against the pass bar**

Copy each case's board, spec and capture files into the run folder and write `score.md` there in the 2026-10-11 format. The bar: every case produces a board; at most 3 capture calls per case; every declared redaction holds (read each board at full size); each board at least 4 of 5 against its pen mock, judged by an Opus judge spawned with the board and the mock only. Then read every board yourself and write down plainly what looks wrong.

- [ ] **Step 5: Contact sheet**

Write `sheet.html` in the run folder: every board at full width with its case name and score. It is a local file; give Matt its path at the next gate. Do not publish it anywhere.

- [ ] **Step 6: Haiku, once Sonnet passes**

Repeat Step 3 with `--model haiku` into a sibling run folder and score it the same way. Its result is reported, not gated on.

- [ ] **Step 7: If the eval fails the bar**

Fix the cause (the tool in the fork, compose or the skill in fast-browser) as a new task with its own test, rebuild the local runtime (Task 6 Step 2), and run the eval again with a new run name.

---

## Phase C: ship the fork

### Task 12: Fork review, PR, merge and release (controller, gated)

- [ ] **Step 1: Whole-branch review of the fork (Opus, high)**

Dispatch the final reviewer on `git diff origin/fast-browser-runtime...HEAD` in the fork tree with the spec's Milestone 2 section and this plan. The reviewer runs `node utils/build/build.js`, the capture spec, the relay node test and the extension capture spec itself. Fix what it finds as new commits; re-review until it approves.

- [ ] **Step 2: Purity scan, then squash**

```bash
cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttheweric-playwright/eager-kettle
git diff origin/fast-browser-runtime...HEAD > "$TMPDIR/m2-fork.diff"
git log origin/fast-browser-runtime..HEAD --format=%B > "$TMPDIR/m2-fork.log"
```

Read both files for employer names, URLs, data, ticket ids and wording from the employer's business domain (test pages are a project tracker). Then squash to one commit without amending anything already pushed (nothing is):

```bash
git reset --soft origin/fast-browser-runtime
git commit -m "feat(mcp): capture evidence as a tool, at 2x, with a timeout on every relay send"
node utils/build/build.js && npm run flint
```

- [ ] **Step 3: Push and open the PR**

Push with the `git_push` tool (`tree`: the fork tree, `setUpstream: true`), then:

```bash
gh pr create --repo m4ttheweric/playwright --base fast-browser-runtime --head m2-capture \
  --title "feat(mcp): capture evidence as a tool, at 2x, with a timeout on every relay send" \
  --body "$(cat <<'EOF'
## Summary
- Adds `browser_capture_evidence`: measures named elements, screenshots the viewport at 2x on the page's existing session and writes its own sidecar
- Adds `--capture-dir` for where captures land
- Every relay send now times out instead of hanging the session
EOF
)"
```

- [ ] **Step 4: Ask Matt to merge (herd_ask)**

Context: the fork PR number, the review verdict, the eval result and the contact sheet path. Options: Matt merges it and the job builds the release from the merge commit (recommended); hold. The job never merges the PR itself.

- [ ] **Step 5: Rebuild from the merged branch**

```bash
git fetch origin
git log --oneline -1 origin/fast-browser-runtime        # the merge
git checkout --detach origin/fast-browser-runtime
node utils/build/build.js
npx playwright test --config=tests/mcp/playwright.config.ts --project=chromium capture-evidence
npm run test-extension 2>&1 | tail -30
rm -rf fast-browser-dist && node utils/fast_browser/build_artifacts.mjs --version 0.1.3 --out-dir fast-browser-dist
```

Expected: green apart from the baseline failures.

- [ ] **Step 6: Ask before releasing (herd_ask), then release**

Context: the release name, the commit it targets and the file list in `fast-browser-dist`. Options: create `fast-browser-v0.1.3` and upload (recommended); hold. On yes:

```bash
gh release create fast-browser-v0.1.3 --repo m4ttheweric/playwright --target fast-browser-runtime \
  --title "Fast Browser 0.1.3" --notes "Adds browser_capture_evidence (2x evidence capture that writes its own sidecar) and a timeout on every relay send."
gh release upload fast-browser-v0.1.3 fast-browser-dist/* --repo m4ttheweric/playwright
```

---

## Phase D: fast-browser, after the release

### Task 13: Ask, then pin runtime 0.1.3 (controller for the ask, then delegated)

**Files (all rewritten by the script unless noted):**
- `runtime-lock.json`, `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `THIRD_PARTY_NOTICES.md`, `tests/unit/runtime-lock.test.mjs`
- Modify by hand: `lib/runtime/launch.mjs:49` and the argument lists that mirror it, `tests/unit/engine.test.mjs:48,60` and `tests/unit/runtime-lock.test.mjs:401,452`

- [ ] **Step 1: Ask (herd_ask)**

Context: pinning writes the release into seven files of the fast-browser branch; the compose and capture suites read the installed runtime, so the job would also install runtime 0.1.3 side by side under `~/.fast-browser/runtime/0.1.3/` (the active plugin stays on 0.1.2 until it updates). Options: pin and install side by side (recommended); pin only; hold.

- [ ] **Step 2: Pin**

```bash
cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-fast-browser/deft-feather
npm run pin-runtime -- --runtime 0.1.3 --plugin 0.1.12
git status --short
```

Expected: exactly the seven files change. The renderer entry is carried forward untouched.

- [ ] **Step 3: Pass the capture directory to the runtime (test first)**

In `tests/unit/engine.test.mjs` and `tests/unit/runtime-lock.test.mjs`, add the expected argument on the line after each `--output-dir=` expectation: `` `--capture-dir=${paths.screenshotsDir}` `` (in `engine.test.mjs` the literal form used beside it, `'--capture-dir=/synthetic-home/.fast-browser/screenshots'`). Run `node --test tests/unit/engine.test.mjs tests/unit/runtime-lock.test.mjs`: FAIL. Then in `lib/runtime/launch.mjs`, after the `--output-dir` line of `runtimeArgs`:

```js
    // browser_capture_evidence writes its png and sidecar here, the folder compose resolves `out` in.
    `--capture-dir=${paths.screenshotsDir}`,
```

Run the two test files again: PASS.

- [ ] **Step 4: Install the pinned runtime side by side (only if Step 1 said so)**

```bash
node --input-type=module -e "
import { installRuntime } from './lib/runtime/install.mjs';
import { loadRuntimeLock } from './lib/runtime/lock.mjs';
import { resolvePaths } from './lib/core/paths.mjs';
const lock = await loadRuntimeLock({ bundledPath: 'runtime-lock.json' });
console.log(await installRuntime({ lock, paths: resolvePaths(), fetch }));
"
ls ~/.fast-browser/runtime
```

Expected: a `0.1.3` directory beside `0.1.2`; nothing else under `~/.fast-browser` changes.

- [ ] **Step 5: Run the gates**

Run: `npm test 2>&1 | tail -8 && npm run test:integration 2>&1 | tail -6`
Expected: PASS. A lock gate that fails is updated to the new value by the script's own output; a gate is never loosened or removed.

- [ ] **Step 6: Commit**

```bash
git add runtime-lock.json package.json package-lock.json .claude-plugin/plugin.json .codex-plugin/plugin.json \
  THIRD_PARTY_NOTICES.md tests/unit/runtime-lock.test.mjs tests/unit/engine.test.mjs lib/runtime/launch.mjs
git commit -m "pin runtime 0.1.3 and pass the capture directory to it"
```

### Task 14: `--seal` goes away

The tool seals its own capture, so the command, its parsing and `sealCapture` are removed. Tests that built sidecars by sealing use `writeSidecar` from Task 7.

**Files:**
- Modify: `lib/cli/parse-args.mjs:136,163-170,513-518`, `lib/cli/main.mjs:632`, `lib/commands/compose.mjs:4,42-46`, `lib/compose/capture.mjs:23-55`
- Modify: `tests/unit/parse-args.test.mjs:665-675`, `tests/unit/compose-command.test.mjs`, `tests/unit/compose-capture.test.mjs`, `tests/e2e/compose-fixtures.test.mjs:44-46`, `tests/e2e/capture-evidence.test.mjs` (the twin test's `seal: null`)

- [ ] **Step 1: Change the tests first**

`tests/unit/parse-args.test.mjs`, replace the three compose tests at lines 665-675:

```js
const pick = ({ command, spec }) => ({ command, spec });

test('compose takes one spec path', () => {
  assert.deepEqual(pick(parseArgs(['compose', 'spec.json'])), { command: 'compose', spec: 'spec.json' });
});
test('compose requires a spec path and no longer seals', () => {
  assert.throws(() => parseArgs(['compose']), /compose requires a spec path/);
  assert.throws(() => parseArgs(['compose', '--seal', 'ret.json']));
});
```

Keep the first test's existing title if it differs; only its expected object changes.

`tests/unit/compose-command.test.mjs`: `world(scale)` writes the sidecar itself and returns its path.

```js
import { writeSidecar } from '../e2e/helpers/capture-sidecar.mjs';

async function world(scale = 1) {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-cmd-'));
  const paths = resolvePaths({ homeDir: home, pluginRoot: path.resolve('.') });
  await mkdir(paths.screenshotsDir, { recursive: true });
  const png = path.join(paths.screenshotsDir, 'r-c-after.c1.png');
  await writeFile(png, PNG);
  const frame = scale === 2 ? [0, 0, 0.5, 0.5] : [0, 0, 1, 1];
  const { sidecar } = await writeSidecar({ png, frame, frameSnap: 'card', boxes: { a: frame }, missed: [], dark: false, scale });
  return { home, paths, sidecar };
}
```

Delete the test `seal writes the sidecar and reports it`. In every other test replace `const { home, paths, ret } = await world(...)` with `const { home, paths, sidecar } = await world(...)`, delete each `const { sidecar } = await compose({ command: 'compose', seal: ret, spec: null }, { paths });` line, and drop `seal: null` from every remaining `compose({ ... })` request.

`tests/unit/compose-capture.test.mjs`: remove `sealCapture` from the import. Delete the four tests that only test sealing (`seal writes a sidecar beside the png that names it by basename`, `seal refuses a capture name with directory parts...`, `seal refuses a return whose png is outside the screenshots directory`, `seal refuses a return that is not a capture-evidence return`). In the remaining tests replace `await sealCapture({ paths, captureReturn, fail })` with `await writeSidecar(captureReturn)`.

`tests/e2e/compose-fixtures.test.mjs`, lines 44-46 (the three lines that write `return.json` and seal it) become:

```js
      const { sidecar } = await writeSidecar(captureReturn);
```

with `import { writeSidecar } from './helpers/capture-sidecar.mjs';` added, and `seal: null` dropped from the one remaining `compose({ ... })` request. Nothing else in that file changes. Drop `seal: null` from the twin test in `tests/e2e/capture-evidence.test.mjs` too.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/unit/parse-args.test.mjs`
Expected: FAIL (`compose --seal` still parses, and the request still carries `seal`).

- [ ] **Step 3: Remove the code**

- `lib/cli/parse-args.mjs`: line 136 becomes `if (command === 'compose') request.spec = null;`. Delete the `--seal` block (lines 163-170). Replace the two checks at lines 513-518 with:

```js
  if (command === 'compose' && request.spec === null) {
    throw new UsageError('<spec>', 'compose requires a spec path');
  }
```

- `lib/cli/main.mjs`: delete the `if (report.mode === 'seal') ...` line.
- `lib/commands/compose.mjs`: import only `COMPOSABLE_SCALES, loadCapture` from `../compose/capture.mjs`; delete the `if (request.seal) { ... }` block.
- `lib/compose/capture.mjs`: delete `sealCapture` and the imports only it used (`rename`, `writeFile`, `confinedScreenshotPath`); keep `crypto`, `readFile`, `path`, `readPngSize`, `CAPTURE_SCHEMA`, `captureDigest`, `isBox`, `COMPOSABLE_SCALES`, `loadCapture`.

- [ ] **Step 4: Run everything that touched a sidecar**

Run: `node --test tests/unit/parse-args.test.mjs tests/unit/compose-command.test.mjs tests/unit/compose-capture.test.mjs && npm run test:compose`
Expected: PASS, with every golden unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/cli/parse-args.mjs lib/cli/main.mjs lib/commands/compose.mjs lib/compose/capture.mjs \
  tests/unit/parse-args.test.mjs tests/unit/compose-command.test.mjs tests/unit/compose-capture.test.mjs \
  tests/e2e/compose-fixtures.test.mjs tests/e2e/capture-evidence.test.mjs
git commit -m "compose: drop --seal, the capture tool writes its own sidecar"
```

### Task 15: The macro stops being a built-in

**Files:**
- Move: `builtins/macros/capture-evidence.js` to `tests/e2e/helpers/capture-evidence.js`
- Modify: `lib/macros/install.mjs:35-41` (`BUILTIN_NAMES`), `builtins/macro-hashes.json` (regenerated), `skills/browser-macros/MACROS.md:214-221` (the entry removed)
- Modify: `tests/e2e/capture-evidence.test.mjs:12`, `tests/e2e/compose-fixtures.test.mjs:18` (the load path), `tests/unit/skills.test.mjs:85-87,156`, `tests/integration/package.test.mjs:29`, `tests/unit/macros.test.mjs` and `tests/integration/setup-macro-refresh.test.mjs` (their `capture-evidence` fixture entries)

- [ ] **Step 1: Change the tests first**

- `tests/unit/skills.test.mjs`: the count of `## ` sections in MACROS.md goes from 5 to 4 (line 85); delete the two assertions on `## capture-evidence` and its script path (lines 86-87); the count of `Status: built-in` goes from 5 to 4 (line 156).
- `tests/integration/package.test.mjs`: remove `'package/builtins/macros/capture-evidence.js'` from `requiredEntries`, and add an assertion that the packed file list holds no entry ending in `capture-evidence.js` (the helper must not ship; confirm `tests/` is outside the package's `files`).
- `tests/unit/macros.test.mjs` and `tests/integration/setup-macro-refresh.test.mjs`: delete the `'capture-evidence.js'` and `'capture-evidence'` entries from their synthetic evidence fixtures.

Run: `node --test tests/unit/skills.test.mjs tests/integration/package.test.mjs tests/integration/release-gates.test.mjs`
Expected: FAIL (five sections, the file still packed).

- [ ] **Step 2: Move the script and retire the built-in**

```bash
git mv builtins/macros/capture-evidence.js tests/e2e/helpers/capture-evidence.js
```

- `lib/macros/install.mjs`: remove `'capture-evidence.js',` from `BUILTIN_NAMES`.
- `skills/browser-macros/MACROS.md`: delete the whole `## capture-evidence` entry (lines 214-221) and the blank line before it.
- In `tests/e2e/capture-evidence.test.mjs` and `tests/e2e/compose-fixtures.test.mjs`, the one line that reads the script changes its URL from `'../../builtins/macros/capture-evidence.js'` to `'./helpers/capture-evidence.js'`. In the moved file, replace its first comment with one that says what it is now: the headless capture script the fixture suites use, kept in step with the tool's rules, 1x.

- [ ] **Step 3: Regenerate the macro hashes**

```bash
npm run macro-hashes
node scripts/generate-macro-hashes.mjs --check
git diff --stat builtins/macro-hashes.json
```

This reads the published versions from the npm registry. Expected: the `capture-evidence.js` and `capture-evidence` keys leave the manifest and nothing else changes.

- [ ] **Step 4: Run the suites**

Run: `npm test 2>&1 | tail -8 && npm run test:integration 2>&1 | tail -6 && npm run test:compose 2>&1 | tail -8`
Expected: PASS, with every golden unchanged.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/helpers/capture-evidence.js builtins/macros/capture-evidence.js lib/macros/install.mjs builtins/macro-hashes.json \
  skills/browser-macros/MACROS.md tests/e2e/capture-evidence.test.mjs tests/e2e/compose-fixtures.test.mjs \
  tests/unit/skills.test.mjs tests/integration/package.test.mjs tests/unit/macros.test.mjs tests/integration/setup-macro-refresh.test.mjs
git commit -m "capture-evidence: retire the built-in macro, keep the script as a test helper"
```

### Task 16: Exit checks, final review and the fast-browser PR (controller)

- [ ] **Step 1: The exit list, on the pinned runtime with no override set**

```bash
cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-fast-browser/deft-feather
unset FAST_BROWSER_TEST_RUNTIME_CLI
npm test 2>&1 | tail -8
npm run test:integration 2>&1 | tail -6
npm run test:compose 2>&1 | tail -8
```

Expected: all green. Compare the counts with the Task 0 baseline and account for every difference by name.

- [ ] **Step 2: Live smoke on the pinned runtime**

The Task 11 gate covered the local build. Ask again (herd_ask) before this run, then:

```bash
FAST_BROWSER_LIVE_E2E=1 node --test --test-name-pattern='^live:' tests/e2e/capture-evidence.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Blind eval again only if the capture path changed after Task 11**

If any commit after the Task 11 eval touched the tool, compose's layout or the skill's text, rerun the Sonnet eval on the pinned runtime and score it. Otherwise the Task 11 result stands and the report says so.

- [ ] **Step 4: Render 2x boards and look at them**

Compose three fixtures from tool captures (a light card, the dark surface, a redaction under a lift) into a scratch home with the pinned runtime, open each PNG, and write down plainly what looks wrong, if anything. This is the look-at-it check; green tests do not replace it.

- [ ] **Step 5: Rebase if Milestone 3 landed first**

`git fetch origin && git log --oneline HEAD..origin/main`. If Milestone 3 is on `main`, rebase onto it: the owner's version of each shared file wins, and this milestone's change (the `scale` factor, the scale check, the removed `--seal`, steps 2 to 4 of the skill, the capture-script line) is reapplied on top. Milestone 3 lays out several captures: read the scale per capture where its code loops over panels. Rerun Step 1.

- [ ] **Step 6: Whole-branch review (Opus, high)**

Dispatch the final reviewer on `git diff origin/main...HEAD` with the spec section and this plan. It runs `npm test`, `npm run test:integration` and `npm run test:compose` itself. Fix findings as new commits and re-review until it approves.

- [ ] **Step 7: Purity scan, squash, push, PR**

Scan `git diff origin/main...HEAD` and the PR body for employer names, URLs, data, ticket ids and wording from the employer's business domain. Squash to one commit (`git reset --soft origin/main`, then one commit: `capture as a runtime tool at 2x; compose accepts 2x captures`), rerun Step 1, push with `git_push`, and open the PR on `m4ttstack/fast-browser` with `gh pr create`, using the repo's PR template if it has one and the MR writing style otherwise (no em dashes; the verification sentence names the suites and the eval run).

- [ ] **Step 8: CodeRabbit and CI**

Wait for CodeRabbit's review and CI on the PR. Address every actionable finding as a new commit, each scanned for purity before `git_push`. Never merge the PR.

- [ ] **Step 9: Report**

Write `.superpowers/report-draft.md` in the fork tree in the brief's format and publish it with `herd_report`: the plan path, both commit ranges, each verification command with its result, the final review verdicts, and in Notes the retired macro left on machines that installed it, plus anything parked.
