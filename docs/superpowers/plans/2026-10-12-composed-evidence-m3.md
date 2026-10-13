# Composed Evidence, Milestone 3: Remaining Primitives and Imported Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `fast-browser compose` draws every primitive in the spec's §4 (ghost, empty, bracket, loupe, link, pair, steps), composes imported ticket screenshots with a declared redaction that is cropped, recorded and confirmable, and closes every layout item milestone 1 parked.

**Architecture:** The in-page layout script is first split into three stages (source, fit, route) that work per panel, so a board is a row of independently laid-out panels sharing one scale rule. Each new mark is a new kind of *target* that the existing router labels; pair and steps add a common-height scale rule; an imported panel is an ordinary capture whose frame and boxes come from the spec instead of the sidecar. The redaction gate is two files compose writes beside the board (crops and a record) plus a `--confirm` mode.

**Tech Stack:** Node >= 20 ES modules, `node:test`, the installed runtime's `playwright-core`, the pinned `chromium-headless-shell`, Inter (bundled).

**Spec:** `docs/superpowers/specs/2026-10-10-composed-evidence-design.md` (this repo). Its "Milestone 3" section is the whole scope, with §3 to §6, "Testing as we build" and "Working rules from M1". Read-only: never edit it.

**Repo for every task:** the fast-browser worktree on branch `m3-primitives` (PUBLIC repo). Never the shared checkout. Milestone 2 runs in parallel on another branch of the same repo.

**Baseline (commit `a2ba811`, measured before this plan):** `npm run test:compose` 47 pass, 0 fail. `npm test` 1952 pass, 0 fail, 36 skipped. The repo has no CI workflow, so the PR's only automated check is CodeRabbit.

## Global Constraints

- Node `>=20`; `package.json` `dependencies` stays `{}`. No new npm dependency. `package.json` gains no script lines in this milestone.
- PUBLIC repo: no employer names, URLs, data, ticket ids or wording from the employer's business domain, in code, fixtures, goldens, commit messages or PR text. Fixtures use the shipped neutral domain, a project tracker. The blind eval's brief and boards never enter a repo.
- Output containment: every file compose writes (board, crops, record, imported PNG, sidecar) resolves inside `paths.screenshotsDir` through `confinedScreenshotPath`. A spec and its captures may live anywhere and are only read.
- The user's Chrome is never used to draw or to convert an image. Compose launches only the pinned `chromium-headless-shell`.
- Error messages never echo a user-supplied value (a file name, key, selector, label or text); they name the field.
- Every mark, lens and crop draws from the redacted copy of the source. No layer may read the original pixels after the redaction pre-pass.
- Nothing outside the shown frame is ever drawn, by any layer. A crop is a privacy boundary: the skill tells the driver that what is outside the frame is not shown.
- Labels never draw on the screenshot.
- A comment states only a constraint the code cannot show.
- Each primitive lands with its fixture and invariant first: the test that draws it is written and seen to fail before the layout code.
- Goldens: a golden is committed only after someone opened it and wrote down what reads wrong. Reviewers run `npm run test:compose` themselves.
- Run only the targeted suites while working (`node --test <file>`, `npm run test:compose`); the full `npm test` runs at the task's last step.
- Models: `sonnet` at `high` effort for implementers and task reviews; `opus` at `high` for the final whole-branch review. Every spawn names both.
- Every task ends with its tests green and a commit. The branch is squashed to one commit before any push.

## Shared files and milestone 2

Milestone 3 owns these, per the spec's table: `lib/compose/page-layout.js`, `lib/compose/page-geometry.js`, `lib/compose/page.mjs`, `lib/compose/spec.mjs`, `lib/compose/engine.mjs`, new modules under `lib/compose/`, `lib/commands/compose.mjs`, `lib/cli/parse-args.mjs`, `lib/cli/main.mjs`, `skills/composing-evidence/SKILL.md`, `tests/e2e/compose-fixtures.test.mjs`, `tests/e2e/compose-invariants.test.mjs`, `tests/e2e/helpers/invariants.mjs`, everything under `tests/fixtures/evidence/`.

Lines that belong to milestone 2 inside those files. Leave them byte-identical so its branch rebases cleanly:

- `lib/commands/compose.mjs`: the `request.seal` branch and the `capture.scale !== 1` refusal.
- `lib/cli/parse-args.mjs` and `lib/cli/main.mjs`: every `--seal` line.
- `skills/composing-evidence/SKILL.md`: pipeline steps 2 (Capture), 3 (Check the return) and 4 (Seal).
- `tests/e2e/compose-fixtures.test.mjs`: the line that loads the macro and the lines that turn its return into a sidecar. Task 1 moves them, unchanged, into one helper, `captureLive`, so milestone 2's edit stays in one place.
- `lib/compose/page-layout.js` and `lib/compose/page-geometry.js`: milestone 2 multiplies source-pixel constants by one `scale` factor. Every source-pixel distance this plan adds is a named constant at the top of its file, never an inline number.

Not ours at all: `lib/compose/capture.mjs` except the one `source: "import"` branch in `loadCapture` (Task 11), `builtins/macros/capture-evidence.js`, `builtins/macro-hashes.json`, `skills/browser-macros/MACROS.md`, `tests/e2e/capture-evidence.test.mjs`, `runtime-lock.json`, the renderer, setup.

**Files outside the spec's table that this plan must touch.** The table lists no unit tests, but the modules it gives milestone 3 have unit tests that pin behaviour this milestone changes:

- `tests/unit/compose-spec.test.mjs`, `tests/unit/compose-geometry.test.mjs`, `tests/unit/compose-page.test.mjs`: tests of modules milestone 3 owns. Edited in place.
- `tests/unit/skills.test.mjs`: one test pins the skill to "two marks, one layout". Its last six lines change in Task 9, nothing else in that file.
- `tests/skills/composing-evidence/red.md` and `green.md`: the skill's test record. Appended to.
- New unit test files, so the shared ones stay untouched: `tests/unit/compose-import.test.mjs`, `tests/unit/compose-redactions.test.mjs`. `tests/unit/compose-command.test.mjs`, `tests/unit/compose-capture.test.mjs` and `tests/unit/parse-args.test.mjs` are **not** edited; milestone 2 changes them.

## Decisions this plan settles

The spec leaves these to the plan. Each is a ruling; an implementer who finds one wrong stops and reports, and does not pick another.

1. **Theme pairs (the spec's open question).** The driver owns it. A light/dark pair is two capture calls with the app's own theme control switched between them, same selectors, same frame selector. The capture tool gains no theme argument. Each capture's own `dark` flag picks its wash.
2. **The common-height rule.** In `pair` and `steps` every panel's capture is drawn at one height `H`: `H = max(96, min(360, 1.25 × the shortest frame's height, 1120 / the sum of the frames' width-to-height ratios))`. The single layout's 0.55 lower scale limit does not apply, which is what lets a large imported screenshot shrink to match a small live crop. When the last term is under 96 the floor wins, the board comes out wide, and compose warns `the panels differ too much in shape to share a height well`.
3. **Panel counts.** `single` takes one panel, `pair` exactly two (each with a `label`), `steps` two to four.
4. **Every mark except `redact` takes optional `title`, `note` and `tag`.** `bracket` and `link` require `title`; a bracket or a link with no label says nothing.
5. **A ghost and an empty are slots, not lifts.** They draw over the capture at the key's box, above the wash, and are never enlarged.
6. **A bracket's rows are not lifted.** The bracket sits 6 px beside the grown union of its rows. When the panel has a wash, the rows are re-drawn flat above it so they stay readable. When the rows reach the frame's edge the bracket sits just outside the frame.
7. **A link is two lifts that never merge**, joined by the existing leader and connector: one leader, one connector, one label.
8. **A loupe's lens shows only pixels inside the shown frame.** Its zoom is relative to the frame as drawn; a target too large for the lens at the asked zoom is zoomed out to fit, with a warning.
9. **An imported panel must give `frame`.** The whole image is spelled `[0, 0, width, height]`.
10. **Import always re-encodes**, PNG input included, through the headless renderer, so the bundle's PNG carries no metadata from the original file. `--origin` is required.
11. **Crops and the record are written only for a board with a redact mark on an imported panel**, and then cover every redaction drawn on that board, live panels included. They live beside the board in the screenshots folder, the only place compose writes; `--confirm <spec.json>` finds them through the spec's `out`.
12. **The record also carries the board's SHA-256**, beyond the spec's minimum of crop name, crop hash and `confirmed`. The revise path copies a re-rendered board over a bundle's board; without the board's hash, a copied board beside a stale confirmed record would look confirmed. `--confirm` refuses when the board's bytes changed.
13. **CLI and skill wording says "the operator"**, not a person's name: the plugin is public.
14. **An unheld frame edge on the image's own boundary is named `image`** and does not warn. Compose cannot tell flush content from cut content there, and has nowhere to move the edge.
15. **A thin rule holds when it runs 48 px in total across the edge line with at least 4 px on the shorter side**, or 24 px on one side when the other side runs off the image. This replaces "24 px on both sides".

## Review Focus

Inputs the spec implies and no primitive's own happy-path test covers. Each has a test in the task named.

1. **A file that is not an image handed to `--import`** (HTML or text renamed `.png`, a truncated JPEG, an SVG) → import refuses with a one-line message naming the field; no stack trace, nothing written. Tests in Task 11.
2. **An inspection redact box whose 12 px pad reaches past the frame or the image** → the fill is clipped to the image, the board shows fill only, and the crop is still written at full resolution. Tests in Tasks 12 and 13.
3. **A pair or a four-step board whose panels have very different shapes, or whose total width passes the renderer's 2400 px viewport** → equal heights, the 96 px floor with its warning, no panel overlapping another, and a PNG exactly twice the stage's size. Tests in Task 8.
4. **A re-render with fewer redactions, or `--confirm` run twice** → no crop file from the earlier render survives, the record is rewritten unconfirmed, and a second confirm is a no-op that succeeds. Tests in Task 13.
5. **A loupe whose target sits at the frame's edge** → the lens shows the frame's pixels and blank beyond them, never the page outside the crop. Test in Task 6.

---

### Task 1: Split the layout into source, fit and route, per panel

`window.__composeLayout` is one 400-line function that handles one panel and mixes sizing with routing. Milestone 1 parked "split them before adding primitives to it". This task moves code without changing what any board looks like, and gives the report the per-panel shape every later task writes into. It also resolves the parked "the report's `frame` is in source pixels and nothing reads it": the units are now written down and the field has readers (Tasks 8 and 12).

**Files:**
- Modify: `lib/compose/page-layout.js` (whole file), `lib/compose/page.mjs` (CSS, `buildBoardHtml`)
- Modify: `tests/e2e/helpers/invariants.mjs`, `tests/e2e/compose-invariants.test.mjs`, `tests/e2e/compose-fixtures.test.mjs`
- Test: `npm run test:compose`

**Interfaces:**
- Consumes: `globalThis.__composeGeometry` as it is today.
- Produces, inside `page-layout.js` (later tasks extend these by name):
  - `async sourceOf(panel, capture, redactFill) -> src`, with `src = { panel, capture, marks, boxes, dark, url, pixels, redactBoxes, fillRects, shown, cleaned, liftMarks, groups, growAvoiding }`. `boxes` is `capture.boxes`; Task 12 makes it the panel's boxes for an imported panel. `groups` is today's `clustered`.
  - `solve(src, groups, scaleFor) -> { groups, plans, finals, notes, frame, cropEdges, S, cw, ch, map }`, today's `solve` with `S = scaleFor(frame)`.
  - `settle(src, scaleFor) -> solved`, today's merge loop.
  - `drawPanel(src, solved, host) -> panel`, which builds `.panel > .comp` under `host`, draws the capture, wash, lifts and redactions, builds `targets` and `anchors`, calls `route`, and returns the panel's report in comp-local pixels plus `comp`.
  - `route(ctx)`, today's label, leader, connector and dot code, reading `ctx.targets` and `ctx.anchors` only.
  - `const singleScale = (frame) => Math.min(MAX_S, Math.max(MIN_S, SINGLE_WIDTH / frame[2]))` with `SINGLE_WIDTH = 560`, `MIN_S = 0.55`, `MAX_S = 1.25`.
- Produces, the report `window.__composeLayout()` returns:

```js
{
  layout: 'single',
  stage: [0, 0, w, h],
  warnings: [],                 // deduplicated, board-wide
  panels: [{
    dark: false,
    capture: [x, y, w, h],      // the drawn frame, board CSS px
    frame: [x, y, w, h],        // the frame drawn, CAPTURE px
    cleanFrame: [x, y, w, h],   // the frame after edge cleaning, CAPTURE px
    frameEdges: { left, top, right, bottom },
    cropped: false, cropEdges: undefined,
    targets: [{ kind: 'lift', mark, rect, lift }],   // everything a leader can start from
    lifts: [{ keys, mark, rect, clamped, grown, pad, source, k, merged? }],
    labels: [{ rect, anchor, target }],
    leaders: [{ points, target, targets }],          // was { lift, lifts }
    connectors: [{ points, target, leader }],        // was { lift }
    dots: [{ center, r, target, slid }],             // was { lift }
    redactions: [{ rect, fill }],
  }],
}
```

  Every `rect`, `points`, `center` and `anchor` is in board CSS pixels; `frame`, `cleanFrame`, `source`, `grown` and `pad` are in capture pixels. A comment at the top of `page-layout.js` says exactly that and nothing more.

- [ ] **Step 1: Rewrite the invariants helper for the per-panel report**

Replace `tests/e2e/helpers/invariants.mjs` with:

```js
import assert from 'node:assert/strict';

export const intersects = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
export const inside = (a, b) => a[0] >= b[0] - 0.5 && a[1] >= b[1] - 0.5 && a[0] + a[2] <= b[0] + b[2] + 0.5 && a[1] + a[3] <= b[1] + b[3] + 0.5;
export const segmentHitsRect = ([x1, y1], [x2, y2], r) => {
  const minX = Math.min(x1, x2); const maxX = Math.max(x1, x2); const minY = Math.min(y1, y2); const maxY = Math.max(y1, y2);
  return intersects([minX, minY, Math.max(maxX - minX, 0.01), Math.max(maxY - minY, 0.01)], [r[0] + 1, r[1] + 1, r[2] - 2, r[3] - 2]);
};

// A copy of LIFT_RING in lib/compose/page-geometry.js, kept apart so the check does not read the code it checks.
const LIFT_RING = 3;
export const rectDistance = ([x, y], r) => Math.hypot(Math.max(r[0] - x, 0, x - r[0] - r[2]), Math.max(r[1] - y, 0, y - r[1] - r[3]));
const ringOf = (target) => (target.kind === 'lift' ? LIFT_RING : 0);

export function assertPanel(panel, stage) {
  for (const label of panel.labels) {
    assert.equal(intersects(label.rect, panel.capture), false, 'a label overlaps the screenshot');
    assert.ok(inside(label.rect, stage), 'a label leaves the stage');
  }
  panel.labels.forEach((a, i) => panel.labels.slice(i + 1).forEach((b) => {
    assert.equal(intersects(a.rect, b.rect), false, 'two labels overlap');
  }));
  for (const lift of panel.lifts) assert.ok(inside(lift.rect, panel.capture), 'a lift leaves the frame');
  panel.lifts.forEach((a, i) => panel.lifts.slice(i + 1).forEach((b) => {
    // Lifts closer than their two paddings cannot be kept apart.
    if (intersects([a.source[0] - 8, a.source[1] - 8, a.source[2] + 16, a.source[3] + 16], b.source)) return;
    assert.equal(intersects(a.rect, b.rect), false, 'two lifts of separate content overlap');
  }));
  const dotted = panel.leaders.filter((leader) => panel.targets[leader.target].kind === 'lift').length;
  assert.equal(panel.dots.length, dotted + panel.connectors.length, 'every lift leader and every connector has an anchor dot');
  for (const dot of panel.dots) {
    panel.targets.forEach((target, i) => {
      const gap = rectDistance(dot.center, target.rect) - dot.r - ringOf(target);
      assert.ok(gap >= -0.5, 'an anchor dot overlaps a target');
      if (i === dot.target) assert.ok(gap <= 1, 'an anchor dot is detached from its target');
    });
  }
  for (const leader of panel.leaders) {
    panel.targets.forEach((target, i) => {
      if (target.mark === panel.targets[leader.target].mark || i === leader.target) return;
      for (let s = 0; s < leader.points.length - 1; s += 1) {
        assert.equal(segmentHitsRect(leader.points[s], leader.points[s + 1], target.rect), false, 'a leader crosses another lift');
      }
    });
    assert.equal(new Set(leader.targets.map((i) => panel.targets[i].mark)).size, 1, 'a leader serves the targets of one mark');
  }
  for (const connector of panel.connectors) {
    const own = panel.targets[connector.target].mark;
    assert.ok(panel.leaders[connector.leader].targets.includes(connector.target), 'a connector belongs to its leader');
    panel.targets.forEach((target) => {
      if (target.mark === own) return;
      for (let s = 0; s < connector.points.length - 1; s += 1) {
        assert.equal(segmentHitsRect(connector.points[s], connector.points[s + 1], target.rect), false, "a mark's connector crosses another mark's lift");
      }
    });
  }
}

export function assertInvariants(report) {
  assert.ok(Array.isArray(report.panels) && report.panels.length > 0, 'the report lists its panels');
  for (const panel of report.panels) assertPanel(panel, report.stage);
}
```

- [ ] **Step 2: Point both e2e suites at `report.panels[0]`**

In `tests/e2e/compose-invariants.test.mjs`:

- `render(spec, capture)` accepts one capture or a list: `const captures = Array.isArray(capture) ? capture : [capture];` and passes `captures` to `buildBoardHtml`.
- Add `const p0 = (report) => report.panels[0];` under the `spec` helper.
- Every `report.lifts`, `report.labels`, `report.leaders`, `report.connectors`, `report.dots`, `report.redactions`, `report.frame`, `report.cropped`, `report.dark` becomes `p0(report).<same>`. `report.warnings` and `report.stage` stay on the report.
- `report.leaders[0].lifts` becomes `p0(report).leaders[0].targets`; `report.connectors[0].lift` becomes `.target`; `d.lift ===` becomes `d.target ===`. Lift indexes and target indexes are equal in this task, since every target is a lift.

In `tests/e2e/compose-fixtures.test.mjs`:

- After `assertInvariants(layoutReport);` add `const board0 = layoutReport.panels[0];` and replace every later `layoutReport.` with `board0.`, except `layoutReport.warnings` and `layoutReport.stage`.
- `layoutReport.leaders.map((l) => l.lifts.length)` becomes `board0.leaders.map((l) => l.targets.length)`.
- Move the macro call and the seal into one helper above the loop, with the two milestone 2 lines unchanged inside it:

```js
// Milestone 2 replaces the body of this helper and nothing else in this file.
async function captureLive({ browser, pageName, targets, frame, out, home, paths }) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(pathToFileURL(path.resolve(`tests/fixtures/evidence/pages/${pageName}.html`)).href);
  const captureReturn = await macro(page, { targets, out, home, frame });
  await page.close();
  assert.equal(captureReturn.failedStep, undefined, `capture failed at ${captureReturn.failedStep}`);
  assert.equal(captureReturn.missed.length, 0, 'every fixture target resolves');
  const ret = path.join(home, `${out}.return.json`);
  await writeFile(ret, JSON.stringify(captureReturn));
  const { sidecar } = await compose({ command: 'compose', seal: ret, spec: null }, { paths });
  return { captureReturn, sidecar };
}
```

  The loop launches the browser and calls it once, keeping `captureReturn` and `sidecar` under their current names:

```js
      const { chromium } = await import(renderer.playwrightCore);
      const browser = await chromium.launch({ headless: true, executablePath: renderer.executablePath });
      let captureReturn; let sidecar;
      try {
        ({ captureReturn, sidecar } = await captureLive({ browser, pageName, targets: fixture.targets, frame: fixture.frame, out: `${path.basename(file, '.json')}.c1`, home, paths }));
      } finally { await browser.close(); }
```

- [ ] **Step 3: Run the suite to see it fail**

Run: `npm run test:compose`
Expected: FAIL, every compose test, with `the report lists its panels` or a `TypeError` reading `panels`.

- [ ] **Step 4: Split `page-layout.js`**

Move code; do not rewrite it. The order of DOM appends and of `report.warnings.push` calls must not change, since goldens and warning order depend on it.

1. Module scope keeps `TONES`, `NS`, `el`, `place`, `loadImage`, the constants, `redactedSource` and `keysOf`, and gains `SINGLE_WIDTH`, `MIN_S`, `MAX_S` and `singleScale`.
2. `sourceOf(panel, capture, redactFill)`: lines from `const marks = panel.marks || []` through the `clustered` computation. It returns the `src` object in the Interfaces block; `growAvoiding` closes over `pixels`, `shown`, `redactBoxes` and `fillRects` as today. `cleaned.cut` is recorded as `src.notes = ['a frame edge cuts through content']` or `[]`.
3. `solve(src, groups, scaleFor)` and `settle(src, scaleFor)`: today's `solve`, `mergeColliding` and the `for (;;)` loop, with the one line `const S = Math.min(1.25, Math.max(0.55, 560 / fw));` replaced by `const S = scaleFor(frame);`.
4. `drawPanel(src, solved, host)`: creates `const col = el('div', 'panel', host); const comp = el('div', 'comp', col);`, then today's capture, fill, wash, lift and redaction drawing. Each lift pushes `targets.push({ kind: 'lift', mark: group.markIndex, rect: [L, T, W, H], lift: report.lifts.length - 1, ring: LIFT_RING, dot: true, source: b, pad })`. Anchors become `{ mark: group.mark, markIndex, label: { title, note, tag }, members: [target indexes] }`, one per mark that has a `title`.
5. `route(ctx)` with `ctx = { comp, svg, src, solved, targets, anchors, report, warn }`: today's code from `const svg = ...` to the `comp.style.width` lines. Inside it, `report.lifts[index]` becomes `targets[index]` everywhere (`rect`, `source`, `pad`), `a.lifts` becomes `a.members`, and `LIFT_RING` used as a target's clearance becomes `targets[index].ring`. `makeLabel(mark)` becomes `makeLabel(anchor.label)`.
6. `window.__composeLayout`:

```js
window.__composeLayout = async function () {
  const { spec, captures, redactFill } = window.__composeData;
  const warnings = [];
  await document.fonts.load('600 13px Inter');
  const stage = document.getElementById('stage');
  const header = el('div', 'header', stage);
  el('span', 'state', header, spec.state).style.background = TONES[spec.state] || '#1F1A3D';
  el('span', 'title', header, spec.title);
  const row = el('div', 'panels', stage);

  const sources = [];
  for (const [i, panel] of spec.panels.entries()) sources.push(await sourceOf(panel, captures[i], redactFill));
  const solved = sources.map((src) => settle(src, singleScale));
  const drawn = sources.map((src, i) => drawPanel(src, solved[i], row));

  await document.fonts.ready;
  const s = stage.getBoundingClientRect();
  const panels = drawn.map(({ comp, panel }) => {
    const c = comp.getBoundingClientRect();
    const dx = c.left - s.left; const dy = c.top - s.top;
    const off = (r) => [r[0] + dx, r[1] + dy, r[2], r[3]];
    const offPoint = ([x, y]) => [x + dx, y + dy];
    return {
      ...panel,
      capture: off(panel.capture),
      targets: panel.targets.map((t) => ({ kind: t.kind, mark: t.mark, rect: off(t.rect), ...(t.lift === undefined ? {} : { lift: t.lift }) })),
      lifts: panel.lifts.map((l) => ({ ...l, rect: off(l.rect) })),
      labels: panel.labels.map((l) => ({ ...l, rect: off(l.rect), anchor: offPoint(l.anchor) })),
      dots: panel.dots.map((d) => ({ ...d, center: offPoint(d.center) })),
      redactions: panel.redactions.map((r) => ({ ...r, rect: off(r.rect) })),
      leaders: panel.leaders.map((l) => ({ ...l, points: l.points.map(offPoint) })),
      connectors: panel.connectors.map((l) => ({ ...l, points: l.points.map(offPoint) })),
    };
  });
  for (const { notes } of drawn) warnings.push(...notes);
  const report = { layout: spec.layout ?? 'single', stage: [0, 0, s.width, s.height], warnings: [...new Set(warnings)], panels };
  window.__composeReport = report;
  return report;
};
```

  `drawPanel` returns `{ comp, panel, notes }`, where `notes` is that panel's warnings in the order today's code pushes them: `src.notes`, then `solved.notes`, then the routing warnings.

- [ ] **Step 5: Add the two wrappers to the page CSS**

In `lib/compose/page.mjs`, after the `.title` rule:

```css
.panels{display:flex;gap:24px;align-items:flex-start}
.panel{display:flex;flex-direction:column;gap:8px}
```

- [ ] **Step 6: Run the suite and prove no board changed**

Run: `npm run test:compose`
Expected: PASS, 47 tests.

Run: `UPDATE_GOLDENS=1 node --test tests/e2e/compose-fixtures.test.mjs && git status --short tests/fixtures/evidence/goldens`
Expected: no output from `git status`. A refactor that changes a single golden byte is wrong: run `git checkout -- tests/fixtures/evidence/goldens`, find the difference, and repeat.

- [ ] **Step 7: Run the unit suite and commit**

Run: `npm test`
Expected: 1952 pass, 0 fail.

```bash
git add lib/compose/page-layout.js lib/compose/page.mjs tests/e2e
git commit -m "compose: split the layout into source, fit and route per panel"
```

---

### Task 2: Geometry items parked from milestone 1

Five parked items live in `page-geometry.js`. All are unit-testable in the `vm` harness `tests/unit/compose-geometry.test.mjs` already uses.

**Files:**
- Modify: `lib/compose/page-geometry.js`, `lib/compose/page-layout.js` (two call sites)
- Modify: `tests/unit/compose-geometry.test.mjs`, `tests/e2e/compose-fixtures.test.mjs` (two assertions), any `tests/fixtures/evidence/specs/*.json` whose `expect.cropEdges` or `expect.frameEdges` names a value this task renames
- Test: `node --test tests/unit/compose-geometry.test.mjs`, `npm run test:compose`

**Interfaces:**
- Produces: `edgeName(side, origin, final, held) -> 'clean' | 'inward' | 'outward' | 'cut'` on `__composeGeometry`; `cleanFrame(pixels, frame, marksBox, { ignore, keep })` whose `edges` values gain `'image'`; `cropToMarks` whose `edges` values become `'snapped' | 'frame' | 'clamped'`; `growBox` returning fractional coordinates on sides that did not move.

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/compose-geometry.test.mjs` (it already defines `canvas`, `INK`, `growBox`, `cleanFrame`, `cropToMarks`, `sandbox`):

```js
const { edgeName } = sandbox.__composeGeometry;

test('a side that does not grow keeps its fractional coordinate', () => {
  const c = canvas(200, 100).fill(40, 24, 60, 4, INK);
  const { box } = growBox(c, [20.5, 20.25, 40, 11.5], 96);
  assert.equal(box[0], 20.5, 'the left edge did not move');
  assert.equal(box[1], 20.25, 'the top edge did not move');
  assert.equal(box[1] + box[3], 31.75, 'the bottom edge did not move');
  assert.ok(box[0] + box[2] >= 100, 'the right edge grew past the block');
});

test('an edge is named for where it ended up, not for its last move', () => {
  assert.equal(edgeName('top', 50, 43, true), 'outward');
  assert.equal(edgeName('top', 50, 57, true), 'inward');
  assert.equal(edgeName('top', 50, 50, true), 'clean');
  assert.equal(edgeName('right', 300, 310, true), 'outward');
  assert.equal(edgeName('bottom', 200, 190, true), 'inward');
  assert.equal(edgeName('left', 10, 4, false), 'cut');
});

test('a crop edge the margin already put on the frame is clamped, one that fell back is frame', () => {
  const c = canvas(600, 400);
  const { edges } = cropToMarks(c, [0, 0, 600, 400], [10, 150, 40, 20]);
  assert.equal(edges.left, 'clamped', 'the 64px margin reached past the frame');
  assert.equal(edges.right, 'snapped');
});

test('a frame edge that cuts a redaction fill moves out to the fill far side', () => {
  const c = canvas(400, 200);
  const { frame, edges } = cleanFrame(c, [100, 20, 200, 160], [150, 60, 40, 20], { keep: [[80, 60, 60, 24]] });
  assert.equal(frame[0], 80, 'the left edge sits on the fill near side');
  assert.equal(frame[0] + frame[2], 300, 'the right edge did not move');
  assert.equal(edges.left, 'outward');
});

test('a fill that the frame does not cut leaves the frame alone', () => {
  const c = canvas(400, 200);
  const { frame } = cleanFrame(c, [100, 20, 200, 160], null, { keep: [[150, 60, 60, 24], [10, 60, 30, 24]] });
  assert.deepEqual(frame, [100, 20, 200, 160]);
});

test('a rule near the image edge is still a rule', () => {
  const c = canvas(200, 60).fill(100, 0, 1, 60, [200, 200, 200]);
  assert.equal(edgeIsClean(c, [20, 10, 160, 44], 'bottom'), true, 'the rule runs off the image 6px below the edge line');
});

test('a border cut 10px from its corner is a rule, a stem cut 4px from its end is content', () => {
  const border = canvas(200, 200).fill(100, 40, 1, 100, [200, 200, 200]);
  assert.equal(edgeIsClean(border, [20, 20, 160, 111], 'bottom'), true, '90px above the line, 10px below');
  const stem = canvas(200, 200).fill(100, 40, 2, 40, INK);
  assert.equal(edgeIsClean(stem, [20, 20, 160, 56], 'bottom'), false, '35px above the line, 4px below: 39px in all');
  const shortSide = canvas(200, 200).fill(100, 40, 1, 100, [200, 200, 200]);
  assert.equal(edgeIsClean(shortSide, [20, 20, 160, 118], 'bottom'), false, 'only 2px of the rule lies below the line');
});

test('content flush with the image edge names the edge image and reports no cut', () => {
  const c = canvas(300, 200).fill(0, 60, 80, 12, INK);
  const { frame, edges, cut } = cleanFrame(c, [0, 20, 300, 160], [20, 50, 40, 30]);
  assert.equal(frame[0], 0);
  assert.equal(edges.left, 'image');
  assert.equal(cut, false);
});
```

`edgeIsClean` takes `(pixels, box, side, bounds, ignore)`; the calls above pass no bounds, so the image is the bounds.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/unit/compose-geometry.test.mjs`
Expected: FAIL on the eight new tests (`edgeName is not a function`, `'frame' !== 'clamped'`, and so on); every existing test still passes.

- [ ] **Step 3: Implement the five fixes**

In `lib/compose/page-geometry.js`:

`growBox`, replacing its last two lines:

```js
    if (SIDES.every((side) => grown[side] === 0)) return { box: box.slice(), cut };
    const x0 = grown.left ? r.x0 : box[0]; const y0 = grown.top ? r.y0 : box[1];
    const x1 = grown.right ? r.x1 : box[0] + box[2]; const y1 = grown.bottom ? r.y1 : box[1] + box[3];
    return { box: [x0, y0, x1 - x0, y1 - y0], cut };
```

`isRule`, replacing the `return [1, -1].every(...)` block, with `const RULE_MIN_SIDE = 4;` beside `RULE_LENGTH`:

```js
    // How far the run's colour holds on one side of the line, with the pixels
    // beside it a different colour. `open` says the probe ran off the image.
    const holds = (dir) => {
      for (let k = 1; k <= 2 * RULE_LENGTH; k += 1) {
        const inside = run.map((along) => at(along, dir * k));
        if (inside.some((px) => px < 0)) return { n: k - 1, open: true };
        if (inside.some((px) => !near(px, ref, TOLERANCE))) return { n: k - 1, open: false };
        const outside = [at(first - 1, dir * k), at(last + 1, dir * k)];
        if (outside.some((px) => px >= 0 && near(px, ref, SLIGHT))) return { n: k - 1, open: false };
      }
      return { n: 2 * RULE_LENGTH, open: false };
    };
    const a = holds(1); const b = holds(-1);
    if (a.open || b.open) return Math.max(a.n, b.n) >= RULE_LENGTH;
    return Math.min(a.n, b.n) >= RULE_MIN_SIDE && a.n + b.n >= 2 * RULE_LENGTH;
```

Update the comment above `RULE_THICKNESS` to state the new rule (48 px in total, 4 px on the shorter side, or 24 px on one side when the other runs off the image).

`edgeName`, a new function beside `cleanFrame`:

```js
  // `origin` and `final` are the edge's coordinate before and after cleaning.
  function edgeName(side, origin, final, isHeld) {
    if (!isHeld) return 'cut';
    const inwardBy = side === 'left' || side === 'top' ? final - origin : origin - final;
    return inwardBy > 0 ? 'inward' : inwardBy < 0 ? 'outward' : 'clean';
  }
```

`cleanFrame`:

- Read `const keep = (options && options.keep) || [];` and keep `const origin = { ...r };` right after `r` is built.
- Add, before the `for (let again = true; again;)` loop, and call it again for a side right after each `shift(side, ...)` inside the loop:

```js
    // A fill hides what is under it, so an edge through one cuts nothing; it
    // still reads as a torn redaction. The edge moves out to the fill's far side.
    const clearKeep = (side) => {
      for (const [kx, ky, kw, kh] of keep) {
        const spansX = kx < r.x1 && kx + kw > r.x0; const spansY = ky < r.y1 && ky + kh > r.y0;
        if (side === 'left' && spansY && kx < r.x0 && kx + kw > r.x0) { r.x0 = Math.max(image.x0, Math.floor(kx)); moved.left = true; }
        if (side === 'right' && spansY && kx < r.x1 && kx + kw > r.x1) { r.x1 = Math.min(image.x1, Math.ceil(kx + kw)); moved.right = true; }
        if (side === 'top' && spansX && ky < r.y0 && ky + kh > r.y0) { r.y0 = Math.max(image.y0, Math.floor(ky)); moved.top = true; }
        if (side === 'bottom' && spansX && ky < r.y1 && ky + kh > r.y1) { r.y1 = Math.min(image.y1, Math.ceil(ky + kh)); moved.bottom = true; }
      }
    };
    for (const side of SIDES) clearKeep(side);
```

  `moved` is declared before this block.
- Replace the `edges` line:

```js
    const onImage = (side) => r[KEY_OF[side]] === image[KEY_OF[side]];
    const edges = Object.fromEntries(SIDES.map((side) => {
      const isIn = isHeld(side);
      if (!isIn && onImage(side)) return [side, 'image'];
      return [side, edgeName(side, origin[KEY_OF[side]], r[KEY_OF[side]], isIn)];
    }));
```

  `last` is no longer read; delete it.

`cropToMarks`: record `const atEdge = { left: x0 === edge.x0, top: y0 === edge.y0, right: x1 === edge.x1, bottom: y1 === edge.y1 };` right after the four `Math.max`/`Math.min` lines, and name each side in the return: `r[KEY_OF[side]] !== edge[KEY_OF[side]] ? 'snapped' : atEdge[side] ? 'clamped' : 'frame'`. Update the function's comment: `edges` names each side `snapped`, `frame` (no clean band, so it fell back to the frame) or `clamped` (the margin already reached the frame).

Export `edgeName` on `globalThis.__composeGeometry`.

In `lib/compose/page-layout.js`, `sourceOf` passes the fills that touch the frame: `cleanFrame(pixels, capture.frame, marksBox, { ignore: fillRects, keep: fillRects.filter((f) => hits(f, capture.frame)) })`, and sets `src.notes` from `cleaned.cut` as before.

- [ ] **Step 4: Run the unit tests**

Run: `node --test tests/unit/compose-geometry.test.mjs`
Expected: PASS. If an existing test asserts a crop edge is `'frame'` where the margin was clamped, it was pinning the misleading name: change that expectation to `'clamped'` and say so in the commit body.

- [ ] **Step 5: Bring the fixture assertions in line**

In `tests/e2e/compose-fixtures.test.mjs`:

- `assert.equal(at[side], kind === 'frame', ...)` becomes `assert.equal(at[side], kind !== 'snapped', \`the ${side} edge is ${kind}: it sits on the cleaned frame's edge unless it snapped\`)`.
- `if (kind === 'clean' || kind === 'cut')` becomes `if (kind === 'clean' || kind === 'cut' || kind === 'image')`.

Run: `grep -ln '"cropEdges"\|"frameEdges"' tests/fixtures/evidence/specs/*.json` and, in each file listed, rename a `frame` value to `clamped` or a `cut` value to `image` only where `npm run test:compose` reports that exact mismatch.

- [ ] **Step 6: Run the compose suite and look at what moved**

Run: `npm run test:compose`
Expected: PASS, or golden mismatches on fixtures whose crop got tighter because a border near the image edge now reads as a rule. For each mismatch: `UPDATE_GOLDENS=1 node --test tests/e2e/compose-fixtures.test.mjs`, open the changed golden (`git status --short tests/fixtures/evidence/goldens`), confirm the new crop cuts no text, and list each changed golden with one line on what changed in the commit body. A golden that got worse is a bug in Step 3, not a golden update.

- [ ] **Step 7: Full unit suite, commit**

Run: `npm test`
Expected: 0 fail.

```bash
git add lib/compose tests/unit/compose-geometry.test.mjs tests/e2e/compose-fixtures.test.mjs tests/fixtures/evidence
git commit -m "compose: honest edge names, whole-pixel-free growth, rules near the image edge"
```

---

### Task 3: Routing items parked from milestone 1

Seven parked items live in `route` and the merge loop, plus the tests milestone 1 listed as missing. Tests are synthetic boards in `tests/e2e/compose-invariants.test.mjs`, built with its `syntheticCapture({ size, bars, boxes })`.

**Files:**
- Modify: `lib/compose/page-layout.js`, `tests/e2e/helpers/invariants.mjs`, `tests/e2e/compose-invariants.test.mjs`
- Test: `node --test tests/e2e/compose-invariants.test.mjs`, `npm run test:compose`

**Interfaces:**
- Consumes: `route(ctx)`, `settle`, `targets`, `anchors` from Task 1.
- Produces: warnings `two lifts overlap` and `a connector crosses another leader`; `assertPanel` checks named below; one lane per connector.

- [ ] **Step 1: Add the new invariants**

In `tests/e2e/helpers/invariants.mjs`, add above `assertPanel`:

```js
const cross = ([ax, ay], [bx, by], [cx, cy], [dx, dy]) => {
  const side = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return side(ax, ay, bx, by, cx, cy) * side(ax, ay, bx, by, dx, dy) < 0 && side(cx, cy, dx, dy, ax, ay) * side(cx, cy, dx, dy, bx, by) < 0;
};
export const pathsCross = (a, b) => a.slice(1).some((p, i) => b.slice(1).some((q, j) => cross(a[i], p, b[j], q)));
```

and at the end of `assertPanel`:

```js
  panel.dots.forEach((a, i) => panel.dots.slice(i + 1).forEach((b) => {
    assert.ok(Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]) >= a.r + b.r, 'two anchor dots overlap');
  }));
  for (const dot of panel.dots) {
    for (const label of panel.labels) assert.ok(rectDistance(dot.center, label.rect) >= dot.r, 'an anchor dot sits on a label');
    // A slid dot keeps 6px from the corners of the side it sits on.
    const [x, y, w, h] = panel.targets[dot.target].rect;
    const onRight = dot.center[0] > x + w;
    const [lo, span, at] = onRight ? [y, h, dot.center[1]] : [x, w, dot.center[0]];
    if (dot.slid !== 0 && span >= 12) assert.ok(at >= lo + 6 - 0.5 && at <= lo + span - 6 + 0.5, 'a slid dot sits in a corner');
  }
  panel.leaders.forEach((a, i) => panel.leaders.slice(i + 1).forEach((b) => {
    assert.equal(pathsCross(a.points, b.points), false, 'two leaders cross');
  }));
  for (const [i, leader] of panel.leaders.entries()) {
    for (let s = 0; s < leader.points.length - 1; s += 1) {
      const [[x1, y1], [x2, y2]] = [leader.points[s], leader.points[s + 1]];
      assert.ok(Math.abs(x1 - x2) < 0.01 || Math.abs(y1 - y2) < 0.01, 'a leader segment is not horizontal or vertical');
    }
    const label = panel.labels.find((l) => l.target === leader.target);
    assert.ok(label, 'a leader ends at a label');
    assert.ok(rectDistance(leader.points[leader.points.length - 1], label.rect) <= 8, 'a leader stops short of its label');
    const dot = panel.dots.find((d) => d.target === leader.target && d.center[0] === leader.points[0][0] && d.center[1] === leader.points[0][1]);
    if (panel.targets[leader.target].kind === 'lift') assert.ok(dot, `leader ${i} starts at its dot`);
  }
```

- [ ] **Step 2: Write the failing synthetic tests**

Append to `tests/e2e/compose-invariants.test.mjs`:

```js
import { pathsCross } from './helpers/invariants.mjs';

const board = async (marks, options) => {
  const { report, dir } = await render(spec(marks), await syntheticCapture(options));
  await rm(dir, { recursive: true, force: true });
  return report;
};

test('lifts that cannot be kept apart at their smallest scale are reported', { skip }, async () => {
  const bars = [[100, 100, 60, 20], [100, 121, 60, 20]];
  const report = await board([{ lift: 'a', title: 'Upper' }, { lift: 'b', title: 'Lower' }], { bars, boxes: { a: bars[0], b: bars[1] } });
  assert.ok(report.warnings.includes('two lifts overlap'));
});

test('lifts with room between them report no overlap', { skip }, async () => {
  const bars = [[100, 100, 60, 20], [100, 180, 60, 20]];
  const report = await board([{ lift: 'a', title: 'Upper' }, { lift: 'b', title: 'Lower' }], { bars, boxes: { a: bars[0], b: bars[1] } });
  assertInvariants(report);
  assert.equal(report.warnings.includes('two lifts overlap'), false);
});

test('a dot that slides past a neighbour keeps its leader track clear of the neighbour', { skip }, async () => {
  // The tall lift's right side is blocked from its top to y=160, so its dot slides below the small lift beside it.
  const bars = [[40, 20, 60, 200], [200, 125, 60, 20], [108, 20, 10, 140]];
  const report = await board([{ lift: 'a', title: 'Tall' }, { lift: 'b', title: 'Small' }], { size: [600, 300], bars, boxes: { a: bars[0], b: bars[1] } });
  assertInvariants(report);
  const tall = p0(report).dots.find((d) => d.target === 0);
  assert.ok(tall.slid > 40, `the tall lift's dot slid ${tall.slid}px down its side`);
});

