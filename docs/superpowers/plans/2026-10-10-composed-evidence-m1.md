# Composed Evidence, Milestone 1: Compose CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `fast-browser compose` renders an evidence spec (stage, frame, wash, lift, callout, tag, redact) into a polished 2x PNG in a pinned headless Chromium, from captures taken by a vendored handle-free capture macro, proven by fixtures, invariants, goldens and a blind agent eval.

**Architecture:** A new `lib/compose/` module in the fast-browser repo builds a self-contained HTML page (template, bundled Inter font, captures as data URIs, an in-page layout script) and screenshots its stage element in a `launch()`-ed `chromium-headless-shell` driven by the installed runtime's own `playwright-core`. Captures come from a new built-in macro, `capture-evidence.js`, and are sealed into digest sidecars by `fast-browser compose --seal`. `setup` installs the pinned headless shell; `doctor` checks it.

**Tech Stack:** Node >= 20 ES modules, `node:test`, the fork's `playwright-core` (from `~/.fast-browser/runtime/<version>/fast-browser-mcp/playwright-core`), `chromium-headless-shell`, Inter (OFL).

**Spec:** `docs/superpowers/specs/2026-10-10-composed-evidence-design.md` (mattstack repo). Milestones 2 to 4 get their own plans after this one's exit check passes.

**Repo for every task:** `~/Documents/GitHub/fast-browser` (PUBLIC). Work on a branch in a worktree under `.worktrees/composed-evidence-m1`; never on `main`. Tests run locally (`npm test`, and the e2e scripts named per task); the repo has no CI.

## Global Constraints

- Node `>=20`; `package.json` `dependencies` stays `{}`. No new npm dependency of any kind.
- PUBLIC repo: no screenshot, URL, name, case id or ticket id from any real product, anywhere in the repo. Fixture pages and data are made up.
- Output containment: every file compose or seal writes resolves inside `~/.fast-browser/screenshots/` (`paths.screenshotsDir`), using the same confinement rule `annotate` uses.
- The user's installed Chrome is never used to render. Compose launches only the pinned `chromium-headless-shell` installed under `~/.fast-browser/renderer/`.
- The capture macro uses only `locator.count`, `locator.evaluate`, `page.evaluate`, `page.screenshot` and `page.waitForTimeout`. Never `newCDPSession`, `elementHandle`, `evaluateHandle`, or a handle's `.evaluate`.
- Error messages never echo a user-supplied value (file name, key, selector, text); name the field instead. Same convention as `lib/commands/annotate.mjs`.
- Comments state only constraints the code cannot show (the repo's existing comment style is long-form; match its tone, not its length).
- Labels never draw on the screenshot; marks are drawn from the redacted source only.
- Every task ends with its tests green and a commit.

## Review Focus

1. **A spec whose sidecar was moved without its PNG** → compose refuses with "a capture sidecar's image was not found beside it", not a stack trace. Test in Task 2.
2. **Two composes writing the same `out` at once** → each render goes to a unique temp file and is renamed into place, so neither leaves a half-written PNG. Test in Task 7.
3. **A label title or note far longer than usual (80+ characters)** → the note wraps inside its max width and labels still never overlap each other or the frame. Test in Task 7.
4. **A lift target touching the frame edge** → the lift clamps inside the frame and is never cut off. Test in Task 7.
5. **A capture on a dark surface** → the macro reports it and the wash and lift border switch to the dark set. Tests in Tasks 7 and 10.

---

### Task 1: Shared screenshots-folder confinement

Move `annotate`'s private `confinedName` into a shared module so compose and seal confine exactly like annotate.

**Files:**
- Create: `lib/core/screenshots.mjs`
- Modify: `lib/commands/annotate.mjs` (remove the local `confinedName`, import the shared one)
- Test: `tests/unit/screenshots-confinement.test.mjs`

**Interfaces:**
- Produces: `confinedScreenshotPath(paths, name, field, fail) -> Promise<string>` (absolute path inside `paths.screenshotsDir`; calls `fail(message)` and throws its result on refusal).

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/screenshots-confinement.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolvePaths } from '../../lib/core/paths.mjs';
import { confinedScreenshotPath } from '../../lib/core/screenshots.mjs';

const fail = (message) => new Error(message);