test('a leader with no clear side is reported', { skip }, async () => {
  const bars = [[100, 100, 60, 20], [200, 100, 60, 20], [100, 160, 60, 20]];
  const report = await board([{ lift: 'a', title: 'Boxed' }, { lift: 'b' }, { lift: 'c' }], { bars, boxes: { a: bars[0], b: bars[1], c: bars[2] } });
  assert.ok(report.warnings.includes('a leader crosses another lift'));
  assert.throws(() => assertInvariants(report), /a leader crosses another lift/);
});

test('a connector with no clear side is reported', { skip }, async () => {
  const bars = [[100, 100, 60, 20], [200, 100, 60, 20], [100, 160, 60, 20], [400, 30, 60, 20]];
  const boxes = { a: bars[0], b: bars[1], c: bars[2], far: bars[3] };
  const report = await board([{ lift: ['far', 'a'], title: 'Pair' }, { lift: 'b' }, { lift: 'c' }], { bars, boxes });
  assert.ok(report.warnings.includes('a connector crosses another lift'));
});

test('a connector joins a leader that leaves by the bottom', { skip }, async () => {
  const bars = [[100, 100, 80, 20], [700, 100, 80, 20]];
  const report = await board([{ lift: ['a', 'b'], title: 'Both' }], { size: [1200, 300], bars, boxes: { a: bars[0], b: bars[1] } });
  assertInvariants(report);
  assert.equal(p0(report).connectors.length, 1);
  const leader = p0(report).leaders[0].points;
  assert.ok(Math.abs(leader[0][0] - leader[1][0]) < 0.01, 'the leader leaves downward');
});

test('connectors of two marks never share a lane', { skip }, async () => {
  // Each pair's left lift is walled in on its right by a middle lift, so both connectors drop to the lane under the frame.
  const bars = [[40, 40, 60, 20], [200, 40, 60, 20], [360, 40, 60, 20], [120, 320, 60, 20], [280, 320, 60, 20], [440, 320, 60, 20]];
  const boxes = { a1: bars[0], m1: bars[1], a2: bars[2], b1: bars[3], m2: bars[4], b2: bars[5] };
  const report = await board([{ lift: ['a1', 'a2'], title: 'Top pair' }, { lift: ['b1', 'b2'], title: 'Lower pair' }, { lift: 'm1' }, { lift: 'm2' }], { size: [600, 600], bars, boxes });
  assertInvariants(report);
  const [first, second] = p0(report).connectors;
  assert.ok(first && second, 'each pair has a connector');
  assert.deepEqual([first.points.length, second.points.length], [4, 4], 'both connectors run along the lane');
  assert.notEqual(first.points[1][1], second.points[1][1], 'each connector has its own lane');
  assert.equal(pathsCross(first.points, second.points), false);
  assert.equal(report.warnings.includes('a connector crosses another leader'), false);
});

test('merging two colliding lifts never sweeps another mark into them', { skip }, async () => {
  const bars = [[100, 100, 40, 20], [146, 122, 40, 20], [100, 126, 30, 14]];
  const boxes = { a: bars[0], c: bars[1], b: bars[2] };
  const report = await board([{ lift: ['a', 'c'], title: 'Diagonal pair' }, { lift: 'b', title: 'Between' }], { bars, boxes });
  assert.equal(p0(report).lifts.filter((l) => l.mark === 0).length, 2, 'the pair stays two lifts');
  assert.ok(p0(report).lifts.every((l) => !l.merged));
});

test('a connector is scored against clean ground, not against the first pixel under it', { skip }, async () => {
  // A 6px stripe beside the upper lift and a block under it leave no clean dot
  // spot. Against clean ground the stripe is a sample or two of ink and the
  // block is thirty; against the route's own first pixel, which is the stripe,
  // the whole clean run to the margin counts as ink instead.
  const bars = [[40, 40, 60, 20], [360, 220, 60, 20], [104, 30, 6, 40], [20, 70, 100, 60]];
  const report = await board([{ lift: ['a', 'c'], title: 'Both ends' }], { size: [600, 400], bars, boxes: { a: bars[0], c: bars[1] } });
  assert.equal(p0(report).connectors[0].points.length, 3, 'the connector leaves by the stripe side, straight to the leader');
});
```

For the three scenario tests that depend on exact geometry (the sliding dot, the diagonal pair and the stripe), run each once, read `report` (add a temporary `console.log(JSON.stringify(p0(report)))`), and if the scene does not produce the situation its comment describes, move the bars until it does. Keep every assertion as written; remove the logging before committing.

- [ ] **Step 3: Run them to see them fail**

Run: `node --test tests/e2e/compose-invariants.test.mjs`
Expected: FAIL on at least `two lifts overlap`, `never share a lane`, `never sweeps another mark` and `scored against clean ground`. A new test that already passes stays; it pins behaviour milestone 1 left untested.

- [ ] **Step 4: Implement**

In `lib/compose/page-layout.js`:

1. **Overlap warning** (`solve`, after the `plans.forEach` that fills `finals`):

```js
      finals.forEach((a, i) => finals.slice(i + 1).forEach((b, k) => {
        if (!hits(grownBoxes[i], grownBoxes[i + 1 + k]) && hits(a.rect, b.rect)) notes.push('two lifts overlap');
      }));
```

2. **Merge guard** (`settle`). A merge is refused when the merged box would cover another mark's box that neither member covered. Refused pairs are remembered so the loop ends:

```js
    const refused = new Set();
    const key = (i, j) => `${solved.groups[i].keys.join()}|${solved.groups[j].keys.join()}`;
    const sweeps = (groups, i, j) => {
      const merged = union([groups[i].original, groups[j].original]);
      return groups.some((g, k) => g.markIndex !== groups[i].markIndex && hits(merged, g.original)
        && !hits(groups[i].original, g.original) && !hits(groups[j].original, g.original));
    };
    for (;;) {
      const pairs = collidingLifts(solved.finals.map((f, i) => ({ mark: solved.groups[i].markIndex, rect: f.rect })))
        .filter(([i, j]) => !refused.has(key(i, j)));
      const allowed = pairs.filter(([i, j]) => !sweeps(solved.groups, i, j) || (refused.add(key(i, j)), false));
      if (!allowed.length) break;
      solved = solve(src, mergeColliding(solved.groups, allowed), scaleFor);
    }
```

3. **Dots stay apart** (`route`). Keep `const placed = [];` and, in `dotOn`'s `slideDot` predicate, after computing `point`, add `if (placed.some(([px, py]) => Math.hypot(px - point[0], py - point[1]) < 2 * DOT_OUTER + 2)) return false;`. The `dot()` helper pushes each centre to `placed`.
4. **Tracks follow the dots**: `rightList.sort((p, q) => p.at - q.at)` and `bottomList.sort((p, q) => p.at - q.at)`, replacing the two sorts by rect centre. The label's own `cy` and `cx` still come from the rect.
5. **One lane per connector**: `connect` still chooses each connector's side with the base lane (`{ y: ch + 10 + 8 * nB }` or `{ x: cw + 10 + 8 * nR }`), since the lane lies outside the capture and adds no ink. A connector whose chosen route uses the lane (`side !== toward`) is not drawn there: push `{ anchor, target, side, at, toward, join, leader }` to `const laned = []`. After both lists are routed, draw them last anchor first (`laned.reverse()`), the first on the base lane and each next one 8 px further out, and only then raise `maxR` and `maxB`. A connector that drops further down the board takes the nearer lane, so its drop never crosses an earlier connector's run.
6. **Ground-referenced scoring**: `inkAlong(o.points) < inkAlong(best.points)` becomes `inkAlong(o.points, groundOf(s, o.side)) < inkAlong(best.points, groundOf(s, best.side))`.
7. **Crossing warning**: after both lists are routed, before `comp.style.width` is set:

```js
    const lines = [...report.leaders.map((l) => ({ points: l.points, mark: targets[l.target].mark })),
      ...report.connectors.map((c) => ({ points: c.points, mark: targets[c.target].mark }))];
    if (lines.some((a, i) => lines.slice(i + 1).some((b) => a.mark !== b.mark && pathsCross(a.points, b.points)))) warn('a connector crosses another leader');
```

  with `pathsCross` added to `page-geometry.js` and exported on `__composeGeometry`, the same two functions as in the invariants helper (the helper keeps its own copy, for the reason its `LIFT_RING` comment gives).

- [ ] **Step 5: Run the suites**

Run: `npm run test:compose`
Expected: PASS, apart from goldens that moved because tracks now follow dot order or a connector changed lane. For each: regenerate, open, confirm leaders and labels still read in order, and list the changed goldens in the commit body.

- [ ] **Step 6: Full unit suite, commit**

Run: `npm test`
Expected: 0 fail.

```bash
git add lib/compose tests/e2e tests/fixtures/evidence/goldens
git commit -m "compose: overlap and crossing warnings, one lane per connector, guarded merges"
```

---

### Task 4: Slots: `empty` and `ghost`

A slot is a rectangle drawn over the capture at a key's box: dashed with italic text where nothing rendered, rose where something was removed. It is the first target that is not a lift, so this task also makes the validator table-driven.

**Files:**
- Modify: `lib/compose/spec.mjs`, `lib/compose/page-layout.js`, `lib/compose/page.mjs`
- Modify: `tests/unit/compose-spec.test.mjs`, `tests/e2e/helpers/invariants.mjs`, `tests/e2e/compose-invariants.test.mjs`, `tests/e2e/compose-fixtures.test.mjs`
- Create: `tests/fixtures/evidence/pages/empty-chart.html`, `tests/fixtures/evidence/pages/ghost-button.html`, `tests/fixtures/evidence/specs/empty-chart.json`, `tests/fixtures/evidence/specs/ghost-button.json`, and their goldens

**Interfaces:**
- Consumes: `sourceOf`, `drawPanel`, `route`, `targets`, `anchors` (Task 1).
- Produces:
  - `spec.mjs`: `MARK_KINDS` (frozen list of every kind compose draws), `markKind`, `markKeys`, `validateSpec` unchanged in signature. `MARK_KINDS_M1` stays exported and unchanged; a test outside this task still reads it.
  - Spec: `{ "empty": "<key>", "text"?: "<= 80 chars", "title"?, "note"?, "tag"? }` and `{ "ghost": "<key>", "title"?, "note"?, "tag"? }`.
  - Report: `panel.wash: boolean`, `panel.slots: [{ kind: 'empty' | 'ghost', mark, rect, text: 'inside' | 'label' | 'dropped' | null }]`; a slot target is `{ kind: 'slot', mark, rect }`.
  - Warning: `an empty slot is too small for its text`.
  - `src.slotMarks: [{ mark, markIndex, kind, box }]`.

- [ ] **Step 1: Write the failing validator tests**

Append to `tests/unit/compose-spec.test.mjs`:

```js
test('ghost and empty take one key and optional words', () => {
  assert.deepEqual(validateSpec(base([
    { empty: 'name', text: 'Nothing rendered here' },
    { ghost: 'phone', tag: 'REMOVED', title: 'Gone', note: 'Removed in this change' },
  ]), [capture()]), []);
});

test('a slot refuses a key list, long text and words that are not text', () => {
  const problems = validateSpec(base([
    { empty: ['name', 'phone'] }, { ghost: 'name', title: '' }, { empty: 'name', text: 'x'.repeat(81) },
    { ghost: 'name', note: 7 }, { ghost: 'name', tag: 'SHINY' }, { empty: 'nowhere' },
  ]), [capture()]);
  assert.ok(problems.includes('panels[0].marks[0] takes exactly one key'));
  assert.ok(problems.includes('panels[0].marks[1].title must not be empty'));
  assert.ok(problems.includes('panels[0].marks[2].text must be text of at most 80 characters'));
  assert.ok(problems.includes('panels[0].marks[3].note must be text'));
  assert.ok(problems.includes('panels[0].marks[4].tag must be one of NEW, CHANGED, REMOVED, ISSUE, PENDING, OK'));
  assert.ok(problems.includes('panels[0].marks[5] names a key the capture did not measure'));
});

test('redact takes no words', () => {
  assert.deepEqual(validateSpec(base([{ redact: 'phone', title: 'ignored' }]), [capture()]), []);
});
```

Run: `node --test tests/unit/compose-spec.test.mjs`
Expected: FAIL, `panels[0].marks[0] is not a supported mark in this version` and the others.

- [ ] **Step 2: Make the validator table-driven**

In `lib/compose/spec.mjs`, replace `MARK_KINDS_M1`'s use (not its export) and the per-mark block:

```js
export const MARK_KINDS_M1 = Object.freeze(['lift', 'redact']);

// keys: how many keys the mark names. words: whether it takes title, note and tag.
const RULES = Object.freeze({
  lift: { keys: 'many', words: true },
  redact: { keys: 'many', words: false },
  empty: { keys: 'one', words: true, text: true },
  ghost: { keys: 'one', words: true },
});
export const MARK_KINDS = Object.freeze(Object.keys(RULES));

export function markKind(mark) {
  if (!mark || typeof mark !== 'object') return null;
  const kinds = MARK_KINDS.filter((kind) => kind in mark);
  return kinds.length === 1 ? kinds[0] : null;
}
```

and inside `validateSpec`'s `forEach` over marks, after `const kind = markKind(mark);` and its refusal:

```js
      const rule = RULES[kind];
      const named = Array.isArray(mark[kind]) ? mark[kind] : [mark[kind]];
      // markKeys drops non-text keys, so the page would silently skip one
      // the validator never saw; refuse it here instead.
      if (named.some((key) => typeof key !== 'string')) { problems.push(`${at} names a key that is not text`); return; }
      if (rule.keys === 'one' && (Array.isArray(mark[kind]) || named.length !== 1)) { problems.push(`${at} takes exactly one key`); return; }
      if (rule.keys === 'two' && (named.length !== 2 || named[0] === named[1])) { problems.push(`${at} takes exactly two different keys`); return; }
      const keys = markKeys(mark);
      if (kind === 'redact' && keys.some((key) => missed.has(key))) {
        problems.push(`${at} redacts a key the capture missed; fix the selector and recapture`);
        return;
      }
      if (keys.length === 0 || keys.some((key) => !measured.has(key))) {
        problems.push(`${at} names a key the capture did not measure`);
      }
      if (rule.words) {
        if (mark.tag !== undefined && !TAGS.includes(mark.tag)) problems.push(`${at}.tag must be one of ${TAGS.join(', ')}`);
        if (rule.title === 'required' && mark.title === undefined) problems.push(`${at}.title is required`);
        if (mark.title !== undefined && !nonEmpty(mark.title)) problems.push(`${at}.title must not be empty`);
        if (mark.note !== undefined && !nonEmpty(mark.note)) problems.push(`${at}.note must be text`);
      }
      if (rule.text && mark.text !== undefined && !(nonEmpty(mark.text) && mark.text.length <= 80)) {
        problems.push(`${at}.text must be text of at most 80 characters`);
      }
      if (rule.zoom && mark.zoom !== undefined && !(Number.isFinite(mark.zoom) && mark.zoom >= 2 && mark.zoom <= 8)) {
        problems.push(`${at}.zoom must be a number from 2 to 8`);
      }
```

`rule.keys === 'two'`, `rule.title === 'required'` and `rule.zoom` have no user yet; Tasks 5 to 7 add the rows that use them.

Run: `node --test tests/unit/compose-spec.test.mjs`
Expected: PASS.

- [ ] **Step 3: Write the fixture pages and specs**

`tests/fixtures/evidence/pages/empty-chart.html`:

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif;background:#f6f7f9}
.card{margin:40px;width:520px;padding:20px;background:#fff;border:1px solid #e5e7eb;border-radius:12px}
h3{margin:0 0 12px;font-size:16px}
.chart{height:180px;border-radius:8px;background:#fafafa}
.meta{margin-top:12px;color:#6b7280}</style>
<div class="card" data-testid="burndown"><h3>Sprint burndown</h3>
  <div class="chart" data-testid="chart"></div>
  <div class="meta">Sprint 14, 9 of 21 points done</div>
</div>
```