test('a plain name resolves inside the screenshots directory', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-conf-'));
  try {
    const paths = resolvePaths({ homeDir: home });
    const out = await confinedScreenshotPath(paths, 'board.png', 'out', fail);
    assert.equal(out, path.join(paths.screenshotsDir, 'board.png'));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a traversing name is refused and the message names the field, not the value', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-conf-'));
  try {
    const paths = resolvePaths({ homeDir: home });
    await assert.rejects(
      () => confinedScreenshotPath(paths, '../../secret.png', 'out', fail),
      (error) => error.message === 'out must resolve inside the screenshots directory'
        && !error.message.includes('secret'),
    );
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('an empty name is refused as required', async () => {
  const paths = resolvePaths({ homeDir: '/nonexistent-home' });
  await assert.rejects(() => confinedScreenshotPath(paths, '', 'out', fail), /out is required/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/screenshots-confinement.test.mjs`
Expected: FAIL, `Cannot find module '../../lib/core/screenshots.mjs'`

- [ ] **Step 3: Create the shared module**

```js
// lib/core/screenshots.mjs
import path from 'node:path';

import { assertConfinedPath } from './containment.mjs';

// Names, never paths: assertConfinedPath requires its root under dataDir, so
// honouring caller-chosen absolute paths and confining are mutually
// exclusive, and containment wins. The refusal names the field, never the
// value, because the value is caller data and is not safe to echo.
export async function confinedScreenshotPath(paths, name, field, fail) {
  if (typeof name !== 'string' || name.length === 0) throw fail(`${field} is required`);
  const candidate = path.resolve(paths.screenshotsDir, name);
  try {
    await assertConfinedPath({ dataDir: paths.dataDir, rootDir: paths.screenshotsDir, candidate });
  } catch {
    throw fail(`${field} must resolve inside the screenshots directory`);
  }
  return candidate;
}
```

- [ ] **Step 4: Point annotate at it**

In `lib/commands/annotate.mjs`, delete the whole `async function confinedName(paths, name, field) { ... }` block and its comment, add `import { confinedScreenshotPath } from '../core/screenshots.mjs';`, and replace the two call sites:

```js
  const outPath = await confinedScreenshotPath(paths, body.out, 'out', fail);
  let basePath = null;
  if (!importMode) {
    basePath = await confinedScreenshotPath(paths, body.base, 'base', fail);
```

Remove the now-unused `assertConfinedPath` import from annotate.mjs.

- [ ] **Step 5: Run the new test and annotate's existing tests**

Run: `node --test tests/unit/screenshots-confinement.test.mjs tests/unit/annotate-*.test.mjs && npm run test:annotate`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add lib/core/screenshots.mjs lib/commands/annotate.mjs tests/unit/screenshots-confinement.test.mjs
git commit -m "core: share screenshots-folder confinement between annotate and compose"
```

---

### Task 2: Capture sidecars (seal and load)

A capture return becomes a sealed sidecar beside its PNG: relative image name plus an unkeyed SHA-256 over the image bytes and the measured geometry. Loading verifies it.

**Files:**
- Create: `lib/compose/capture.mjs`
- Test: `tests/unit/compose-capture.test.mjs`

**Interfaces:**
- Consumes: `confinedScreenshotPath` (Task 1).
- Produces:
  - `CAPTURE_SCHEMA = 'capture-evidence/1'`
  - `captureDigest(pngBytes: Buffer, geometry: {frame, boxes}) -> string` (hex)
  - `sealCapture({ paths, captureReturn, fail }) -> Promise<{ sidecar: string, png: string }>` writes `<stem>.capture.json` beside the PNG (stem = PNG name without `.png`).
  - `loadCapture({ sidecarPath, fail }) -> Promise<Capture>` where `Capture = { sidecarPath, pngPath, png: Buffer, size: [w,h], frame: [x,y,w,h], frameSnap, boxes: Record<string,[x,y,w,h]>, missed: Array<{key,reason}>, dark: boolean, scale: number }`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/compose-capture.test.mjs
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolvePaths } from '../../lib/core/paths.mjs';
import { captureDigest, loadCapture, sealCapture } from '../../lib/compose/capture.mjs';

const fail = (message) => new Error(message);
// 1x1 PNG; only the bytes matter to the digest, and the IHDR to readPngSize.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
  + '1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');

async function setup() {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-cap-'));
  const paths = resolvePaths({ homeDir: home });
  await mkdir(paths.screenshotsDir, { recursive: true });
  const png = path.join(paths.screenshotsDir, 'run1-case-after.c1.png');
  await writeFile(png, PNG);
  const captureReturn = {
    schemaVersion: 'capture-evidence/1', name: 'run1-case-after.c1.png', png,
    frame: [0, 0, 1, 1], frameSnap: 'card', boxes: { a: [0, 0, 1, 1] }, missed: [],
    dark: false, viewport: { w: 1, h: 1 }, scale: 1,
  };
  return { home, paths, png, captureReturn };
}

test('seal writes a sidecar beside the png that names it by basename', async () => {
  const { home, paths, captureReturn } = await setup();
  try {
    const { sidecar } = await sealCapture({ paths, captureReturn, fail });
    assert.equal(sidecar, path.join(paths.screenshotsDir, 'run1-case-after.c1.capture.json'));
    const body = JSON.parse(await readFile(sidecar, 'utf8'));
    assert.equal(body.image, 'run1-case-after.c1.png');
    assert.equal(body.digest, captureDigest(PNG, { frame: [0, 0, 1, 1], boxes: { a: [0, 0, 1, 1] } }));
    assert.equal('png' in body, false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('load verifies the digest and resolves the image beside the sidecar', async () => {
  const { home, paths, captureReturn } = await setup();
  try {
    const { sidecar } = await sealCapture({ paths, captureReturn, fail });
    const moved = path.join(home, 'elsewhere');
    await mkdir(moved);
    await rename(sidecar, path.join(moved, path.basename(sidecar)));
    await rename(captureReturn.png, path.join(moved, 'run1-case-after.c1.png'));
    const capture = await loadCapture({ sidecarPath: path.join(moved, path.basename(sidecar)), fail });
    assert.deepEqual(capture.size, [1, 1]);
    assert.deepEqual(capture.boxes, { a: [0, 0, 1, 1] });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('an edited box fails the digest', async () => {
  const { home, paths, captureReturn } = await setup();
  try {
    const { sidecar } = await sealCapture({ paths, captureReturn, fail });
    const body = JSON.parse(await readFile(sidecar, 'utf8'));
    body.boxes.a = [0, 0, 2, 2];
    await writeFile(sidecar, JSON.stringify(body));
    await assert.rejects(() => loadCapture({ sidecarPath: sidecar, fail }),
      /a capture sidecar does not match its image/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a sidecar moved without its png is refused clearly', async () => {
  const { home, paths, captureReturn } = await setup();
  try {
    const { sidecar } = await sealCapture({ paths, captureReturn, fail });
    await rm(captureReturn.png);
    await assert.rejects(() => loadCapture({ sidecarPath: sidecar, fail }),
      /a capture sidecar's image was not found beside it/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('seal refuses a return whose png is outside the screenshots directory', async () => {
  const { home, paths, captureReturn } = await setup();
  try {
    await assert.rejects(
      () => sealCapture({ paths, captureReturn: { ...captureReturn, png: '/tmp/elsewhere.png', name: 'x.png' }, fail }),
      /capture png must be inside the screenshots directory/,
    );
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('seal refuses a return that is not a capture-evidence return', async () => {
  const { home, paths, captureReturn } = await setup();
  try {
    await assert.rejects(
      () => sealCapture({ paths, captureReturn: { ...captureReturn, schemaVersion: 1 }, fail }),
      /not a capture-evidence return/,
    );
  } finally { await rm(home, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/unit/compose-capture.test.mjs`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

```js
// lib/compose/capture.mjs
import crypto from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readPngSize } from '../annotate/png.mjs';
import { confinedScreenshotPath } from '../core/screenshots.mjs';

export const CAPTURE_SCHEMA = 'capture-evidence/1';

// Unkeyed on purpose: it catches accidental edits and copy mistakes, the bar
// the spec sets. It is not a defence against an agent that recomputes it.
export function captureDigest(pngBytes, { frame, boxes }) {
  return crypto.createHash('sha256')
    .update(pngBytes)
    .update(JSON.stringify({ frame, boxes }))
    .digest('hex');
}

function isBox(value) {
  return Array.isArray(value) && value.length === 4 && value.every((n) => Number.isFinite(n));
}

export async function sealCapture({ paths, captureReturn, fail }) {
  const r = captureReturn;
  if (!r || r.schemaVersion !== CAPTURE_SCHEMA) throw fail('the file is not a capture-evidence return');
  if (!isBox(r.frame) || !r.boxes || typeof r.boxes !== 'object') throw fail('the capture return has no frame or boxes');
  for (const box of Object.values(r.boxes)) if (!isBox(box)) throw fail('the capture return has a malformed box');
  const png = await confinedScreenshotPath(paths, r.name, 'capture png', fail);
  if (typeof r.png !== 'string' || path.resolve(r.png) !== png) {
    throw fail('capture png must be inside the screenshots directory');
  }
  let bytes;
  try { bytes = await readFile(png); } catch { throw fail('the capture png was not found'); }
  const stem = path.basename(png).replace(/\.png$/i, '');
  const sidecar = await confinedScreenshotPath(paths, `${stem}.capture.json`, 'capture sidecar', fail);
  const body = {
    schemaVersion: CAPTURE_SCHEMA,
    source: 'live',
    image: path.basename(png),
    frame: r.frame,
    frameSnap: r.frameSnap ?? 'card',
    boxes: r.boxes,
    missed: Array.isArray(r.missed) ? r.missed : [],
    dark: Boolean(r.dark),
    scale: Number.isInteger(r.scale) ? r.scale : 1,
    digest: captureDigest(bytes, { frame: r.frame, boxes: r.boxes }),
  };
  const temp = `${sidecar}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, sidecar);
  return { sidecar, png };
}

export async function loadCapture({ sidecarPath, fail }) {
  let body;
  try { body = JSON.parse(await readFile(sidecarPath, 'utf8')); } catch { throw fail('a capture sidecar could not be read'); }
  if (body.schemaVersion !== CAPTURE_SCHEMA || typeof body.image !== 'string'
    || body.image !== path.basename(body.image)) {
    throw fail('a capture sidecar is malformed');
  }
  const pngPath = path.join(path.dirname(sidecarPath), body.image);
  let png;
  try { png = await readFile(pngPath); } catch { throw fail("a capture sidecar's image was not found beside it"); }
  if (captureDigest(png, { frame: body.frame, boxes: body.boxes }) !== body.digest) {
    throw fail('a capture sidecar does not match its image');
  }
  const { width, height } = readPngSize(png);
  return {
    sidecarPath, pngPath, png, size: [width, height],
    frame: body.frame, frameSnap: body.frameSnap, boxes: body.boxes,
    missed: body.missed ?? [], dark: Boolean(body.dark), scale: body.scale ?? 1,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/unit/compose-capture.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/compose/capture.mjs tests/unit/compose-capture.test.mjs
git commit -m "compose: seal capture returns into digest sidecars and verify on load"
```

---

### Task 3: Spec validation

Pure validation of a spec against its loaded captures. Returns every problem, never only the first.

**Files:**
- Create: `lib/compose/spec.mjs`
- Test: `tests/unit/compose-spec.test.mjs`

**Interfaces:**
- Consumes: `Capture` (Task 2).
- Produces:
  - `STATES = ['AFTER', 'BEFORE → AFTER', 'FLOW', 'FOUND']`, `TAGS = ['NEW','CHANGED','REMOVED','ISSUE','PENDING','OK']`
  - `MARK_KINDS_M1 = ['lift', 'redact']`
  - `validateSpec(spec, capturesByPanel: Capture[]) -> string[]` (problem messages; empty means valid). Messages name fields and indexes, never values.
  - `markKind(mark) -> 'lift' | 'redact' | null`, `markKeys(mark) -> string[]`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/compose-spec.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSpec } from '../../lib/compose/spec.mjs';

const capture = (over = {}) => ({ boxes: { name: [10, 10, 50, 20], phone: [10, 40, 80, 20] }, missed: [], ...over });
const base = (marks) => ({
  state: 'AFTER', title: 'A board', layout: 'single', out: 'r-c-after.png',
  panels: [{ capture: 'r-c-after.c1.capture.json', marks }],
});

test('a valid lift and redact spec has no problems', () => {
  assert.deepEqual(validateSpec(base([
    { lift: 'name', title: 'Name', note: 'Shown', tag: 'NEW' },
    { redact: 'phone' },
  ]), [capture()]), []);
});

test('every problem is reported, by field and index, never by value', () => {
  const problems = validateSpec({
    state: 'DONE', title: '', layout: 'grid', out: '', panels: [{ capture: 'x.json', marks: [
      { lift: 'nope', title: 'X', tag: 'SHINY' }, { bracket: ['name'] }, {},
    ] }],
  }, [capture()]);
  assert.ok(problems.includes('state must be one of AFTER, BEFORE → AFTER, FLOW, FOUND'));
  assert.ok(problems.includes('title is required'));
  assert.ok(problems.includes('layout must be single in this version'));
  assert.ok(problems.includes('out is required'));
  assert.ok(problems.includes('panels[0].marks[0] names a key the capture did not measure'));
  assert.ok(problems.includes('panels[0].marks[0].tag must be one of NEW, CHANGED, REMOVED, ISSUE, PENDING, OK'));
  assert.ok(problems.includes('panels[0].marks[1] is not a supported mark in this version'));
  assert.ok(problems.includes('panels[0].marks[2] is not a supported mark in this version'));
  assert.equal(problems.some((p) => p.includes('nope') || p.includes('SHINY')), false);
});

test('a redact key the capture reported as missed is refused', () => {
  const problems = validateSpec(base([{ redact: 'email' }]),
    [capture({ missed: [{ key: 'email', reason: 'ambiguous' }] })]);
  assert.ok(problems.includes('panels[0].marks[0] redacts a key the capture missed; fix the selector and recapture'));
});

test('a panel with no marks and no capture is refused', () => {
  const problems = validateSpec({ ...base([]), panels: [{}] }, [null]);
  assert.ok(problems.includes('panels[0].capture is required'));
});

test('an empty panel list is refused', () => {
  assert.ok(validateSpec({ ...base([]), panels: [] }, []).includes('panels must list exactly one panel in this version'));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/unit/compose-spec.test.mjs`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

```js
// lib/compose/spec.mjs
export const STATES = Object.freeze(['AFTER', 'BEFORE → AFTER', 'FLOW', 'FOUND']);
export const TAGS = Object.freeze(['NEW', 'CHANGED', 'REMOVED', 'ISSUE', 'PENDING', 'OK']);
export const MARK_KINDS_M1 = Object.freeze(['lift', 'redact']);

export function markKind(mark) {
  if (!mark || typeof mark !== 'object') return null;
  const kinds = MARK_KINDS_M1.filter((kind) => kind in mark);
  return kinds.length === 1 ? kinds[0] : null;
}

export function markKeys(mark) {
  const kind = markKind(mark);
  if (!kind) return [];
  const value = mark[kind];
  return (Array.isArray(value) ? value : [value]).filter((key) => typeof key === 'string');
}

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

export function validateSpec(spec, capturesByPanel) {
  const problems = [];
  if (!STATES.includes(spec?.state)) problems.push(`state must be one of ${STATES.join(', ')}`);
  if (!nonEmpty(spec?.title)) problems.push('title is required');
  if ((spec?.layout ?? 'single') !== 'single') problems.push('layout must be single in this version');
  if (!nonEmpty(spec?.out)) problems.push('out is required');
  const panels = Array.isArray(spec?.panels) ? spec.panels : [];
  if (panels.length !== 1) problems.push('panels must list exactly one panel in this version');
  panels.forEach((panel, p) => {
    if (!nonEmpty(panel?.capture)) problems.push(`panels[${p}].capture is required`);
    const capture = capturesByPanel[p];
    const measured = new Set(Object.keys(capture?.boxes ?? {}));
    const missed = new Set((capture?.missed ?? []).map((entry) => entry.key));
    (Array.isArray(panel?.marks) ? panel.marks : []).forEach((mark, m) => {
      const at = `panels[${p}].marks[${m}]`;
      const kind = markKind(mark);
      if (!kind) { problems.push(`${at} is not a supported mark in this version`); return; }
      const keys = markKeys(mark);
      if (kind === 'redact' && keys.some((key) => missed.has(key))) {
        problems.push(`${at} redacts a key the capture missed; fix the selector and recapture`);
        return;
      }
      if (keys.length === 0 || keys.some((key) => !measured.has(key))) {
        problems.push(`${at} names a key the capture did not measure`);
      }
      if (kind === 'lift') {
        if (mark.tag !== undefined && !TAGS.includes(mark.tag)) problems.push(`${at}.tag must be one of ${TAGS.join(', ')}`);
        if (mark.title !== undefined && !nonEmpty(mark.title)) problems.push(`${at}.title must not be empty`);
      }
    });
  });
  return problems;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/unit/compose-spec.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/compose/spec.mjs tests/unit/compose-spec.test.mjs
git commit -m "compose: validate evidence specs against their captures"
```

---

### Task 4: Renderer pin in the runtime lock, and its installer

The lock gains an optional `renderer` entry (pinned `chromium-headless-shell` per macOS platform, as immutable GitHub release assets). A new installer downloads, verifies and unzips it under `~/.fast-browser/renderer/`.

**Files:**
- Modify: `lib/runtime/lock.mjs` (parse `renderer`), `lib/core/paths.mjs` (add `rendererDir`)
- Create: `lib/compose/renderer.mjs`
- Test: `tests/unit/runtime-lock.test.mjs` (extend), `tests/unit/compose-renderer.test.mjs`

**Interfaces:**
- Produces:
  - lock: `lock.renderer = { revision: string, platforms: { 'mac-arm64'?: Artifact, 'mac-x64'?: Artifact } } | undefined`, `Artifact = { url, file, sha256 }`, file name exactly `chromium-headless-shell-<revision>-<platform>.zip`.
  - `paths.rendererDir = <dataDir>/renderer`
  - `rendererPlatform(nodePlatform = process.platform, arch = process.arch) -> 'mac-arm64' | 'mac-x64' | null`
  - `rendererExecutable(paths, lock, platform) -> string` = `<rendererDir>/<revision>/<platform>/chrome-headless-shell-<platform>/chrome-headless-shell`
  - `installRenderer({ lock, paths, fetch, platform }) -> Promise<{ executable, revision, installed: boolean }>` (idempotent; `installed: false` when already present and verified by marker)
  - `rendererStatus({ lock, paths, platform }) -> Promise<'ready' | 'missing' | 'unpinned' | 'unsupported'>`

- [ ] **Step 1: Write the failing lock tests**

Append to `tests/unit/runtime-lock.test.mjs`, which already builds a valid lock with `fixtureLock()`:

```js
test('a lock without renderer parses and has no renderer', () => {
  const lock = parseRuntimeLock(fixtureLock());
  assert.equal(lock.renderer, undefined);
});

test('a renderer entry parses per platform', () => {
  const value = fixtureLock();
  value.renderer = {
    revision: '1243',
    platforms: {
      'mac-arm64': {
        url: 'https://github.com/m4ttheweric/playwright/releases/download/fast-browser-v0.1.2/chromium-headless-shell-1243-mac-arm64.zip',
        file: 'chromium-headless-shell-1243-mac-arm64.zip',
        sha256: 'a'.repeat(64),
      },
    },
  };
  const lock = parseRuntimeLock(value);
  assert.equal(lock.renderer.revision, '1243');
  assert.equal(lock.renderer.platforms['mac-arm64'].file, 'chromium-headless-shell-1243-mac-arm64.zip');
});

test('a renderer file name that does not match its revision and platform is refused', () => {
  const value = fixtureLock();
  value.renderer = { revision: '1243', platforms: { 'mac-arm64': {
    url: 'https://github.com/o/r/releases/download/t/other.zip', file: 'other.zip', sha256: 'a'.repeat(64),
  } } };
  assert.throws(() => parseRuntimeLock(value), /renderer\.platforms\.mac-arm64\.file must be exactly chromium-headless-shell-1243-mac-arm64\.zip/);
});

test('an unknown renderer platform is refused', () => {
  const value = fixtureLock();
  value.renderer = { revision: '1243', platforms: { 'win-x64': {} } };
  assert.throws(() => parseRuntimeLock(value), /renderer\.platforms has an unsupported platform/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/unit/runtime-lock.test.mjs`
Expected: the renderer tests FAIL (renderer is dropped or not validated)

- [ ] **Step 3: Parse the renderer entry**

In `lib/runtime/lock.mjs`, add above `parseRuntimeLock`:

```js
const RENDERER_PLATFORMS = Object.freeze(['mac-arm64', 'mac-x64']);

// Optional, like the CRX: a lock without it is valid for everything except
// `compose`, which reports the missing renderer itself. A lock that carries
// one must pin it as precisely as the runtime.
function rendererEntry(renderer, options) {
  if (renderer === undefined) return {};
  const entry = object(renderer, 'renderer');
  const revision = string(entry.revision, 'renderer.revision');
  if (!/^[0-9]+$/.test(revision)) throw new RuntimeLockError('renderer.revision must be numeric');
  const platforms = object(entry.platforms, 'renderer.platforms');
  const parsed = {};
  for (const [platform, artifact] of Object.entries(platforms)) {
    if (!RENDERER_PLATFORMS.includes(platform)) {
      throw new RuntimeLockError('renderer.platforms has an unsupported platform');
    }
    const field = `renderer.platforms.${platform}`;
    const item = object(artifact, field);
    const file = artifactFile(item.file, `${field}.file`, `chromium-headless-shell-${revision}-${platform}.zip`);
    parsed[platform] = {
      url: artifactUrl(item.url, `${field}.url`, file, options),
      file,
      sha256: checksum(item.sha256, `${field}.sha256`),
    };
  }
  return { renderer: { revision, platforms: parsed } };
}
```

and in `parseRuntimeLock`'s returned object, after the `extension: { ... }` property, add `...rendererEntry(lock.renderer, options),`. In `loadRuntimeLock`'s override branch, extend the URL refusal and the `beside` rewrite to cover renderer artifacts:

```js
  const renderer = value.renderer === undefined ? null : object(value.renderer, 'renderer');
  const rendererArtifacts = renderer?.platforms && typeof renderer.platforms === 'object'
    ? Object.values(renderer.platforms) : [];
  if ('url' in runtime || 'url' in extension || (crx && 'url' in crx)
    || rendererArtifacts.some((item) => item && typeof item === 'object' && 'url' in item)) {
    throw new RuntimeLockError('runtime lock override must not contain artifact URLs');
  }
```

and add to `resolved`:

```js
    ...(renderer ? { renderer: {
      ...renderer,
      platforms: Object.fromEntries(Object.entries(renderer.platforms ?? {})
        .map(([platform, item]) => [platform, { ...item, ...beside(item?.file) }])),
    } } : {}),
```

In `lib/core/paths.mjs`, add `rendererDir: path.join(dataDir, 'renderer'),` after `extensionDir`.

- [ ] **Step 4: Run the lock tests**

Run: `node --test tests/unit/runtime-lock.test.mjs`
Expected: PASS

- [ ] **Step 5: Write the failing installer tests**

```js
// tests/unit/compose-renderer.test.mjs
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import crypto from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { resolvePaths } from '../../lib/core/paths.mjs';
import {
  installRenderer, rendererExecutable, rendererPlatform, rendererStatus,
} from '../../lib/compose/renderer.mjs';

const execFile = promisify(execFileCallback);

async function fakeShellZip(dir, platform) {
  const tree = path.join(dir, 'tree');
  const exeDir = path.join(tree, `chrome-headless-shell-${platform}`);
  await mkdir(exeDir, { recursive: true });
  await writeFile(path.join(exeDir, 'chrome-headless-shell'), '#!/bin/sh\necho fake\n');
  await chmod(path.join(exeDir, 'chrome-headless-shell'), 0o755);
  const zip = path.join(dir, `chromium-headless-shell-1243-${platform}.zip`);
  await execFile('/usr/bin/zip', ['-qr', zip, `chrome-headless-shell-${platform}`], { cwd: tree });
  const sha256 = crypto.createHash('sha256').update(await readFile(zip)).digest('hex');
  return { url: pathToFileURL(zip).href, file: path.basename(zip), sha256 };
}

test('platform mapping covers macOS only', () => {
  assert.equal(rendererPlatform('darwin', 'arm64'), 'mac-arm64');
  assert.equal(rendererPlatform('darwin', 'x64'), 'mac-x64');
  assert.equal(rendererPlatform('linux', 'x64'), null);
});

test('install verifies the checksum, unzips, and is idempotent', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-rend-'));
  try {
    const paths = resolvePaths({ homeDir: home });
    const artifact = await fakeShellZip(home, 'mac-arm64');
    const lock = { renderer: { revision: '1243', platforms: { 'mac-arm64': artifact } } };
    assert.equal(await rendererStatus({ lock, paths, platform: 'mac-arm64' }), 'missing');
    const first = await installRenderer({ lock, paths, platform: 'mac-arm64' });
    assert.equal(first.installed, true);
    assert.equal(first.executable, rendererExecutable(paths, lock, 'mac-arm64'));
    assert.equal(await rendererStatus({ lock, paths, platform: 'mac-arm64' }), 'ready');
    const second = await installRenderer({ lock, paths, platform: 'mac-arm64' });
    assert.equal(second.installed, false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a checksum mismatch installs nothing', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-rend-'));
  try {
    const paths = resolvePaths({ homeDir: home });
    const artifact = { ...(await fakeShellZip(home, 'mac-arm64')), sha256: 'b'.repeat(64) };
    const lock = { renderer: { revision: '1243', platforms: { 'mac-arm64': artifact } } };
    await assert.rejects(() => installRenderer({ lock, paths, platform: 'mac-arm64' }), /renderer checksum did not match/);
    assert.equal(await rendererStatus({ lock, paths, platform: 'mac-arm64' }), 'missing');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('status reports unpinned and unsupported', async () => {
  const paths = resolvePaths({ homeDir: '/nonexistent' });
  assert.equal(await rendererStatus({ lock: {}, paths, platform: 'mac-arm64' }), 'unpinned');
  assert.equal(await rendererStatus({ lock: { renderer: { revision: '1', platforms: {} } }, paths, platform: null }), 'unsupported');
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `node --test tests/unit/compose-renderer.test.mjs`
Expected: FAIL, module not found

- [ ] **Step 7: Implement the installer**

```js
// lib/compose/renderer.mjs
import { execFile as execFileCallback } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { assertConfinedPath } from '../core/containment.mjs';

const execFile = promisify(execFileCallback);

export class RendererInstallError extends Error {
  constructor(message) { super(message); this.name = 'RendererInstallError'; }
}

export function rendererPlatform(nodePlatform = process.platform, arch = process.arch) {
  if (nodePlatform !== 'darwin') return null;
  if (arch === 'arm64') return 'mac-arm64';
  if (arch === 'x64') return 'mac-x64';
  return null;
}

function platformDir(paths, lock, platform) {
  return path.join(paths.rendererDir, lock.renderer.revision, platform);
}

export function rendererExecutable(paths, lock, platform) {
  return path.join(platformDir(paths, lock, platform), `chrome-headless-shell-${platform}`, 'chrome-headless-shell');
}

function markerPath(paths, lock, platform) {
  return path.join(platformDir(paths, lock, platform), 'installed.json');
}

export async function rendererStatus({ lock, paths, platform }) {
  if (!lock?.renderer) return 'unpinned';
  if (!platform || !lock.renderer.platforms?.[platform]) return 'unsupported';
  try {
    const marker = JSON.parse(await readFile(markerPath(paths, lock, platform), 'utf8'));
    const exe = await stat(rendererExecutable(paths, lock, platform));
    return marker.sha256 === lock.renderer.platforms[platform].sha256 && exe.isFile() ? 'ready' : 'missing';
  } catch {
    return 'missing';
  }
}

async function fetchBytes(url, fetchImplementation) {
  if (url.startsWith('file:')) return readFile(fileURLToPath(url));
  if (typeof fetchImplementation !== 'function') throw new RendererInstallError('a Fetch-compatible fetch is required');
  const response = await fetchImplementation(url, { redirect: 'follow' });
  if (!response.ok) throw new RendererInstallError(`renderer download failed (HTTP ${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function installRenderer({ lock, paths, fetch: fetchImplementation = globalThis.fetch, platform = rendererPlatform() }) {
  const status = await rendererStatus({ lock, paths, platform });
  if (status === 'unpinned') throw new RendererInstallError('the runtime lock pins no renderer');
  if (status === 'unsupported') throw new RendererInstallError('the renderer is not available for this platform');
  const executable = rendererExecutable(paths, lock, platform);
  if (status === 'ready') return { executable, revision: lock.renderer.revision, installed: false };

  const artifact = lock.renderer.platforms[platform];
  const target = platformDir(paths, lock, platform);
  await assertConfinedPath({ dataDir: paths.dataDir, rootDir: paths.rendererDir, candidate: target });
  const bytes = await fetchBytes(artifact.url, fetchImplementation);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(artifact.sha256, 'hex'))) {
    throw new RendererInstallError('renderer checksum did not match the runtime lock');
  }
  const staging = `${target}.staging-${crypto.randomUUID()}`;
  const zipPath = `${staging}.zip`;
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    await writeFile(zipPath, bytes, { mode: 0o600 });
    await execFile('/usr/bin/unzip', ['-qq', zipPath, '-d', staging]);
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    await writeFile(markerPath(paths, lock, platform),
      `${JSON.stringify({ schemaVersion: 1, revision: lock.renderer.revision, sha256: artifact.sha256 })}\n`, { mode: 0o600 });
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(zipPath, { force: true });
  }
  return { executable, revision: lock.renderer.revision, installed: true };
}
```

- [ ] **Step 8: Run the tests**

Run: `node --test tests/unit/compose-renderer.test.mjs tests/unit/runtime-lock.test.mjs`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/runtime/lock.mjs lib/core/paths.mjs lib/compose/renderer.mjs tests/unit/runtime-lock.test.mjs tests/unit/compose-renderer.test.mjs
git commit -m "compose: pin chromium-headless-shell in the runtime lock and install it"
```

---

### Task 5: Bundled Inter font

**Files:**
- Create: `assets/fonts/InterVariable.woff2`, `assets/fonts/OFL.txt`
- Modify: `THIRD_PARTY_NOTICES.md`
- Test: `tests/unit/compose-font.test.mjs`

**Interfaces:**
- Produces: `assets/fonts/InterVariable.woff2` (read by Task 6's page builder via `new URL('../../assets/fonts/InterVariable.woff2', import.meta.url)`).

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/compose-font.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the bundled Inter font is a woff2 file with its licence beside it', async () => {
  const font = await readFile(new URL('../../assets/fonts/InterVariable.woff2', import.meta.url));
  assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2');
  const licence = await readFile(new URL('../../assets/fonts/OFL.txt', import.meta.url), 'utf8');
  assert.match(licence, /SIL OPEN FONT LICENSE/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/compose-font.test.mjs`
Expected: FAIL, ENOENT

- [ ] **Step 3: Fetch the font from the upstream release and record its checksum**

```bash
mkdir -p assets/fonts /tmp/inter-dl && cd /tmp/inter-dl
curl -fsSLO https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
unzip -q Inter-4.1.zip -d inter
cp inter/web/InterVariable.woff2 ~/Documents/GitHub/fast-browser/.worktrees/composed-evidence-m1/assets/fonts/
cp inter/LICENSE.txt ~/Documents/GitHub/fast-browser/.worktrees/composed-evidence-m1/assets/fonts/OFL.txt
shasum -a 256 inter/web/InterVariable.woff2
```

Append to `THIRD_PARTY_NOTICES.md`:

```markdown
## Inter

`assets/fonts/InterVariable.woff2` is Inter 4.1 by Rasmus Andersson
(https://github.com/rsms/inter), licensed under the SIL Open Font License 1.1
(`assets/fonts/OFL.txt`). SHA-256 of the bundled file: <paste the shasum output>.
It is embedded into `fast-browser compose` renders so they never fetch fonts.
```

- [ ] **Step 4: Run the test**

Run: `node --test tests/unit/compose-font.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add assets/fonts THIRD_PARTY_NOTICES.md tests/unit/compose-font.test.mjs
git commit -m "compose: bundle Inter (OFL) for offline renders"
```

---

### Task 6: The board page (template, redaction pre-pass, layout)

Builds the self-contained HTML. All layout runs in the page and publishes a geometry report on `window.__composeReport` for the invariant tests.

**Files:**
- Create: `lib/compose/page.mjs` (Node side: builds the HTML string), `lib/compose/page-layout.js` (browser side: plain script, read as text and inlined)
- Test: `tests/unit/compose-page.test.mjs`

**Interfaces:**
- Consumes: `Capture` (Task 2), validated spec (Task 3), the font (Task 5).
- Produces:
  - `buildBoardHtml({ spec, captures: Capture[], fontBytes: Buffer, layoutSource: string }) -> string`
  - In-page global `window.__composeReport = { dark: boolean, stage: Rect, frame: Rect, capture: Rect, lifts: Array<{ keys: string[], rect: Rect, clamped: boolean }>, labels: Array<{ rect: Rect, anchor: [x,y] }>, leaders: Array<{ points: [x,y][], lift: number }>, redactions: Array<{ rect: Rect, fill: string }>, warnings: string[] }`, `Rect = [x, y, w, h]` in CSS pixels relative to `#stage`.
  - `REDACT_FILL = '#CBD5E1'`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/compose-page.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBoardHtml, REDACT_FILL } from '../../lib/compose/page.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

test('the page inlines the capture, the font and the layout script, and fetches nothing', () => {
  const html = buildBoardHtml({
    spec: { state: 'AFTER', title: 'T <b>', layout: 'single', out: 'o.png',
      panels: [{ capture: 'c.json', marks: [{ lift: 'a', title: 'Hello' }] }] },
    captures: [{ png: PNG, size: [1, 1], frame: [0, 0, 1, 1], boxes: { a: [0, 0, 1, 1] }, dark: false }],
    fontBytes: Buffer.from('wOF2fake'),
    layoutSource: 'window.__composeLayout = () => {};',
  });
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /data:font\/woff2;base64,/);
  assert.match(html, /window\.__composeLayout/);
  assert.equal(/https?:\/\//.test(html), false);
  assert.equal(html.includes('<b>'), false, 'spec text is JSON-encoded, never raw HTML');
  assert.ok(html.includes(REDACT_FILL));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/compose-page.test.mjs`
Expected: FAIL, module not found

- [ ] **Step 3: Implement the Node-side builder**

```js
// lib/compose/page.mjs
export const REDACT_FILL = '#CBD5E1';

// JSON inside a <script> must not be able to close the tag.
function scriptSafe(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

const CSS = `
:root{--accent:#6E56CF;--ink:#1F1A3D;--muted:#5B5870}
*{box-sizing:border-box;margin:0}
body{background:transparent;font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}
#stage{display:inline-flex;flex-direction:column;gap:18px;padding:28px;border-radius:16px;
  background:linear-gradient(135deg,#EDE9FE 0%,#DBEAFE 55%,#E0F7F4 100%)}
.header{display:flex;gap:10px;align-items:center}
.state{padding:3px 9px;border-radius:999px;color:#fff;font-size:11px;font-weight:700;letter-spacing:.6px}
.title{font-size:15px;font-weight:600;color:var(--ink)}
.comp{position:relative}
.capture{position:absolute;left:0;top:0;border-radius:10px;overflow:hidden;box-shadow:0 10px 30px rgba(30,27,75,.18)}
.fill{position:absolute;inset:0;background-repeat:no-repeat}
.wash{position:absolute;inset:0;background:rgba(255,255,255,.55)}
.wash.dark{background:rgba(11,9,32,.65)}
.lift{position:absolute;border-radius:7px;background-repeat:no-repeat;box-shadow:0 0 0 3px #fff,0 12px 28px rgba(30,27,75,.30)}
.lift.dark{box-shadow:0 0 0 3px #4B4670,0 12px 28px rgba(0,0,0,.5)}
.redtag{position:absolute;padding:2px 6px;border-radius:999px;background:#334155;color:#fff;font-size:9px;font-weight:700;letter-spacing:.6px}
.label{position:absolute;display:flex;flex-direction:column;gap:3px;max-width:240px}
.lrow{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ltitle{font-size:13px;font-weight:600;color:var(--ink)}
.lnote{font-size:12px;color:var(--muted);line-height:1.4;max-width:200px;overflow-wrap:anywhere}
.tag{padding:2px 7px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.6px;background:#E2E8F0;color:#475569}
.tag.NEW,.tag.OK{background:#DCFCE7;color:#15803D}.tag.CHANGED{background:#FEF3C7;color:#B45309}
.tag.REMOVED{background:#FFE4E6;color:#BE123C}.tag.ISSUE{background:#FEE2E2;color:#B91C1C}
svg.ov{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
`;

export function buildBoardHtml({ spec, captures, fontBytes, layoutSource }) {
  const data = {
    spec,
    redactFill: REDACT_FILL,
    captures: captures.map((c) => ({
      uri: `data:image/png;base64,${c.png.toString('base64')}`,
      size: c.size, frame: c.frame, boxes: c.boxes, dark: c.dark,
    })),
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${fontBytes.toString('base64')}) format('woff2');font-weight:100 900;font-display:block}
${CSS}</style></head><body><div id="stage"></div>
<script>window.__composeData = ${scriptSafe(data)};</script>
<script>${layoutSource}</script>
</body></html>`;
}
```

- [ ] **Step 4: Implement the in-page layout script**

```js
// lib/compose/page-layout.js
// Runs inside the headless renderer page. Plain script, no imports: page.mjs
// inlines this file's text. window.__composeLayout() returns a Promise that
// resolves once every image is decoded and layout is final.
(function () {
  const TONES = { AFTER: '#15803D', 'BEFORE → AFTER': '#4F46E5', FLOW: '#1F1A3D', FOUND: '#B91C1C' };
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, cls, parent, text) => {
    const e = document.createElement(tag); if (cls) e.className = cls;
    if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e;
  };
  const place = (e, x, y, w, h) => {
    e.style.left = `${x}px`; e.style.top = `${y}px`;
    if (w != null) { e.style.width = `${w}px`; e.style.height = `${h}px`; }
  };
  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src;
  });

  // Redaction is applied once, to the source pixels, before any layer reads
  // them: every layer below draws from this redacted copy, so no lift can
  // ever show what a redaction hides.
  async function redactedSource(capture, regions, fill) {
    const img = await loadImage(capture.uri);
    const canvas = document.createElement('canvas');
    canvas.width = capture.size[0]; canvas.height = capture.size[1];
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = fill;
    for (const [x, y, w, h] of regions) ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    return canvas.toDataURL('image/png');
  }

  const union = (boxes) => {
    const x = Math.min(...boxes.map((b) => b[0])); const y = Math.min(...boxes.map((b) => b[1]));
    return [x, y, Math.max(...boxes.map((b) => b[0] + b[2])) - x, Math.max(...boxes.map((b) => b[1] + b[3])) - y];
  };
  const keysOf = (mark, kind) => [].concat(mark[kind]);

  window.__composeLayout = async function () {
    const { spec, captures, redactFill } = window.__composeData;
    const report = { lifts: [], labels: [], leaders: [], redactions: [], warnings: [], dark: false };
    const stage = document.getElementById('stage');
    const header = el('div', 'header', stage);
    el('span', 'state', header, spec.state).style.background = TONES[spec.state] || '#1F1A3D';
    el('span', 'title', header, spec.title);

    const panel = spec.panels[0];
    const capture = captures[0];
    const marks = panel.marks || [];
    const [fx, fy, fw, fh] = capture.frame;
    const S = Math.min(1.25, Math.max(0.55, 560 / fw));
    const cw = Math.round(fw * S); const ch = Math.round(fh * S);
    const side = fw > 2.2 * fh ? 'bottom' : 'right';
    const dark = Boolean(capture.dark);
    report.dark = dark;
    const map = (b) => [(b[0] - fx) * S, (b[1] - fy) * S, b[2] * S, b[3] * S];

    const redactBoxes = marks.filter((m) => 'redact' in m).map((m) => union(keysOf(m, 'redact').map((k) => capture.boxes[k])));
    const source = await redactedSource(capture, redactBoxes, redactFill);
    const bg = (node, x, y, k) => {
      node.style.backgroundImage = `url(${source})`;
      node.style.backgroundSize = `${capture.size[0] * S * k}px ${capture.size[1] * S * k}px`;
      node.style.backgroundPosition = `${-x * S * k}px ${-y * S * k}px`;
    };

    const comp = el('div', 'comp', stage);
    const cap = el('div', 'capture', comp); place(cap, 0, 0, cw, ch);
    bg(el('div', 'fill', cap), fx, fy, 1);
    if (marks.some((m) => 'lift' in m)) el('div', `wash${dark ? ' dark' : ''}`, cap);

    for (const box of redactBoxes) {
      const [x, y, w, h] = map(box);
      const tag = el('div', 'redtag', comp, 'REDACTED'); place(tag, Math.min(x + w - 6, cw - 64), Math.max(y - 10, 2));
      report.redactions.push({ rect: [x, y, w, h], fill: redactFill });
    }

    const anchors = [];
    for (const mark of marks) {
      if (!('lift' in mark)) continue;
      const keys = keysOf(mark, 'lift');
      const b = union(keys.map((k) => capture.boxes[k]));
      const pad = 4; const k = 1.06;
      const bb = [b[0] - pad, b[1] - pad, b[2] + 2 * pad, b[3] + 2 * pad];
      const [x, y, w, h] = map(bb);
      const W = Math.min(w * k, cw - 4); const H = Math.min(h * k, ch - 4);
      let L = x + w / 2 - W / 2; let T = y + h / 2 - H / 2;
      const clampedL = Math.min(Math.max(L, 2), cw - W - 2); const clampedT = Math.min(Math.max(T, 2), ch - H - 2);
      const clamped = clampedL !== L || clampedT !== T;
      L = clampedL; T = clampedT;
      if (clamped) report.warnings.push('a lift was clamped at the frame edge');
      // bg() positions the source at -bb * S * k, so a clamped lift still
      // shows its own region wherever it ends up.
      const lift = el('div', `lift${dark ? ' dark' : ''}`, comp); place(lift, L, T, W, H);
      bg(lift, bb[0], bb[1], k);
      report.lifts.push({ keys, rect: [L, T, W, H], clamped });
      if (mark.title) anchors.push({ mark, rect: [L, T, W, H], index: report.lifts.length - 1 });
    }

    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'ov'); comp.appendChild(svg);
    const line = (points, lift) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M ${points.map((q) => q.join(' ')).join(' L ')}`);
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#6E56CF'); p.setAttribute('stroke-width', '1.5');
      svg.appendChild(p); report.leaders.push({ points, lift });
    };
    const dot = ([cx, cy]) => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 4.5);
      c.setAttribute('fill', '#6E56CF'); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', 2);
      svg.appendChild(c);
    };
    const makeLabel = (mark) => {
      const lab = el('div', 'label', comp); const row = el('div', 'lrow', lab);
      if (mark.tag) el('span', `tag ${mark.tag}`, row, mark.tag);
      el('span', 'ltitle', row, mark.title);
      if (mark.note) el('div', 'lnote', lab, mark.note);
      return lab;
    };

    let maxR = cw; let maxB = ch;
    if (side === 'right') {
      let nextY = 0;
      for (const a of anchors.sort((p, q) => (p.rect[1] + p.rect[3] / 2) - (q.rect[1] + q.rect[3] / 2))) {
        const lab = makeLabel(a.mark); const r = lab.getBoundingClientRect();
        const cy = a.rect[1] + a.rect[3] / 2;
        const y = Math.max(nextY, cy - r.height / 2, 0); nextY = y + r.height + 10;
        const x = cw + 34; place(lab, x, y);
        const p1 = [a.rect[0] + a.rect[2], cy]; const xm = cw + 16; const ey = y + Math.min(r.height / 2, 11);
        line([p1, [xm, cy], [xm, ey], [x - 6, ey]], a.index); dot(p1);
        report.labels.push({ rect: [x, y, r.width, r.height], anchor: p1 });
        maxR = Math.max(maxR, x + r.width); maxB = Math.max(maxB, y + r.height);
      }
    } else {
      let nextX = 0;
      for (const a of anchors.sort((p, q) => p.rect[0] - q.rect[0])) {
        const lab = makeLabel(a.mark); const r = lab.getBoundingClientRect();
        const cx = a.rect[0] + a.rect[2] / 2;
        const x = Math.max(nextX, cx - 24, 0); nextX = x + r.width + 20;
        const y = ch + 34; place(lab, x, y);
        const p1 = [cx, a.rect[1] + a.rect[3]]; const ym = ch + 16;
        line([p1, [cx, ym], [x + 12, ym], [x + 12, y - 6]], a.index); dot(p1);
        report.labels.push({ rect: [x, y, r.width, r.height], anchor: p1 });
        maxR = Math.max(maxR, x + r.width); maxB = Math.max(maxB, y + r.height);
      }
    }
    comp.style.width = `${Math.ceil(maxR + 4)}px`; comp.style.height = `${Math.ceil(maxB + 4)}px`;
    svg.setAttribute('width', comp.style.width); svg.setAttribute('height', comp.style.height);

    await document.fonts.ready;
    const s = stage.getBoundingClientRect(); const c = comp.getBoundingClientRect();
    const off = (rect) => [rect[0] + c.left - s.left, rect[1] + c.top - s.top, rect[2], rect[3]];
    report.stage = [0, 0, s.width, s.height];
    report.capture = off([0, 0, cw, ch]);
    report.frame = report.capture;
    report.lifts = report.lifts.map((l) => ({ ...l, rect: off(l.rect) }));
    report.labels = report.labels.map((l) => ({ ...l, rect: off(l.rect) }));
    report.redactions = report.redactions.map((r) => ({ ...r, rect: off(r.rect) }));
    report.leaders = report.leaders.map((l) => ({ ...l, points: l.points.map(([x, y]) => [x + c.left - s.left, y + c.top - s.top]) }));
    window.__composeReport = report;
    return report;
  };
}());
```

- [ ] **Step 5: Run the test**

Run: `node --test tests/unit/compose-page.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/compose/page.mjs lib/compose/page-layout.js tests/unit/compose-page.test.mjs
git commit -m "compose: build the board page with redaction pre-pass and margin layout"
```

---

### Task 7: The render engine and layout invariants

Launches the pinned headless shell with the installed runtime's `playwright-core`, renders at `deviceScaleFactor: 2`, returns the layout report. The invariant tests run here.

**Files:**
- Create: `lib/compose/engine.mjs`, `tests/e2e/helpers/renderer.mjs`
- Test: `tests/e2e/compose-invariants.test.mjs`
- Modify: `package.json` (add script `"test:compose": "node --test tests/e2e/compose-invariants.test.mjs tests/e2e/compose-fixtures.test.mjs"`)

**Interfaces:**
- Consumes: `buildBoardHtml` (Task 6), `rendererExecutable`/`rendererStatus` (Task 4).
- Produces:
  - `playwrightCorePath(paths, lock) -> string` = `<runtimeDir>/<lock.productVersion>/fast-browser-mcp/playwright-core/index.mjs`
  - `renderBoard({ html, outPath, executablePath, playwrightCore }) -> Promise<{ report, pixels: { width, height } }>` writes `outPath` atomically (temp file + rename).
  - test helper `rendererForTests() -> Promise<{ executablePath, playwrightCore } | null>` (null skips e2e tests with a message when this machine has no installed runtime/renderer).

- [ ] **Step 1: Write the test helper**

```js
// tests/e2e/helpers/renderer.mjs
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePaths } from '../../../lib/core/paths.mjs';
import { loadRuntimeLock } from '../../../lib/runtime/lock.mjs';
import { rendererExecutable, rendererPlatform } from '../../../lib/compose/renderer.mjs';
import { playwrightCorePath } from '../../../lib/compose/engine.mjs';

const pluginRoot = fileURLToPath(new URL('../../../', import.meta.url));

// The e2e compose tests use the developer's installed runtime and renderer
// read-only (never written). Run `fast-browser setup` once to provide them.
export async function rendererForTests() {
  const paths = resolvePaths();
  const lock = await loadRuntimeLock({ bundledPath: path.join(pluginRoot, 'runtime-lock.json') });
  const platform = rendererPlatform();
  if (!lock.renderer || !platform) return null;
  const executablePath = rendererExecutable(paths, lock, platform);
  const playwrightCore = playwrightCorePath(paths, lock);
  try { await access(executablePath); await access(playwrightCore); } catch { return null; }
  return { executablePath, playwrightCore };
}
```

- [ ] **Step 2: Write the failing invariant tests**

```js
// tests/e2e/compose-invariants.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { renderBoard } from '../../lib/compose/engine.mjs';
import { buildBoardHtml, REDACT_FILL } from '../../lib/compose/page.mjs';
import { rendererForTests } from './helpers/renderer.mjs';

const renderer = await rendererForTests();
const skip = renderer ? false : 'no installed runtime + renderer; run `fast-browser setup`';
const font = await readFile(new URL('../../assets/fonts/InterVariable.woff2', import.meta.url));
const layoutSource = await readFile(new URL('../../lib/compose/page-layout.js', import.meta.url), 'utf8');

// A synthetic 600x300 capture: white card, three grey text bars.
async function syntheticCapture({ dark = false } = {}) {
  const { chromium } = await import(renderer.playwrightCore);
  const browser = await chromium.launch({ headless: true, executablePath: renderer.executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 300 } });
    const bg = dark ? '#111827' : '#ffffff'; const fg = dark ? '#e5e7eb' : '#334155';
    await page.setContent(`<body style="margin:0;background:${bg}">
      <div style="position:absolute;left:40px;top:40px;width:200px;height:20px;background:${fg}"></div>
      <div style="position:absolute;left:40px;top:80px;width:300px;height:20px;background:${fg}"></div>
      <div style="position:absolute;left:560px;top:260px;width:40px;height:40px;background:${fg}"></div></body>`);
    return { png: await page.screenshot(), size: [600, 300], frame: [0, 0, 600, 300], dark,
      boxes: { a: [40, 40, 200, 20], b: [40, 80, 300, 20], edge: [560, 260, 40, 40] } };
  } finally { await browser.close(); }
}

const intersects = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const inside = (a, b) => a[0] >= b[0] - 0.5 && a[1] >= b[1] - 0.5 && a[0] + a[2] <= b[0] + b[2] + 0.5 && a[1] + a[3] <= b[1] + b[3] + 0.5;
const segmentHitsRect = ([x1, y1], [x2, y2], r) => {
  const minX = Math.min(x1, x2); const maxX = Math.max(x1, x2); const minY = Math.min(y1, y2); const maxY = Math.max(y1, y2);
  return intersects([minX, minY, Math.max(maxX - minX, 0.01), Math.max(maxY - minY, 0.01)], [r[0] + 1, r[1] + 1, r[2] - 2, r[3] - 2]);
};

async function render(spec, capture) {
  const dir = await mkdtemp(path.join(tmpdir(), 'fb-compose-'));
  const outPath = path.join(dir, 'board.png');
  const html = buildBoardHtml({ spec, captures: [capture], fontBytes: font, layoutSource });
  const result = await renderBoard({ html, outPath, ...renderer });
  return { ...result, dir, outPath };
}

function assertInvariants(report) {
  for (const label of report.labels) {
    assert.equal(intersects(label.rect, report.capture), false, 'a label overlaps the screenshot');
    assert.ok(inside(label.rect, report.stage), 'a label leaves the stage');
  }
  report.labels.forEach((a, i) => report.labels.slice(i + 1).forEach((b) => {
    assert.equal(intersects(a.rect, b.rect), false, 'two labels overlap');
  }));
  for (const lift of report.lifts) assert.ok(inside(lift.rect, report.capture), 'a lift leaves the frame');
  for (const leader of report.leaders) {
    report.lifts.forEach((lift, i) => {
      if (i === leader.lift) return;
      for (let s = 0; s < leader.points.length - 1; s += 1) {
        assert.equal(segmentHitsRect(leader.points[s], leader.points[s + 1], lift.rect), false, 'a leader crosses another lift');
      }
    });
  }
}

const spec = (marks, title = 'Board') => ({ state: 'AFTER', title, layout: 'single', out: 'o.png', panels: [{ capture: 'c.json', marks }] });

test('two adjacent lifts with labels hold every invariant', { skip }, async () => {
  const { report, dir } = await render(spec([
    { lift: 'a', title: 'First', note: 'One line' }, { lift: 'b', title: 'Second', tag: 'NEW' },
  ]), await syntheticCapture());
  try { assertInvariants(report); assert.equal(report.labels.length, 2); } finally { await rm(dir, { recursive: true, force: true }); }
});

test('very long titles and notes wrap and still never overlap', { skip }, async () => {
  const long = 'A note that runs well past any sensible label width so it must wrap across several lines cleanly';
  const { report, dir } = await render(spec([
    { lift: 'a', title: 'A fairly long label title for a lifted element', note: long },
    { lift: 'b', title: 'Another long label title that keeps going', note: long },
  ]), await syntheticCapture());
  try { assertInvariants(report); } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a lift on a target touching the frame edge is clamped inside the frame', { skip }, async () => {
  const { report, dir } = await render(spec([{ lift: 'edge', title: 'Edge' }]), await syntheticCapture());
  try {
    assert.equal(report.lifts[0].clamped, true);
    assert.ok(report.warnings.includes('a lift was clamped at the frame edge'));
    assertInvariants(report);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a lift over a redacted key shows the fill, never the original pixels', { skip }, async () => {
  const { report, dir, outPath } = await render(spec([{ redact: 'a' }, { lift: 'a', title: 'Covered' }]), await syntheticCapture());
  try {
    const { chromium } = await import(renderer.playwrightCore);
    const browser = await chromium.launch({ headless: true, executablePath: renderer.executablePath });
    try {
      const page = await browser.newPage();
      const png = (await readFile(outPath)).toString('base64');
      const lift = report.lifts[0].rect;
      const [r, g, b] = await page.evaluate(async ({ png, x, y }) => {
        const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(x, y, 1, 1).data);
      }, { png, x: Math.round((lift[0] + lift[2] / 2) * 2), y: Math.round((lift[1] + lift[3] / 2) * 2) });
      const fill = [0xCB, 0xD5, 0xE1];
      assert.ok(Math.abs(r - fill[0]) + Math.abs(g - fill[1]) + Math.abs(b - fill[2]) < 24, `pixel ${r},${g},${b} is not the redaction fill ${REDACT_FILL}`);
    } finally { await browser.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a dark capture gets the dark wash and lift border', { skip }, async () => {
  const { report, dir } = await render(spec([{ lift: 'a', title: 'Dark' }]), await syntheticCapture({ dark: true }));
  try { assert.equal(report.dark, true); } finally { await rm(dir, { recursive: true, force: true }); }
});

test('two renders of the same out at once both finish and leave one valid png', { skip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fb-compose-'));
  try {
    const outPath = path.join(dir, 'same.png');
    const capture = await syntheticCapture();
    const html = buildBoardHtml({ spec: spec([{ lift: 'a', title: 'Race' }]), captures: [capture], fontBytes: font, layoutSource });
    await Promise.all([renderBoard({ html, outPath, ...renderer }), renderBoard({ html, outPath, ...renderer })]);
    const bytes = await readFile(outPath);
    assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG');
    const leftovers = (await (await import('node:fs/promises')).readdir(dir)).filter((f) => f.includes('.tmp'));
    assert.deepEqual(leftovers, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the board renders at 2x', { skip }, async () => {
  const { report, pixels, dir } = await render(spec([{ lift: 'a', title: 'Scale' }]), await syntheticCapture());
  try {
    assert.equal(pixels.width, Math.round(report.stage[2] * 2));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test tests/e2e/compose-invariants.test.mjs`
Expected: FAIL, `Cannot find module '../../lib/compose/engine.mjs'` (or every test skipped if this machine has no renderer yet; in that case run `node scripts/pin-renderer.mjs --local` from Task 12 first, or install the renderer from a local lock override, before continuing)

- [ ] **Step 4: Implement the engine**

```js
// lib/compose/engine.mjs
import crypto from 'node:crypto';
import { readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { readPngSize } from '../annotate/png.mjs';

export function playwrightCorePath(paths, lock) {
  return path.join(paths.runtimeDir, lock.productVersion, 'fast-browser-mcp', 'playwright-core', 'index.mjs');
}

// Launches only the pinned headless shell (never the user's Chrome) and
// writes through a unique temp file so two composes of one `out` can never
// leave a half-written board.
export async function renderBoard({ html, outPath, executablePath, playwrightCore, timeoutMs = 30_000 }) {
  const { chromium } = await import(playwrightCore);
  const browser = await chromium.launch({ headless: true, executablePath, timeout: timeoutMs });
  const temp = path.join(path.dirname(outPath), `.${path.basename(outPath)}.${crypto.randomUUID()}.tmp.png`);
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1600 } });
    page.setDefaultTimeout(timeoutMs);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error?.message ?? error)));
    await page.setContent(html, { waitUntil: 'load' });
    const report = await page.evaluate(() => window.__composeLayout());
    if (errors.length) throw new Error('the board page reported an error');
    await page.locator('#stage').screenshot({ path: temp, omitBackground: true });
    const { width, height } = readPngSize(await readFile(temp));
    await rename(temp, outPath);
    return { report, pixels: { width, height } };
  } finally {
    await rm(temp, { force: true });
    await browser.close();
  }
}
```

- [ ] **Step 5: Run the invariant tests**

Run: `node --test tests/e2e/compose-invariants.test.mjs`
Expected: PASS (7 tests), not skipped on a machine with the renderer installed

- [ ] **Step 6: Commit**

```bash
git add lib/compose/engine.mjs tests/e2e/helpers/renderer.mjs tests/e2e/compose-invariants.test.mjs package.json
git commit -m "compose: render boards in the pinned headless shell with layout invariants"
```

---

### Task 8: The `compose` command (render and seal)

**Files:**
- Create: `lib/commands/compose.mjs`
- Modify: `lib/cli/parse-args.mjs`, `lib/cli/main.mjs`
- Test: `tests/unit/compose-command.test.mjs`, `tests/unit/parse-args.test.mjs` (extend; if the parse-args tests live in a differently named file, extend that one)

**Interfaces:**
- Consumes: Tasks 1 to 7.
- Produces:
  - CLI: `fast-browser compose <spec.json> [--json]` and `fast-browser compose --seal <capture-return.json> [--json]`
  - `compose(request, supplied) -> Promise<{ mode: 'render', ok: true, out, warnings, width, height } | { mode: 'seal', ok: true, sidecar, png }>`
  - `request` shape from parse-args: `{ command: 'compose', spec: string | null, seal: string | null, json: boolean }`
  - Spec `capture` paths and the spec itself: a capture sidecar path in a spec is resolved relative to the spec file's directory.

- [ ] **Step 1: Write the failing command tests**

```js
// tests/unit/compose-command.test.mjs
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compose } from '../../lib/commands/compose.mjs';
import { resolvePaths } from '../../lib/core/paths.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
  + '1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');

async function world() {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-cmd-'));
  const paths = resolvePaths({ homeDir: home, pluginRoot: path.resolve('.') });
  await mkdir(paths.screenshotsDir, { recursive: true });
  const png = path.join(paths.screenshotsDir, 'r-c-after.c1.png');
  await writeFile(png, PNG);
  const ret = path.join(home, 'return.json');
  await writeFile(ret, JSON.stringify({ schemaVersion: 'capture-evidence/1', name: 'r-c-after.c1.png', png,
    frame: [0, 0, 1, 1], frameSnap: 'card', boxes: { a: [0, 0, 1, 1] }, missed: [], dark: false, scale: 1 }));
  return { home, paths, ret };
}

test('seal writes the sidecar and reports it', async () => {
  const { home, paths, ret } = await world();
  try {
    const report = await compose({ command: 'compose', seal: ret, spec: null }, { paths });
    assert.equal(report.mode, 'seal');
    assert.equal(path.basename(report.sidecar), 'r-c-after.c1.capture.json');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('render refuses an invalid spec and lists every problem', async () => {
  const { home, paths, ret } = await world();
  try {
    const { sidecar } = await compose({ command: 'compose', seal: ret, spec: null }, { paths });
    const specPath = path.join(paths.screenshotsDir, 'spec.json');
    await writeFile(specPath, JSON.stringify({ state: 'NOPE', title: '', out: 'b.png',
      panels: [{ capture: path.basename(sidecar), marks: [{ lift: 'zzz' }] }] }));
    await assert.rejects(() => compose({ command: 'compose', spec: specPath, seal: null }, {
      paths, renderBoard: async () => { throw new Error('must not render'); },
    }), (error) => /state must be one of/.test(error.message) && /title is required/.test(error.message)
      && /names a key the capture did not measure/.test(error.message));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('render resolves the capture beside the spec, confines out, and reports warnings', async () => {
  const { home, paths, ret } = await world();
  try {
    const { sidecar } = await compose({ command: 'compose', seal: ret, spec: null }, { paths });
    const specPath = path.join(paths.screenshotsDir, 'spec.json');
    await writeFile(specPath, JSON.stringify({ state: 'AFTER', title: 'T', out: 'r-c-after.png',
      panels: [{ capture: path.basename(sidecar), marks: [{ lift: 'a', title: 'A' }] }] }));
    let rendered;
    const report = await compose({ command: 'compose', spec: specPath, seal: null }, {
      paths,
      rendererLocation: async () => ({ executablePath: '/x', playwrightCore: '/y' }),
      renderBoard: async (args) => { rendered = args; await writeFile(args.outPath, PNG);
        return { report: { warnings: ['a lift was clamped at the frame edge'] }, pixels: { width: 2, height: 2 } }; },
    });
    assert.equal(rendered.outPath, path.join(paths.screenshotsDir, 'r-c-after.png'));
    assert.equal(report.out, rendered.outPath);
    assert.deepEqual(report.warnings, ['a lift was clamped at the frame edge']);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('render refuses an out that escapes the screenshots directory', async () => {
  const { home, paths, ret } = await world();
  try {
    const { sidecar } = await compose({ command: 'compose', seal: ret, spec: null }, { paths });
    const specPath = path.join(paths.screenshotsDir, 'spec.json');
    await writeFile(specPath, JSON.stringify({ state: 'AFTER', title: 'T', out: '../../x.png',
      panels: [{ capture: path.basename(sidecar), marks: [] }] }));
    await assert.rejects(() => compose({ command: 'compose', spec: specPath, seal: null }, { paths }),
      /out must resolve inside the screenshots directory/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('render explains a missing renderer with the setup remedy', async () => {
  const { home, paths, ret } = await world();
  try {
    const { sidecar } = await compose({ command: 'compose', seal: ret, spec: null }, { paths });
    const specPath = path.join(paths.screenshotsDir, 'spec.json');
    await writeFile(specPath, JSON.stringify({ state: 'AFTER', title: 'T', out: 'o.png',
      panels: [{ capture: path.basename(sidecar), marks: [] }] }));
    await assert.rejects(() => compose({ command: 'compose', spec: specPath, seal: null }, {
      paths, rendererLocation: async () => null,
    }), /run `fast-browser setup`/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
```

Add to the parse-args tests:

```js
test('compose takes one spec path', () => {
  assert.deepEqual(pick(parseArgs(['compose', 'spec.json'])), { command: 'compose', spec: 'spec.json', seal: null });
});
test('compose --seal takes one return path', () => {
  assert.deepEqual(pick(parseArgs(['compose', '--seal', 'ret.json'])), { command: 'compose', spec: null, seal: 'ret.json' });
});
test('compose needs exactly one of a spec or --seal', () => {
  assert.throws(() => parseArgs(['compose']), /compose requires a spec path or --seal/);
  assert.throws(() => parseArgs(['compose', 'a.json', '--seal', 'b.json']), /compose takes a spec path or --seal, not both/);
});
```

where `pick = ({ command, spec, seal }) => ({ command, spec, seal })` is defined at the top of the added block.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/unit/compose-command.test.mjs tests/unit/parse-args.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement the command**

```js
// lib/commands/compose.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadCapture, sealCapture } from '../compose/capture.mjs';
import { playwrightCorePath, renderBoard as defaultRenderBoard } from '../compose/engine.mjs';
import { buildBoardHtml } from '../compose/page.mjs';
import { rendererExecutable, rendererPlatform, rendererStatus } from '../compose/renderer.mjs';
import { validateSpec } from '../compose/spec.mjs';
import { resolvePaths } from '../core/paths.mjs';
import { confinedScreenshotPath } from '../core/screenshots.mjs';
import { loadRuntimeLock } from '../runtime/lock.mjs';
import { LifecycleError } from './shared.mjs';

function fail(message, exitCode = 2) {
  return new LifecycleError(message, { stage: 'compose', exitCode });
}

async function defaultRendererLocation(paths) {
  const lock = await loadRuntimeLock({ bundledPath: path.join(paths.pluginRoot, 'runtime-lock.json') });
  const platform = rendererPlatform();
  if (await rendererStatus({ lock, paths, platform }) !== 'ready') return null;
  return { executablePath: rendererExecutable(paths, lock, platform), playwrightCore: playwrightCorePath(paths, lock) };
}

async function readJson(file, what) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { throw fail(`unable to read the ${what}`); }
}

export async function compose(request, supplied = {}) {
  const paths = supplied.paths ?? resolvePaths({ homeDir: supplied.homeDir, pluginRoot: supplied.pluginRoot });
  if (request.seal) {
    const captureReturn = await readJson(request.seal, 'capture return');
    const { sidecar, png } = await sealCapture({ paths, captureReturn, fail });
    return { mode: 'seal', ok: true, sidecar, png };
  }

  const specPath = path.resolve(request.spec);
  const spec = await readJson(specPath, 'compose spec');
  const panels = Array.isArray(spec.panels) ? spec.panels : [];
  const captures = [];
  for (const panel of panels) {
    if (typeof panel?.capture !== 'string' || panel.capture.length === 0) { captures.push(null); continue; }
    captures.push(await loadCapture({ sidecarPath: path.resolve(path.dirname(specPath), panel.capture), fail }));
  }
  const problems = validateSpec(spec, captures);
  if (problems.length) throw fail(`the compose spec has problems:\n- ${problems.join('\n- ')}`);
  const outPath = await confinedScreenshotPath(paths, spec.out, 'out', fail);

  const location = await (supplied.rendererLocation ?? defaultRendererLocation)(paths);
  if (!location) throw fail('the compose renderer is not installed; run `fast-browser setup`');
  const fontBytes = await readFile(new URL('../../assets/fonts/InterVariable.woff2', import.meta.url));
  const layoutSource = await readFile(new URL('../compose/page-layout.js', import.meta.url), 'utf8');
  const html = buildBoardHtml({ spec, captures, fontBytes, layoutSource });
  const { report, pixels } = await (supplied.renderBoard ?? defaultRenderBoard)({ html, outPath, ...location });
  return { mode: 'render', ok: true, out: outPath, warnings: report.warnings ?? [], width: pixels.width, height: pixels.height };
}
```

- [ ] **Step 4: Wire the CLI**

In `lib/cli/parse-args.mjs`: add `'compose'` to the command list on line 5. Existing tests compare whole request objects, so add the two fields only for compose: right after the request object literal (the one holding `config: null,` near line 74) is built, add `if (command === 'compose') { request.spec = null; request.seal = null; }`. In the token loop, before the `seen`-duplicate guard (next to the annotate positional block), add:

```js
    if (command === 'compose' && token === '--seal') {
      if (request.seal !== null) throw new UsageError(token, 'compose takes one --seal path');
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(token, '--seal requires a capture return path');
      request.seal = value;
      index += 1;
      continue;
    }
    if (command === 'compose' && !token.startsWith('--')) {
      if (request.spec !== null) throw new UsageError(token, 'compose takes exactly one spec path');
      request.spec = token;
      continue;
    }
```

and after the loop, beside the annotate check:

```js
  if (command === 'compose' && request.spec === null && request.seal === null) {
    throw new UsageError('<spec>', 'compose requires a spec path or --seal');
  }
  if (command === 'compose' && request.spec !== null && request.seal !== null) {
    throw new UsageError('<spec>', 'compose takes a spec path or --seal, not both');
  }
```

In `lib/cli/main.mjs`: `import { compose } from '../commands/compose.mjs';`, add `compose` to the default `commands` object, add `compose` to the `HELP` usage line, and in `humanReport`:

```js
  if (command === 'compose') {
    if (report.mode === 'seal') return `Sealed capture: ${report.sidecar}\n`;
    const notes = report.warnings.length ? `\nWarnings:\n- ${report.warnings.join('\n- ')}` : '';
    return `Composed board at ${report.width}x${report.height}: ${report.out}${notes}\n`;
  }
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/unit/compose-command.test.mjs tests/unit/parse-args.test.mjs && npm run test:unit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/commands/compose.mjs lib/cli/parse-args.mjs lib/cli/main.mjs tests/unit/compose-command.test.mjs tests/unit/parse-args.test.mjs
git commit -m "compose: add the compose command (render and --seal)"
```

---

### Task 9: Setup installs the renderer; doctor checks it

**Files:**
- Modify: `lib/commands/setup.mjs`, `lib/commands/doctor.mjs`, `lib/doctor/checks.mjs`
- Test: `tests/unit/commands.test.mjs` (extend; it already drives `main()` and `doctor()` with injected fakes)

**Interfaces:**
- Consumes: `installRenderer`, `rendererStatus`, `rendererPlatform` (Task 4).
- Produces: setup dependency `installRenderer` (injectable like `installRuntime`); doctor dependency `composeRendererStatus: () => Promise<'ready'|'missing'|'unpinned'|'unsupported'>`; doctor check id `compose-renderer`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/commands.test.mjs`, next to the existing `annotate-renderer` doctor tests (they use `passingChecksExcept` and `unusedPaths`, both already defined in that file):

```js
test('doctor compose-renderer passes when the renderer is ready', async () => {
  const report = await doctor({ profile: 'safe' }, {
    checks: passingChecksExcept('compose-renderer'),
    composeRendererStatus: async () => 'ready',
    paths: unusedPaths,
  });
  assert.equal(report.checks.find(({ id }) => id === 'compose-renderer').status, 'pass');
});

test('doctor compose-renderer fails with the setup remedy when the renderer is missing', async () => {
  const report = await doctor({ profile: 'safe' }, {
    checks: passingChecksExcept('compose-renderer'),
    composeRendererStatus: async () => 'missing',
    paths: unusedPaths,
  });
  const check = report.checks.find(({ id }) => id === 'compose-renderer');
  assert.equal(check.status, 'fail');
  assert.match(check.remediation, /fast-browser setup/);
});

test('doctor compose-renderer passes quietly when the lock pins no renderer', async () => {
  const report = await doctor({ profile: 'safe' }, {
    checks: passingChecksExcept('compose-renderer'),
    composeRendererStatus: async () => 'unpinned',
    paths: unusedPaths,
  });
  assert.equal(report.checks.find(({ id }) => id === 'compose-renderer').status, 'pass');
});
```

Next to the existing setup test that asserts `events` equal `['platform', 'dirs', 'save']` (around the `installRuntime: async () => ({ version: '0.1.0-alpha.1' })` fakes), add two copies of that test with these changes:

```js
// Copy 1: the lock pins a renderer, so setup installs it after the runtime.
      loadRuntimeLock: async () => ({
        productVersion: '0.1.0-alpha.1', sourceCommit: 'abc',
        runtime: { sha256: 'a'.repeat(64) }, extension: { id: 'extension-id', version: '1.0.0' },
        renderer: { revision: '1243', platforms: {} },
      }),
      installRuntime: async () => { events.push('runtime'); return { version: '0.1.0-alpha.1' }; },
      installRenderer: async () => { events.push('renderer'); return { installed: true }; },
// ...and assert: assert.deepEqual(events.filter((e) => e === 'runtime' || e === 'renderer'), ['runtime', 'renderer']);

// Copy 2: the same lock without `renderer`, and
      installRenderer: async () => { events.push('renderer'); },
// ...and assert: assert.equal(events.includes('renderer'), false);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/unit/commands.test.mjs`
Expected: the five new tests FAIL (`compose-renderer` is not a known check; setup never calls `installRenderer`)

- [ ] **Step 3: Implement**

In `lib/commands/setup.mjs`: `import { installRenderer as installPinnedRenderer } from '../compose/renderer.mjs';`, add `installRenderer: supplied.installRenderer ?? installPinnedRenderer,` to the deps object beside `installRuntime`, and immediately after each `runtime = await deps.installRuntime(...)` line (the first-install path and the upgrade path), add:

```js
    // Optional like the CRX: a lock without a renderer still sets up fully,
    // and compose reports the missing renderer itself.
    if (lock.renderer) await deps.installRenderer({ lock, paths: deps.paths, fetch: deps.fetch });
```

In `lib/doctor/checks.mjs`, add `'compose-renderer',` after `'annotate-renderer',`. In `lib/commands/doctor.mjs`, import `{ rendererPlatform, rendererStatus } from '../compose/renderer.mjs';` and `{ loadRuntimeLock } from '../runtime/lock.mjs';` (if not already imported), and add beside `'annotate-renderer'`:

```js
    // Installed by setup whenever the lock pins it, so a failure here means
    // setup has not run since the pin landed or the download was removed.
    'compose-renderer': async () => {
      const status = await (dependencies.composeRendererStatus ?? (async () => {
        const lock = await loadRuntimeLock({ bundledPath: path.join(paths.pluginRoot ?? PLUGIN_ROOT, 'runtime-lock.json') });
        return rendererStatus({ lock, paths, platform: rendererPlatform() });
      }))();
      if (status === 'ready') return pass('The compose renderer is installed.');
      if (status === 'unpinned') return pass('This runtime pins no compose renderer.');
      if (status === 'unsupported') return pass('The compose renderer is not available on this platform.');
      return fail('The compose renderer is not installed.', 'Run `fast-browser setup` to install it.');
    },
```

(`PLUGIN_ROOT` and `path` are already used by doctor.mjs around line 320; reuse them.)

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/commands/setup.mjs lib/commands/doctor.mjs lib/doctor/checks.mjs tests/unit/commands.test.mjs
git commit -m "setup: install the pinned compose renderer; doctor: check it"
```

---

### Task 10: The `capture-evidence` built-in macro

The handle-free capture macro from the spike, shipped as a built-in. It returns the `capture-evidence/1` shape `--seal` accepts.

**Files:**
- Create: `builtins/macros/capture-evidence.js`, `tests/fixtures/evidence/pages/{nested-cards,repeated-rows,tiny-badge,dark-surface,heading-strip,far-targets}.html`
- Modify: `lib/macros/install.mjs` (`BUILTIN_NAMES`), `skills/browser-macros/MACROS.md` (new `## capture-evidence` section)
- Test: `tests/e2e/capture-evidence.test.mjs` (add to the `test:compose` script)

**Interfaces:**
- Produces: macro args `{ targets: Record<string,string>, frame?: 'auto' | string, out: string, home: string }`; return `{ schemaVersion: 'capture-evidence/1', name, png, frame, frameSnap: 'card'|'selector'|'union', boxes, missed, dark, viewport, scale: 1 }` or `{ failedStep, error }`; `frameSnap: 'too-large'` returns `failedStep: 'frame'` and captures nothing.

- [ ] **Step 1: Write the fixture pages**

`tests/fixtures/evidence/pages/nested-cards.html`:

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif;background:#f6f7f9}
.section{margin:40px;padding:24px;background:#fff;border:1px solid #e5e7eb;border-radius:12px}
.card{margin-top:16px;padding:16px;border:1px solid #e5e7eb;border-radius:8px}
.row{display:flex;gap:8px;padding:4px 0}</style>
<div class="section"><h3>Members</h3>
  <div class="card" data-testid="person-card">
    <div class="row"><strong>Pat Example</strong></div>
    <div class="row" data-testid="named">Listed as owner</div>
    <div class="row" data-testid="driver">Listed as editor</div>
    <div class="row" data-testid="phone">(555) 010-0000</div>
  </div>
</div>
```

`repeated-rows.html` (three identical "Edit" buttons, one uniquely scoped row):

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif}.list{margin:40px;border:1px solid #ddd;border-radius:8px;padding:12px}
.item{display:flex;justify-content:space-between;padding:8px}</style>
<div class="list">
  <div class="item" data-testid="row-a"><span>Alpha</span><button>Edit</button></div>
  <div class="item" data-testid="row-b"><span>Bravo</span><button>Edit</button></div>
  <div class="item" data-testid="row-c"><span>Charlie</span><button>Edit</button></div>
</div>
```

`tiny-badge.html`:

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif}.head{margin:40px;padding:16px;border:1px solid #ddd;border-radius:8px}
.badge{display:inline-block;width:12px;height:12px;background:#2563eb;border-radius:3px;vertical-align:middle}</style>
<div class="head"><span data-testid="title">Example Sedan</span> <span class="badge" data-testid="badge" aria-label="Augmented"></span></div>
```

`dark-surface.html`:

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif;background:#0b1020;color:#e5e7eb}
.card{margin:40px;padding:20px;background:#111827;border:1px solid #374151;border-radius:10px}</style>
<div class="card"><div data-testid="value">Status: Ready</div></div>
```

`heading-strip.html` (the only card-edged ancestor of the target is a full-width strip; the minimum content size must reject it and fall back to the union):

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif}
.strip{background:#fff;border-bottom:1px solid #ddd;height:28px;padding:4px 16px}</style>
<div class="strip"><h4 data-testid="heading" style="margin:0">Example Sedan</h4></div>
```

`far-targets.html` (two targets more than a viewport apart):

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif}</style>
<div data-testid="top" style="position:absolute;top:20px;left:20px">Top</div>
<div data-testid="bottom" style="position:absolute;top:3000px;left:20px">Bottom</div>
```

- [ ] **Step 2: Write the failing macro tests**

```js
// tests/e2e/capture-evidence.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { rendererForTests } from './helpers/renderer.mjs';

const renderer = await rendererForTests();
const skip = renderer ? false : 'no installed runtime + renderer; run `fast-browser setup`';
const source = await readFile(new URL('../../builtins/macros/capture-evidence.js', import.meta.url), 'utf8');
// The macro file is a single async arrow expression, exactly as
// browser_run_code_unsafe receives it.
const macro = new Function(`return (${source});`)();
const pageUrl = (name) => pathToFileURL(path.resolve(`tests/fixtures/evidence/pages/${name}.html`)).href;

async function run(name, args) {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-capev-'));
  const { chromium } = await import(renderer.playwrightCore);
  const browser = await chromium.launch({ headless: true, executablePath: renderer.executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto(pageUrl(name));
    return { home, result: await macro(page, { home, out: 'cap', ...args }) };
  } finally { await browser.close(); }
}

test('auto frame snaps to the card holding every target', { skip }, async () => {
  const { home, result } = await run('nested-cards', { targets: { named: '[data-testid=named]', driver: '[data-testid=driver]' } });
  try {
    assert.equal(result.schemaVersion, 'capture-evidence/1');
    assert.equal(result.frameSnap, 'card');
    assert.ok(result.frame[2] < 1000 && result.frame[3] < 700);
    assert.deepEqual(Object.keys(result.boxes).sort(), ['driver', 'named']);
    assert.equal(result.png, path.join(home, '.fast-browser', 'screenshots', 'cap.png'));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('an ambiguous selector is missed, never guessed', { skip }, async () => {
  const { home, result } = await run('repeated-rows', { targets: { edit: 'button', bravo: '[data-testid=row-b] >> text=Bravo' } });
  try {
    assert.deepEqual(result.missed, [{ key: 'edit', reason: 'ambiguous', count: 3 }]);
    assert.ok(result.boxes.bravo);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a dark surface is reported as dark', { skip }, async () => {
  const { home, result } = await run('dark-surface', { targets: { value: '[data-testid=value]' } });
  try { assert.equal(result.dark, true); } finally { await rm(home, { recursive: true, force: true }); }
});

test('a heading-only strip is not a frame; the union is used and reported', { skip }, async () => {
  const { home, result } = await run('heading-strip', { targets: { heading: '[data-testid=heading]' } });
  try { assert.equal(result.frameSnap, 'union'); } finally { await rm(home, { recursive: true, force: true }); }
});

test('targets too far apart for one frame capture nothing', { skip }, async () => {
  const { home, result } = await run('far-targets', { targets: { top: '[data-testid=top]', bottom: '[data-testid=bottom]' } });
  try {
    assert.equal(result.failedStep, 'frame');
    assert.equal(result.frameSnap, 'too-large');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a tiny badge is measured', { skip }, async () => {
  const { home, result } = await run('tiny-badge', { targets: { badge: '[data-testid=badge]', title: '[data-testid=title]' } });
  try { assert.equal(result.boxes.badge[2], 12); } finally { await rm(home, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test tests/e2e/capture-evidence.test.mjs`
Expected: FAIL, ENOENT on the macro file

- [ ] **Step 4: Write the macro**

```js
// builtins/macros/capture-evidence.js
async (page, args) => {
  // Only locator.count, locator.evaluate, page.evaluate, page.screenshot and
  // page.waitForTimeout: those are the calls proven safe over the extension
  // relay. Element handles stalled the relay in the spike, and a new CDP
  // session kills it, so neither may appear here.
  const { targets = {}, frame = 'auto', out = 'capture', home } = args || {};
  if (typeof home !== 'string' || home[0] !== '/' || home.split('/').includes('..')) {
    return { failedStep: 'args', error: "home must be the caller's absolute home directory path, with no .. segments" };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(out)) return { failedStep: 'args', error: 'out must be a simple file name' };
  const keys = Object.keys(targets);
  if (keys.length === 0) return { failedStep: 'args', error: 'targets is required' };

  await page.locator(targets[keys[0]]).first().waitFor({ timeout: 5000 }).catch(() => {});
  const missed = [];
  const tagged = [];
  for (const key of keys) {
    const locator = page.locator(targets[key]);
    const count = await locator.count();
    if (count !== 1) { missed.push(count === 0 ? { key, reason: 'no-match' } : { key, reason: 'ambiguous', count }); continue; }
    await locator.evaluate((element, k) => element.setAttribute('data-ev-key', k), key, { timeout: 2000 });
    tagged.push(key);
  }
  if (tagged.length === 0) return { failedStep: 'resolve', missed };
  let frameSnap = 'card';
  if (frame !== 'auto') {
    const count = await page.locator(frame).count();
    if (count !== 1) return { failedStep: 'frame', error: 'the frame selector must match exactly one element' };
    await page.locator(frame).evaluate((element) => element.setAttribute('data-ev-frame', ''), undefined, { timeout: 2000 });
    frameSnap = 'selector';
  }

  const placed = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('[data-ev-key]')];
    const union = () => {
      const rects = elements.map((e) => e.getBoundingClientRect());
      const x = Math.min(...rects.map((r) => r.left + scrollX)); const y = Math.min(...rects.map((r) => r.top + scrollY));
      return { x, y, w: Math.max(...rects.map((r) => r.right + scrollX)) - x, h: Math.max(...rects.map((r) => r.bottom + scrollY)) - y };
    };
    const u = union();
    if (u.w > innerWidth || u.h > innerHeight * 0.9) return { snap: 'too-large' };
    let chosen = document.querySelector('[data-ev-frame]');
    let snap = chosen ? 'selector' : 'card';
    if (!chosen) {
      const chain = (e) => { const list = []; for (let n = e; n; n = n.parentElement) list.push(n); return list; };
      const common = chain(elements[0]).find((n) => elements.every((e) => n.contains(e)));
      for (let n = common; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const s = getComputedStyle(n); const r = n.getBoundingClientRect();
        const edged = parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderBottomWidth) > 0 || s.boxShadow !== 'none'
          || (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent');
        // A heading-only strip is not a card: require room for content
        // beyond the targets themselves.
        const roomy = r.height >= Math.max(64, u.h + 24) && r.width >= 120;
        if (edged && roomy && r.width <= innerWidth && r.height <= innerHeight * 0.9) { chosen = n; break; }
      }
      if (!chosen) snap = 'union';
    }
    if (chosen) { chosen.setAttribute('data-ev-frame', ''); chosen.scrollIntoView({ block: 'center', inline: 'nearest' }); }
    else elements[0].scrollIntoView({ block: 'center', inline: 'nearest' });
    return { snap };
  });
  if (placed.snap === 'too-large') {
    await page.evaluate(() => document.querySelectorAll('[data-ev-key]').forEach((e) => e.removeAttribute('data-ev-key')));
    return { failedStep: 'frame', frameSnap: 'too-large', error: 'the targets cannot share one viewport-sized frame' };
  }
  if (frameSnap !== 'selector') frameSnap = placed.snap;
  await page.waitForTimeout(350);

  const name = `${out}.png`;
  const png = `${home}/.fast-browser/screenshots/${name}`;
  // Screenshot first, then measure, with nothing page-changing in between.
  await page.screenshot({ path: png, scale: 'css' });
  const measured = await page.evaluate(() => {
    const rect = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
    const boxes = {};
    for (const e of document.querySelectorAll('[data-ev-key]')) boxes[e.getAttribute('data-ev-key')] = rect(e);
    const f = document.querySelector('[data-ev-frame]');
    let dark = false;
    for (let n = f ?? document.querySelector('[data-ev-key]'); n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor.match(/[\d.]+/g);
      if (c && (c.length < 4 || +c[3] > 0.5)) { dark = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 110; break; }
    }
    const result = { boxes, frame: f ? rect(f) : null, dark, viewport: { w: document.documentElement.clientWidth, h: innerHeight } };
    document.querySelectorAll('[data-ev-key]').forEach((e) => e.removeAttribute('data-ev-key'));
    if (f) f.removeAttribute('data-ev-frame');
    return result;
  });
  const boxes = {};
  for (const [key, box] of Object.entries(measured.boxes)) {
    if (box[2] <= 0 || box[3] <= 0) { missed.push({ key, reason: 'not-visible' }); continue; }
    if (box[1] < 0 || box[1] + box[3] > measured.viewport.h) { missed.push({ key, reason: 'out-of-view' }); continue; }
    boxes[key] = box;
  }
  const values = Object.values(boxes);
  const base = measured.frame ?? (values.length ? [
    Math.min(...values.map((b) => b[0])), Math.min(...values.map((b) => b[1])),
    Math.max(...values.map((b) => b[0] + b[2])) - Math.min(...values.map((b) => b[0])),
    Math.max(...values.map((b) => b[1] + b[3])) - Math.min(...values.map((b) => b[1])),
  ] : [0, 0, measured.viewport.w, measured.viewport.h]);
  const pad = frameSnap === 'union' ? 24 : 12;
  const fx = Math.max(0, base[0] - pad); const fy = Math.max(0, base[1] - pad);
  const frameBox = [fx, fy,
    Math.min(measured.viewport.w, base[0] + base[2] + pad) - fx,
    Math.min(measured.viewport.h, base[1] + base[3] + pad) - fy];
  return {
    schemaVersion: 'capture-evidence/1', name, png, frame: frameBox, frameSnap,
    boxes, missed, dark: measured.dark, viewport: measured.viewport, scale: 1,
  };
}
```

- [ ] **Step 5: Register it as a built-in**

In `lib/macros/install.mjs`, add `'capture-evidence.js',` to `BUILTIN_NAMES` after `'capture-annotated.js'`. Append to `skills/browser-macros/MACROS.md`:

```markdown
## capture-evidence

- Description: Capture and measure named elements for `fast-browser compose`. Scrolls the frame into view, screenshots the viewport, then measures each target in the same page state. `frame: "auto"` crops to the nearest card that holds every target (falling back to the targets' union, reported as `frameSnap: "union"`); a selector crops to that element. A selector matching zero or several elements is listed in `missed` and never guessed. Targets too far apart for one frame fail with `frameSnap: "too-large"` and capture nothing. Reports whether the frame sits on a dark surface. Seal the return with `fast-browser compose --seal <file>` before composing. Uses no element handles and no CDP sessions, so it is safe over the extension relay. Runs without Node host globals, so pass your own absolute home directory as `home`.
- Params: `{ targets: Record<string, string>, frame?: "auto" | string (default "auto"), out: string, home: string (your absolute home directory path) }`
- Target: Current page (site-agnostic)
- Script: `~/.fast-browser/macros/capture-evidence.js`
- Status: built-in
```

Update `package.json`'s `test:compose` to `"node --test tests/e2e/compose-invariants.test.mjs tests/e2e/capture-evidence.test.mjs tests/e2e/compose-fixtures.test.mjs"`.

- [ ] **Step 6: Run the tests and the macro-install tests**

Run: `node --test tests/e2e/capture-evidence.test.mjs && npm run test:unit`
Expected: PASS. If a macro-install unit test pins the built-in list or the packaged index sections, update its expectation to include `capture-evidence` in the same order as `BUILTIN_NAMES`.

- [ ] **Step 7: Commit**

```bash
git add builtins/macros/capture-evidence.js lib/macros/install.mjs skills/browser-macros/MACROS.md tests/fixtures/evidence tests/e2e/capture-evidence.test.mjs package.json tests/unit
git commit -m "macros: add capture-evidence, the handle-free capture for compose"
```

---

### Task 11: End-to-end fixtures and goldens

Each synthetic page is captured with the macro, sealed, composed from a checked-in spec, and checked against invariants and a golden PNG.

**Files:**
- Create: `tests/fixtures/evidence/specs/{nested-cards,dark-surface,tiny-badge,redact-under-lift}.json`, `tests/fixtures/evidence/goldens/` (generated), `tests/e2e/helpers/png-diff.mjs`, `tests/e2e/compose-fixtures.test.mjs`

**Interfaces:**
- Consumes: the macro (Task 10), `sealCapture` (Task 2), `compose` (Task 8), invariant helpers (copy the `intersects`/`inside`/`assertInvariants` functions from Task 7's test into `tests/e2e/helpers/invariants.mjs` and import them from both tests).
- Produces: `diffPngs({ a: Buffer, b: Buffer, renderer }) -> Promise<{ sameSize: boolean, differing: number, total: number }>`; env `UPDATE_GOLDENS=1` rewrites goldens.

- [ ] **Step 1: Write the fixture specs**

`tests/fixtures/evidence/specs/nested-cards.json`:

```json
{ "state": "AFTER", "title": "Pat is listed as owner and editor", "layout": "single", "out": "fx-nested-cards.png",
  "targets": { "named": "[data-testid=named]", "driver": "[data-testid=driver]", "phone": "[data-testid=phone]" },
  "panels": [{ "marks": [
    { "lift": ["named", "driver"], "title": "On the project", "note": "Owner and editor", "tag": "NEW" },
    { "redact": "phone" } ] }] }
```

`dark-surface.json`:

```json
{ "state": "AFTER", "title": "Status reads Ready", "layout": "single", "out": "fx-dark-surface.png",
  "targets": { "value": "[data-testid=value]" },
  "panels": [{ "marks": [ { "lift": "value", "title": "Ready", "tag": "OK" } ] }] }
```

`tiny-badge.json`:

```json
{ "state": "AFTER", "title": "The sedan carries the augmented badge", "layout": "single", "out": "fx-tiny-badge.png",
  "targets": { "title": "[data-testid=title]", "badge": "[data-testid=badge]" },
  "panels": [{ "marks": [ { "lift": ["title", "badge"], "title": "Augmented", "note": "Badge beside the name" } ] }] }
```

`redact-under-lift.json`:

```json
{ "state": "AFTER", "title": "A lift never reveals a redaction", "layout": "single", "out": "fx-redact-under-lift.png",
  "targets": { "phone": "[data-testid=phone]", "driver": "[data-testid=driver]" },
  "page": "nested-cards",
  "panels": [{ "marks": [ { "redact": "phone" }, { "lift": ["driver", "phone"], "title": "Covered" } ] }] }
```

(`targets` and `page` are test inputs; the test strips them and fills `panels[0].capture` before composing. `page` defaults to the spec's file name.)

- [ ] **Step 2: Write the diff helper**

```js
// tests/e2e/helpers/png-diff.mjs
export async function diffPngs({ a, b, renderer, tolerance = 24 }) {
  const { chromium } = await import(renderer.playwrightCore);
  const browser = await chromium.launch({ headless: true, executablePath: renderer.executablePath });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ({ a, b, tolerance }) => {
      const load = async (s) => { const i = new Image(); i.src = `data:image/png;base64,${s}`; await i.decode(); return i; };
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { sameSize: false, differing: -1, total: 0 };
      const read = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
      const da = read(ia); const db = read(ib); let differing = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > tolerance) differing += 1;
      }
      return { sameSize: true, differing, total: da.length / 4 };
    }, { a: a.toString('base64'), b: b.toString('base64'), tolerance });
  } finally { await browser.close(); }
}
```

- [ ] **Step 3: Write the failing fixture test**

```js
// tests/e2e/compose-fixtures.test.mjs
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { compose } from '../../lib/commands/compose.mjs';
import { resolvePaths } from '../../lib/core/paths.mjs';
import { diffPngs } from './helpers/png-diff.mjs';
import { rendererForTests } from './helpers/renderer.mjs';

const renderer = await rendererForTests();
const skip = renderer ? false : 'no installed runtime + renderer; run `fast-browser setup`';
const macro = new Function(`return (${await readFile(new URL('../../builtins/macros/capture-evidence.js', import.meta.url), 'utf8')});`)();
const specDir = path.resolve('tests/fixtures/evidence/specs');
const goldenDir = path.resolve('tests/fixtures/evidence/goldens');
const pluginRoot = path.resolve('.');

for (const file of (await readdir(specDir)).filter((f) => f.endsWith('.json'))) {
  test(`fixture ${file} composes, holds its invariants and matches its golden`, { skip }, async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'fb-fx-'));
    try {
      const paths = resolvePaths({ homeDir: home, pluginRoot });
      const fixture = JSON.parse(await readFile(path.join(specDir, file), 'utf8'));
      const pageName = fixture.page ?? path.basename(file, '.json');
      const { chromium } = await import(renderer.playwrightCore);
      const browser = await chromium.launch({ headless: true, executablePath: renderer.executablePath });
      let captureReturn;
      try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
        await page.goto(pathToFileURL(path.resolve(`tests/fixtures/evidence/pages/${pageName}.html`)).href);
        captureReturn = await macro(page, { targets: fixture.targets, out: `${path.basename(file, '.json')}.c1`, home });
      } finally { await browser.close(); }
      assert.equal(captureReturn.missed.length, 0, 'every fixture target resolves');
      const ret = path.join(home, 'return.json');
      await writeFile(ret, JSON.stringify(captureReturn));
      const { sidecar } = await compose({ command: 'compose', seal: ret, spec: null }, { paths });
      const spec = { ...fixture, panels: [{ ...fixture.panels[0], capture: path.basename(sidecar) }] };
      delete spec.targets; delete spec.page;
      const specPath = path.join(paths.screenshotsDir, `${path.basename(file, '.json')}.spec.json`);
      await writeFile(specPath, JSON.stringify(spec));
      const report = await compose({ command: 'compose', spec: specPath, seal: null }, {
        paths, rendererLocation: async () => renderer,
      });
      const board = await readFile(report.out);
      const golden = path.join(goldenDir, `${path.basename(file, '.json')}.png`);
      if (process.env.UPDATE_GOLDENS === '1') {
        await mkdir(goldenDir, { recursive: true });
        await writeFile(golden, board);
        return;
      }
      const diff = await diffPngs({ a: board, b: await readFile(golden), renderer });
      assert.equal(diff.sameSize, true, 'board and golden differ in size');
      assert.ok(diff.differing / diff.total < 0.002, `${diff.differing} of ${diff.total} pixels differ from the golden`);
    } finally { await rm(home, { recursive: true, force: true }); }
  });
}
```

- [ ] **Step 4: Generate the goldens and look at every one**

Run: `UPDATE_GOLDENS=1 node --test tests/e2e/compose-fixtures.test.mjs`
Then open every file in `tests/fixtures/evidence/goldens/` (`open -a Preview tests/fixtures/evidence/goldens/*.png`) and confirm by eye: crop on the card, lift on the right element, labels in the margin, phone unreadable, dark fixture dark-washed. A golden is only committed after it has been looked at.

- [ ] **Step 5: Run the fixtures against the goldens**

Run: `npm run test:compose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/evidence tests/e2e/helpers tests/e2e/compose-fixtures.test.mjs
git commit -m "compose: synthetic end-to-end fixtures with reviewed goldens"
```

---

### Task 12: Pin and publish the renderer

Turns the lock's renderer entry into real pinned assets. **The upload step publishes to a public GitHub release; ask Matt before running it.**

**Files:**
- Create: `scripts/pin-renderer.mjs`
- Modify: `runtime-lock.json`, `package.json` (script `"pin-renderer": "node scripts/pin-renderer.mjs"`)

**Interfaces:**
- Produces: `node scripts/pin-renderer.mjs --revision <rev> --tag <fork release tag> [--local]`. `--local` downloads and installs into this machine's `~/.fast-browser/renderer/` from a lock override (for development before publishing) and edits nothing tracked.

- [ ] **Step 1: Find the headless-shell revision and download URLs the fork pins**

```bash
RT=~/.fast-browser/runtime/$(node -p "require('./runtime-lock.json').productVersion")/fast-browser-mcp/playwright-core
node -p "require('$RT/browsers.json').browsers.find(b => b.name === 'chromium-headless-shell')"
for P in mac15-arm64 mac15; do PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=$P node $RT/cli.js install --dry-run chromium-headless-shell; done
```

Expected: a revision number and one `Download url:` line per platform (`mac15-arm64` → `mac-arm64`, `mac15` → `mac-x64`). Record them.

- [ ] **Step 2: Write the pin script**

```js
// scripts/pin-renderer.mjs
// Pins chromium-headless-shell for compose. Re-hosts each platform's zip as
// an asset on the fork's immutable release (the lock only accepts immutable
// GitHub release URLs) and writes its checksum into runtime-lock.json.
import { execFile as execFileCallback } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const { values } = parseArgs({ options: {
  revision: { type: 'string' }, tag: { type: 'string' }, 'url-mac-arm64': { type: 'string' }, 'url-mac-x64': { type: 'string' },
  upload: { type: 'boolean', default: false },
} });
for (const key of ['revision', 'tag', 'url-mac-arm64', 'url-mac-x64']) {
  if (!values[key]) { console.error(`--${key} is required`); process.exit(2); }
}
const repo = 'm4ttheweric/playwright';
const dir = await mkdtemp(path.join(tmpdir(), 'pin-renderer-'));
const platforms = {};
for (const platform of ['mac-arm64', 'mac-x64']) {
  const file = `chromium-headless-shell-${values.revision}-${platform}.zip`;
  const response = await fetch(values[`url-${platform}`]);
  if (!response.ok) throw new Error(`download failed for ${platform}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(dir, file), bytes);
  platforms[platform] = {
    url: `https://github.com/${repo}/releases/download/${values.tag}/${file}`,
    file,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
  if (values.upload) await execFile('gh', ['release', 'upload', values.tag, path.join(dir, file), '--repo', repo, '--clobber']);
}
const lockPath = path.resolve('runtime-lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
lock.renderer = { revision: values.revision, platforms };
await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`Pinned renderer ${values.revision}${values.upload ? ' and uploaded assets' : ' (not uploaded)'}; zips in ${dir}`);
```

- [ ] **Step 3: Dry run without uploading, and verify the lock parses**

```bash
node scripts/pin-renderer.mjs --revision <rev> --tag fast-browser-v<current productVersion> \
  --url-mac-arm64 <url from step 1> --url-mac-x64 <url from step 1>
node -e "import('./lib/runtime/lock.mjs').then(async m => console.log((await m.loadRuntimeLock({ bundledPath: 'runtime-lock.json' })).renderer.revision))"
git diff runtime-lock.json
```

Expected: the revision prints; the diff adds only `renderer`.

- [ ] **Step 4: Ask Matt, then upload**

Ask Matt: "Upload the two chromium-headless-shell zips (about 90 MB each) as assets on the public fork release `fast-browser-v<version>`?" Only after a yes:

```bash
node scripts/pin-renderer.mjs --revision <rev> --tag fast-browser-v<version> \
  --url-mac-arm64 <url> --url-mac-x64 <url> --upload
fast-browser setup && fast-browser doctor
```

Expected: setup installs the renderer; doctor's `compose-renderer` passes.

- [ ] **Step 5: Run every compose test against the real install**

Run: `npm run test:unit && npm run test:compose`
Expected: PASS, nothing skipped

- [ ] **Step 6: Commit**

```bash
git add scripts/pin-renderer.mjs runtime-lock.json package.json
git commit -m "runtime: pin chromium-headless-shell for compose"
```

---

### Task 13: The `composing-evidence` skill

**REQUIRED SUB-SKILL:** superpowers:writing-skills (RED baseline first: a fresh agent given only `annotating-screenshots` and the Task 14 brief; then GREEN with this skill). Matt's standing rule: every skill edit goes through writing-skills.

**Files:**
- Create: `skills/composing-evidence/SKILL.md`
- Modify: `skills/annotating-screenshots/SKILL.md` (top of the file: one paragraph pointing live captures used as evidence at `composing-evidence`)

**Interfaces:**
- Consumes: the macro (Task 10), `compose` and `--seal` (Task 8).

- [ ] **Step 1: RED baseline**

Dispatch a fresh Sonnet agent with only the current skills and the Task 14 brief; record where it goes wrong (expected: hand-placed coordinates, full-viewport captures, chips on content). Save the transcript summary to `tests/skills/composing-evidence/red.md`.

- [ ] **Step 2: Write the skill**

```markdown
---
name: composing-evidence
description: Use when a live page needs to become polished evidence for an MR or ticket, such as proving a value changed, showing a fixed bug, or marking what a reviewer should look at, and the result should be a cropped, labelled image rather than a marked-up full screenshot
---

# Composing Evidence

You name page elements and write words. Fast Browser measures them and lays
out every mark and label. You never place anything by pixel.

## The pipeline

1. `browser_snapshot` (or `browser_find` on a large page) to choose selectors.
2. Capture: `browser_run_code_unsafe` with
   `filename: "<your home>/.fast-browser/macros/capture-evidence.js"` and
   `args: { targets: { <key>: "<selector>" }, frame: "auto", out: "<run>-<case>-after.c1", home: "<your home>" }`.
3. Fix every key in `missed` (`no-match`, `ambiguous`, `out-of-view`) and
   capture again. Never edit the return.
4. Save the return to a file and seal it: `fast-browser compose --seal <file>`.
5. Write the spec (below) beside the sidecar; `capture` names the sidecar by
   its file name.
6. `fast-browser compose <spec.json>`. Fix every listed problem.
7. Read the PNG. Check the crop shows what the brief names, every lift sits on
   the right element, labels sit outside the screenshot, and nothing you were
   told to hide is readable. Re-render at most twice.

## Selectors

Prefer role selectors (`role=heading[name="Example"]`), then text scoped to a
container (`[data-testid=section] >> text=Unknown section`). For repeated
elements, scope to the one container that is unique; never use `nth=`. A
selector must match exactly one element.

## Spec

```json
{
  "state": "AFTER",
  "title": "One sentence: what this board proves",
  "layout": "single",
  "out": "<run>-<case>-after.png",
  "panels": [{
    "capture": "<run>-<case>-after.c1.capture.json",
    "marks": [
      { "lift": "key", "title": "Short label", "note": "One line", "tag": "NEW" },
      { "lift": ["key1", "key2"], "title": "One point, two elements" },
      { "redact": "key" }
    ]
  }]
}
```

- `state`: `AFTER`, `BEFORE → AFTER`, `FLOW`, `FOUND`.
- `tag`: `NEW`, `CHANGED`, `REMOVED`, `ISSUE`, `PENDING`, `OK`.
- Lift the whole fact (the chip and its value, not one word of it). Adjacent
  elements that make one point go in one lift.
- `redact` hides personal data you are not verifying. A redact key that came
  back in `missed` is not redacted; compose refuses it. Fix and recapture.
- If `frameSnap` came back `union`, the page had no card around the targets;
  pass a `frame` selector for the container you mean.

## Done means

Report each board's PNG path and spec path, and anything you could not do.
```

- [ ] **Step 3: GREEN run**

Same brief, fresh Sonnet agent, now with the skill. Record results in `tests/skills/composing-evidence/green.md`. Iterate the skill text on any failure (writing-skills' refactor loop) until the brief's boards pass.

- [ ] **Step 4: Commit**

```bash
git add skills/composing-evidence skills/annotating-screenshots/SKILL.md tests/skills/composing-evidence
git commit -m "skills: add composing-evidence"
```

---

### Task 14: Milestone exit: blind eval and contact sheet

Nothing here is committed to the repo: the brief and its output show a real product and live only on Matt's machine.

**Files (operator machine only):**
- `~/.fast-browser/composed-evidence-eval/spike/blind/BRIEF.md` (the spike's five-case brief, already copied there from the design session along with the spike's code, specs and boards). In milestone 1 the bracket, loupe and steps cases are scored as single lifts; milestone 3 scores them as their own primitives.
- `~/.fast-browser/composed-evidence-eval/runs/<date>/`

- [ ] **Step 1: Confirm the pass bar with Matt**

The spec's bar is a proposal. Before running, ask Matt to confirm or change: every case produces a board; at most 3 capture calls per case; every declared redaction holds; each board at least 4/5 against its pen mock.

- [ ] **Step 2: Run the blind eval**

Dispatch `fast-browser:browser-driver` with `model: sonnet` and only `skills/composing-evidence/SKILL.md` plus the brief. Ground rules as in the spike: Fast Browser tools only, the capture macro is the only `browser_run_code_unsafe` use, never `newCDPSession`, stop a case after two identical failures.

- [ ] **Step 3: Score it**

Per case: board produced (y/n), capture calls, unresolved selector problems, redactions readable (y/n). Write `score.md` in the run folder.

- [ ] **Step 4: Publish a contact sheet for Matt**

Build one HTML page (light and dark scheme) showing each board beside its pen mock from `evidence.pen` (export the matching pen boards as PNG with pen.dev's Export), and publish it as a private artifact. Matt scores each board out of 5. A milestone that changes output is not done until he has looked at it.

- [ ] **Step 5: Decide**

If the bar is met: milestone 1 is done; write the milestone 2 plan. If not: file what failed against the task that owns it, fix, and rerun Steps 2 to 4.
```