`tests/fixtures/evidence/pages/ghost-button.html`:

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif;background:#f6f7f9}
.card{margin:40px;width:520px;padding:20px;background:#fff;border:1px solid #e5e7eb;border-radius:12px}
h3{margin:0 0 12px;font-size:16px}
.bar{display:flex;gap:8px;align-items:center}
button{font:inherit;height:32px;padding:0 14px;border:1px solid #d1d5db;border-radius:6px;background:#fff}
.gap{display:inline-block;width:86px;height:32px}
p{margin:14px 0 0;color:#6b7280}</style>
<div class="card" data-testid="release"><h3>Release 2.4</h3>
  <div class="bar"><button>Edit</button><button>Duplicate</button><span class="gap" data-testid="gap"></span><button>Archive</button></div>
  <p>Three changes are queued for this release.</p>
</div>
```

`tests/fixtures/evidence/specs/empty-chart.json`:

```json
{ "state": "FOUND", "title": "The burndown chart renders nothing", "layout": "single", "out": "fx-empty-chart.png",
  "targets": { "chart": "[data-testid=chart]" },
  "expect": { "slots": [["empty", "inside"]], "noWarnings": true },
  "panels": [{ "marks": [ { "empty": "chart", "text": "Nothing rendered here" } ] }] }
```

`tests/fixtures/evidence/specs/ghost-button.json`:

```json
{ "state": "AFTER", "title": "Export is no longer in the release toolbar", "layout": "single", "out": "fx-ghost-button.png",
  "targets": { "gap": "[data-testid=gap]" },
  "expect": { "slots": [["ghost", null]], "noWarnings": true },
  "panels": [{ "marks": [ { "ghost": "gap", "tag": "REMOVED", "title": "Export is gone", "note": "Removed from the toolbar" } ] }] }
```

In `tests/e2e/compose-fixtures.test.mjs`, after the `minLiftHeight` check:

```js
      if (fixture.expect?.slots) {
        assert.deepEqual(board0.slots.map((s) => [s.kind, s.text]), fixture.expect.slots, 'each slot is drawn as expected');
        assert.equal(board0.wash, board0.lifts.length > 0, 'a slot alone raises no wash');
      }
```

- [ ] **Step 4: Write the invariant and the synthetic tests**

In `tests/e2e/helpers/invariants.mjs`: the dot count line becomes

```js
  const dotted = panel.leaders.filter((leader) => ['lift', 'slot'].includes(panel.targets[leader.target].kind)).length;
```

the leader-start check in Task 3's block reads `if (['lift', 'slot'].includes(panel.targets[leader.target].kind))`, and `assertPanel` gains:

```js
  for (const slot of panel.slots ?? []) assert.ok(inside(slot.rect, panel.capture), 'a slot leaves the frame');
```

Append to `tests/e2e/compose-invariants.test.mjs`:

```js
test('an empty slot holds its text when it fits and hands it to a label when it does not', { skip }, async () => {
  const boxes = { big: [100, 60, 300, 150], small: [450, 230, 50, 18] };
  const report = await board([{ empty: 'big' }, { empty: 'small', text: 'Nothing rendered here' }], { bars: [], boxes });
  assertInvariants(report);
  assert.deepEqual(p0(report).slots.map((s) => s.text), ['inside', 'label']);
  assert.equal(p0(report).labels.length, 1, 'the small slot explains itself in the margin');
  assert.equal(p0(report).targets[p0(report).leaders[0].target].kind, 'slot');
  assert.equal(p0(report).wash, false);
});

test('an empty slot with a title of its own drops text that does not fit, and says so', { skip }, async () => {
  const report = await board([{ empty: 'small', title: 'Chart missing' }], { bars: [], boxes: { small: [300, 150, 50, 18] } });
  assert.equal(p0(report).slots[0].text, 'dropped');
  assert.ok(report.warnings.includes('an empty slot is too small for its text'));
});

test('a ghost slot sits on its box and takes a label', { skip }, async () => {
  const report = await board([{ ghost: 'a', tag: 'REMOVED', title: 'Removed' }], { bars: [], boxes: { a: [100, 100, 200, 40] } });
  assertInvariants(report);
  const [slot] = p0(report).slots;
  assert.equal(slot.kind, 'ghost');
  const scale = p0(report).capture[2] / p0(report).frame[2];
  assert.ok(Math.abs(slot.rect[2] - 200 * scale) < 1 && Math.abs(slot.rect[3] - 40 * scale) < 1, 'the slot is the size of its box');
  assert.equal(p0(report).dots.length, 1);
});
```

Run: `node --test tests/e2e/compose-invariants.test.mjs`
Expected: FAIL (`slots` is undefined).

- [ ] **Step 5: Draw slots**

`lib/compose/page-layout.js`:

- `sourceOf`: build `const slotMarks = marks.flatMap((mark, markIndex) => { const kind = ['empty', 'ghost'].find((k) => k in mark); return kind ? [{ mark, markIndex, kind, box: boxes[mark[kind]] }] : []; });`. Slot boxes join `sourceMarks` (the marks that bound the frame cleaning), the `avoid` list of `growAvoiding` (a lift never grows into a slot), and, in `solve`, the `markBoxes` the crop keeps. Return it as `src.slotMarks`.
- `drawPanel`, right after the wash and before the lifts:

```js
    const clip = ([x, y, w, h]) => {
      const x0 = Math.max(0, x); const y0 = Math.max(0, y); const x1 = Math.min(cw, x + w); const y1 = Math.min(ch, y + h);
      return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
    };
    for (const slot of src.slotMarks) {
      const rect = clip(map(slot.box));
      if (!rect) continue;
      const node = el('div', `slot ${slot.kind}${dark ? ' dark' : ''}`, cap); place(node, ...rect);
      let text = null; let { title } = slot.mark;
      if (slot.kind === 'empty') {
        const words = slot.mark.text ?? 'Nothing rendered here';
        const span = el('span', null, node, words); const size = span.getBoundingClientRect();
        if (size.width + 16 <= rect[2] && size.height + 8 <= rect[3]) text = 'inside';
        else {
          span.remove(); text = title ? 'dropped' : 'label';
          if (title) notes.push('an empty slot is too small for its text'); else title = words;
        }
      }
      panel.slots.push({ kind: slot.kind, mark: slot.markIndex, rect, text });
      const target = targets.push({ kind: 'slot', mark: slot.markIndex, rect, ring: 0, dot: true, source: slot.box, pad: [0, 0, 0, 0] }) - 1;
      if (title) anchors.push({ mark: slot.mark, markIndex: slot.markIndex, label: { title, note: slot.mark.note, tag: slot.mark.tag }, members: [target] });
    }
```

- `panel.wash = groups.length > 0;` beside the line that draws the wash, and `slots: []` in the panel's initial report. `__composeLayout` offsets `slots[].rect` like every other rect.
- In `route`, the page content a dot's footprint ignores stays "under a lift": filter `targets` by `kind === 'lift'` there. A slot is translucent, so content under it is still on show.

`lib/compose/page.mjs` CSS:

```css
.slot{position:absolute;border-radius:8px;display:flex;align-items:center;justify-content:center}
.slot.empty{border:1.5px dashed #94A3B8;background:rgba(248,250,252,.7);font-style:italic;font-weight:500;font-size:13px;color:#64748B;white-space:nowrap}
.slot.empty.dark{border-color:#64748B;background:rgba(15,23,42,.55);color:#CBD5E1}
.slot.ghost{border:1.5px solid #FB7185;background:rgba(244,63,94,.12)}
.slot.ghost.dark{background:rgba(244,63,94,.22)}
```

- [ ] **Step 6: Run, generate the two goldens, look at them**

Run: `node --test tests/e2e/compose-invariants.test.mjs`
Expected: PASS.

Run: `UPDATE_GOLDENS=1 node --test --test-name-pattern='empty-chart|ghost-button' tests/e2e/compose-fixtures.test.mjs`, then open `tests/fixtures/evidence/goldens/empty-chart.png` and `ghost-button.png` with the Read tool.
Check and write down, in the task report: the dashed slot covers the whole chart area and its text is centred and readable; the rose slot sits exactly on the toolbar gap, between Duplicate and Archive; the ghost's label and leader are in the margin; the italic is not ugly (the bundled Inter is upright, so the browser slants it). Anything that reads wrong is fixed before commit, not noted and left.

Run: `git status --short tests/fixtures/evidence/goldens`
Expected: exactly the two new files; no existing golden changed.

- [ ] **Step 7: Suites, commit**

Run: `npm run test:compose && npm test`
Expected: 0 fail.

```bash
git add lib/compose tests
git commit -m "compose: empty and ghost slots"
```

---

### Task 5: `bracket`

A bracket is a span marker beside a group of rows with one label. The spec's rule: it sits beside the rows it groups, not at the frame edge.

**Files:**
- Modify: `lib/compose/spec.mjs`, `lib/compose/page-layout.js`, `lib/compose/page.mjs`
- Modify: `tests/unit/compose-spec.test.mjs`, `tests/e2e/helpers/invariants.mjs`, `tests/e2e/compose-invariants.test.mjs`, `tests/e2e/compose-fixtures.test.mjs`
- Create: `tests/fixtures/evidence/pages/bracket-rows.html`, `tests/fixtures/evidence/pages/bracket-table.html`, `tests/fixtures/evidence/specs/bracket-rows.json`, `tests/fixtures/evidence/specs/bracket-table.json`, and their goldens

**Interfaces:**
- Consumes: `targets`, `anchors`, `route`, `growAvoiding`, `clip`, `panel.wash` (Tasks 1 and 4).
- Produces:
  - Spec: `{ "bracket": "<key>" | ["<key>", ...], "title": "<required>", "note"?, "tag"? }`.
  - Report: `panel.brackets: [{ mark, rows: rect, rect, slid, inMargin }]`, `panel.flats: [{ mark, rect }]`; a bracket target is `{ kind: 'bracket', mark, rect }` with no dot.
  - Warnings: `a bracket edge cuts through content`, `a bracket sits on page content`.
  - `probes(src, solved, targets) -> { colourAt, differs, groundOf, inkIn }`, shared by `drawPanel` and `route`.
  - An anchor may carry `prefer: ['right', 'bottom']`; `route` uses it in place of the frame-shape preference.
  - Constants `BRACKET_GAP = 6`, `BRACKET_ARM = 6`, `BRACKET_REACH = 24`, `BRACKET_STEP = 2`, `BRACKET_GUTTER = 14`, `BRACKET_EDGE = 4`.

- [ ] **Step 1: Validator test, then the rule**

Append to `tests/unit/compose-spec.test.mjs`:

```js
test('a bracket groups one or more keys and must say what it groups', () => {
  assert.deepEqual(validateSpec(base([{ bracket: ['name', 'phone'], title: 'Two rows', note: 'Both changed' }]), [capture()]), []);
  assert.ok(validateSpec(base([{ bracket: ['name', 'phone'] }]), [capture()]).includes('panels[0].marks[0].title is required'));
});
```

In the existing test `every problem is reported, by field and index, never by value`, the unsupported mark `{ bracket: ['name'] }` becomes `{ sparkle: ['name'] }`; its expected message does not change.

Run: `node --test tests/unit/compose-spec.test.mjs` → FAIL on the new test.

Add to `RULES` in `lib/compose/spec.mjs`: `bracket: { keys: 'many', words: true, title: 'required' },`.

Run again → PASS.

- [ ] **Step 2: Fixture pages and specs**

`tests/fixtures/evidence/pages/bracket-rows.html` (rows end mid-card, so the bracket has room inside the frame):

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif;background:#f6f7f9}
.card{margin:40px;width:520px;padding:20px;background:#fff;border:1px solid #e5e7eb;border-radius:12px}
.head{display:flex;gap:10px;align-items:center;margin-bottom:10px}
h3{margin:0;font-size:16px}
.pill{padding:2px 9px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:12px}
ul{list-style:none;margin:0;padding:0}
li{width:max-content;padding:6px 0}
b{font-weight:600;margin-left:8px}</style>
<div class="card" data-testid="checks"><div class="head"><h3>Release checks</h3><span class="pill" data-testid="summary">3 of 5 passing</span></div>
  <ul>
    <li data-testid="r1">Unit tests <b>passed</b></li>
    <li data-testid="r2">Lint <b>failed</b></li>
    <li data-testid="r3">Build <b>failed</b></li>
    <li data-testid="r4">Type check <b>passed</b></li>
    <li data-testid="r5">Audit <b>passed</b></li>
  </ul>
</div>
```

`tests/fixtures/evidence/pages/bracket-table.html` (rows span the card, so the bracket goes to the margin):

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif;background:#f6f7f9}
.card{margin:40px;width:520px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}
h3{margin:0;padding:16px 20px;font-size:16px}
table{width:100%;border-collapse:collapse}
td{padding:9px 20px;border-top:1px solid #eef0f3}
td:last-child{text-align:right;color:#6b7280}</style>
<div class="card" data-testid="queue"><h3>Review queue</h3>
  <table>
    <tr data-testid="q1"><td>Update the onboarding copy</td><td>Waiting 2 days</td></tr>
    <tr data-testid="q2"><td>Fix the export timeout</td><td>Waiting 5 days</td></tr>
    <tr data-testid="q3"><td>Rename the audit tab</td><td>Waiting 6 days</td></tr>
    <tr data-testid="q4"><td>Add a dark theme toggle</td><td>Waiting 1 day</td></tr>
  </table>
</div>
```

`tests/fixtures/evidence/specs/bracket-rows.json`:

```json
{ "state": "FOUND", "title": "Two release checks fail, and the summary counts them", "layout": "single", "out": "fx-bracket-rows.png",
  "targets": { "r2": "[data-testid=r2]", "r3": "[data-testid=r3]", "summary": "[data-testid=summary]" },
  "expect": { "brackets": [false], "flats": 1 },
  "panels": [{ "marks": [
    { "bracket": ["r2", "r3"], "title": "Two checks failing", "note": "Lint and build", "tag": "ISSUE" },
    { "lift": "summary", "title": "Summary agrees" } ] }] }
```

`tests/fixtures/evidence/specs/bracket-table.json`:

```json
{ "state": "AFTER", "title": "The two oldest reviews sort to the middle of the queue", "layout": "single", "out": "fx-bracket-table.png",
  "targets": { "q2": "[data-testid=q2]", "q3": "[data-testid=q3]" },
  "expect": { "brackets": [true], "flats": 0 },
  "panels": [{ "marks": [ { "bracket": ["q2", "q3"], "title": "Oldest two", "note": "Five and six days" } ] }] }
```

In `tests/e2e/compose-fixtures.test.mjs`, after the `slots` check:

```js
      if (fixture.expect?.brackets) {
        assert.deepEqual(board0.brackets.map((b) => b.inMargin), fixture.expect.brackets, 'each bracket sits inside the frame or in the margin as expected');
        assert.equal(board0.flats.length, fixture.expect.flats, 'bracketed rows are redrawn flat only under a wash');
      }
```

- [ ] **Step 3: Invariant and synthetic tests**

`assertPanel` gains:

```js
  for (const bracket of panel.brackets ?? []) {
    const gap = bracket.rect[0] - (bracket.rows[0] + bracket.rows[2]);
    // 6px beside the rows, up to 24px further to clear content, or just outside a frame edge the rows nearly reach.
    assert.ok(gap >= 0 && gap <= 42, 'a bracket sits away from its rows');
    assert.ok(Math.abs(bracket.rect[1] - bracket.rows[1]) <= 1 && Math.abs(bracket.rect[3] - bracket.rows[3]) <= 1, 'a bracket does not span its rows');
    for (const lift of panel.lifts) assert.equal(intersects(bracket.rect, lift.rect), false, 'a bracket is drawn over a lift');
  }
```

and its leader-end check accepts a bracket leader like any labelled one (no change needed: a bracket always has a label).

Append to `tests/e2e/compose-invariants.test.mjs`:

```js
const rows = [[60, 60, 200, 16], [60, 84, 200, 16], [60, 108, 200, 16]];
const rowBoxes = { r1: rows[0], r2: rows[1], r3: rows[2] };

test('a bracket sits beside its rows, not at the frame edge', { skip }, async () => {
  const report = await board([{ bracket: ['r1', 'r2'], title: 'Two rows' }], { bars: rows, boxes: rowBoxes });
  assertInvariants(report);
  const [bracket] = p0(report).brackets;
  const frameRight = p0(report).capture[0] + p0(report).capture[2];
  assert.equal(bracket.inMargin, false);
  assert.ok(frameRight - (bracket.rect[0] + bracket.rect[2]) > 40, 'the bracket is well inside the frame');
  assert.equal(p0(report).dots.length, 0, 'a bracket needs no dot');
  assert.equal(p0(report).flats.length, 0, 'no wash, so nothing to redraw');
});

test('a bracket slides past content that sits right beside its rows', { skip }, async () => {
  const report = await board([{ bracket: ['r1', 'r2'], title: 'Two rows' }], { bars: [...rows, [264, 60, 10, 40]], boxes: rowBoxes });
  assertInvariants(report);
  assert.ok(p0(report).brackets[0].slid > 0);
  assert.equal(report.warnings.includes('a bracket sits on page content'), false);
});

test('bracketed rows stay readable under a wash', { skip }, async () => {
  const bars = [...rows, [400, 200, 80, 20]];
  const report = await board([{ bracket: ['r1', 'r2'], title: 'Two rows' }, { lift: 'far', title: 'Elsewhere' }], { bars, boxes: { ...rowBoxes, far: bars[3] } });
  assertInvariants(report);
  assert.equal(p0(report).wash, true);
  assert.equal(p0(report).flats.length, 1);
});

test('rows that reach the frame edge put their bracket in the margin', { skip }, async () => {
  const wide = [[400, 60, 196, 16], [400, 84, 196, 16]];
  const report = await board([{ bracket: ['a', 'b'], title: 'Edge rows' }], { bars: wide, boxes: { a: wide[0], b: wide[1] } });
  assertInvariants(report);
  const [bracket] = p0(report).brackets;
  assert.equal(bracket.inMargin, true);
  assert.ok(bracket.rect[0] >= p0(report).capture[0] + p0(report).capture[2], 'the bracket is outside the screenshot');
});
```

Run: `node --test tests/e2e/compose-invariants.test.mjs` → FAIL (`brackets` undefined).

- [ ] **Step 4: Draw brackets**

`lib/compose/page-layout.js`:

1. Move `colourAt`, `differs` and `groundOf` out of `route` into `probes(src, solved, targets)`, called once in `drawPanel` and passed to `route` in `ctx`. `groundOf(index, side)` keeps reading `targets[index].source` and `.pad`. Add:

```js
    // Capture pixels whose centres fall inside a board rect and differ from `ref`.
    const inkIn = ([x, y, w, h], ref) => {
      let ink = 0;
      for (let sy = Math.floor(fy + y / S); sy <= Math.ceil(fy + (y + h) / S); sy += 1) {
        for (let sx = Math.floor(fx + x / S); sx <= Math.ceil(fx + (x + w) / S); sx += 1) {
          const dx = (sx + 0.5 - fx) * S; const dy = (sy + 0.5 - fy) * S;
          if (dx < x || dy < y || dx > x + w || dy > y + h || dx < 0 || dy < 0 || dx > cw || dy > ch) continue;
          if (sx < 0 || sy < 0 || sx >= pixels.width || sy >= pixels.height) continue;
          if (differs((sy * pixels.width + sx) * 4, ref)) ink += 1;
        }
      }
      return ink;
    };
```

2. `sourceOf`: `const bracketMarks = marks.flatMap((mark, markIndex) => ('bracket' in mark ? [{ mark, markIndex, original: union(keysOf(mark, 'bracket').map((k) => boxes[k])) }] : []));`. Their `original` boxes join `sourceMarks`. After `growAvoiding` exists, each gets `const { box, cut } = growAvoiding(b.original, []); b.rows = box;` and a cut pushes `a bracket edge cuts through content` to `src.notes`. In `solve`, `rows` boxes join `markBoxes`.

3. `drawPanel`, after the lifts are drawn (a bracket must see them), with `let gutter = 0;` declared before:

```js
    for (const b of src.bracketMarks) {
      const rowsRect = clip(map(b.rows));
      if (!rowsRect) continue;
      if (panel.wash) {
        const flat = el('div', 'flat', cap); place(flat, ...rowsRect);
        bg(flat, fx + rowsRect[0] / S, fy + rowsRect[1] / S, 1);
        panel.flats.push({ mark: b.markIndex, rect: rowsRect });
      }
      const right = rowsRect[0] + rowsRect[2];
      const edge = [fx + right / S - 1, fy + rowsRect[1] / S, 1, rowsRect[3] / S];
      const ref = probe.groundOf({ source: edge, pad: [0, 0, 0, 0] }, 'right');
      let x = null; let slid = 0; let inMargin = false;
      for (let d = 0; d <= BRACKET_REACH; d += BRACKET_STEP) {
        const at = right + BRACKET_GAP + d;
        if (at + BRACKET_ARM > cw - BRACKET_EDGE) { inMargin = true; break; }
        const strip = [at - 2, rowsRect[1], BRACKET_ARM + 4, rowsRect[3]];
        if (probe.inkIn(strip, ref) === 0 && !targets.some((t) => t.kind === 'lift' && hits(strip, t.rect))) { x = at; slid = d; break; }
      }
      if (inMargin) { x = cw + BRACKET_GAP; gutter = BRACKET_GUTTER; }
      if (x === null) { x = right + BRACKET_GAP; notes.push('a bracket sits on page content'); }
      const rect = [x, rowsRect[1], BRACKET_ARM, rowsRect[3]];
      glyphs.push(rect);
      panel.brackets.push({ mark: b.markIndex, rows: rowsRect, rect, slid, inMargin });
      const source = [fx + x / S, fy + rect[1] / S, BRACKET_ARM / S, rect[3] / S];
      const target = targets.push({ kind: 'bracket', mark: b.markIndex, rect, ring: 0, dot: false, source, pad: [0, 0, 0, 0] }) - 1;
      anchors.push({ mark: b.mark, markIndex: b.markIndex, prefer: ['right', 'bottom'], label: { title: b.mark.title, note: b.mark.note, tag: b.mark.tag }, members: [target] });
    }
```

  `groundOf` accepts a target object as well as an index for this one call; make its first parameter `target` and have `route` pass `targets[index]`. `bg` is the existing source-positioning helper. The `.flat` nodes are appended to `cap` after the wash and so before the slots' and lifts' own nodes only in DOM order under `cap`; lifts live on `comp` and still draw above.

4. `route`:
   - `const preferredFor = (a) => a.prefer ?? preferred;` used wherever `preferred` is read for an anchor.
   - A target with `dot: false` starts its leader on its own edge and never slides: in the anchor loop, `if (!targets[lift].dot) { Object.assign(a, { side: s, primary: lift, at: centre of that side, slid: 0 }); break; }` ahead of the `dotOn` call, and the start point is `[rect right, at]` or `[at, rect bottom]` with no `DOT_OFF`. `leaderFor` draws no dot for such a target.
   - Every right-margin x gains `gutter`: label `x = cw + gutter + 18 + 8 * nR`, track `xm = cw + gutter + 10 + 8 * (nR - 1 - i)`, and the bottom anchors' far lane `{ x: cw + gutter + 10 + 8 * nR }`.
   - After the leaders, draw each rect in `glyphs` on the svg: `M x top L x+ARM top L x+ARM bottom L x bottom`, stroke `#6E56CF`, width 2, `stroke-linejoin: round`, no fill.

5. Report: `brackets: []`, `flats: []` in the initial panel report; `__composeLayout` offsets `brackets[].rows`, `brackets[].rect` and `flats[].rect`.

`lib/compose/page.mjs` CSS: `.flat{position:absolute;background-repeat:no-repeat}`.

- [ ] **Step 5: Run, generate, look**

Run: `node --test tests/e2e/compose-invariants.test.mjs` → PASS.

Run: `UPDATE_GOLDENS=1 node --test --test-name-pattern='bracket-rows|bracket-table' tests/e2e/compose-fixtures.test.mjs`, then Read both goldens.
Check and write down: in `bracket-rows` the bracket hugs the two failing rows, spans exactly their height, and the two rows are at full contrast while the rest is washed; in `bracket-table` the bracket is just outside the frame beside rows 2 and 3 and its leader does not run through it; neither label overlaps the screenshot.

Run: `git status --short tests/fixtures/evidence/goldens` → exactly two new files.

- [ ] **Step 6: Suites, commit**

Run: `npm run test:compose && npm test` → 0 fail.

```bash
git add lib/compose tests
git commit -m "compose: brackets beside the rows they group"
```

---

### Task 6: `loupe`

A ring on a tiny target and a magnified circle in the margin. Its leader routes like a lift's. This is the answer to milestone 1's parked "two neighbouring tiny lifts stay small": a target too small to read in place gets a loupe, and Task 9 says so in the skill.

**Files:**
- Modify: `lib/compose/spec.mjs`, `lib/compose/page-layout.js`, `lib/compose/page.mjs`
- Modify: `tests/unit/compose-spec.test.mjs`, `tests/e2e/helpers/invariants.mjs`, `tests/e2e/compose-invariants.test.mjs`, `tests/e2e/compose-fixtures.test.mjs`
- Create: `tests/fixtures/evidence/specs/loupe-badge.json` (page: the shipped `tiny-badge.html`) and its golden

**Interfaces:**
- Consumes: `targets` with `dot: false` (Task 5), `clip`, `bg`, `route`.
- Produces:
  - Spec: `{ "loupe": "<key>", "zoom"?: 2..8 (default 4), "title"?, "note"?, "tag"? }`.
  - Report: `panel.loupes: [{ mark, target, ring: rect, lens: rect, zoom, asked }]`; a loupe target is `{ kind: 'ring', mark, rect }`.
  - Warning: `a loupe was zoomed out to fit its target`.
  - An anchor may carry `lens: { box, zoom, asked }`; `route` then places a lens block where a label would go.
  - Constants `LENS_D = 110`, `LENS_RING = 4`, `LENS_GAP = 12`, `LOUPE_PAD = 5`, `LOUPE_FILL = 0.8`, `LOUPE_ZOOM = 4`.

- [ ] **Step 1: Validator test, then the rule**

Append to `tests/unit/compose-spec.test.mjs`:

```js
test('a loupe takes one key and a zoom from 2 to 8', () => {
  assert.deepEqual(validateSpec(base([{ loupe: 'name', zoom: 4, title: 'Tiny' }, { loupe: 'phone' }]), [capture()]), []);
  const problems = validateSpec(base([{ loupe: 'name', zoom: 12 }, { loupe: 'name', zoom: '4' }, { loupe: ['name', 'phone'] }]), [capture()]);
  assert.ok(problems.includes('panels[0].marks[0].zoom must be a number from 2 to 8'));
  assert.ok(problems.includes('panels[0].marks[1].zoom must be a number from 2 to 8'));
  assert.ok(problems.includes('panels[0].marks[2] takes exactly one key'));
});
```

Run → FAIL. Add to `RULES`: `loupe: { keys: 'one', words: true, zoom: true },`. Run → PASS.

- [ ] **Step 2: Fixture spec**

`tests/fixtures/evidence/specs/loupe-badge.json`:

```json
{ "state": "AFTER", "title": "The project carries the pinned badge", "layout": "single", "out": "fx-loupe-badge.png",
  "targets": { "badge": "[data-testid=badge]" },
  "page": "tiny-badge",
  "expect": { "loupes": [4] },
  "panels": [{ "marks": [ { "loupe": "badge", "zoom": 4, "title": "Pinned badge", "note": "Marks a pinned project" } ] }] }
```

In `tests/e2e/compose-fixtures.test.mjs`, after the `brackets` check:

```js
      if (fixture.expect?.loupes) assert.deepEqual(board0.loupes.map((l) => l.zoom), fixture.expect.loupes, 'each loupe magnifies as asked');
```

- [ ] **Step 3: Invariants and synthetic tests**

`assertPanel` gains, and its leader-end check uses the lens for a loupe's leader:

```js
  for (const loupe of panel.loupes ?? []) {
    assert.ok(inside(loupe.ring, panel.capture), 'a loupe ring leaves the frame');
    assert.equal(intersects(loupe.lens, panel.capture), false, 'a lens covers the screenshot');
    assert.ok(inside(loupe.lens, stage), 'a lens leaves the stage');
    for (const label of panel.labels) assert.equal(intersects(loupe.lens, label.rect), false, 'a lens covers a label');
  }
  (panel.loupes ?? []).forEach((a, i) => panel.loupes.slice(i + 1).forEach((b) => {
    assert.equal(intersects(a.lens, b.lens), false, 'two lenses overlap');
  }));
```

In the leader loop written in Task 3, replace the label lookup with:

```js
    const lens = (panel.loupes ?? []).find((l) => l.target === leader.target)?.lens;
    const end = lens ?? panel.labels.find((l) => l.target === leader.target)?.rect;
    assert.ok(end, 'a leader ends at a label or a lens');
    assert.ok(rectDistance(leader.points[leader.points.length - 1], end) <= 8, 'a leader stops short of its label');
```

Extend `syntheticCapture` in `tests/e2e/compose-invariants.test.mjs` with tinted bars, so a test can tell one region from another: add a `tints = []` option, each `[x, y, w, h, colour]`, drawn after `bars` with `background:${colour}`.

Append:

```js
import { countOffColor } from './helpers/png-diff.mjs';

test('a loupe rings its target and magnifies it in the margin', { skip }, async () => {
  const bars = [[300, 150, 10, 10]];
  const report = await board([{ loupe: 'tiny', zoom: 4, title: 'Tiny', note: 'Hard to see' }], { bars, boxes: { tiny: bars[0] } });
  assertInvariants(report);
  const [loupe] = p0(report).loupes;
  assert.equal(loupe.zoom, 4);
  assert.ok(Math.abs(loupe.lens[2] - 110) < 0.5 && Math.abs(loupe.lens[3] - 110) < 0.5, 'the lens is 110px across');
  assert.equal(p0(report).dots.length, 0, 'the ring is the marker');
  assert.equal(p0(report).labels.length, 1);
  assert.equal(report.warnings.length, 0);
});

test('a target too large for the lens is zoomed out, with a warning', { skip }, async () => {
  const bars = [[100, 100, 120, 40]];
  const report = await board([{ loupe: 'big', zoom: 8 }], { bars, boxes: { big: bars[0] } });
  assertInvariants(report);
  assert.ok(p0(report).loupes[0].zoom < 8 && p0(report).loupes[0].asked === 8);
  assert.ok(report.warnings.includes('a loupe was zoomed out to fit its target'));
});

test('a lens shows the frame and nothing beyond it', { skip }, async () => {
  const capture = await syntheticCapture({ bars: [[282, 140, 10, 10]], boxes: { tiny: [282, 140, 10, 10] }, tints: [[304, 100, 80, 100, '#dc2626']] });
  const { report, outPath, dir } = await render(spec([{ loupe: 'tiny', zoom: 2 }]), { ...capture, frame: [0, 0, 300, 300] });
  try {
    const scale = (await readFile(outPath)).readUInt32BE(16) / report.stage[2];
    const rect = p0(report).loupes[0].lens.map((v) => Math.round(v * scale));
    const red = await countOffColor({ png: await readFile(outPath), rect, color: [220, 38, 38], tolerance: 90, renderer });
    assert.equal(red.total - red.off, 0, 'the lens shows page that the frame left out');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a loupe over a redacted key magnifies the fill, never the original pixels', { skip }, async () => {
  const bars = [[100, 100, 40, 20]];
  const { report, outPath, dir } = await render(spec([{ redact: 'a' }, { loupe: 'a', zoom: 2 }]), await syntheticCapture({ bars, boxes: { a: bars[0] } }));
  try {
    const scale = (await readFile(outPath)).readUInt32BE(16) / report.stage[2];
    const [x, y, w, h] = p0(report).loupes[0].lens;
    const rect = [x + w / 2 - 6, y + h / 2 - 6, 12, 12].map((v) => Math.round(v * scale));
    const off = await countOffColor({ png: await readFile(outPath), rect, color: [0xCB, 0xD5, 0xE1], tolerance: 24, renderer });
    assert.equal(off.off, 0, 'the middle of the lens is the redaction fill');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

Run: `node --test tests/e2e/compose-invariants.test.mjs` → FAIL (`loupes` undefined).

- [ ] **Step 4: Draw loupes**

`lib/compose/page-layout.js`:

1. `sourceOf`: `const loupeMarks = marks.flatMap((mark, markIndex) => ('loupe' in mark ? [{ mark, markIndex, box: boxes[mark.loupe] }] : []));`. Their boxes join `sourceMarks` and the crop's `markBoxes`, as slots' do.

2. `drawPanel`, after the brackets:

```js
    for (const l of src.loupeMarks) {
      const box = clip(map(l.box));
      if (!box) continue;
      const r = Math.max(box[2], box[3]) / 2 + LOUPE_PAD;
      const cx = Math.min(Math.max(box[0] + box[2] / 2, r), cw - r); const cy = Math.min(Math.max(box[1] + box[3] / 2, r), ch - r);
      const ring = [cx - r, cy - r, 2 * r, 2 * r];
      // The target shows at full contrast inside its ring, wash or no wash.
      const patch = el('div', 'patch', cap); place(patch, ...ring); bg(patch, fx + ring[0] / S, fy + ring[1] / S, 1);
      place(el('div', 'ring', cap), ...ring);
      const asked = l.mark.zoom ?? LOUPE_ZOOM;
      const zoom = Math.max(1, Math.min(asked, (LOUPE_FILL * LENS_D) / Math.max(box[2], box[3])));
      if (zoom < asked - 1e-9) notes.push('a loupe was zoomed out to fit its target');
      const target = targets.push({ kind: 'ring', mark: l.markIndex, rect: ring, ring: 0, dot: false, source: l.box, pad: [0, 0, 0, 0] }) - 1;
      anchors.push({
        mark: l.mark, markIndex: l.markIndex, members: [target],
        label: l.mark.title ? { title: l.mark.title, note: l.mark.note, tag: l.mark.tag } : null,
        lens: { centre: [box[0] + box[2] / 2, box[1] + box[3] / 2], zoom, asked },
      });
    }
```

3. `route`: a margin item is a block. Where the right list computes `const lab = makeLabel(a.label); const r = lab.getBoundingClientRect();`, branch:

```js
      const lab = a.label ? makeLabel(a.label) : null;
      const size = lab ? lab.getBoundingClientRect() : { width: 0, height: 0 };
      const lensWide = a.lens ? LENS_D + (lab ? LENS_GAP : 0) : 0;
      const block = { width: lensWide + size.width, height: Math.max(a.lens ? LENS_D : 0, size.height) };
```

   and use `block.height` for the stacking (`y = Math.max(nextY, cy - block.height / 2, 0); nextY = y + block.height + (a.lens ? 16 : 10)`), `block.width` for `maxR`. With a lens: the lens sits at `[x, y + (block.height - LENS_D) / 2]`, the label at `[x + LENS_D + LENS_GAP, y + block.height / 2 - size.height / 2]`, and the leader's last two points are `[xm, ey]` and `[x - LENS_RING - 2, ey]` with `ey` the lens's centre height. The bottom list is the same turned a quarter: lens at `[x, y]`, label to its right, `nextX = x + block.width + 20`, leader ending at `[x + LENS_D / 2, y - LENS_RING - 2]`. Without a lens nothing changes.

   Drawing a lens at `[lx, ly]`:

```js
    const drawLens = (a, lx, ly) => {
      const lens = el('div', `lens${dark ? ' dark' : ''}`, comp); place(lens, lx, ly, LENS_D, LENS_D);
      // Only the shown frame is drawn inside the lens, so the lens cannot show page that the crop left out.
      const view = el('div', 'lensview', lens); const z = a.lens.zoom;
      place(view, LENS_D / 2 - a.lens.centre[0] * z, LENS_D / 2 - a.lens.centre[1] * z, cw * z, ch * z);
      bg(view, fx, fy, z);
      const chip = el('div', 'ztag', comp, `${Math.round(z * 10) / 10}×`); place(chip, lx + LENS_D - 30, ly + LENS_D - 14);
      report.loupes.push({ mark: a.markIndex, target: a.primary, ring: targets[a.primary].rect, lens: [lx, ly, LENS_D, LENS_D], zoom: z, asked: a.lens.asked });
    };
```

   A label is pushed to `report.labels` only when `lab` exists.

4. Report: `loupes: []` initially; `__composeLayout` offsets `loupes[].ring` and `loupes[].lens`.

`lib/compose/page.mjs` CSS:

```css
.patch{position:absolute;border-radius:999px;background-repeat:no-repeat}
.ring{position:absolute;border:2px solid var(--accent);border-radius:999px}
.lens{position:absolute;border-radius:999px;overflow:hidden;background:#F1F5F9;box-shadow:0 0 0 4px #fff,0 12px 28px rgba(30,27,75,.35)}
.lens.dark{background:#0F172A;box-shadow:0 0 0 4px #4B4670,0 12px 28px rgba(0,0,0,.5)}
.lensview{position:absolute;background-repeat:no-repeat}
.ztag{position:absolute;padding:2px 6px;border-radius:999px;background:var(--ink);color:#fff;font-size:10px;font-weight:700}
```

- [ ] **Step 5: Run, generate, look**

Run: `node --test tests/e2e/compose-invariants.test.mjs` → PASS.

Run: `UPDATE_GOLDENS=1 node --test --test-name-pattern='loupe-badge' tests/e2e/compose-fixtures.test.mjs`, then Read `goldens/loupe-badge.png`.
Check and write down: the ring is on the badge and only the badge; the lens shows the badge sharp enough to read and nothing cut off; the leader leaves the ring, turns in the margin and ends on the lens edge without crossing page text; the label sits beside the lens; the zoom chip reads `4×` and does not cover the badge in the lens.

Run: `git status --short tests/fixtures/evidence/goldens` → one new file.

- [ ] **Step 6: Suites, commit**

Run: `npm run test:compose && npm test` → 0 fail.

```bash
git add lib/compose tests
git commit -m "compose: loupe with a lens that stays inside the frame"
```

---

### Task 7: `link`

One connector between two lifts, one label. A link is a two-key lift whose two lifts are never clustered and never merged.

**Files:**
- Modify: `lib/compose/spec.mjs`, `lib/compose/page-layout.js`
- Modify: `tests/unit/compose-spec.test.mjs`, `tests/e2e/helpers/invariants.mjs`, `tests/e2e/compose-invariants.test.mjs`, `tests/e2e/compose-fixtures.test.mjs`
- Create: `tests/fixtures/evidence/pages/link-version.html`, `tests/fixtures/evidence/specs/link-version.json`, and its golden

**Interfaces:**
- Consumes: `liftMarks`, `groups`, `settle`'s merge loop, the leader and connector (Tasks 1 and 3).
- Produces: Spec `{ "link": ["<keyA>", "<keyB>"], "title": "<required>", "note"?, "tag"? }`; report `panel.links: [{ mark, targets: [i, j] }]`; a group may carry `separate: true`.

- [ ] **Step 1: Validator test, then the rule**

```js
test('a link joins exactly two different keys under one title', () => {
  assert.deepEqual(validateSpec(base([{ link: ['name', 'phone'], title: 'Same fact, two places' }]), [capture()]), []);
  const problems = validateSpec(base([{ link: ['name'], title: 'One' }, { link: ['name', 'name'], title: 'Twice' }, { link: ['name', 'phone'] }]), [capture()]);
  assert.ok(problems.includes('panels[0].marks[0] takes exactly two different keys'));
  assert.ok(problems.includes('panels[0].marks[1] takes exactly two different keys'));
  assert.ok(problems.includes('panels[0].marks[2].title is required'));
});
```

Run → FAIL. Add to `RULES`: `link: { keys: 'two', words: true, title: 'required' },`. Run → PASS.

- [ ] **Step 2: Fixture page and spec**

`tests/fixtures/evidence/pages/link-version.html`:

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif;background:#f6f7f9}
.card{margin:40px;width:520px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}
.head{display:flex;gap:10px;align-items:center;padding:16px 20px}
h3{margin:0;font-size:16px}
.chip{padding:2px 9px;border-radius:999px;background:#e0e7ff;color:#3730a3;font-size:12px}
table{width:100%;border-collapse:collapse}
td{padding:9px 20px;border-top:1px solid #eef0f3}
td span{display:inline-block}</style>
<div class="card" data-testid="deploys"><div class="head"><h3>Deploys</h3><span class="chip" data-testid="head-version">v2.4.1</span></div>
  <table>
    <tr><td>Production</td><td><span>v2.3.9</span></td><td>4 days ago</td></tr>
    <tr><td>Staging</td><td><span data-testid="row-version">v2.4.1</span></td><td>2 hours ago</td></tr>
    <tr><td>Preview</td><td><span>v2.5.0</span></td><td>10 minutes ago</td></tr>
  </table>
</div>
```

`tests/fixtures/evidence/specs/link-version.json`:

```json
{ "state": "AFTER", "title": "The header shows the version that staging runs", "layout": "single", "out": "fx-link-version.png",
  "targets": { "head": "[data-testid=head-version]", "row": "[data-testid=row-version]" },
  "expect": { "links": 1 },
  "panels": [{ "marks": [ { "link": ["head", "row"], "title": "Same version, two places", "tag": "OK" } ] }] }
```

In `tests/e2e/compose-fixtures.test.mjs`, after the `loupes` check: `if (fixture.expect?.links !== undefined) assert.equal(board0.links.length, fixture.expect.links, 'each link is drawn');`. The existing `fixture.panels[0].marks.flatMap((m, i) => ('lift' in m ? [i] : []))` and the `marks.some((m) => m.lift)` checks stay about `lift` marks only.

- [ ] **Step 3: Invariant and synthetic tests**

`assertPanel` gains:

```js
  for (const link of panel.links ?? []) {
    assert.equal(link.targets.length, 2, 'a link has two lifts');
    assert.ok(link.targets.every((i) => panel.targets[i].kind === 'lift' && !panel.lifts[panel.targets[i].lift].merged), 'a link merged its two lifts');
    const leaders = panel.leaders.filter((l) => panel.targets[l.target].mark === link.mark);
    assert.equal(leaders.length, 1, 'a link has one leader');
    assert.deepEqual([...leaders[0].targets].sort(), [...link.targets].sort(), "a link's leader serves both lifts");
    assert.equal(panel.connectors.filter((c) => link.targets.includes(c.target)).length, 1, 'a link has one connector');
  }
```

Append to `tests/e2e/compose-invariants.test.mjs`:

```js
test('a link keeps two lifts where a lift of the same keys would make one', { skip }, async () => {
  const bars = [[100, 100, 60, 20], [166, 100, 60, 20]];
  const boxes = { a: bars[0], b: bars[1] };
  const lifted = await board([{ lift: ['a', 'b'], title: 'Together' }], { bars, boxes });
  assert.equal(p0(lifted).lifts.length, 1, 'adjacent keys in one lift mark cluster');
  const linked = await board([{ link: ['a', 'b'], title: 'Linked' }], { bars, boxes });
  assert.equal(p0(linked).lifts.length, 2);
  assert.equal(p0(linked).links.length, 1);
  assert.equal(p0(linked).labels.length, 1);
  assert.equal(p0(linked).connectors.length, 1);
});

test('a link across the frame holds every invariant', { skip }, async () => {
  const bars = [[40, 40, 60, 20], [420, 220, 60, 20]];
  const report = await board([{ link: ['a', 'b'], title: 'Same fact, two places' }], { size: [600, 400], bars, boxes: { a: bars[0], b: bars[1] } });
  assertInvariants(report);
  assert.equal(p0(report).links.length, 1);
});
```

Run → FAIL (`links` undefined; the link mark draws nothing).

- [ ] **Step 4: Draw links**

`lib/compose/page-layout.js`:

- `const liftKind = (mark) => ('lift' in mark ? 'lift' : 'link' in mark ? 'link' : null);`. `liftMarks` keeps every mark with a `liftKind`, and each entry carries `kind`. Every `keysOf(mark, 'lift')` in `sourceOf` and `solve` becomes `keysOf(mark, kind)`.
- Clustering: a link skips `clusterBoxes`; its clusters are `[[0], [1]]`, and its groups carry `separate: true`.
- `settle`: `collidingLifts` pairs where either group is `separate` are dropped before the merge guard.
- `drawPanel`: after the lifts, `for each link mark: panel.links.push({ mark: markIndex, targets: <the two target indexes of its lifts> })`. `links: []` in the initial report.

No routing change: a link's two lifts are one anchor with two members, which the router already draws as a leader from one and a connector from the other.

- [ ] **Step 5: Run, generate, look**

Run: `node --test tests/e2e/compose-invariants.test.mjs` → PASS.

Run: `UPDATE_GOLDENS=1 node --test --test-name-pattern='link-version' tests/e2e/compose-fixtures.test.mjs`, then Read `goldens/link-version.png`.
Check and write down: both versions are lifted and readable, one label, the connector joins the second lift to the leader without running through the table's text, and it reads as "these two are the same thing". If the connector's route reads as a tangle, say so in the report; the controller decides whether it is a routing fix or a fixture change.

- [ ] **Step 6: Suites, commit**

Run: `npm run test:compose && npm test` → 0 fail.

```bash
git add lib/compose tests
git commit -m "compose: link, two lifts under one label that never merge"
```

---

### Task 8: `pair` and `steps` layouts, and the common-height rule

**Files:**
- Modify: `lib/compose/spec.mjs`, `lib/compose/page-geometry.js`, `lib/compose/page-layout.js`, `lib/compose/page.mjs`
- Modify: `tests/unit/compose-spec.test.mjs`, `tests/unit/compose-geometry.test.mjs`, `tests/e2e/helpers/invariants.mjs`, `tests/e2e/compose-invariants.test.mjs`, `tests/e2e/compose-fixtures.test.mjs`
- Create pages: `status-before.html`, `status-after.html`, `theme-light.html`, `theme-dark.html`, `flow-list.html`, `flow-detail.html`, `flow-confirm.html`; specs `pair-before-after.json`, `pair-light-dark.json`, `steps-flow.json`; their goldens

**Interfaces:**
- Consumes: `sourceOf`, `settle`, `drawPanel`, `singleScale` (Task 1).
- Produces:
  - `commonHeight(frames) -> { height, floored }` on `__composeGeometry`, with `PANEL_BUDGET = 1120`, `PANEL_MIN_H = 96`, `PANEL_MAX_H = 360`, `PANEL_MAX_S = 1.25`.
  - Spec: `layout: "single" | "pair" | "steps"`; `panels[].label?: text, at most 48 characters`.
  - Report: `report.layout`, `report.arrows: [rect]`, `panel.extent: rect` (the panel column, head included), `panel.head: { rect, number: n | null } | null`.
  - Warning: `the panels differ too much in shape to share a height well`.
  - Fixture format: a panel may carry `fixture: { page, targets, frame }`; the suite captures one sidecar per panel, named `<fixture>.c<n>`.
  - Constants `HEAD_H = 22`, `ARROW_D = 40`.

- [ ] **Step 1: Unit tests for the height rule**

Append to `tests/unit/compose-geometry.test.mjs`:

```js
const commonHeight = (frames) => ({ ...sandbox.__composeGeometry.commonHeight(frames) });

test('two frames of one shape share the height their width budget allows', () => {
  assert.deepEqual(commonHeight([[0, 0, 600, 300], [0, 0, 600, 300]]), { height: 280, floored: false });
});

test('a frame three times the size of its neighbour gets the same height', () => {
  assert.deepEqual(commonHeight([[0, 0, 1800, 900], [10, 10, 600, 300]]), { height: 280, floored: false });
});

test('small frames are not blown up past 1.25x', () => {
  assert.deepEqual(commonHeight([[0, 0, 300, 120], [0, 0, 300, 120]]), { height: 150, floored: false });
});

test('tall frames stop at 360', () => {
  assert.equal(commonHeight([[0, 0, 300, 600], [0, 0, 300, 600]]).height, 360);
});

test('a strip beside a card floors the height at 96 and says so', () => {
  assert.deepEqual(commonHeight([[0, 0, 1500, 75], [0, 0, 450, 100]]), { height: 96, floored: true });
});
```

Run: `node --test tests/unit/compose-geometry.test.mjs` → FAIL (`commonHeight is not a function`).

- [ ] **Step 2: Implement `commonHeight`**

In `lib/compose/page-geometry.js`, exported on `__composeGeometry`:

```js
  const PANEL_BUDGET = 1120;
  const PANEL_MIN_H = 96;
  const PANEL_MAX_H = 360;
  const PANEL_MAX_S = 1.25;

  // The one height every panel of a pair or steps board is drawn at, whatever
  // each frame's own size: the board's width budget shared by the frames'
  // shapes, never enlarging the shortest frame past PANEL_MAX_S. `floored`
  // says the shapes needed less than PANEL_MIN_H, so the board runs wide.
  function commonHeight(frames) {
    const shapes = frames.reduce((sum, f) => sum + f[2] / f[3], 0);
    const shortest = Math.min(...frames.map((f) => f[3]));
    const wanted = Math.min(PANEL_MAX_H, PANEL_MAX_S * shortest, PANEL_BUDGET / shapes);
    return { height: Math.max(PANEL_MIN_H, Math.round(wanted)), floored: PANEL_BUDGET / shapes < PANEL_MIN_H };
  }
```

Run → PASS.

- [ ] **Step 3: Validator tests, then the rules**

In `tests/unit/compose-spec.test.mjs`, the two expectations that pin the single layout change: `'layout must be single in this version'` becomes `'layout must be one of single, pair, steps'`, and `'panels must list exactly one panel in this version'` becomes `'a single layout takes exactly one panel'`. Append:

```js
const two = (layout, panels) => ({ state: 'BEFORE → AFTER', title: 'A board', layout, out: 'b.png', panels });
const panel = (over = {}) => ({ capture: 'c.capture.json', marks: [], ...over });

test('a pair takes two labelled panels and steps takes two to four', () => {
  assert.deepEqual(validateSpec(two('pair', [panel({ label: 'BEFORE' }), panel({ label: 'AFTER' })]), [capture(), capture()]), []);
  assert.deepEqual(validateSpec(two('steps', [panel(), panel({ label: 'Open the menu' }), panel()]), [capture(), capture(), capture()]), []);
  assert.ok(validateSpec(two('pair', [panel({ label: 'BEFORE' })]), [capture()]).includes('a pair layout takes exactly two panels'));
  assert.ok(validateSpec(two('pair', [panel({ label: 'BEFORE' }), panel()]), [capture(), capture()]).includes('panels[1].label is required in a pair layout'));
  assert.ok(validateSpec(two('steps', [panel()]), [capture()]).includes('a steps layout takes two to four panels'));
  assert.ok(validateSpec(two('steps', [panel(), panel(), panel(), panel(), panel()]), Array(5).fill(capture())).includes('a steps layout takes two to four panels'));
});

test('a panel label is short text, and each panel checks its own capture', () => {
  const problems = validateSpec(two('pair', [panel({ label: 'x'.repeat(49) }), panel({ label: 7, marks: [{ lift: 'phone' }] })]),
    [capture(), capture({ boxes: { name: [0, 0, 5, 5] } })]);
  assert.ok(problems.includes('panels[0].label must be text of at most 48 characters'));
  assert.ok(problems.includes('panels[1].label must be text of at most 48 characters'));
  assert.ok(problems.includes('panels[1].marks[0] names a key the capture did not measure'));
});
```

Run → FAIL. In `lib/compose/spec.mjs`:

```js
export const LAYOUTS = Object.freeze({ single: [1, 1], pair: [2, 2], steps: [2, 4] });
const COUNT = Object.freeze({ single: 'a single layout takes exactly one panel', pair: 'a pair layout takes exactly two panels', steps: 'a steps layout takes two to four panels' });
```

replacing the two single-only checks:

```js
  const layout = spec.layout ?? 'single';
  if (!(layout in LAYOUTS)) problems.push(`layout must be one of ${Object.keys(LAYOUTS).join(', ')}`);
  const panels = Array.isArray(spec.panels) ? spec.panels : [];
  if (layout in LAYOUTS && (panels.length < LAYOUTS[layout][0] || panels.length > LAYOUTS[layout][1])) problems.push(COUNT[layout]);
```

and, first thing in the per-panel loop:

```js
    if (panel?.label !== undefined && !(nonEmpty(panel.label) && panel.label.length <= 48)) problems.push(`panels[${p}].label must be text of at most 48 characters`);
    else if (layout === 'pair' && panel?.label === undefined) problems.push(`panels[${p}].label is required in a pair layout`);
```

Run → PASS.

- [ ] **Step 4: Teach the fixture suite about several panels**

In `tests/e2e/compose-fixtures.test.mjs`, replace the single `captureLive` call and the `spec` construction:

```js
      const name = path.basename(file, '.json');
      const inputs = fixture.panels.map((panel, i) => panel.fixture ?? (i === 0 ? { page: fixture.page, targets: fixture.targets, frame: fixture.frame } : {}));
      const taken = [];
      const browser = await chromium.launch({ headless: true, executablePath: renderer.executablePath });
      try {
        for (const [i, input] of inputs.entries()) {
          taken.push(await captureLive({ browser, pageName: input.page ?? name, targets: input.targets, frame: input.frame, out: `${name}.c${i + 1}`, home, paths }));
        }
      } finally { await browser.close(); }
      const { captureReturn } = taken[0];
      const spec = { ...fixture, panels: fixture.panels.map(({ fixture: _input, ...panel }, i) => ({ ...panel, capture: path.basename(taken[i].sidecar) })) };
      delete spec.targets; delete spec.page; delete spec.expect; delete spec.frame;
```

Every assertion below it keeps reading `captureReturn` and `board0`, so it checks panel 1 of a multi-panel fixture exactly as it checks a single board. After `assertInvariants(layoutReport);` add:

```js
      assert.equal(layoutReport.panels.length, fixture.panels.length, 'one drawn panel per spec panel');
      if (fixture.expect?.dark) assert.deepEqual(layoutReport.panels.map((p) => p.dark), fixture.expect.dark, 'each panel takes its own capture\'s wash');
```

- [ ] **Step 5: Fixture pages and specs**

All seven pages share this head; only the body differs:

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif;background:#f6f7f9;color:#111827}
.card{margin:40px;width:420px;padding:20px;background:#fff;border:1px solid #e5e7eb;border-radius:12px}
h3{margin:0 0 12px;font-size:16px}
.row{display:flex;justify-content:space-between;padding:6px 0}
.chip{padding:2px 9px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px}
.muted{color:#6b7280}
button{font:inherit;height:32px;padding:0 14px;border:1px solid #d1d5db;border-radius:6px;background:#fff}
.dark{background:#0b1020;color:#e5e7eb}.dark .card{background:#111827;border-color:#1f2937}.dark .muted{color:#9ca3af}</style>
```

- `status-before.html` body: `<div class="card" data-testid="deploy"><h3>Deploy status</h3><div class="row"><span>Service</span><span>Tracker API</span></div><div class="row"><span>Status</span><span data-testid="status" style="display:inline-block;width:120px;height:20px"></span></div><div class="row"><span class="muted">Last deploy</span><span class="muted">2 hours ago</span></div></div>`
- `status-after.html` body: the same card with `<span class="chip" data-testid="status">Healthy</span>` as the status.
- `theme-light.html` body: `<div class="card" data-testid="plan"><h3>Plan</h3><div class="row"><span>Seats</span><span data-testid="seats">12 of 20 used</span></div><div class="row"><span class="muted">Renews</span><span class="muted">in 18 days</span></div></div>`
- `theme-dark.html`: the same body, with `<body class="dark">`.
- `flow-list.html` body: `<div class="card" data-testid="list"><h3>Projects</h3><div class="row"><span data-testid="project">Atlas rewrite</span><span class="muted">14 tasks</span></div><div class="row"><span>Docs refresh</span><span class="muted">6 tasks</span></div></div>`
- `flow-detail.html` body: `<div class="card" data-testid="detail"><h3>Atlas rewrite</h3><div class="row"><span class="muted">14 tasks, 3 overdue</span><button data-testid="archive">Archive project</button></div></div>`
- `flow-confirm.html` body: `<div class="card" data-testid="confirm"><h3>Archive this project?</h3><p class="muted">Its 14 tasks become read-only.</p><div class="row"><button>Cancel</button><button data-testid="confirm-button">Archive</button></div></div>`

`tests/fixtures/evidence/specs/pair-before-after.json`:

```json
{ "state": "BEFORE → AFTER", "title": "The deploy card now shows its status", "layout": "pair", "out": "fx-pair-before-after.png",
  "panels": [
    { "label": "BEFORE", "fixture": { "page": "status-before", "targets": { "status": "[data-testid=status]" }, "frame": "[data-testid=deploy]" },
      "marks": [ { "empty": "status", "text": "No status" } ] },
    { "label": "AFTER", "fixture": { "page": "status-after", "targets": { "status": "[data-testid=status]" }, "frame": "[data-testid=deploy]" },
      "marks": [ { "lift": "status", "title": "Status shown", "tag": "NEW" } ] } ] }
```

`tests/fixtures/evidence/specs/pair-light-dark.json`:

```json
{ "state": "AFTER", "title": "Seat usage reads the same in both themes", "layout": "pair", "out": "fx-pair-light-dark.png",
  "expect": { "dark": [false, true] },
  "panels": [
    { "label": "LIGHT", "fixture": { "page": "theme-light", "targets": { "seats": "[data-testid=seats]" }, "frame": "[data-testid=plan]" },
      "marks": [ { "lift": "seats", "title": "12 of 20" } ] },
    { "label": "DARK", "fixture": { "page": "theme-dark", "targets": { "seats": "[data-testid=seats]" }, "frame": "[data-testid=plan]" },
      "marks": [ { "lift": "seats", "title": "12 of 20" } ] } ] }
```

`tests/fixtures/evidence/specs/steps-flow.json`:

```json
{ "state": "FLOW", "title": "Archiving a project asks before it acts", "layout": "steps", "out": "fx-steps-flow.png",
  "panels": [
    { "label": "Open the project", "fixture": { "page": "flow-list", "targets": { "project": "[data-testid=project]" }, "frame": "[data-testid=list]" },
      "marks": [ { "lift": "project", "title": "Start here" } ] },
    { "label": "Choose Archive", "fixture": { "page": "flow-detail", "targets": { "archive": "[data-testid=archive]" }, "frame": "[data-testid=detail]" },
      "marks": [ { "lift": "archive", "title": "Archive" } ] },
    { "label": "Confirm", "fixture": { "page": "flow-confirm", "targets": { "confirm": "[data-testid=confirm-button]" }, "frame": "[data-testid=confirm]" },
      "marks": [ { "lift": "confirm", "title": "Asks first", "tag": "NEW" } ] } ] }
```

- [ ] **Step 6: Invariants and synthetic tests**

`assertInvariants` (the report-level function) gains:

```js
  for (const panel of report.panels) if (panel.extent) assert.ok(inside(panel.extent, report.stage), 'a panel leaves the stage');
  if (report.panels.length > 1) {
    const heights = report.panels.map((p) => p.capture[3]); const tops = report.panels.map((p) => p.capture[1]);
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 0.5, 'panels differ in height');
    assert.ok(Math.max(...tops) - Math.min(...tops) <= 0.5, 'panels do not line up');
    report.panels.forEach((a, i) => report.panels.slice(i + 1).forEach((b) => {
      assert.equal(intersects(a.extent, b.extent), false, 'two panels overlap');
    }));
    for (const arrow of report.arrows) {
      assert.ok(inside(arrow, report.stage), 'an arrow leaves the stage');
      for (const panel of report.panels) assert.equal(intersects(arrow, panel.extent), false, 'an arrow covers a panel');
    }
    assert.equal(report.arrows.length, report.layout === 'steps' ? report.panels.length - 1 : 0, 'steps are joined by arrows, pairs are not');
  }
```

Append to `tests/e2e/compose-invariants.test.mjs`:

```js
const multi = (layout, panels, title = 'Board') => ({ state: 'FLOW', title, layout, out: 'o.png', panels: panels.map((marks, i) => ({ label: `Panel ${i + 1}`, capture: `c${i}.json`, marks })) });

test('a pair draws two captures of very different sizes at one height', { skip }, async () => {
  const big = await syntheticCapture({ size: [1800, 900], bars: [[300, 300, 600, 60]], boxes: { a: [300, 300, 600, 60] } });
  const small = await syntheticCapture({ size: [600, 300], bars: [[100, 100, 200, 20]], boxes: { a: [100, 100, 200, 20] } });
  const { report, pixels, dir } = await render(multi('pair', [[], [{ lift: 'a', title: 'After' }]]), [big, small]);
  try {
    assertInvariants(report);
    assert.equal(report.panels.length, 2);
    assert.equal(report.panels[0].capture[3], report.panels[1].capture[3]);
    assert.equal(report.arrows.length, 0);
    assert.equal(pixels.width, Math.round(report.stage[2] * 2));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a strip beside a card shares the floor height and the board says the shapes clash', { skip }, async () => {
  const strip = await syntheticCapture({ size: [1500, 75], bars: [[40, 30, 200, 14]], boxes: { a: [40, 30, 200, 14] } });
  const card = await syntheticCapture({ size: [450, 300], bars: [[40, 40, 200, 20]], boxes: { a: [40, 40, 200, 20] } });
  const { report, pixels, dir } = await render(multi('pair', [[], []]), [strip, card]);
  try {
    assertInvariants(report);
    assert.equal(report.panels[0].capture[3], 96);
    assert.ok(report.warnings.includes('the panels differ too much in shape to share a height well'));
    assert.equal(pixels.width, Math.round(report.stage[2] * 2), 'the whole board is in the PNG');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('four labelled steps render whole, even wider than the renderer viewport', { skip }, async () => {
  const captures = [];
  // A lift that fills most of a squarish frame keeps the frame uncropped and its label on the right, the widest arrangement.
  for (let i = 0; i < 4; i += 1) captures.push(await syntheticCapture({ size: [400, 300], bars: [[40, 40, 300, 200]], boxes: { a: [40, 40, 300, 200] } }));
  const long = 'A label title long enough to take its full width';
  const { report, pixels, dir } = await render(multi('steps', captures.map(() => [{ lift: 'a', title: long, note: long }])), captures);
  try {
    assertInvariants(report);
    assert.equal(report.arrows.length, 3);
    assert.deepEqual(report.panels.map((p) => p.head.number), [1, 2, 3, 4]);
    assert.equal(pixels.width, Math.round(report.stage[2] * 2), 'no panel was clipped by the viewport');
    assert.equal(pixels.height, Math.round(report.stage[3] * 2));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a single board with a panel label draws a head and nothing else changes', { skip }, async () => {
  const one = { state: 'AFTER', title: 'Board', layout: 'single', out: 'o.png', panels: [{ label: 'AFTER', capture: 'c.json', marks: [{ lift: 'a', title: 'First' }] }] };
  const { report, dir } = await render(one, await syntheticCapture());
  try { assertInvariants(report); assert.ok(report.panels[0].head); assert.equal(report.panels[0].head.number, null); } finally { await rm(dir, { recursive: true, force: true }); }
});
```

Run → FAIL (one panel drawn, no `extent`).

- [ ] **Step 7: Draw the row of panels**

`lib/compose/page-layout.js`, in `__composeLayout`, replacing the `solved` line:

```js
    const layout = spec.layout ?? 'single';
    let solved = sources.map((src) => settle(src, singleScale));
    if (sources.length > 1) {
      const { height, floored } = commonHeight(solved.map((s) => s.frame));
      if (floored) warnings.push('the panels differ too much in shape to share a height well');
      solved = sources.map((src) => settle(src, (frame) => height / frame[3]));
    }
    const arrows = [];
    const drawn = sources.map((src, i) => {
      if (layout === 'steps' && i > 0) {
        const arrow = el('div', 'arrow', row, '→');
        arrow.style.marginTop = `${HEAD_H + 8 + solved[i].ch / 2 - ARROW_D / 2}px`;
        arrows.push(arrow);
      }
      return drawPanel(src, solved[i], row, { number: layout === 'steps' ? i + 1 : null, headed: layout !== 'single' || Boolean(src.panel.label) });
    });
```

`drawPanel(src, solved, host, head)`: when `head.headed`, before the comp:

```js
    const phead = el('div', 'phead', col);
    if (head.number) el('span', 'num', phead, String(head.number));
    if (src.panel.label) el('span', 'plabel', phead, src.panel.label);
```

and it returns `col` and `phead` so `__composeLayout` can measure `extent` (the column's rect) and `head: { rect, number }` (or `null`) against the stage after `document.fonts.ready`, exactly as it measures the comp. `report.arrows` is each arrow node's rect against the stage; `report.layout = layout`.

Because `S = height / frame[3]`, `ch = Math.round(fh * S)` is `height` for every panel, which is what the invariant checks.

`lib/compose/page.mjs` CSS:

```css
.phead{display:flex;gap:8px;align-items:center;height:22px}
.plabel{font-size:11px;font-weight:700;letter-spacing:.8px;color:var(--muted);white-space:nowrap}
.num{flex:none;width:22px;height:22px;border-radius:999px;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
.arrow{flex:none;width:40px;height:40px;border-radius:999px;background:#fff;box-shadow:0 4px 12px rgba(30,27,75,.15);display:flex;align-items:center;justify-content:center;color:var(--accent);font-size:20px;font-weight:700}
.panel{flex:none}
```

If the four-step test shows a PNG narrower than twice the stage, the stage was clipped: raise the page's viewport in `lib/compose/engine.mjs` from `{ width: 2400, height: 1600 }` to `{ width: 4800, height: 2400 }` and rerun every golden (`UPDATE_GOLDENS=1`, then `git status --short` must show no existing golden changed).

- [ ] **Step 8: Run, generate, look**

Run: `node --test tests/e2e/compose-invariants.test.mjs` → PASS.

Run: `UPDATE_GOLDENS=1 node --test --test-name-pattern='pair-|steps-' tests/e2e/compose-fixtures.test.mjs`, then Read the three goldens.
Check and write down, per board: the two or three captures are the same height and line up at the top; heads read BEFORE and AFTER, LIGHT and DARK, or 1, 2, 3 with their labels; in `pair-light-dark` the dark panel has the dark wash and the dark lift ring; in `steps-flow` each arrow chip sits between its panels at mid-height; no label of one panel runs into the next panel; nothing is cramped or stranded. A board that is correct by the invariants and still reads badly is reported as such.

Run: `git status --short tests/fixtures/evidence/goldens` → three new files, no existing golden changed.

- [ ] **Step 9: Suites, commit**

Run: `npm run test:compose && npm test` → 0 fail.

```bash
git add lib/compose tests
git commit -m "compose: pair and steps layouts at a common height"
```

---

### Task 9: The skill learns the marks and the layouts

The driver's only instructions are `skills/composing-evidence/SKILL.md`. Milestone 2 owns pipeline steps 2, 3 and 4 of that file; this task does not change a character of them.

**Files:**
- Modify: `skills/composing-evidence/SKILL.md`, `tests/unit/skills.test.mjs` (the last six assertions of one test), `lib/compose/spec.mjs` (drop `MARK_KINDS_M1`), `tests/skills/composing-evidence/red.md`, `tests/skills/composing-evidence/green.md`
- Test: `node --test tests/unit/skills.test.mjs`

**Interfaces:**
- Consumes: `MARK_KINDS`, `LAYOUTS` from `lib/compose/spec.mjs` (Tasks 4 to 8).
- Produces: the skill sections `## Spec`, `### Layouts`, `### Marks` that Task 14 extends.

- [ ] **Step 1: Load the skill-writing skill**

REQUIRED SUB-SKILL: invoke `superpowers:writing-skills` before touching the file, and follow its RED, GREEN, refactor order below.

- [ ] **Step 2: RED, on paper**

Dispatch three fresh agents (`general-purpose`, `sonnet`, `medium`), each given the *current* `SKILL.md` text and this prompt, with no other context:

> You have captured one page and the capture's `boxes` has the keys `row1`, `row2`, `row3`, `badge`, `total`, `rowTotal`, `gap`. You have a second capture of the same card in dark theme with the same keys. Write the compose spec JSON for each brief. Reply with JSON only.
> 1. Rows 2 and 3 are the ones that changed; mark them as a group.
> 2. The badge is 12 px wide; make it readable.
> 3. The total in the header and the total in row 3 are the same number; show that.
> 4. An Export button used to sit in the gap; show that it is gone.
> 5. Show the card in light and in dark theme as one image.

Record in `tests/skills/composing-evidence/red.md`, under a new heading `## 2026-10: marks and layouts (milestone 3)`, what each agent wrote per brief: which mark kinds, whether it invented fields, whether it made one board or two for brief 5. Expected: lifts everywhere, two separate boards for brief 5.

- [ ] **Step 3: Pin the new contract in the unit test**

In `tests/unit/skills.test.mjs`, test `composing-evidence states the compose contract and the blind-run lessons`: the import line becomes `const { STATES, TAGS, MARK_KINDS, LAYOUTS } = await import('../../lib/compose/spec.mjs');`, and the two statements from `assert.deepEqual([...MARK_KINDS_M1], ['lift', 'redact']);` through the end of the `unsupported` loop are replaced by:

```js
  for (const kind of MARK_KINDS) assert.ok(text.includes(`\`${kind}\``), kind);
  for (const layout of Object.keys(LAYOUTS)) assert.ok(text.includes(`\`${layout}\``), layout);
  assert.match(text, phrase('too small to read'));
  assert.match(text, phrase('exactly two keys'));
  assert.match(text, phrase('One capture per panel'));
  assert.match(text, phrase('the same selectors and the same frame selector'));
  assert.match(text, phrase('all panels at one height'));
```

Nothing above those lines changes. Run: `node --test tests/unit/skills.test.mjs` → FAIL on `bracket`.

- [ ] **Step 4: Rewrite the Spec section**

In `skills/composing-evidence/SKILL.md`:

The second paragraph's last sentence, "You never place anything by pixel, and you never type a number into a spec.", becomes "On a live page you never place anything by pixel."

Step 6 gains one sentence after "Read any warnings it prints.": "Each warning names something compose could not lay out well; a tighter frame or a different mark usually clears it."

Step 7's check list gains, after "labels sit outside the screenshot": "every panel shows the same region its neighbour does,".

Replace everything from `## Spec` up to, not including, `## Done means` with:

````markdown
## Spec

```json
{
  "state": "BEFORE → AFTER",
  "title": "One sentence: what this board proves",
  "layout": "pair",
  "out": "<board>.png",
  "panels": [
    { "label": "BEFORE", "capture": "<board>.c1.capture.json",
      "marks": [ { "empty": "chart", "text": "Nothing rendered here" } ] },
    { "label": "AFTER", "capture": "<board>.c2.capture.json",
      "marks": [
        { "lift": "status", "title": "Short label", "note": "One line", "tag": "CHANGED" },
        { "lift": ["owner", "role"], "title": "One point, two elements" },
        { "bracket": ["row2", "row3"], "title": "Two rows", "note": "One line" },
        { "loupe": "badge", "zoom": 4, "title": "Tiny badge" },
        { "link": ["total", "rowTotal"], "title": "Same number, two places" },
        { "ghost": "gap", "tag": "REMOVED", "title": "Export is gone" },
        { "redact": "email" }
      ] }
  ]
}
```

- `state`: `AFTER`, `BEFORE → AFTER`, `FLOW` or `FOUND`.
- `out` is a file name; the board is written to `~/.fast-browser/screenshots/`.
- Every key a mark names must be in that panel's capture `boxes`.
- Every mark but `redact` takes an optional `title`, `note` (one line) and
  `tag`: `NEW`, `CHANGED`, `REMOVED`, `ISSUE`, `PENDING` or `OK`. `bracket`
  and `link` need a `title`.

### Layouts

| `layout` | Panels | Use it for |
|---|---|---|
| `single` | one | one screen |
| `pair` | two, each with a `label`: `BEFORE` and `AFTER`, or `LIGHT` and `DARK` | one region in two states |
| `steps` | two to four, in order, each `label` saying what the user does | a flow across screens |

One capture per panel, named `<board>.c1`, `<board>.c2` and so on: run steps
2 to 4 once for each. Frame both panels of a pair on the same region, with
the same frame selector, so the reader compares like with like. Compose
draws all panels at one height.

For `LIGHT` and `DARK`, capture, switch the app's own theme control, and
capture again with the same selectors and the same frame selector.

### Marks

| The brief says | Mark |
|---|---|
| point at an element | `lift` |
| a group of rows or lines | `bracket` over the rows' keys |
| something too small to read: an icon, a badge, a one-word chip | `loupe` (`zoom` 2 to 8; 4 unless told) |
| one fact shown in two places | `link` with exactly two keys |
| something was removed | `ghost` on the gap, or on the element now in its place |
| nothing rendered where something should | `empty` on the blank region; `text` says what is missing |
| hide personal data | `redact` |

- **Lift the whole fact.** Target the element that holds the chip and its
  value, the icon and its text, not one word of it. When the brief names a
  small element (a badge, icon or chip), mark that element alone and leave
  its neighbours out: `lift` enlarges it a little, `loupe` magnifies it.
- Elements that make one point can share a `lift` as a key list. Compose
  lifts adjacent ones together and separated ones as separate lifts under
  one label. Use `link` when the point is that two places agree.
- `redact` covers personal data you are not verifying with a solid fill, not
  a blur. Redact the element that holds the whole value: the fill covers that
  element's box only. A redact key that came back in `missed` is not
  redacted, and compose refuses it: fix the selector and capture again.
````

Keep `## Done means` as it is. Delete the old bullets this replaces; do not leave two versions of a rule.

In `lib/compose/spec.mjs`, delete the `MARK_KINDS_M1` export (run `grep -rn MARK_KINDS_M1 lib tests` first; it must have no other reader).

- [ ] **Step 5: Unit test, then GREEN on paper**

Run: `node --test tests/unit/skills.test.mjs` → PASS, every assertion in the file, including the ones above the edited lines (`fast-browser setup` appears exactly twice; the capture, check and seal steps are untouched).

Run: `git diff -U0 skills/composing-evidence/SKILL.md | grep -n '^[-+]' | grep -i 'macro\|seal\|failedStep\|missed'` → no output. A hit means a milestone 2 line moved; undo it.

Dispatch three fresh agents with the Step 2 prompt and the *new* skill text. Validate each reply with a throwaway script in the scratchpad that calls `validateSpec(spec, captures)` with fake captures carrying those keys; every spec must validate, brief 1 must use `bracket`, 2 `loupe`, 3 `link`, 4 `ghost`, 5 one `pair` board labelled `LIGHT` and `DARK`. Record the results in `tests/skills/composing-evidence/green.md` under `## 2026-10: marks and layouts (milestone 3)`. If an agent picks the wrong mark, fix the table's wording, not the test, and rerun.

- [ ] **Step 6: Commit**

Run: `npm test` → 0 fail.

```bash
git add skills/composing-evidence/SKILL.md lib/compose/spec.mjs tests/unit/skills.test.mjs tests/skills/composing-evidence
git commit -m "composing-evidence: the new marks and the pair and steps layouts"
```

---

### Task 10: Blind eval A, live marks and layouts

The spec's working rule: a blind eval every few tasks, not only at the end. Fixtures show the engine holds its own rules; only a fresh agent on a real page shows whether the boards read. **Controller only: no subagent opens this gate or drives the browser on its own.** Nothing from this task is committed: the brief and the boards show a real app and live under `.superpowers/eval/`, which the repo ignores.

**Files (never committed):**
- Create: `.superpowers/eval/m3-a/BRIEF.md`, `.superpowers/eval/m3-a/score.md`, copies of every board and spec the run produced

- [ ] **Step 1: Open the gate**

The blind eval drives the operator's real Chrome through Fast Browser, and needs two things outside this worktree: boards land in `~/.fast-browser/screenshots/` (where compose writes by design), and the driver needs the current capture macro at a path the browser tools accept, because this build is not installed. `herd_ask` with two questions, then stop until the answer arrives:

1. *Which app does the blind eval drive, in your Chrome?* Options: the app the milestone 1 eval used, started and signed in by the operator (recommended; it has every case); the repo's synthetic fixture pages served on localhost; skip the live eval for now and score fixture boards only, leaving the exit bar unmet.
2. *How many capture calls does a multi-panel board get?* The spec's bar is "at most 3 capture calls per case", written when every board had one capture. Options: 3 per panel (recommended); 3 per case whatever its panels; 5 per case.

The question's context names the two outside writes (the macro copy at `~/.fast-browser/output/composed-evidence-eval/capture-evidence.js`, and boards in the screenshots folder).

- [ ] **Step 2: Write the brief**

One case per primitive this milestone has drawn so far, each in plain words with no selector and no coordinate: a `bracket` (a group of rows), a `loupe` (an icon or badge under 16 px), a `link` (one value shown in two places), an `empty` or a `ghost` (a region that is blank or lost an element in the app's current state), a `pair` (one card in two states or two themes), and `steps` (two or three screens of one flow). Add one case with a live `redact`. Choose the concrete elements from the approved app after the gate, by looking at it once.

Copy the frame of `~/.fast-browser/composed-evidence-eval/runs/2026-10-11/BRIEF.md`: the page, "never sign in", the two local differences (the macro path, and compose run as `node <this worktree>/bin/fast-browser.mjs compose`), the run name `m3a`, the ground rules (Fast Browser tools only; the capture macro is the only `browser_run_code_unsafe` use; the capture budget the gate answered; stop a case after two identical failures), and the per-case report. Do not name the marks in the brief: the skill's table has to carry the choice.

- [ ] **Step 3: Run it**

Copy `builtins/macros/capture-evidence.js` to the macro path the gate approved. Dispatch `fast-browser:browser-driver`, `model: sonnet`, effort `medium`, with only the skill's path and the brief's path.

- [ ] **Step 4: Score it**

Copy each board and spec into `.superpowers/eval/m3-a/`. Read every board PNG yourself. Write `score.md` as milestone 1's: per case, board made, capture calls, unresolved selector problems, hidden fields readable, which mark the agent chose, and one plain line on what reads wrong. Judge each board 1 to 5 against the spike's board for the same primitive in `~/.fast-browser/composed-evidence-eval/spike/blind/out/` with one `opus` `high` judge per board, given the board, the reference and the question "does this prove what the brief says at a glance, and what gets in the way?".

- [ ] **Step 5: Act on it**

A board under 4, a wrong mark choice, or a redaction that does not hold becomes a fix task. That includes a look-only note the spec dropped from milestone 1 (a long connector, merged rings, the nested-cards look): it is fixed only when it is why a board scored under the bar. Each fix task is appended to this plan's ledger with its own test first: an engine fault goes to `page-layout.js` with a fixture that reproduces it on a synthetic page; a skill fault goes through `superpowers:writing-skills`. Rerun the failing cases after the fix. After two fix-and-rerun rounds that still miss the bar, `herd_ask` with the scores instead of a third round.

---

### Task 11: Importing an image as a capture

`fast-browser compose --import <image> --out <name> --origin <where it came from>` turns a ticket's screenshot into a PNG and a sidecar that compose loads like any capture.

**Files:**
- Create: `lib/compose/import.mjs`, `lib/compose/files.mjs`, `tests/unit/compose-import.test.mjs`
- Modify: `lib/compose/engine.mjs`, `lib/compose/capture.mjs` (the `loadCapture` digest and return lines only), `lib/commands/compose.mjs`, `lib/cli/parse-args.mjs`, `lib/cli/main.mjs`, `tests/e2e/compose-invariants.test.mjs`
- Test: `node --test tests/unit/compose-import.test.mjs`, `node --test tests/e2e/compose-invariants.test.mjs`

**Interfaces:**
- Produces:
  - `files.mjs`: `sameFile(a, b) -> Promise<boolean>` (same real path, or the same path ignoring case); `writeAtomic(file, data, mode = 0o600) -> Promise<void>`.
  - `import.mjs`: `detectFormat(bytes) -> 'png' | 'jpeg' | 'webp' | 'gif' | null`; `importCapture({ paths, source, out, origin, rasterize, fail }) -> Promise<{ sidecar, png, format, width, height }>`; `IMPORT_MAX_BYTES = 25 * 1024 * 1024`.
  - `engine.mjs`: `rasterizeImage({ bytes, mime, executablePath, playwrightCore, timeoutMs }) -> Promise<Buffer>` (PNG bytes).
  - `loadCapture` on an import sidecar returns `{ sidecarPath, pngPath, png, size, source: 'import', origin, format, frame: null, boxes: {}, missed: [], dark: false, scale: 1 }`. A live capture's return is unchanged and has no `source`.
  - The import sidecar: `{ "schemaVersion": "capture-evidence/1", "source": "import", "image": "<out>.png", "origin": "...", "format": "jpeg", "scale": 1, "digest": "<sha-256 of the PNG bytes followed by {}>" }`.
  - Request fields `import`, `out`, `origin` (all `null` unless given); report `{ mode: 'import', ok, sidecar, png, format, width, height }`; CLI line `Imported capture at <w>x<h>: <sidecar>`.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/compose-import.test.mjs`:

```js
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { main } from '../../lib/cli/main.mjs';
import { parseArgs } from '../../lib/cli/parse-args.mjs';
import { compose } from '../../lib/commands/compose.mjs';
import { loadCapture } from '../../lib/compose/capture.mjs';
import { sameFile } from '../../lib/compose/files.mjs';
import { detectFormat, importCapture } from '../../lib/compose/import.mjs';
import { resolvePaths } from '../../lib/core/paths.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
  + '1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const JPEG_HEAD = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
const fail = (message) => Object.assign(new Error(message), { exitCode: 2 });
const rasterize = async () => PNG;

async function world() {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-imp-'));
  const paths = resolvePaths({ homeDir: home, pluginRoot: path.resolve('.') });
  await mkdir(paths.screenshotsDir, { recursive: true });
  const source = path.join(home, 'ticket.jpg');
  await writeFile(source, JPEG_HEAD);
  return { home, paths, source };
}
const origin = 'https://tracker.example/issues/1';

test('formats are told apart by their first bytes, never by their name', () => {
  assert.equal(detectFormat(PNG), 'png');
  assert.equal(detectFormat(JPEG_HEAD), 'jpeg');
  assert.equal(detectFormat(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1')), 'webp');
  assert.equal(detectFormat(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00', 'latin1')), 'gif');
  assert.equal(detectFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(detectFormat(Buffer.from('<!doctype html><p>hi</p>')), null);
  assert.equal(detectFormat(Buffer.alloc(4)), null);
});

test('import writes a PNG and a sidecar with no measurements, and compose loads it', async () => {
  const { home, paths, source } = await world();
  try {
    const done = await importCapture({ paths, source, out: 'r-c-before.c1', origin, rasterize, fail });
    assert.equal(done.png, path.join(paths.screenshotsDir, 'r-c-before.c1.png'));
    assert.deepEqual([done.format, done.width, done.height], ['jpeg', 1, 1]);
    const body = JSON.parse(await readFile(done.sidecar, 'utf8'));
    assert.deepEqual(Object.keys(body).sort(), ['digest', 'format', 'image', 'origin', 'scale', 'schemaVersion', 'source']);
    assert.deepEqual([body.source, body.image, body.origin, body.format], ['import', 'r-c-before.c1.png', origin, 'jpeg']);
    assert.deepEqual(await readFile(done.png), PNG, 'the bundle holds the converted bytes');
    const loaded = await loadCapture({ sidecarPath: done.sidecar, fail });
    assert.deepEqual([loaded.source, loaded.frame, loaded.boxes, loaded.size, loaded.format], ['import', null, {}, [1, 1], 'jpeg']);
  } finally { await rm(home, { recursive: true, force: true }); }
});

for (const [label, change, message] of [
  ['a file that is not an image', async ({ source }) => writeFile(source, '<!doctype html><p>not an image</p>'), /must be a PNG, JPEG, WebP or GIF/],
  ['an SVG', async ({ source }) => writeFile(source, '<svg xmlns="http://www.w3.org/2000/svg"/>'), /must be a PNG, JPEG, WebP or GIF/],
  ['a missing file', async ({ source }) => rm(source), /was not found/],
  ['an image over 25 MB', async ({ source }) => writeFile(source, Buffer.concat([JPEG_HEAD, Buffer.alloc(25 * 1024 * 1024)])), /larger than 25 MB/],
]) {
  test(`import refuses ${label} and writes nothing`, async () => {
    const w = await world();
    try {
      await change(w);
      await assert.rejects(() => importCapture({ paths: w.paths, source: w.source, out: 'x.c1', origin, rasterize, fail }),
        (error) => message.test(error.message) && !error.message.includes('ticket'));
      assert.deepEqual(await readdir(w.paths.screenshotsDir), []);
    } finally { await rm(w.home, { recursive: true, force: true }); }
  });
}

test('import refuses an image the renderer cannot decode, a bad name, and a missing origin', async () => {
  const { home, paths, source } = await world();
  try {
    const args = { paths, source, out: 'x.c1', origin, rasterize, fail };
    await assert.rejects(() => importCapture({ ...args, rasterize: async () => { throw new Error('decode'); } }), /could not be decoded/);
    await assert.rejects(() => importCapture({ ...args, out: '../x' }), /out must be a simple file name/);
    await assert.rejects(() => importCapture({ ...args, out: 'a/b' }), /out must be a simple file name/);
    await assert.rejects(() => importCapture({ ...args, origin: '  ' }), /origin is required/);
    assert.deepEqual(await readdir(paths.screenshotsDir), []);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('import refuses to write over the image it is reading, however the name is cased', async () => {
  const { home, paths } = await world();
  try {
    const source = path.join(paths.screenshotsDir, 'Ticket.c1.png');
    await writeFile(source, PNG);
    await assert.rejects(() => importCapture({ paths, source, out: 'ticket.c1', origin, rasterize, fail }), /out must not name the image being imported/);
    assert.deepEqual(await readFile(source), PNG);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('two spellings of one file are the same file, two files are not', async () => {
  const { home, paths, source } = await world();
  try {
    assert.equal(await sameFile(source, path.join(home, 'TICKET.JPG')), true);
    assert.equal(await sameFile(source, path.join(paths.screenshotsDir, 'ticket.jpg')), false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('an import sidecar that carries measurements, or whose image changed, is refused', async () => {
  const { home, paths, source } = await world();
  try {
    const { sidecar, png } = await importCapture({ paths, source, out: 'x.c1', origin, rasterize, fail });
    const body = JSON.parse(await readFile(sidecar, 'utf8'));
    await writeFile(sidecar, JSON.stringify({ ...body, boxes: { a: [0, 0, 1, 1] } }));
    await assert.rejects(() => loadCapture({ sidecarPath: sidecar, fail }), /must not carry measurements/);
    await writeFile(sidecar, JSON.stringify(body));
    await writeFile(png, Buffer.concat([PNG, Buffer.from([0])]));
    await assert.rejects(() => loadCapture({ sidecarPath: sidecar, fail }), /does not match its image/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('the CLI parses --import with --out and --origin, and nothing else beside it', () => {
  const request = parseArgs(['compose', '--import', 'ticket.jpg', '--out', 'x.c1', '--origin', origin]);
  assert.deepEqual([request.import, request.out, request.origin, request.spec], ['ticket.jpg', 'x.c1', origin, null]);
  assert.throws(() => parseArgs(['compose', '--import', 'ticket.jpg']), /--import requires --out and --origin/);
  assert.throws(() => parseArgs(['compose', 'spec.json', '--import', 'ticket.jpg', '--out', 'x', '--origin', 'o']), /compose takes one of/);
  assert.throws(() => parseArgs(['compose', 'spec.json', '--out', 'x']), /--out and --origin go with --import/);
  assert.throws(() => parseArgs(['compose', '--import']), /--import requires a value/);
});

test('the command imports through the pinned renderer and the CLI reports the size', async () => {
  const { home, paths, source } = await world();
  try {
    let asked;
    const report = await compose(parseArgs(['compose', '--import', source, '--out', 'x.c1', '--origin', origin]), {
      paths, rendererLocation: async () => ({ executablePath: '/x', playwrightCore: '/y' }),
      rasterizeImage: async (image) => { asked = image; return PNG; },
    });
    assert.deepEqual([report.mode, report.width, report.height], ['import', 1, 1]);
    assert.deepEqual([asked.mime, asked.executablePath], ['image/jpeg', '/x']);
    const lines = [];
    await main(parseArgs(['compose', '--import', source, '--out', 'x.c1', '--origin', origin]), { write: (text) => lines.push(text), commands: { compose: async () => report } });
    assert.equal(lines.join(''), `Imported capture at 1x1: ${report.sidecar}\n`);
    await assert.rejects(() => compose(parseArgs(['compose', '--import', source, '--out', 'y.c1', '--origin', origin]), { paths, rendererLocation: async () => null }),
      /run `fast-browser setup`/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
```

Run: `node --test tests/unit/compose-import.test.mjs` → FAIL (modules missing).

- [ ] **Step 2: `files.mjs` and `import.mjs`**

`lib/compose/files.mjs`:

```js
import crypto from 'node:crypto';
import { realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// A file that does not exist yet still has a real parent folder to resolve through.
async function real(file) {
  try { return await realpath(file); } catch { /* not there yet */ }
  try { return path.join(await realpath(path.dirname(file)), path.basename(file)); } catch { return path.resolve(file); }
}

// The default macOS volume folds case, so two spellings of one name are one
// file there; treating them as one everywhere only ever refuses more.
export async function sameFile(a, b) {
  const [ra, rb] = await Promise.all([real(a), real(b)]);
  return ra === rb || ra.toLowerCase() === rb.toLowerCase();
}

export async function writeAtomic(file, data, mode = 0o600) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, data, { mode });
  await rename(temp, file);
}
```

`lib/compose/import.mjs`:

```js
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { readPngSize } from '../annotate/png.mjs';
import { confinedScreenshotPath } from '../core/screenshots.mjs';
import { CAPTURE_SCHEMA, captureDigest } from './capture.mjs';
import { sameFile, writeAtomic } from './files.mjs';

export const IMPORT_MAX_BYTES = 25 * 1024 * 1024;
const OUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MIME = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' });
const ascii = (bytes, from, to) => bytes.subarray(from, to).toString('latin1');

export function detectFormat(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif';
  return null;
}

export async function importCapture({ paths, source, out, origin, rasterize, fail }) {
  if (typeof out !== 'string' || !OUT_NAME.test(out)) throw fail('out must be a simple file name');
  if (typeof origin !== 'string' || origin.trim().length === 0 || origin.length > 2000) {
    throw fail('origin is required: say where the image came from');
  }
  const png = await confinedScreenshotPath(paths, `${out}.png`, 'out', fail);
  const sidecar = await confinedScreenshotPath(paths, `${out}.capture.json`, 'out', fail);
  if (await sameFile(source, png)) throw fail('out must not name the image being imported');
  let size;
  try { ({ size } = await stat(source)); } catch { throw fail('the image to import was not found'); }
  if (size > IMPORT_MAX_BYTES) throw fail('the image to import is larger than 25 MB');
  const bytes = await readFile(source);
  const format = detectFormat(bytes);
  if (!format) throw fail('the image to import must be a PNG, JPEG, WebP or GIF');
  let converted;
  try { converted = await rasterize({ bytes, mime: MIME[format] }); } catch (error) {
    if (error?.name === 'RuntimeUnavailableError') throw error;
    throw fail('the image to import could not be decoded');
  }
  const { width, height } = readPngSize(converted);
  await writeAtomic(png, converted);
  await writeAtomic(sidecar, `${JSON.stringify({
    schemaVersion: CAPTURE_SCHEMA, source: 'import', image: path.basename(png), origin, format, scale: 1,
    digest: captureDigest(converted, {}),
  }, null, 2)}\n`);
  return { sidecar, png, format, width, height };
}
```

- [ ] **Step 3: The renderer converts; `loadCapture` reads**

`lib/compose/engine.mjs`, after `renderBoard`:

```js
const IMPORT_MAX_SIDE = 16000;

// Decodes in the pinned headless shell and re-encodes from a canvas, so the
// PNG that joins a bundle carries none of the original file's metadata. A GIF
// yields its first frame.
export async function rasterizeImage({ bytes, mime, executablePath, playwrightCore, timeoutMs = 30_000 }) {
  if (typeof executablePath !== 'string' || executablePath.length === 0) {
    throw new Error('the compose renderer executable path is required');
  }
  let chromium;
  try { ({ chromium } = await import(playwrightCore)); } catch { throw new RuntimeUnavailableError(); }
  const browser = await chromium.launch({ headless: true, executablePath, timeout: timeoutMs });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    const encoded = await page.evaluate(async ({ uri, limit }) => {
      const image = new Image(); image.src = uri;
      await image.decode();
      if (image.naturalWidth > limit || image.naturalHeight > limit) throw new Error('too large');
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
    }, { uri: `data:${mime};base64,${bytes.toString('base64')}`, limit: IMPORT_MAX_SIDE });
    return Buffer.from(encoded, 'base64');
  } finally { await browser.close(); }
}
```

`lib/compose/capture.mjs`, `loadCapture` only. The digest check and the lines after it become:

```js
  const imported = body.source === 'import';
  if (imported && (body.frame !== undefined || body.boxes !== undefined)) {
    throw fail('an imported capture sidecar must not carry measurements');
  }
  if (captureDigest(png, imported ? {} : { frame: body.frame, boxes: body.boxes }) !== body.digest) {
    throw fail('a capture sidecar does not match its image');
  }
  const { width, height } = readPngSize(png);
  if (imported) {
    return { sidecarPath, pngPath, png, size: [width, height], source: 'import', origin: body.origin, format: body.format,
      frame: null, boxes: {}, missed: [], dark: false, scale: 1 };
  }
```

followed by the existing live `return`, unchanged. Touch nothing else in that file: milestone 2 owns it.

- [ ] **Step 4: The command and the CLI**

`lib/commands/compose.mjs`: import `importCapture` and `rasterizeImage as defaultRasterizeImage`. Right after the `request.seal` branch (which stays byte-identical):

```js
  if (request.import) {
    const location = await (supplied.rendererLocation ?? defaultRendererLocation)(paths, supplied);
    if (!location || location.status) throw fail(RENDERER_REMEDIES[location?.status] ?? RENDERER_REMEDIES.missing);
    const convert = supplied.rasterizeImage ?? defaultRasterizeImage;
    try {
      const done = await importCapture({
        paths, source: path.resolve(request.import), out: request.out, origin: request.origin, fail,
        rasterize: (image) => convert({ ...image, ...location }),
      });
      return { mode: 'import', ok: true, ...done };
    } catch (error) {
      if (error instanceof RuntimeUnavailableError) throw fail('the fast-browser runtime is not installed; run `fast-browser setup`');
      throw error;
    }
  }
```

`lib/cli/parse-args.mjs`:

- Under the line `if (command === 'compose') { request.spec = null; request.seal = null; }`, which stays as it is, add `if (command === 'compose') { request.import = null; request.out = null; request.origin = null; }`.
- After the `--seal` block and before the compose positional block:

```js
    if (command === 'compose' && ['--import', '--out', '--origin'].includes(token)) {
      const field = token.slice(2);
      if (request[field] !== null) throw new UsageError(token, `compose takes one ${token} value`);
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(token, `${token} requires a value`);
      request[field] = value;
      index += 1;
      continue;
    }
```

- The check `request.spec === null && request.seal === null` gains `&& request.import === null`, and its message becomes `compose requires a spec path or --seal, or --import`. The next check (a spec path and `--seal` together) stays as it is. After it:

```js
  if (command === 'compose') {
    const modes = [request.spec, request.seal, request.import].filter((value) => value !== null).length;
    if (modes > 1 && !(request.spec !== null && request.seal !== null)) {
      throw new UsageError('<spec>', 'compose takes one of a spec path, --seal or --import');
    }
    if (request.import !== null && (request.out === null || request.origin === null)) throw new UsageError('--import', '--import requires --out and --origin');
    if (request.import === null && (request.out !== null || request.origin !== null)) throw new UsageError('--out', '--out and --origin go with --import');
  }
```

`lib/cli/main.mjs`, in the compose branch of `humanReport`, after the seal line: `if (report.mode === 'import') return \`Imported capture at ${report.width}x${report.height}: ${report.sidecar}\n\`;`.

Run: `node --test tests/unit/compose-import.test.mjs tests/unit/parse-args.test.mjs tests/unit/compose-command.test.mjs tests/unit/compose-capture.test.mjs` → PASS, all four files, with no edit to the last three.

- [ ] **Step 5: The real renderer converts every format**

Append to `tests/e2e/compose-invariants.test.mjs`:

```js
import { rasterizeImage } from '../../lib/compose/engine.mjs';
import { readPngSize } from '../../lib/annotate/png.mjs';

// A real 2x2 GIF with two frames, the first all red and the second all blue.
const TWO_FRAME_GIF = Buffer.from('47494638396102000200810000ff000000000000000000000021ff0b4e45545343415045322e30030100000021f904040a00'
  + '00002c00000000020002000008060001080410100021f904050a0001002c0000000002000200810000ff0000000000000000000806000108041010003b', 'hex');

async function encoded(mime) {
  const { chromium } = await import(renderer.playwrightCore);
  const browser = await chromium.launch({ headless: true, executablePath: renderer.executablePath });
  try {
    const page = await browser.newPage();
    const uri = await page.evaluate((type) => {
      const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 20;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#16a34a'; ctx.fillRect(0, 0, 40, 20);
      return canvas.toDataURL(type, 0.95);
    }, mime);
    return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
  } finally { await browser.close(); }
}

for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
  test(`the renderer converts ${mime} to a PNG of the same size`, { skip }, async () => {
    const png = await rasterizeImage({ bytes: await encoded(mime), mime, ...renderer });
    assert.deepEqual(readPngSize(png), { width: 40, height: 20 });
    const green = await countOffColor({ png, rect: [4, 4, 32, 12], color: [22, 163, 74], tolerance: 40, renderer });
    assert.equal(green.off, 0);
  });
}

test('a GIF imports as its first frame', { skip }, async () => {
  const png = await rasterizeImage({ bytes: TWO_FRAME_GIF, mime: 'image/gif', ...renderer });
  assert.deepEqual(readPngSize(png), { width: 2, height: 2 });
  const red = await countOffColor({ png, rect: [0, 0, 2, 2], color: [255, 0, 0], tolerance: 40, renderer });
  assert.equal(red.off, 0, 'the first frame is red');
});

test('a JPEG cut off in its header is refused, not half-drawn', { skip }, async () => {
  const bytes = (await encoded('image/jpeg')).subarray(0, 40);
  await assert.rejects(() => rasterizeImage({ bytes, mime: 'image/jpeg', ...renderer }));
});
```

Run: `node --test tests/e2e/compose-invariants.test.mjs` → PASS.

- [ ] **Step 6: Suites, commit**

Run: `npm run test:compose && npm test` → 0 fail.

```bash
git add lib tests/unit/compose-import.test.mjs tests/e2e/compose-invariants.test.mjs
git commit -m "compose --import: a ticket image becomes a PNG capture with a sidecar"
```

---

### Task 12: Imported panels

An imported panel is an ordinary panel whose frame and boxes come from the spec, in the image's own pixels, because there is no page to measure.

**Files:**
- Modify: `lib/compose/spec.mjs`, `lib/compose/page.mjs`, `lib/compose/page-geometry.js`, `lib/compose/page-layout.js`, `lib/commands/compose.mjs`
- Modify: `tests/unit/compose-spec.test.mjs`, `tests/unit/compose-geometry.test.mjs`, `tests/e2e/helpers/invariants.mjs`, `tests/e2e/compose-invariants.test.mjs`, `tests/e2e/compose-fixtures.test.mjs`
- Create pages `ticket-before.html`, `ticket-after.html`; specs `import-single.json`, `import-pair-3x.json`; their goldens

**Interfaces:**
- Consumes: `loadCapture`'s import return (Task 11), `commonHeight` and panel heads (Task 8), slots (Task 4).
- Produces:
  - Spec: on a panel whose capture is imported, `frame: [x, y, w, h]` (required) and `boxes: { key: [x, y, w, h] }`, in image pixels. Refused on a live panel.
  - `validateSpec(spec, captures)` reads `captures[p].source` and `captures[p].size`.
  - `frameIsDark(pixels, frame) -> boolean` on `__composeGeometry`.
  - Page data: each capture carries `source: 'live' | 'import'`, and an imported one carries the panel's `frame` and `boxes`.
  - Report: `panel.source`, `panel.head.origin: boolean`; `panel.redactions[].rect` is the fill as drawn (the box plus its pad, clipped to the capture).
  - Constants `REDACT_GROW = 2`, `IMPORT_REDACT_PAD = 12`.
  - Fixture format: `fixture: { import: { page, dpr, format } }` on a panel, with the panel's own `frame` and `boxes`.

- [ ] **Step 1: Validator tests, then the rules**

Append to `tests/unit/compose-spec.test.mjs`:

```js
const imported = (over = {}) => ({ source: 'import', size: [800, 600], boxes: {}, missed: [], ...over });
const importPanel = (over = {}) => ({ capture: 'r-before.c1.capture.json', frame: [100, 100, 400, 300], boxes: { map: [120, 120, 200, 100], address: [120, 300, 180, 30] },
  marks: [{ empty: 'map' }, { redact: 'address' }], ...over });
const single = (panel) => ({ state: 'FOUND', title: 'A board', layout: 'single', out: 'b.png', panels: [panel] });

test('an imported panel names its frame and boxes in image pixels', () => {
  assert.deepEqual(validateSpec(single(importPanel()), [imported()]), []);
});

test('an imported panel must give a frame, inside the image', () => {
  assert.ok(validateSpec(single(importPanel({ frame: undefined })), [imported()]).includes('panels[0].frame is required for an imported panel'));
  for (const frame of [[700, 100, 400, 300], [-1, 0, 10, 10], [0, 0, 0, 10], [0, 0, 10], 'all', [0, 0, 10, Number.NaN]]) {
    assert.ok(validateSpec(single(importPanel({ frame })), [imported()]).includes('panels[0].frame must be four numbers inside the image'), JSON.stringify(frame));
  }
});

test('every box of an imported panel lies inside its frame', () => {
  assert.ok(validateSpec(single(importPanel({ boxes: { map: [90, 120, 50, 50] } })), [imported()]).includes('panels[0].boxes has a box outside the frame'));
  assert.ok(validateSpec(single(importPanel({ boxes: { map: [120, 120, 200] } })), [imported()]).includes('panels[0].boxes must map keys to boxes of four numbers'));
  assert.ok(validateSpec(single(importPanel({ boxes: [] })), [imported()]).includes('panels[0].boxes must map keys to boxes of four numbers'));
});

test('a mark on an imported panel names a key in the panel boxes, redactions included', () => {
  const problems = validateSpec(single(importPanel({ marks: [{ redact: 'phone' }, { lift: 'map' }] })), [imported()]);
  assert.deepEqual(problems, ["panels[0].marks[0] names a key that is not in the panel's boxes"]);
});

test('inspection geometry on a live panel is refused', () => {
  const problems = validateSpec(base([]), [capture()]);
  assert.deepEqual(problems, []);
  const withFrame = { ...base([]), panels: [{ capture: 'c.json', frame: [0, 0, 10, 10], marks: [] }] };
  assert.ok(validateSpec(withFrame, [capture()]).includes('panels[0].frame and panels[0].boxes are only for an imported panel'));
  const withBoxes = { ...base([]), panels: [{ capture: 'c.json', boxes: { name: [0, 0, 10, 10] }, marks: [{ lift: 'name' }] }] };
  assert.ok(validateSpec(withBoxes, [capture()]).includes('panels[0].frame and panels[0].boxes are only for an imported panel'));
});
```

Run → FAIL. In `validateSpec`'s per-panel loop, replacing the line that builds `measured`:

```js
    const importedPanel = capture?.source === 'import';
    let measured = new Set(Object.keys(capture?.boxes ?? {}));
    if (importedPanel) {
      const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every((n) => Number.isFinite(n)) && b[2] > 0 && b[3] > 0;
      const within = (b, o) => b[0] >= o[0] && b[1] >= o[1] && b[0] + b[2] <= o[0] + o[2] && b[1] + b[3] <= o[1] + o[3];
      const frameOk = isBox(panel?.frame) && within(panel.frame, [0, 0, capture.size[0], capture.size[1]]);
      if (panel?.frame === undefined) problems.push(`panels[${p}].frame is required for an imported panel`);
      else if (!frameOk) problems.push(`panels[${p}].frame must be four numbers inside the image`);
      const boxes = panel?.boxes ?? {};
      const boxesOk = boxes !== null && typeof boxes === 'object' && !Array.isArray(boxes) && Object.values(boxes).every(isBox);
      if (!boxesOk) problems.push(`panels[${p}].boxes must map keys to boxes of four numbers`);
      else if (frameOk && !Object.values(boxes).every((b) => within(b, panel.frame))) problems.push(`panels[${p}].boxes has a box outside the frame`);
      measured = new Set(boxesOk ? Object.keys(boxes) : []);
    } else if (panel?.frame !== undefined || panel?.boxes !== undefined) {
      problems.push(`panels[${p}].frame and panels[${p}].boxes are only for an imported panel`);
    }
```

and the unknown-key message becomes `importedPanel ? "names a key that is not in the panel's boxes" : 'names a key the capture did not measure'`.

Run → PASS.

- [ ] **Step 2: Dark detection from pixels**

Append to `tests/unit/compose-geometry.test.mjs`:

```js
test('an imported frame is dark when its pixels are, whatever the rest of the image is', () => {
  const { frameIsDark } = sandbox.__composeGeometry;
  const c = canvas(400, 200).fill(200, 0, 200, 200, [17, 24, 39]);
  assert.equal(frameIsDark(c, [0, 0, 190, 200]), false);
  assert.equal(frameIsDark(c, [210, 0, 190, 200]), true);
  assert.equal(frameIsDark(canvas(100, 100, [108, 108, 108]), [0, 0, 100, 100]), true);
  assert.equal(frameIsDark(canvas(100, 100, [112, 112, 112]), [0, 0, 100, 100]), false);
});
```

`lib/compose/page-geometry.js`, exported:

```js
  const DARK_BELOW = 110;
  // The capture rule's luminance test, taken over a 16 by 16 grid of the
  // frame's pixels: an imported image has no page to ask for its background.
  function frameIsDark(pixels, frame) {
    const b = boundsOf(pixels, frame);
    const values = [];
    for (let i = 0; i < 16; i += 1) {
      for (let j = 0; j < 16; j += 1) {
        const x = Math.min(b.x1 - 1, Math.floor(b.x0 + ((b.x1 - b.x0) * (i + 0.5)) / 16));
        const y = Math.min(b.y1 - 1, Math.floor(b.y0 + ((b.y1 - b.y0) * (j + 0.5)) / 16));
        const at = (y * pixels.width + x) * 4;
        values.push(0.299 * pixels.data[at] + 0.587 * pixels.data[at + 1] + 0.114 * pixels.data[at + 2]);
      }
    }
    return median(values) < DARK_BELOW;
  }
```

- [ ] **Step 3: Fixture pages, specs and the import harness**

`tests/fixtures/evidence/pages/ticket-before.html` (absolute positions, so the inspection numbers below are exact):

```html
<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:14px Helvetica,Arial,sans-serif;background:#f6f7f9;color:#111827}
.card{position:absolute;left:40px;top:40px;width:420px;height:260px;box-sizing:border-box;background:#fff;border:1px solid #e5e7eb;border-radius:12px}
h3{position:absolute;left:20px;top:20px;margin:0;font-size:16px;line-height:20px}
.owner{position:absolute;left:20px;top:52px;line-height:20px}
.chart{position:absolute;left:20px;top:88px;width:380px;height:120px;border-radius:8px;background:#fafafa}
.contact{position:absolute;left:20px;top:222px;line-height:20px;color:#374151}</style>
<div class="card" data-testid="burndown"><h3>Sprint burndown</h3>
  <div class="owner">Owner: Pat Example</div>
  <div class="chart" data-testid="chart"></div>
  <div class="contact">pat.example@tracker.example</div>
</div>
```

`ticket-after.html`: the same file with the chart filled in, `<div class="chart" data-testid="chart" style="background:linear-gradient(to top right,#c7d2fe 0 50%,#fafafa 50%)"></div>`.

In CSS pixels the card is `[40, 40, 420, 260]`, the chart `[61, 129, 380, 120]`, the owner line starts at `[61, 93]` and the contact line at `[61, 263]`, each 20 tall. Multiply by the screenshot's device scale for image pixels.

`tests/fixtures/evidence/specs/import-single.json` (device scale 2):

```json
{ "state": "FOUND", "title": "The burndown chart is blank in the reported screenshot", "layout": "single", "out": "fx-import-single.png",
  "expect": { "origin": [true], "slots": [["empty", "inside"]], "redactionPad": 12, "crops": 2 },
  "panels": [
    { "fixture": { "import": { "page": "ticket-before", "dpr": 2, "format": "jpeg" } },
      "frame": [72, 72, 856, 536],
      "boxes": { "chart": [122, 258, 760, 240], "owner": [118, 182, 340, 48], "contact": [118, 522, 500, 48] },
      "marks": [ { "empty": "chart", "text": "Nothing rendered here" }, { "redact": "owner" }, { "redact": "contact" } ] } ] }
```

`tests/fixtures/evidence/specs/import-pair-3x.json` (device scale 3 beside a live 1x capture of the same card):

```json
{ "state": "BEFORE → AFTER", "title": "The burndown chart renders again", "layout": "pair", "out": "fx-import-pair-3x.png",
  "expect": { "origin": [true, false], "sizeRatio": 2.5, "crops": 1 },
  "panels": [
    { "label": "BEFORE", "fixture": { "import": { "page": "ticket-before", "dpr": 3, "format": "jpeg" } },
      "frame": [108, 108, 1284, 804],
      "boxes": { "chart": [183, 387, 1140, 360], "contact": [177, 783, 750, 72] },
      "marks": [ { "empty": "chart", "text": "Nothing rendered here" }, { "redact": "contact" } ] },
    { "label": "AFTER", "fixture": { "page": "ticket-after", "targets": { "chart": "[data-testid=chart]" }, "frame": "[data-testid=burndown]" },
      "marks": [ { "lift": "chart", "title": "Chart renders", "tag": "OK" } ] } ] }
```

(`expect.crops` is read in Task 13; until then the suite ignores it.)

In `tests/e2e/compose-fixtures.test.mjs`, beside `captureLive`:

```js
async function captureImport({ browser, input, out, home, paths }) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: input.dpr });
  await page.goto(pathToFileURL(path.resolve(`tests/fixtures/evidence/pages/${input.page}.html`)).href);
  const shot = path.join(home, `${out}.${input.format}`);
  await page.screenshot({ path: shot, type: input.format, quality: input.format === 'jpeg' ? 92 : undefined });
  await page.close();
  const { sidecar } = await compose({ command: 'compose', import: shot, out, origin: 'https://tracker.example/issues/1' }, { paths, rendererLocation: async () => renderer });
  return { captureReturn: null, sidecar };
}
```

and the capture loop picks one: `taken.push(input.import ? await captureImport({ browser, input: input.import, out: ..., home, paths }) : await captureLive({ ... }))`. Every block below that reads `captureReturn` (the `covers`, `apart`, `cleanRows`, `leaderGround` and `dotGround` expectations and the frame-offset block) runs only `if (captureReturn)`; an imported first panel has no macro return to compare against. After the `dark` expectation:

```js
      if (fixture.expect?.origin) assert.deepEqual(layoutReport.panels.map((p) => Boolean(p.head?.origin)), fixture.expect.origin, 'an imported panel says it came from the ticket');
      if (fixture.expect?.sizeRatio) {
        const [first, second] = layoutReport.panels;
        assert.ok(first.frame[3] / second.frame[3] >= fixture.expect.sizeRatio, 'the imported frame is several times the live one');
        assert.equal(first.capture[3], second.capture[3], 'and both are drawn at one height');
      }
      if (fixture.expect?.redactionPad) {
        const panel = layoutReport.panels[0]; const scale = panel.capture[2] / panel.frame[2];
        const box = fixture.panels[0].boxes[fixture.panels[0].marks.find((m) => m.redact).redact];
        const drawn = panel.redactions[0].rect;
        assert.ok(Math.abs(drawn[2] - (box[2] + 2 * fixture.expect.redactionPad) * scale) < 1.5, 'the fill is the box plus its pad on both sides');
      }
```

- [ ] **Step 4: Synthetic tests, including the relocation rule**

Append to `tests/e2e/compose-invariants.test.mjs`:

```js
test('an inspection redaction is padded by 12 image pixels, a measured one by 2', { skip }, async () => {
  const bars = [[200, 120, 80, 20]];
  const capture = await syntheticCapture({ bars, boxes: { a: bars[0] } });
  const live = await board([{ redact: 'a' }], { bars, boxes: { a: bars[0] } });
  const { report, dir } = await render(spec([{ redact: 'a' }]), { ...capture, source: 'import' });
  await rm(dir, { recursive: true, force: true });
  const scale = p0(report).capture[2] / p0(report).frame[2];
  assert.ok(Math.abs(p0(report).redactions[0].rect[2] - (80 + 24) * scale) < 1);
  assert.ok(Math.abs(p0(live).redactions[0].rect[2] - (80 + 4) * (p0(live).capture[2] / p0(live).frame[2])) < 1);
  assert.equal(p0(report).source, 'import');
  assert.equal(p0(report).head.origin, true);
});

test('a redaction pad that runs past the image is clipped and still hides its box', { skip }, async () => {
  const bars = [[0, 0, 60, 20]];
  const capture = await syntheticCapture({ bars, boxes: { a: bars[0] } });
  const { report, outPath, dir } = await render(spec([{ redact: 'a' }]), { ...capture, source: 'import' });
  try {
    const [x, y, w, h] = p0(report).redactions[0].rect;
    assert.ok(Math.abs(x - p0(report).capture[0]) < 0.5 && Math.abs(y - p0(report).capture[1]) < 0.5, 'the fill starts at the screenshot corner');
    const scale = (await readFile(outPath)).readUInt32BE(16) / report.stage[2];
    const inner = [x + 4, y + 4, w - 8, h - 8].map((v) => Math.round(v * scale));
    const off = await countOffColor({ png: await readFile(outPath), rect: inner, color: [0xCB, 0xD5, 0xE1], tolerance: 24, renderer });
    assert.equal(off.off, 0, 'nothing but fill where the box was');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an imported panel takes its wash from its own pixels', { skip }, async () => {
  const dark = await syntheticCapture({ dark: true });
  const { report, dir } = await render(spec([{ lift: 'a', title: 'Dark' }]), { ...dark, dark: false, source: 'import' });
  await rm(dir, { recursive: true, force: true });
  assert.equal(p0(report).dark, true, 'the sidecar says nothing about dark; the pixels do');
});
```

In `tests/e2e/compose-fixtures.test.mjs`, move the loop body's setup (temp home, captures, spec file) into `async function prepare(file, home)` returning `{ paths, fixture, taken, specPath, name }`, used by the loop, and add:

```js
test('a bundle copied to another folder renders the same board', { skip }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-move-'));
  try {
    const { paths, specPath } = await prepare('import-pair-3x.json', home);
    const options = { paths, rendererLocation: async () => renderer };
    const first = await compose({ command: 'compose', spec: specPath }, options);
    const original = await readFile(first.out);
    const moved = path.join(home, 'elsewhere');
    await mkdir(moved);
    for (const entry of await readdir(paths.screenshotsDir)) {
      if (/\.(spec\.json|capture\.json)$/.test(entry) || /\.c\d+\.png$/.test(entry)) await copyFile(path.join(paths.screenshotsDir, entry), path.join(moved, entry));
    }
    for (const entry of await readdir(paths.screenshotsDir)) await rm(path.join(paths.screenshotsDir, entry), { recursive: true });
    const second = await compose({ command: 'compose', spec: path.join(moved, path.basename(specPath)) }, options);
    assert.equal(second.out, first.out, 'the board still lands in the screenshots folder');
    const diff = await diffPngs({ a: original, b: await readFile(second.out), renderer, tolerance: 0 });
    assert.deepEqual([diff.sameSize, diff.differing], [true, 0], 'the copied bundle draws the same pixels');
  } finally { await rm(home, { recursive: true, force: true }); }
});
```

(`copyFile` joins the `node:fs/promises` import.)

Run both e2e files → FAIL (`source` undefined, imported captures have no frame).

- [ ] **Step 5: Compose an imported panel**

`lib/commands/compose.mjs`, after the captures are loaded and validated:

```js
  // An imported capture has no measurements: its frame and boxes are the panel's own, placed by inspection.
  const drawn = captures.map((capture, index) => (capture.source === 'import'
    ? { ...capture, frame: panels[index].frame, boxes: panels[index].boxes ?? {} } : capture));
```

and `buildBoardHtml` receives `captures: drawn`. `validateSpec(spec, captures)` keeps receiving the loaded captures.

`lib/compose/page.mjs`: each capture in the page data gains `source: c.source === 'import' ? 'import' : 'live'`; CSS gains

```css
.origin{padding:2px 7px;border-radius:999px;background:#E0E7FF;color:#3730A3;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap}
```

`lib/compose/page-layout.js`:

- Module constants `REDACT_GROW = 2` and `IMPORT_REDACT_PAD = 12`. `redactedSource(capture, regions, fill, grow)` fills `[x - grow, y - grow, w + 2 * grow, h + 2 * grow]`.
- `sourceOf`: `const imported = capture.source === 'import'; const grow = imported ? IMPORT_REDACT_PAD : REDACT_GROW;`, `fillRects` built with `grow`, and `const dark = imported ? frameIsDark(pixels, shown) : Boolean(capture.dark);` once `shown` is known. `src.imported = imported`.
- `drawPanel`: `report.redactions` records the fill as drawn: `const rect = clip(map(fillRect))`, pushed when not null (this replaces mapping the bare box, so a live redaction's `rect` grows by its 2 px on each side). The head is drawn when `head.headed || src.imported`, and an imported panel's head ends with `el('span', 'origin', phead, 'From the ticket')`. `panel.source = imported ? 'import' : 'live'`; `head.origin = imported`.
- `__composeLayout` passes `headed: layout !== 'single' || Boolean(src.panel.label) || src.imported`.

`tests/e2e/helpers/invariants.mjs`: `assertPanel` gains `for (const r of panel.redactions) assert.ok(inside(r.rect, panel.capture), 'a redaction is drawn outside the screenshot');`.

- [ ] **Step 6: Run, generate, look**

Run: `node --test tests/e2e/compose-invariants.test.mjs` → PASS.

Run: `UPDATE_GOLDENS=1 node --test --test-name-pattern='import-' tests/e2e/compose-fixtures.test.mjs`, then Read both goldens.
Check and write down: `import-single` shows the card cropped from the 2x screenshot, a "FROM THE TICKET" chip in its head, the dashed slot over the blank chart, and solid fills over the owner line and the contact line with **no letter of either visible**, including at the fills' ends; `import-pair-3x` shows the two cards at the same height though one source is three times the other, BEFORE with its chip and AFTER without, and reads as a before and after of one region. If a fill misses a letter, the inspection box in the fixture is wrong: fix the numbers from the CSS positions above, never by widening the pad.

Existing goldens with a redaction (`nested-cards`, `redact-under-lift`) must not change: `git status --short tests/fixtures/evidence/goldens` shows two new files only.

- [ ] **Step 7: Suites, commit**

Run: `npm run test:compose && npm test` → 0 fail.

```bash
git add lib tests
git commit -m "compose: imported panels, placed by inspection and labelled as from the ticket"
```

---

### Task 13: Redaction crops, the record, and `--confirm`

The fast-browser half of the redaction gate, and the parked `out` collision check.

**Files:**
- Create: `lib/compose/redactions.mjs`, `tests/unit/compose-redactions.test.mjs`
- Modify: `lib/compose/engine.mjs`, `lib/compose/page-layout.js`, `lib/commands/compose.mjs`, `lib/cli/parse-args.mjs`, `lib/cli/main.mjs`, `tests/e2e/compose-fixtures.test.mjs`
- Test: `node --test tests/unit/compose-redactions.test.mjs`, `npm run test:compose`

**Interfaces:**
- Consumes: `sameFile`, `writeAtomic` and the compose option parsing (Task 11); `panel.redactions[].rect` and `panel.source` (Task 12).
- Produces:
  - Report (layout): `report.gated: boolean` (some imported panel declares a `redact`), `report.crops: [{ panel, redaction, rect }]` (`redaction` indexes `panels[panel].redactions`) in board CSS pixels, whole numbers, each a drawn redaction grown by `CROP_MARGIN = 24` and clipped to the stage; empty unless `gated`.
  - `renderBoard` returns `{ report, pixels, crops: Buffer[] }`.
  - `redactions.mjs`: `REDACTIONS_SCHEMA = 'compose-redactions/1'`; `recordName(stem)`, `cropName(stem, n)`, `isRedactionArtifact(name, stem)`; `clearRedactionArtifacts(dir, stem)`; `writeRedactionRecord({ dir, stem, boardPath, crops: [{ bytes, panel }] }) -> { record, crops: string[] }`; `confirmRedactions({ dir, stem, fail }) -> { record, confirmed: number }`.
  - The record: `{ "schemaVersion": "compose-redactions/1", "board": "<stem>.png", "boardSha256": "...", "redactions": [{ "crop": "<stem>.redact-1.png", "sha256": "...", "panel": 0, "confirmed": false }] }`.
  - Render report gains `redactions: { record, crops }` when gated; `{ mode: 'confirm', ok, record, confirmed }`.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/compose-redactions.test.mjs`:

```js
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { main } from '../../lib/cli/main.mjs';
import { parseArgs } from '../../lib/cli/parse-args.mjs';
import { compose } from '../../lib/commands/compose.mjs';
import { CAPTURE_SCHEMA, captureDigest } from '../../lib/compose/capture.mjs';
import { resolvePaths } from '../../lib/core/paths.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
  + '1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const crop = (n) => Buffer.concat([PNG, Buffer.from([n])]);

async function world({ out = 'b.png' } = {}) {
  const home = await mkdtemp(path.join(tmpdir(), 'fb-red-'));
  const paths = resolvePaths({ homeDir: home, pluginRoot: path.resolve('.') });
  const dir = paths.screenshotsDir;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'b.c1.png'), PNG);
  const frame = [0, 0, 1, 1]; const boxes = { a: [0, 0, 1, 1] };
  await writeFile(path.join(dir, 'b.c1.capture.json'), JSON.stringify({ schemaVersion: CAPTURE_SCHEMA, source: 'live', image: 'b.c1.png',
    frame, frameSnap: 'card', boxes, missed: [], dark: false, scale: 1, digest: captureDigest(PNG, { frame, boxes }) }));
  const specPath = path.join(dir, 'b.spec.json');
  await writeFile(specPath, JSON.stringify({ state: 'AFTER', title: 'T', out, panels: [{ capture: 'b.c1.capture.json', marks: [{ redact: 'a' }] }] }));
  return { home, paths, dir, specPath };
}

// Stands in for the renderer: writes the board and hands back `count` crops.
const rendering = (count, gated = true) => ({
  rendererLocation: async () => ({ executablePath: '/x', playwrightCore: '/y' }),
  renderBoard: async ({ outPath }) => {
    await writeFile(outPath, PNG);
    const crops = Array.from({ length: count }, (_, i) => ({ panel: 0, rect: [0, 0, 1, 1], i }));
    return { report: { warnings: [], gated, crops }, pixels: { width: 2, height: 2 }, crops: crops.map((c) => crop(c.i)) };
  },
});
const render = (w, count, gated) => compose({ command: 'compose', spec: w.specPath }, { paths: w.paths, ...rendering(count, gated) });
const confirm = (w) => compose(parseArgs(['compose', '--confirm', w.specPath]), { paths: w.paths });
const record = async (w) => JSON.parse(await readFile(path.join(w.dir, 'b.redactions.json'), 'utf8'));

test('a gated render writes one crop per redaction and an unconfirmed record', async () => {
  const w = await world();
  try {
    const report = await render(w, 2);
    assert.deepEqual(report.redactions.crops.map((p) => path.basename(p)), ['b.redact-1.png', 'b.redact-2.png']);
    const body = await record(w);
    assert.deepEqual([body.schemaVersion, body.board, body.redactions.length], ['compose-redactions/1', 'b.png', 2]);
    assert.ok(body.redactions.every((r) => r.confirmed === false && /^[0-9a-f]{64}$/.test(r.sha256)));
    assert.deepEqual(await readFile(path.join(w.dir, 'b.redact-2.png')), crop(1));
  } finally { await rm(w.home, { recursive: true, force: true }); }
});

test('confirm marks every entry, and confirming twice changes nothing', async () => {
  const w = await world();
  try {
    await render(w, 2);
    assert.deepEqual([(await confirm(w)).mode, (await confirm(w)).confirmed], ['confirm', 2]);
    assert.ok((await record(w)).redactions.every((r) => r.confirmed === true));
  } finally { await rm(w.home, { recursive: true, force: true }); }
});

test('confirm refuses a missing crop, a changed crop and a changed board', async () => {
  for (const [change, message] of [
    [(w) => rm(path.join(w.dir, 'b.redact-1.png')), /a redaction crop is missing/],
    [(w) => writeFile(path.join(w.dir, 'b.redact-2.png'), crop(9)), /a redaction crop changed/],
    [(w) => writeFile(path.join(w.dir, 'b.png'), crop(7)), /the board changed/],
  ]) {
    const w = await world();
    try {
      await render(w, 2);
      await change(w);
      await assert.rejects(() => confirm(w), (error) => error.exitCode === 2 && message.test(error.message));
      assert.ok((await record(w)).redactions.every((r) => r.confirmed === false), 'a refused confirm confirms nothing');
    } finally { await rm(w.home, { recursive: true, force: true }); }
  }
});

test('a re-render resets a confirmed record and leaves no crop from the earlier render', async () => {
  const w = await world();
  try {
    await render(w, 3);
    await confirm(w);
    await render(w, 1);
    assert.ok((await record(w)).redactions.every((r) => r.confirmed === false));
    assert.deepEqual((await readdir(w.dir)).filter((f) => f.includes('.redact-')), ['b.redact-1.png']);
  } finally { await rm(w.home, { recursive: true, force: true }); }
});

test('a board with no imported redaction has no record, and loses a stale one', async () => {
  const w = await world();
  try {
    await render(w, 1);
    const report = await render(w, 0, false);
    assert.equal(report.redactions, undefined);
    assert.deepEqual((await readdir(w.dir)).filter((f) => f.includes('redact')), []);
    await assert.rejects(() => confirm(w), /this board has no redaction record/);
  } finally { await rm(w.home, { recursive: true, force: true }); }
});

test('a record that names a crop outside its own bundle is refused', async () => {
  const w = await world();
  try {
    await render(w, 1);
    const body = await record(w);
    body.redactions[0].crop = '../b.c1.png';
    await writeFile(path.join(w.dir, 'b.redactions.json'), JSON.stringify(body));
    await assert.rejects(() => confirm(w), /the redaction record is malformed/);
  } finally { await rm(w.home, { recursive: true, force: true }); }
});

const sidecarFor = (image) => JSON.stringify({ schemaVersion: CAPTURE_SCHEMA, source: 'live', image, frame: [0, 0, 1, 1], frameSnap: 'card',
  boxes: {}, missed: [], dark: false, scale: 1, digest: captureDigest(PNG, { frame: [0, 0, 1, 1], boxes: {} }) });

for (const [label, out, prepare] of [
  ['a differently cased capture name', 'B.C1.png', async () => {}],
  ['a symlink to a capture', 'alias.png', async (w) => symlink(path.join(w.dir, 'b.c1.png'), path.join(w.dir, 'alias.png'))],
  // The board's first crop would be written as b.redact-1.png, which this spec reads as a capture.
  ['a name whose crops would land on a capture', 'b.png', async (w) => {
    await writeFile(path.join(w.dir, 'b.redact-1.png'), PNG);
    await writeFile(path.join(w.dir, 'b.redact-1.capture.json'), sidecarFor('b.redact-1.png'));
    await writeFile(w.specPath, JSON.stringify({ state: 'AFTER', title: 'T', out: 'b.png', panels: [{ capture: 'b.redact-1.capture.json', marks: [] }] }));
  }],
]) {
  test(`render refuses an out that is ${label}`, async () => {
    const w = await world({ out });
    try {
      await prepare(w);
      await assert.rejects(() => compose({ command: 'compose', spec: w.specPath }, { paths: w.paths, ...rendering(1), renderBoard: async () => { throw new Error('must not render'); } }),
        (error) => error.exitCode === 2 && /\bout\b/.test(error.message));
      assert.deepEqual(await readFile(path.join(w.dir, 'b.c1.png')), PNG, 'the capture is untouched');
    } finally { await rm(w.home, { recursive: true, force: true }); }
  });
}

test('the CLI parses --confirm as a mode of its own', () => {
  assert.equal(parseArgs(['compose', '--confirm', 'b.spec.json']).confirm, 'b.spec.json');
  assert.equal(parseArgs(['compose', 'b.spec.json']).confirm, null);
  assert.throws(() => parseArgs(['compose', 'b.spec.json', '--confirm', 'b.spec.json']), /compose takes one of a spec path, --seal, --import or --confirm/);
  assert.throws(() => parseArgs(['compose', '--confirm']), /--confirm requires a value/);
});

test('the CLI names the crops to read and says who confirms', async () => {
  const lines = [];
  const report = { mode: 'render', ok: true, out: '/s/b.png', warnings: [], width: 2, height: 2, redactions: { record: '/s/b.redactions.json', crops: ['/s/b.redact-1.png'] } };
  await main(parseArgs(['compose', 'b.spec.json']), { write: (t) => lines.push(t), commands: { compose: async () => report } });
  assert.match(lines.join(''), /Redaction crops to read, unconfirmed:\n- \/s\/b\.redact-1\.png\n/);
  assert.match(lines.join(''), /only after the operator has confirmed every crop/);
  lines.length = 0;
  await main(parseArgs(['compose', '--confirm', 'b.spec.json']), { write: (t) => lines.push(t), commands: { compose: async () => ({ mode: 'confirm', ok: true, record: '/s/b.redactions.json', confirmed: 2 }) } });
  assert.equal(lines.join(''), 'Confirmed 2 redactions: /s/b.redactions.json\n');
});
```

Run: `node --test tests/unit/compose-redactions.test.mjs` → FAIL.

- [ ] **Step 2: `redactions.mjs`**

```js
import crypto from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { writeAtomic } from './files.mjs';

export const REDACTIONS_SCHEMA = 'compose-redactions/1';
export const recordName = (stem) => `${stem}.redactions.json`;
export const cropName = (stem, n) => `${stem}.redact-${n}.png`;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// Case is ignored: on the default macOS volume two spellings name one file.
export function isRedactionArtifact(name, stem) {
  const lower = name.toLowerCase(); const prefix = `${stem.toLowerCase()}.`;
  if (!lower.startsWith(prefix)) return false;
  const rest = lower.slice(prefix.length);
  return rest === 'redactions.json' || /^redact-\d+\.png$/.test(rest);
}

export async function clearRedactionArtifacts(dir, stem) {
  let entries;
  try { entries = await readdir(dir); } catch { return; }
  await Promise.all(entries.filter((name) => isRedactionArtifact(name, stem)).map((name) => rm(path.join(dir, name), { force: true })));
}

export async function writeRedactionRecord({ dir, stem, boardPath, crops }) {
  const written = [];
  const redactions = [];
  for (const [index, crop] of crops.entries()) {
    const name = cropName(stem, index + 1);
    await writeAtomic(path.join(dir, name), crop.bytes);
    written.push(path.join(dir, name));
    redactions.push({ crop: name, sha256: sha256(crop.bytes), panel: crop.panel, confirmed: false });
  }
  const record = path.join(dir, recordName(stem));
  await writeAtomic(record, `${JSON.stringify({
    schemaVersion: REDACTIONS_SCHEMA, board: path.basename(boardPath), boardSha256: sha256(await readFile(boardPath)), redactions,
  }, null, 2)}\n`);
  return { record, crops: written };
}

export async function confirmRedactions({ dir, stem, fail }) {
  const recordPath = path.join(dir, recordName(stem));
  let record;
  try { record = JSON.parse(await readFile(recordPath, 'utf8')); } catch { throw fail('this board has no redaction record; render it first'); }
  const entries = record?.redactions;
  if (record?.schemaVersion !== REDACTIONS_SCHEMA || record.board !== `${stem}.png` || !Array.isArray(entries)
    || entries.some((entry, index) => entry?.crop !== cropName(stem, index + 1) || typeof entry.sha256 !== 'string')) {
    throw fail('the redaction record is malformed; render the board again');
  }
  let board;
  try { board = await readFile(path.join(dir, record.board)); } catch { throw fail('the board is missing; render it again'); }
  if (sha256(board) !== record.boardSha256) throw fail('the board changed since it was rendered; render it again');
  for (const entry of entries) {
    let bytes;
    try { bytes = await readFile(path.join(dir, entry.crop)); } catch { throw fail('a redaction crop is missing; render the board again'); }
    if (sha256(bytes) !== entry.sha256) throw fail('a redaction crop changed since it was rendered; render the board again');
  }
  await writeAtomic(recordPath, `${JSON.stringify({ ...record, redactions: entries.map((entry) => ({ ...entry, confirmed: true })) }, null, 2)}\n`);
  return { record: recordPath, confirmed: entries.length };
}
```

- [ ] **Step 3: The layout says what to crop; the engine crops**

`lib/compose/page-layout.js`, at the end of `__composeLayout`, before the report is returned, with `const CROP_MARGIN = 24;` at module scope:

```js
    const gated = spec.panels.some((panel, i) => captures[i].source === 'import' && (panel.marks || []).some((mark) => 'redact' in mark));
    const whole = ([x, y, w, h]) => {
      const x0 = Math.max(0, Math.floor(x - CROP_MARGIN)); const y0 = Math.max(0, Math.floor(y - CROP_MARGIN));
      return [x0, y0, Math.min(Math.ceil(s.width), Math.ceil(x + w + CROP_MARGIN)) - x0, Math.min(Math.ceil(s.height), Math.ceil(y + h + CROP_MARGIN)) - y0];
    };
    report.gated = gated;
    report.crops = gated ? panels.flatMap((panel, p) => panel.redactions.map((r, k) => ({ panel: p, redaction: k, rect: whole(r.rect) }))) : [];
```

`lib/compose/engine.mjs`, in `renderBoard`, after the stage screenshot is renamed into place:

```js
    // Cut from the page that drew the board, at the board's own device scale:
    // a downscaled view of the whole board is how a readable sliver survives.
    const crops = [];
    if (report.crops?.length) {
      const stage = await page.locator('#stage').boundingBox();
      for (const { rect: [x, y, width, height] } of report.crops) {
        crops.push(await page.screenshot({ fullPage: true, omitBackground: true, clip: { x: stage.x + x, y: stage.y + y, width, height } }));
      }
    }
    return { report, pixels: { width, height }, crops };
```

- [ ] **Step 4: The command: clear, render, record, confirm, and the stricter `out` check**

`lib/commands/compose.mjs`:

- Imports: `sameFile` from `../compose/files.mjs`; `clearRedactionArtifacts`, `confirmRedactions`, `isRedactionArtifact`, `writeRedactionRecord` from `../compose/redactions.mjs`.
- Before the spec is read for a render, the confirm mode:

```js
  if (request.confirm) {
    const spec = await readJson(path.resolve(request.confirm), 'compose spec');
    if (!spec || typeof spec.out !== 'string' || !spec.out.endsWith('.png')) throw fail('the compose spec names no board to confirm');
    const board = await confinedScreenshotPath(paths, spec.out, 'out', fail);
    const done = await confirmRedactions({ dir: path.dirname(board), stem: path.basename(board, '.png'), fail });
    return { mode: 'confirm', ok: true, ...done };
  }
```

- The `out` check, replacing the byte-for-byte comparison:

```js
  const stem = path.basename(outPath, '.png'); const outDir = path.dirname(outPath);
  for (const input of [specPath, ...captures.flatMap((capture) => [capture.pngPath, capture.sidecarPath])]) {
    const besideBoard = await sameFile(path.dirname(input), outDir);
    if (await sameFile(input, outPath) || (besideBoard && isRedactionArtifact(path.basename(input), stem))) {
      throw fail('out must not name the spec or one of its captures');
    }
  }
```

- Around the render:

```js
  // Cleared before drawing, so a render that dies cannot leave a confirmed record beside a new board.
  await clearRedactionArtifacts(outDir, stem);
```

  and after it:

```js
  const { report, pixels } = rendered;
  const redactions = report.gated
    ? await writeRedactionRecord({ dir: outDir, stem, boardPath: outPath, crops: (rendered.crops ?? []).map((bytes, i) => ({ bytes, panel: report.crops[i].panel })) })
    : null;
  return { mode: 'render', ok: true, out: outPath, warnings: report.warnings ?? [], width: pixels.width, height: pixels.height, ...(redactions ? { redactions } : {}) };
```

`lib/cli/parse-args.mjs`, four small edits to what Task 11 added: the init line also sets `request.confirm = null`; the option list becomes `['--import', '--out', '--origin', '--confirm']`; the "requires" check gains `&& request.confirm === null` and reads `compose requires a spec path or --seal, --import or --confirm`; and `modes` counts `request.confirm` too, with the message `compose takes one of a spec path, --seal, --import or --confirm`.

`lib/cli/main.mjs`, compose branch:

```js
    if (report.mode === 'confirm') return `Confirmed ${report.confirmed} redaction${report.confirmed === 1 ? '' : 's'}: ${report.record}\n`;
```

and the render line gains, when `report.redactions` is set:

```js
    const crops = report.redactions
      ? `\nRedaction crops to read, unconfirmed:\n- ${report.redactions.crops.join('\n- ')}\nRun \`fast-browser compose --confirm <spec.json>\` only after the operator has confirmed every crop.`
      : '';
    return `Composed board at ${report.width}x${report.height}: ${report.out}${notes}${crops}\n`;
```

Run: `node --test tests/unit/compose-redactions.test.mjs tests/unit/compose-command.test.mjs` → PASS, with no edit to `compose-command.test.mjs` (its three "out would overwrite" tests still pass against the stricter check).

- [ ] **Step 5: The real thing, on the imported fixtures**

In `tests/e2e/compose-fixtures.test.mjs`, after the redaction sampling block (`report` here is `compose`'s return):

```js
      if (fixture.expect?.crops === undefined) assert.equal(report.redactions, undefined, 'a board with no imported redaction has no record');
      else {
        assert.equal(report.redactions.crops.length, fixture.expect.crops, 'one crop per drawn redaction');
        const body = JSON.parse(await readFile(report.redactions.record, 'utf8'));
        assert.ok(body.redactions.every((r) => r.confirmed === false), 'a fresh render is unconfirmed');
        for (const [i, file] of report.redactions.crops.entries()) {
          const bytes = await readFile(file);
          const [, , w, h] = layoutReport.crops[i].rect;
          assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [Math.round(w * scale), Math.round(h * scale)], 'the crop is at the board\'s full resolution');
          // The drawn redaction, inset past its antialiased edge, is fill and nothing else.
          const { panel, redaction } = layoutReport.crops[i];
          const [rx, ry, rw, rh] = layoutReport.panels[panel].redactions[redaction].rect;
          const [cx, cy] = layoutReport.crops[i].rect;
          const inner = [rx - cx + 3, ry - cy + 3, rw - 6, rh - 6].map((v) => Math.round(v * scale));
          const off = await countOffColor({ png: bytes, rect: inner, color: fill, tolerance: 24, renderer });
          assert.equal(off.off, 0, `${off.off} pixels of a crop's redaction are not fill`);
        }
        const options = { paths, rendererLocation: async () => renderer };
        assert.equal((await compose({ command: 'compose', confirm: specPath }, options)).confirmed, fixture.expect.crops);
        await compose({ command: 'compose', spec: specPath }, options);
        const again = JSON.parse(await readFile(report.redactions.record, 'utf8'));
        assert.ok(again.redactions.every((r) => r.confirmed === false), 're-rendering resets the confirmation');
      }
```

Run: `npm run test:compose` → PASS, goldens unchanged (crops are extra files; the board's pixels do not move).

- [ ] **Step 6: Look at the crops**

Compose `import-single` by hand into a temp home (the suite's `prepare` shows how) and Read each `fx-import-single.redact-<n>.png`. Write down: the crop is sharp (board resolution, not a thumbnail); it shows the whole fill with a margin of context around it; no letter of the hidden text is visible at any edge of the fill.

- [ ] **Step 7: Suites, commit**

Run: `npm run test:compose && npm test` → 0 fail.

```bash
git add lib tests
git commit -m "compose: redaction crops, the confirmation record, and compose --confirm"
```

---

### Task 14: The skill learns imported panels and the redaction gate

**Files:**
- Modify: `skills/composing-evidence/SKILL.md`, `tests/unit/skills.test.mjs` (the same test as Task 9), `tests/skills/composing-evidence/red.md`, `tests/skills/composing-evidence/green.md`

- [ ] **Step 1: Load `superpowers:writing-skills`; RED on paper**

Three fresh agents (`general-purpose`, `sonnet`, `medium`) get the Task 9 skill text and: "A ticket has a screenshot of the broken page attached, saved at `/tmp/ticket.jpg`, 2400 by 1600 pixels. It shows a customer's name and email. Describe, command by command and with the spec you would write, how you produce a before board from it with the name and email hidden. Your image viewer shows it at 1200 by 800." Record in `red.md` under `## 2026-10: imported images (milestone 3)`: whether it invents an import path, what coordinates it writes (viewer pixels or image pixels), whether it checks the redaction, whether it treats the board as finished.

- [ ] **Step 2: Pin the contract**

In `tests/unit/skills.test.mjs`, the same test, after the lines Task 9 added:

```js
  assert.match(text, /fast-browser compose --import <image> --out <board>\.c1 --origin <ticket link>/);
  assert.match(text, phrase("the image's real pixels"));
  assert.match(text, phrase('Read every crop'));
  assert.match(text, phrase('not the whole board'));
  assert.match(text, /fast-browser compose --confirm <spec\.json>/);
  assert.match(text, phrase('Never run it yourself'));
  assert.match(text, phrase('renders it unconfirmed again'));
```

Run → FAIL.

- [ ] **Step 3: Add the section**

The frontmatter `description` becomes: `Use when a live page, or a screenshot attached to a ticket, needs to become polished evidence for an MR or ticket, such as proving a value changed, showing a fixed bug, or marking what a reviewer should look at, and the result should be a cropped, labelled image rather than a marked-up full screenshot`.

Insert before `## Done means`:

````markdown
## A screenshot from a ticket

A ticket's screenshot has no page behind it, so nothing can be measured.
This is the one place you write coordinates.

1. **Import it.**
   `fast-browser compose --import <image> --out <board>.c1 --origin <ticket link>`.
   It prints the image's real size and the sidecar path.
2. **Read the image and place the frame and the boxes** in the image's real
   pixels. Your viewer may show it smaller; then multiply everything you
   read off it by real width over shown width. Pad each box 6 to 10 real
   pixels so it covers what it marks.
3. **Write the panel** with `frame` and `boxes` beside `capture`:

```json
{ "label": "BEFORE", "capture": "<board>.c1.capture.json",
  "frame": [x, y, w, h],
  "boxes": { "chart": [x, y, w, h], "email": [x, y, w, h] },
  "marks": [ { "empty": "chart", "text": "Nothing rendered here" }, { "redact": "email" } ] }
```

   The whole image is `[0, 0, width, height]`, and is almost never the right
   frame. Compose refuses a frame outside the image and a box outside the
   frame, and labels the panel as from the ticket.
4. **Hide everything the brief says to hide**, wherever it appears inside
   the frame, not only where you are pointing. Crop first: what is outside
   the frame is not shown.
5. **Render, then read every crop.** For a ticket image with a `redact`,
   compose writes `<board>.redact-<n>.png` beside the board, one per
   redaction, at full resolution. Read every crop, not the whole board: a
   shrunken board is how a readable sliver survives. If any letter shows,
   widen that box and render again.
6. **Stop there.** The board is not done until the operator has looked at
   each crop and said yes. Report the crop paths and that the board is
   unconfirmed. `fast-browser compose --confirm <spec.json>` records that
   yes. Never run it yourself unless the operator confirmed this board's
   crops in this conversation; a re-render renders it unconfirmed again.

When a live after is paired with a ticket before, frame the after on the
same region with an explicit frame selector.
````

`## Done means` gains: "For a ticket image with a redaction, also report each crop's path, that you read each one, and that the board is unconfirmed."

- [ ] **Step 4: Unit test, GREEN on paper, commit**

Run: `node --test tests/unit/skills.test.mjs` → PASS.

Three fresh agents with the Step 1 prompt and the new text. Each must: run `--import` with `--out` and `--origin`; write `frame` and `boxes` in 2400-wide pixels (twice what the viewer shows); redact both fields; read the crops; and stop without running `--confirm`. Record in `green.md`. A miss is a wording fix and a rerun.

Run: `npm test` → 0 fail.

```bash
git add skills/composing-evidence/SKILL.md tests/unit/skills.test.mjs tests/skills/composing-evidence
git commit -m "composing-evidence: ticket screenshots, redaction crops and the confirm rule"
```

---

### Task 15: Milestone exit: blind eval B, the contact sheet, and every board looked at

**Controller only.** Nothing here is committed.

**Files (never committed):** `.superpowers/eval/m3-exit/` (brief, boards, specs, crops, `score.md`, `sheet.html`)

- [ ] **Step 1: Open the gate**

`herd_ask`, one ask, then stop:

1. *Run the exit blind eval in your Chrome now?* Options: yes, the same app as eval A, all primitives plus a ticket screenshot (recommended); yes, but you supply the ticket screenshot's path first; not now.
2. *Where does the contact sheet go?* Options: a local HTML file I open for you (recommended: the boards show the eval app); a private artifact; both.

The context says what stands in for the ticket screenshot under the first option: the run's own first full-page capture of the eval app, re-saved as a JPEG, with two visible fields declared as personal data to hide. It is QA fixture data, so a redaction that fails exposes nothing real, and it exercises import, inspection geometry, the 12 px pad, the crops and the record end to end.

- [ ] **Step 2: Run the exit eval**

The brief covers every milestone 3 primitive (the eval A cases, fixed or not), plus: a `FOUND` board from the ticket image alone with the declared fields hidden, and a `BEFORE → AFTER` pair whose before is the ticket image and whose after is the live page framed on the same region. Run name `m3x`. Dispatch `fast-browser:browser-driver`, `model: sonnet`, effort `medium`, skill path and brief path only.

- [ ] **Step 3: Score against the spec's bar**

`score.md`, per case: board made; capture calls against the budget the eval A gate set; every declared redaction holds (read each `redact-<n>.png` crop yourself at full size, and the live redaction on its board); the record exists and every entry is still `confirmed: false` (the driver must not have confirmed); score 1 to 5 from an `opus` `high` judge against the spike's board for that primitive (`spike/blind/out/` and `spike/blind/out-import/`). The bar: every case has a board, the capture budget holds, every declared redaction holds, every board scores 4 or more.

A miss becomes a fix task with its test first, then a rerun of the failing cases; after two rounds, `herd_ask` with the scores.

- [ ] **Step 4: One Haiku run**

Once Sonnet meets the bar, run the same brief once with `model: haiku`, effort `medium`, run name `m3x-haiku`. Record its scores in `score.md` under their own heading. It does not gate the milestone; it answers the spec's open question with a measurement.

- [ ] **Step 5: Build the contact sheet and look at every board**

`sheet.html` in the eval folder: every eval board beside its reference, then every fixture golden this milestone added (`empty-chart`, `ghost-button`, `bracket-rows`, `bracket-table`, `loupe-badge`, `link-version`, `pair-before-after`, `pair-light-dark`, `steps-flow`, `import-single`, `import-pair-3x`) and the redaction crops, each with its one-line verdict. The page follows the system colour scheme, light and dark. Open it with `open` and, if the gate asked for it, publish it as a private artifact.

Read every board on it yourself and write, per board type, what reads wrong in plain words. "Looks fine" is acceptable only when it is true.

---

### Task 16: Final review, squash, purity, ship

**Controller only.**

- [ ] **Step 1: Goldens from the final code**

With the tree clean at the last task's commit: `UPDATE_GOLDENS=1 npm run test:compose`, then `git status --short`. Expected: no output. Any golden that changes was committed from a tree that differed from its commit: open it, confirm it is the right picture, commit it, and repeat this step until it is a no-op.

- [ ] **Step 2: The three suites**

Run: `npm test` → 0 fail. `npm run test:integration` → 0 fail. `npm run test:compose` → 0 fail. Record the three counts.

- [ ] **Step 3: Final whole-branch review**

Dispatch the final reviewer (`opus`, `high`) on `a2ba811..HEAD` with the spec's Milestone 3 section and this plan. It runs `npm run test:compose` itself. One fix wave for what it finds, then a scoped re-review of the wave. The verdict must be an approval.

- [ ] **Step 4: Rebase if milestone 2 landed**

`git fetch origin main`. If `origin/main` moved, rebase onto it. In a shared file, the owner's version wins and the other milestone's named change is re-applied on top: this branch owns every shared file except `lib/compose/capture.mjs`, where milestone 2's version wins and the `source: "import"` branch of `loadCapture` is re-applied. Then repeat Steps 1 and 2.

- [ ] **Step 5: Squash to one commit**

```bash
git reset --soft "$(git merge-base HEAD origin/main)"
git commit -m "compose: the remaining primitives, pair and steps layouts, and imported ticket panels"
```

The message body lists what the milestone adds in plain lines, with no ticket id and no product name. Rerun Step 2 on the squashed commit.

- [ ] **Step 6: Purity scan**

Scan the squashed diff and the PR body for employer names, URLs, data, ticket ids and business-domain wording: `git diff origin/main...HEAD | grep -inE -f .superpowers/purity-terms.txt`, with the term list kept in that ignored file and written to no repo. Also scan every new golden by eye one last time for text that is not the fixtures' made-up tracker. Expected: no hit. A hit is fixed in the tree and Step 5 is repeated; it is never pushed and fixed later.

- [ ] **Step 7: Push and open the PR**

`git_push` with this worktree as `tree` and `setUpstream: true`. Then `gh pr create --repo m4ttstack/fast-browser --base main` with a body in the repo-less fallback shape: two framing sentences, "What changed" with bold-labelled one-clause bullets (Marks, Layouts, Imported panels, Redaction gate, Layout fixes, Skill), and "Verification" with the three suite counts, the blind eval's result in one sentence that names no product, and the goldens added. No em dashes. Run Step 6's scan on the body before creating it.

- [ ] **Step 8: CodeRabbit and CI**

Wait for CodeRabbit's review. The repo has no CI workflow; if a check appears, wait for it too. Address each actionable finding with a test first where one applies, amend the single commit, rerun Step 2 and Step 6, and push with `git_push` and `forceWithLease: true`. If CodeRabbit is rate limited, run one `opus` `high` review of the PR diff in its place. Never merge: the operator merges.

- [ ] **Step 9: Report**

Write `.superpowers/report-draft.md` in the format the job brief gives and publish it with `herd_report`.
