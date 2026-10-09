# Console runs pass 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved pass-2 polish of the console runs UI (quieter pages, polished gate form, record/review/inputs/evidence redesigns) and fix the bugs live use found (stage docs never resolve, junk legacy evidence links, slow generic run errors, loading that reads as empty, fixture faking lost races, oversized kit toasts).

**Architecture:** Logic fixes land first and are pure or server-side with unit tests: rt-client evidence parsing, daemon pack provenance, the console's stage-doc and legacy-image routes, the kit notification sizing. UI tasks then rework the runs components against the pass-2 boards, with `data-parity` keys and a light+dark parity run each. Derived facts stay in `apps/console/src/app/runs/derive/`.

**Tech Stack:** Bun monorepo; daemon in `lib/` (bun:test); `packages/rt-client` (bun:test); `packages/ui` kit on Mantine 9.5 (vitest); `apps/console` Hono server + React (vitest, Testing Library); pen.dev boards via the Pencil MCP; Fast Browser for parity.

**Spec:** `docs/superpowers/specs/2026-10-09-console-runs-pass-2-design.md` (builds on `docs/superpowers/specs/2026-10-08-console-runs-redesign-design.md`).

## Global Constraints

- Boards: the "After" frames in the Pass 2 section of `console work runs.pen` are the design; light is the base, dark is derived; every replaced board's dark variant is redrawn.
- One thing leads; metadata recedes: no fact appears twice on a screen.
- Copy-shortcut key chips on page metadata are removed (`t` ticket, `m` MR, `b` branch, `w` worktree) together with their copy hotkeys (`t b w m c`); gate-form keys stay (`1`-`9` pick, ⌘↵ submit) as small key caps.
- Kit first (`docs/apps/ui-authoring.md`): Mantine component as it ships, then a CSS module via `classNames`; never a hand-rolled control where the kit has one.
- Console tokens only; font weights 400/500/700 only; every surface works in light and dark.
- Pure selectors: derived facts come from `derive/` or new pure, unit-tested functions beside it.
- Kind-aware: an element that does not apply to a run's kind is omitted, not shown empty or zero.
- Every decision count on a page counts answered questions; "1 decision" is singular.
- Notification copy is sentence case with a capital ("Couldn't focus the pane").
- Live screenshots (employer data) stay local; designs, fixtures and commits use invented data only.
- Locally run only targeted tests for touched files (`bun test <file>` from the repo root for `lib/` and `packages/rt-client`; `bunx vitest run <file>` inside `apps/console` or `packages/ui`).
- Worktree git commands must be plain (no `cd` + git compounds); complex shell goes in a scratchpad script run with `bash <path>`.

## Review Focus

- A legacy evidence value that mixes prose, URLs and real image paths (the live ACME-1234 / ACME-1235 shapes) → only URLs and real file paths survive, image paths render as images; pinned in Task 2.
- A run recorded before team packs moved (`acme=<old sha>`) or with a `plugin=<sha>` token → its stage docs still resolve; pinned in Task 4.
- An unknown run id or a daemon outage → an error card within about a second, not a spinner for 7s; pinned in Task 15.
- A gate submit that fails for a reason other than a lost race → picks and note survive and Try again works; pinned in Task 9.
- A legacy image request for a path outside `~/.mattstack/evidence` or not named by the run → 404; pinned in Task 5.

---

### Task 1: Boards into the repo (controller task, Pencil)

The controller runs this task itself (it owns the Pencil canvas); no implementer subagent.

**Files:**
- Modify: `docs/apps/design/console/runs.pen` (replace with the saved `~/.pencil/documents/e2611ec9-4377-4e5e-b3f8-200921d09d36/console work runs.pen`)
- Create: `docs/apps/design/console/before/*.png` (only the files the Pass 2 "Before" frames reference; all are design-fixture or Storybook shots with invented data)
- Create: `docs/apps/design/console/parity/runs-p2-<slug>.<scheme>.html`, `docs/apps/design/console/renders/runs-p2-<slug>.<scheme>.png`
- Modify: `docs/apps/design/console/README.md` (a "Runs pass 2" section: board, frame id, route, fixture scenario; board-fix list entries)
- Modify: `apps/console/scripts/parity/boards.ts`

- [ ] **Step 1:** In Pencil, for each "After" frame, Copy it with `theme: { mode: "dark" }` to the right of the light board, named `<name> · dark`; check each dark board with an Export at scale 1 and read it (no unreadable text, borders visible).
- [ ] **Step 2:** Name every After board's content roots so parity can key them (`Hero`, `Story`, `Story list`, `Side`, `Gate`, `Columns`, `Decision log`, `Drawer`, `Summary`, `History`, etc., matching the `data-parity` keys tasks 8-17 will add); reuse first-pass layer names where the layer survived.
- [ ] **Step 3:** Export each After board light and dark as `html-css` with layer names to `docs/apps/design/console/parity/runs-p2-<slug>.<scheme>.html` and PNG scale 1 to `renders/`. Slugs: `live`, `gate`, `record`, `inputs`, `states`, `runs`, `review`, `story-details`, `overlays`, `search`.
- [ ] **Step 4:** Copy the `.pen` and the referenced `before/` images into `docs/apps/design/console/`; grep the copied `.pen` text for employer identifiers (the `scripts/repo-purity.sh` word list) and expect none in the Pass 2 frames.
- [ ] **Step 5:** Add the boards to `boards.ts` (slug, penPath frame id, route, fixture scenario, roots) and the README section; mark the first-pass boards they replace as superseded.
- [ ] **Step 6:** Commit: `git add docs/apps/design/console apps/console/scripts/parity/boards.ts` then `git commit -m "console design: pass 2 boards, dark variants, parity exports"`.

---

### Task 2: Legacy evidence parsing (rt-client)

**Files:**
- Modify: `packages/rt-client/src/evidence.ts`
- Test: `packages/rt-client/test/evidence.test.ts`

**Interfaces:**
- Produces: `parseEvidence(value)` unchanged signature; v0 `links` now only contains URLs and real file paths. New export `legacyItems(links: string[]): LegacyItem[]` where `type LegacyItem = { kind: 'image' | 'file' | 'url'; value: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { legacyItems, parseEvidence } from "../src/evidence";

describe("legacy evidence paths", () => {
  test("prose fractions and route patterns are not paths", () => {
    const v = JSON.stringify({
      before: "52/52 loads in the crawl; see https://tracker.example/WEB-1",
      after: "capture titles on /c/:id, /cases/:id and /orders/:id at ship",
    });
    expect(parseEvidence(v)).toEqual({ version: 0, links: ["https://tracker.example/WEB-1"] });
  });

  test("absolute file paths with an extension survive, mid-token slashes do not", () => {
    const v = "Evidence: /Users/acme/.mattstack/evidence/web-412/before.png and docs/a/b.md and x/y/z";
    expect(parseEvidence(v)).toEqual({ version: 0, links: ["/Users/acme/.mattstack/evidence/web-412/before.png"] });
  });

  test("a path inside quotes or brackets still starts a token", () => {
    const v = `["/tmp/ev/after.webp", "(/tmp/ev/log.txt)"]`;
    expect(parseEvidence(v)).toEqual({ version: 0, links: ["/tmp/ev/after.webp", "/tmp/ev/log.txt"] });
  });

  test("nothing but prose is no evidence", () => {
    expect(parseEvidence("screenshot -- /c/:id before/after")).toEqual({ version: null });
  });

  test("legacyItems sorts images, files and urls", () => {
    expect(legacyItems(["/a/b.PNG", "/a/c.log", "http://localhost:4001/orders/1#x"])).toEqual([
      { kind: "image", value: "/a/b.PNG" },
      { kind: "file", value: "/a/c.log" },
      { kind: "url", value: "http://localhost:4001/orders/1#x" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/rt-client/test/evidence.test.ts`
Expected: FAIL (the first test yields `/52`, `/c/:id` … links; `legacyItems` is not exported).

- [ ] **Step 3: Implement**

Replace the `LINK` regex and `linksIn` in `packages/rt-client/src/evidence.ts`:

```ts
const URL_RE = /https?:\/\/[^\s"',)\]]+/g;
// A file path starts a token (start, whitespace, quote or bracket) and ends
// in an extension; `52/52` and `/c/:id` are prose, not files.
const PATH_RE = /(?<=^|[\s"'([])(\/[^\s"',)\]]*\.[A-Za-z0-9]{1,8})(?=$|[\s"',)\]])/g;

function linksIn(text: string): string[] {
  const urls = text.match(URL_RE) ?? [];
  const withoutUrls = text.replace(URL_RE, " ");
  const paths = withoutUrls.match(PATH_RE) ?? [];
  return [...new Set([...urls, ...paths])];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

export type LegacyItem = { kind: "image" | "file" | "url"; value: string };

export function legacyItems(links: string[]): LegacyItem[] {
  return links.map((value) =>
    /^https?:\/\//i.test(value)
      ? { kind: "url", value }
      : { kind: IMAGE_EXT.test(value) ? "image" : "file", value },
  );
}
```

Keep `stringsIn` and the rest of `parseEvidence` as they are; they already call `linksIn`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test packages/rt-client/test/evidence.test.ts`
Expected: PASS, including the file's existing tests (update an existing expectation only where it asserted a `/`-prefixed prose token as a link; note each such change in the commit message).

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/evidence.ts packages/rt-client/test/evidence.test.ts
git commit -m "rt-client: legacy evidence keeps only urls and real file paths"
```

---

### Task 3: Pack provenance records the pack's own name (daemon)

**Files:**
- Modify: `lib/runs/provenance.ts`
- Test: `lib/runs/__tests__/provenance.test.ts`

**Interfaces:**
- Produces: `packProvenance(dirs)` records `<name>=<shortsha>` where `<name>` is `.claude-plugin/plugin.json`'s `name` when readable, else the directory basename.

- [ ] **Step 1: Write the failing test** (append to the describe block; reuse the file's `repo()` and `git()` helpers)

```ts
  test("records the plugin manifest's name, not the directory basename", () => {
    const dir = repo("plugin");
    mkdirSync(join(dir, ".claude-plugin"));
    writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme" }));
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "manifest");
    const sha = git(dir, "rev-parse", "--short", "HEAD");
    expect(packProvenance([dir]).commits).toEqual([`acme=${sha}`]);
  });

  test("an unreadable manifest falls back to the basename", () => {
    const dir = repo("badmanifest");
    mkdirSync(join(dir, ".claude-plugin"));
    writeFileSync(join(dir, ".claude-plugin", "plugin.json"), "{not json");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "bad");
    const sha = git(dir, "rev-parse", "--short", "HEAD");
    expect(packProvenance([dir]).commits).toEqual([`${dir.split("/").pop()}=${sha}`]);
  });
```

Add `mkdirSync` to the `fs` import.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/runs/__tests__/provenance.test.ts`
Expected: FAIL (first new test gets the basename).

- [ ] **Step 3: Implement** in `lib/runs/provenance.ts`

```ts
import { readFileSync } from "fs";
import { basename, join } from "path";

function packName(dir: string): string {
  try {
    const name = JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8"))?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  } catch {
    // An absent or broken manifest names the pack by its directory.
  }
  return basename(dir);
}
```

and change `commits.push(\`${basename(dir)}=${sha}\`)` to `commits.push(\`${packName(dir)}=${sha}\`)`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/runs/__tests__/provenance.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add lib/runs/provenance.ts lib/runs/__tests__/provenance.test.ts
git commit -m "runs: record a pack under its manifest name, not its folder"
```

---

### Task 4: Stage docs resolve for every recorded pack (console server)

**Files:**
- Create: `apps/console/src/server/stageDoc.ts` (pure resolution over injected `runGit`/`runRt` and a filesystem reader)
- Modify: `apps/console/src/server/effectiveInputs.ts` (the `/stage-doc` route calls `resolveStageDoc`)
- Test: `apps/console/src/server/stageDoc.test.ts`

**Interfaces:**
- Consumes: `parsePackCommits` (now also returns version tokens, below), `RunGit`, `RunRt` from `git-bin`/`rt-bin`.
- Produces: `resolveStageDoc(deps, input): Promise<{ text: string; pack: string; sha: string } | null>` with

```ts
export interface StageDocDeps {
  runGit: RunGit;
  packDirs: () => Promise<{ name: string; dir: string }[]>; // rt skills packs --json
  readFile: (path: string) => Promise<string | null>;
  pluginCacheDir: string; // ~/.claude/plugins/cache/mattstack/mattstack
}
export interface StageDocInput {
  packCommits: string | null; // runs.pack_commits
  stage: string;              // already validated against STAGE_NAME
}
```

Resolution order: tokens parsed from `packCommits` as `{ pack, ref, kind: 'sha' | 'version' }`; team packs (any pack not named `mattstack`) first, then `mattstack`. For a `sha` token: for each known pack dir (its own name first, then the rest), `git -C <dir> rev-parse --show-toplevel` → repo root; `git -C <root> cat-file -t <sha>` must print `commit`; then `git -C <root> ls-tree -r --name-only <sha>`; pick the path matching `(^|/)attachments/(pipeline/)?stage-<stage>/SKILL.md$`, preferring a path that contains `/<pack>/` or starts with the pack dir's path relative to the root; `git -C <root> show <sha>:<path>`. For a `version` token named `mattstack`: read `<pluginCacheDir>/<version>/attachments/pipeline/stage-<stage>/SKILL.md`. Return the first hit; null when nothing resolves. `parsePackCommits` keeps returning `{pack, sha}` for sha tokens (callers unchanged); add `parsePackTokens(s)` returning both kinds.

- [ ] **Step 1: Write the failing tests** (`stageDoc.test.ts`, vitest, fakes only)

```ts
import { describe, expect, it } from 'vitest';
import { parsePackTokens, resolveStageDoc, type StageDocDeps } from './stageDoc';

const fakeGit = (repos: Record<string, { root: string; commits: Record<string, Record<string, string>> }>) =>
  (async (args: string[]) => {
    const dir = args[1];
    const repo = Object.values(repos).find(r => dir.startsWith(r.root));
    if (!repo) return { code: 128, stdout: '', stderr: 'not a repo' };
    const cmd = args.slice(2);
    if (cmd[0] === 'rev-parse') return { code: 0, stdout: repo.root + '\n', stderr: '' };
    if (cmd[0] === 'cat-file') return repo.commits[cmd[2]] ? { code: 0, stdout: 'commit\n', stderr: '' } : { code: 128, stdout: '', stderr: 'bad' };
    if (cmd[0] === 'ls-tree') return { code: 0, stdout: Object.keys(repo.commits[cmd[3]] ?? {}).join('\n'), stderr: '' };
    if (cmd[0] === 'show') { const [sha, path] = cmd[1].split(':'); const t = repo.commits[sha]?.[path]; return t ? { code: 0, stdout: t, stderr: '' } : { code: 128, stdout: '', stderr: 'no path' }; }
    return { code: 1, stdout: '', stderr: '' };
  }) as StageDocDeps['runGit'];

const org = {
  root: '/org',
  commits: {
    aaa1111: { 'mattstack/packs/acme/attachments/stage-plan/SKILL.md': 'OLD PLAN' },
    bbb2222: { 'mattstack/teams/acme/plugin/attachments/stage-plan/SKILL.md': 'NEW PLAN' },
  },
};

const deps = (extra: Partial<StageDocDeps> = {}): StageDocDeps => ({
  runGit: fakeGit({ org }),
  packDirs: async () => [{ name: 'acme', dir: '/org/mattstack/teams/acme/plugin' }, { name: 'mattstack', dir: '/mono/plugins/mattstack' }],
  readFile: async p => (p === '/cache/0.30.20/attachments/pipeline/stage-ship/SKILL.md' ? 'SHIP DOC' : null),
  pluginCacheDir: '/cache',
  ...extra,
});

describe('parsePackTokens', () => {
  it('reads sha and version tokens', () => {
    expect(parsePackTokens('plugin=bbb2222,mattstack=0.30.20')).toEqual([
      { pack: 'plugin', ref: 'bbb2222', kind: 'sha' },
      { pack: 'mattstack', ref: '0.30.20', kind: 'version' },
    ]);
  });
});

describe('resolveStageDoc', () => {
  it('finds a doc at an old sha after the pack moved', async () => {
    expect(await resolveStageDoc(deps(), { packCommits: 'acme=aaa1111', stage: 'plan' })).toMatchObject({ text: 'OLD PLAN', pack: 'acme' });
  });
  it('resolves a legacy plugin= token through whichever repo has the commit', async () => {
    expect(await resolveStageDoc(deps(), { packCommits: 'plugin=bbb2222,mattstack=0.30.20', stage: 'plan' })).toMatchObject({ text: 'NEW PLAN' });
  });
  it('reads a version-recorded mattstack doc from the plugin cache', async () => {
    expect(await resolveStageDoc(deps(), { packCommits: 'acme=bbb2222,mattstack=0.30.20', stage: 'ship' })).toMatchObject({ text: 'SHIP DOC', pack: 'mattstack' });
  });
  it('is null when no pack has the stage', async () => {
    expect(await resolveStageDoc(deps(), { packCommits: 'acme=bbb2222', stage: 'gates' })).toBeNull();
  });
  it('is null with nothing recorded', async () => {
    expect(await resolveStageDoc(deps(), { packCommits: null, stage: 'plan' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (in `apps/console`): `bunx vitest run src/server/stageDoc.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `stageDoc.ts`**

```ts
import type { RunGit } from './git-bin';

export interface PackToken { pack: string; ref: string; kind: 'sha' | 'version' }
export interface StageDocDeps {
  runGit: RunGit;
  packDirs: () => Promise<{ name: string; dir: string }[]>;
  readFile: (path: string) => Promise<string | null>;
  pluginCacheDir: string;
}
export interface StageDocInput { packCommits: string | null; stage: string }

export function parsePackTokens(s: string | null): PackToken[] {
  if (!s) return [];
  const out: PackToken[] = [];
  for (const token of s.split(/[\s,]+/)) {
    const m = /^([^=]+)=(.+)$/.exec(token);
    if (!m) continue;
    const [, pack, ref] = m;
    if (/^[0-9a-f]{7,40}$/i.test(ref)) out.push({ pack, ref, kind: 'sha' });
    else if (/^\d+\.\d+\.\d+/.test(ref)) out.push({ pack, ref, kind: 'version' });
  }
  return out;
}

const docPath = (stage: string) =>
  new RegExp(`(^|/)attachments/(pipeline/)?stage-${stage}/SKILL\\.md$`);

async function git(deps: StageDocDeps, args: string[]) {
  try {
    const r = await deps.runGit(args);
    return r.code === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

async function fromSha(deps: StageDocDeps, token: PackToken, stage: string, dirs: { name: string; dir: string }[]) {
  const ordered = [...dirs.filter(d => d.name === token.pack), ...dirs.filter(d => d.name !== token.pack)];
  const seenRoots = new Set<string>();
  for (const d of ordered) {
    const root = (await git(deps, ['-C', d.dir, 'rev-parse', '--show-toplevel']))?.trim();
    if (!root || seenRoots.has(root)) continue;
    seenRoots.add(root);
    if ((await git(deps, ['-C', root, 'cat-file', '-t', token.ref]))?.trim() !== 'commit') continue;
    const tree = (await git(deps, ['-C', root, 'ls-tree', '-r', '--name-only', token.ref])) ?? '';
    const want = docPath(stage);
    const hits = tree.split('\n').filter(p => want.test(p));
    if (hits.length === 0) continue;
    const rel = d.dir.startsWith(root) ? d.dir.slice(root.length + 1) : '';
    const pick =
      hits.find(p => rel && p.startsWith(rel + '/')) ??
      hits.find(p => p.includes(`/${token.pack}/`)) ??
      hits[0];
    const text = await git(deps, ['-C', root, 'show', `${token.ref}:${pick}`]);
    if (text != null) return { text, pack: token.pack === 'plugin' ? d.name : token.pack, sha: token.ref };
  }
  return null;
}

export async function resolveStageDoc(deps: StageDocDeps, input: StageDocInput) {
  const tokens = parsePackTokens(input.packCommits);
  if (tokens.length === 0) return null;
  const ordered = [...tokens.filter(t => t.pack !== 'mattstack'), ...tokens.filter(t => t.pack === 'mattstack')];
  let dirs: { name: string; dir: string }[] = [];
  try { dirs = await deps.packDirs(); } catch { dirs = []; }
  for (const t of ordered) {
    if (t.kind === 'sha') {
      const hit = await fromSha(deps, t, input.stage, dirs);
      if (hit) return hit;
    } else if (t.pack === 'mattstack') {
      const text = await deps.readFile(`${deps.pluginCacheDir}/${t.ref}/attachments/pipeline/stage-${input.stage}/SKILL.md`);
      if (text != null) return { text, pack: 'mattstack', sha: t.ref };
    }
  }
  return null;
}
```

- [ ] **Step 4: Wire the route.** In `effectiveInputs.ts`'s `/stage-doc` handler, replace the `first`/`resolvePackDir`/`git show` block with:

```ts
const hit = await resolveStageDoc(
  {
    runGit,
    packDirs: async () => {
      const { stdout } = await runRt(['skills', 'packs', '--json']);
      const packs = (parseJsonPayload(stdout) as PacksResponse | undefined)?.packs;
      return Array.isArray(packs) ? packs.filter(p => typeof p?.dir === 'string') : [];
    },
    readFile: async p => { try { return await Bun.file(p).text(); } catch { return null; } },
    pluginCacheDir: join(homedir(), '.claude/plugins/cache/mattstack/mattstack'),
  },
  { packCommits: res.data.run.pack_commits, stage }
);
if (!hit) return c.json(NO_DOC, 404);
return c.json({ text: hit.text, pack: hit.pack, sha: hit.sha }, 200);
```

Inject `readFile` and `pluginCacheDir` through `mountEffectiveInputs`'s parameters (defaulting as above) so `effectiveInputs.test.ts` stays free of `Bun`; update that file's stage-doc tests to the new behaviour (a moved-pack case and a `plugin=` case) and keep the 400 for a bad stage name.

- [ ] **Step 5: Run to verify pass**

Run: `bunx vitest run src/server/stageDoc.test.ts src/server/effectiveInputs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/server/stageDoc.ts apps/console/src/server/stageDoc.test.ts apps/console/src/server/effectiveInputs.ts apps/console/src/server/effectiveInputs.test.ts
git commit -m "console: resolve stage docs across every recorded pack, moved packs and the plugin cache"
```

---

### Task 5: Legacy evidence images route (console server + fixture)

**Files:**
- Create: `apps/console/src/server/legacyEvidence.ts`
- Modify: `apps/console/src/server/runs.ts` (mount `GET /api/runs/:repo/:runId/evidence-file?path=`)
- Modify: `apps/console/src/server/fixtures/design/runsFixture.ts` (a `legacyEvidenceFile(repo, runId, path)` answering invented PNG bytes for its legacy run)
- Test: `apps/console/src/server/legacyEvidence.test.ts`

**Interfaces:**
- Produces: `legacyImageAllowed(input: { evidence: string | null; path: string; realpath: (p: string) => string | null; evidenceRoot: string }): boolean` (pure) and the route; client helper `legacyImageUrl(repo, runId, path)` in `apps/console/src/app/runs/run-page/evidenceImages.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { legacyImageAllowed } from './legacyEvidence';

const root = '/home/u/.mattstack/evidence';
const real = (p: string) => (p.startsWith('/link') ? '/etc/passwd.png' : p);
const evidence = JSON.stringify({ before: `${root}/web-412/before.png` });

describe('legacyImageAllowed', () => {
  it('allows an image the run names inside the evidence root', () => {
    expect(legacyImageAllowed({ evidence, path: `${root}/web-412/before.png`, realpath: real, evidenceRoot: root })).toBe(true);
  });
  it('refuses a path the run does not name', () => {
    expect(legacyImageAllowed({ evidence, path: `${root}/web-999/x.png`, realpath: real, evidenceRoot: root })).toBe(false);
  });
  it('refuses a named path that resolves outside the root', () => {
    const ev = JSON.stringify({ before: '/link/x.png' });
    expect(legacyImageAllowed({ evidence: ev, path: '/link/x.png', realpath: real, evidenceRoot: root })).toBe(false);
  });
  it('refuses a non-image', () => {
    const ev = JSON.stringify({ log: `${root}/web-412/run.log` });
    expect(legacyImageAllowed({ evidence: ev, path: `${root}/web-412/run.log`, realpath: real, evidenceRoot: root })).toBe(false);
  });
  it('refuses a missing file', () => {
    expect(legacyImageAllowed({ evidence, path: `${root}/web-412/before.png`, realpath: () => null, evidenceRoot: root })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bunx vitest run src/server/legacyEvidence.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import { legacyItems, parseEvidence } from '@mattstack/rt-client/evidence';

export function legacyImageAllowed({ evidence, path, realpath, evidenceRoot }: {
  evidence: string | null; path: string; realpath: (p: string) => string | null; evidenceRoot: string;
}): boolean {
  const parsed = parseEvidence(evidence);
  if (parsed.version !== 0) return false;
  const named = legacyItems(parsed.links).some(i => i.kind === 'image' && i.value === path);
  if (!named) return false;
  const resolved = realpath(path);
  const rootReal = realpath(evidenceRoot) ?? evidenceRoot;
  return resolved != null && (resolved === rootReal || resolved.startsWith(rootReal.replace(/\/$/, '') + '/'));
}
```

Route in `runs.ts` (chained, inline handler per the app's Hono RPC rule): read the run via `getRun`, take its `evidence` field value, call `legacyImageAllowed` with `realpath = p => { try { return realpathSync(p) } catch { return null } }` and `evidenceRoot = join(homedir(), '.mattstack/evidence')`; on true stream the file with its image mime and `cache-control: private, max-age=3600`; else `c.json({ error: 'no evidence' }, 404)`. Under a fixture, answer from `fixture.legacyEvidenceFile`.

- [ ] **Step 4: Fixture data.** Add to the runs fixture one finished work run (invented: `WEB-377 Show the courier name on the parcel card`, repo `acme/web`) whose `evidence` field is legacy prose naming two image paths under `/Users/acme/.mattstack/evidence/web-377/` plus one URL `http://localhost:4001/orders/4821#parcels` and a junk fraction ("12/12 cards"); `legacyEvidenceFile` returns small solid PNGs (reuse the fixture's existing image bytes) for those two paths.
- [ ] **Step 5: Run to verify pass** — `bunx vitest run src/server/legacyEvidence.test.ts src/server/fixtures/design/runsFixture.test.ts` → PASS.
- [ ] **Step 6: Commit** — `git add` the four files, `git commit -m "console: serve legacy evidence images a run names inside the evidence root"`.

---

### Task 6: Kit notifications sized for the dense scale

**Files:**
- Modify: `packages/ui/src/notifications/notifications.tsx` (`ICON_SIZE` 20 → 11)
- Modify: `packages/ui/src/design-system/component-styles.module.css` (`.notificationRoot` and new `.notificationIcon`, `.notificationTitle`, `.notificationDescription`, `.notificationClose`)
- Modify: `packages/ui/src/design-system/base-theme.ts` (`Notification: { classNames: { root, icon, title, description, closeButton } }`)
- Test: `packages/ui/src/notifications/notifications.test.tsx`

- [ ] **Step 1: Write the failing test** (append)

```tsx
it('renders the type icon at the dense size', () => {
  render(<MantineProvider theme={theme}><Notifications /></MantineProvider>);
  act(() => { notifications.success('Copied branch name'); });
  const svg = document.querySelector('.mantine-Notification-icon svg');
  expect(svg?.getAttribute('width')).toBe('11');
});
```

(Use the file's existing imports/helpers for `render`, `act`, `theme`.)

- [ ] **Step 2: Run** — in `packages/ui`: `bunx vitest run src/notifications/notifications.test.tsx` → FAIL (width 20).
- [ ] **Step 3: Implement.** `ICON_SIZE = 11`. CSS:

```css
.notificationRoot {
  box-shadow: var(--mantine-shadow-md);
  padding: 11px 12px 11px 14px;
  border-radius: 10px;
  gap: 10px;
}
.notificationIcon {
  width: 18px;
  height: 18px;
  min-width: 18px;
  margin-inline-end: 0;
}
.notificationTitle,
.notificationDescription:only-child {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.35;
}
.notificationDescription {
  font-size: 12.5px;
  line-height: 1.4;
}
.notificationClose {
  width: 20px;
  height: 20px;
  min-width: 20px;
}
```

Wire the four new classNames in `base-theme.ts` next to `root: classes.notificationRoot`.
- [ ] **Step 4: Run** the test → PASS. Then open the kit's notifications story in Storybook (`bun run storybook`, port of your choice) with Fast Browser in light and dark: even padding, an 18px circle, text 13px; compare against the "toasts" tile of the After · states board.
- [ ] **Step 5: Commit** — `git commit -m "ui: size notifications for the dense scale"` with the four files.

---

### Task 7: Fixture writes refuse with 403; outage and review-findings scenarios

**Files:**
- Modify: `apps/console/src/server/fixtures/design/runsFixture.ts` (`FIXTURE_READ_ONLY` responses), `apps/console/src/server/gates.ts`, `apps/console/src/server/panes.ts`, and any other route returning `FIXTURE_READ_ONLY` with 409 → 403
- Modify: `apps/console/src/server/fixtures/design/scenarios.ts` (add `runs-outage`: the runs, run, gates and effective-inputs routes answer `502 { error: 'daemon unreachable' }`)
- Modify: `runsFixture.ts` (the WEB-388 review run: a "Post which findings to !412?" multi-select question whose four picked options are `[Important] Dedupe matches on email only, so contacts without an email import twice. (contacts/import/dedupe.ts:58)`, `[Important] No test covers merging two contacts that share a phone number.`, `[Minor] mergeContacts deletes the losing record; the name doesn't say so. (contacts/merge.ts:12)`, `[Minor] The skip log prints the whole contact record, email included.`; outcome `request changes`; an abandoned work run carries `abandon` reason "Superseded by WEB-430", by "you", at a timestamp)
- Test: `apps/console/src/server/gates.test.ts`, `apps/console/src/server/fixtures/design/runsFixture.test.ts`, `scenarios.test.ts`

- [ ] **Step 1: Write failing tests:** fixture POST `/api/gates/:id/answer` → status 403 with `{ error: 'the design fixture is read-only' }`; `runs-outage` GET `/api/runs` → 502; the review fixture run's gates include the findings question with four picked options.
- [ ] **Step 2: Run** `bunx vitest run src/server/gates.test.ts src/server/fixtures/design` → FAIL.
- [ ] **Step 3: Implement** the status change, the scenario (a flag on the fixture the four routes check before answering), and the data.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "console fixture: refuse writes with 403; outage scenario; review findings and abandon reason"`.

---

### Task 8: Pure derive additions

**Files:**
- Modify: `apps/console/src/app/runs/derive/record.ts` (`answeredQuestionCount`), `derive/fields.ts` (`fieldLabel` de-camelcases, label map), `derive/kind.ts` (`runTitle` review order), `derive/lanes.ts` (`earlierPage`)
- Create: `apps/console/src/app/runs/derive/findings.ts` (`parseFinding`)
- Test: `derive/record.test.ts`, `derive/fields.test.ts`, `derive/kind.test.ts`, `derive/lanes.test.ts`, `derive/findings.test.ts`

**Interfaces (Produces):**
- `answeredQuestionCount(gates: GateRow[]): number` — answered gates' questions that have an answer.
- `fieldLabel(key: string): string` — map `{ ci: 'CI', mr: 'MR', shiptarget: 'Ship target' }` (keys compared lowercased, separators stripped) then split camelCase/kebab/snake: `ShipTarget` → "Ship target", `evidence-plan` → "Evidence plan".
- `runTitle(run, enrichment)` — for review/respond: `mrTitle` → `ticketTitle` → `Review of !<iid>` (from `run.outcome?.reviewed?.iid`) → `<work_type> run`; for others: `ticketTitle` → branch → `<work_type> run`. Never the run id.
- `earlierPage(groups: DayGroup[], days: number): { shown: DayGroup[]; more: boolean }` — the first `days` calendar-day groups.
- `parseFinding(text: string): { severity: 'important' | 'minor' | null; text: string; where: string | null }` — strips a leading `[Important]`/`[Minor]` (case-insensitive, also `[NON-BLOCKING]` dropped) and a trailing `(path:line)` or `(path)` into `where`.

- [ ] **Step 1: Write the failing tests**

```ts
// findings.test.ts
import { describe, expect, it } from 'vitest';
import { parseFinding } from './findings';
describe('parseFinding', () => {
  it('lifts severity and location', () => {
    expect(parseFinding('[Important] Dedupe matches on email only. (contacts/import/dedupe.ts:58)')).toEqual({ severity: 'important', text: 'Dedupe matches on email only.', where: 'contacts/import/dedupe.ts:58' });
  });
  it('drops a non-blocking tag and keeps minor', () => {
    expect(parseFinding('[Minor] [NON-BLOCKING] overview leans on another island')).toEqual({ severity: 'minor', text: 'overview leans on another island', where: null });
  });
  it('leaves plain text alone', () => {
    expect(parseFinding('Approve')).toEqual({ severity: null, text: 'Approve', where: null });
  });
});
// fields.test.ts additions
it.each([['ShipTarget', 'Ship target'], ['ci', 'CI'], ['evidence-plan', 'Evidence plan'], ['mr', 'MR']])('fieldLabel(%s) = %s', (k, v) => expect(fieldLabel(k)).toBe(v));
// record.test.ts addition
it('counts answered questions, not gates', () => {
  const g = (id: string, qs: string[], answered: boolean) => ({ id, status: answered ? 'answered' : 'open', questions: qs.map(q => ({ id: q, label: q, options: [] })), answer: answered ? { answers: Object.fromEntries(qs.map(q => [q, 'x'])) } : null }) as unknown as GateRow;
  expect(answeredQuestionCount([g('a', ['q1', 'q2'], true), g('b', ['q3'], true), g('c', ['q4'], false)])).toBe(3);
});
// kind.test.ts additions
it('titles a review by its MR, never its id', () => {
  const run = { ticket: null, branch: 'feature/x', work_type: 'review', id: '2026-1', outcome: { reviewed: { iid: 412 } } };
  expect(runTitle(run, { mrTitle: 'Dedupe contacts' })).toBe('Dedupe contacts');
  expect(runTitle(run, {})).toBe('Review of !412');
  expect(runTitle({ ...run, outcome: null }, {})).toBe('review run');
});
// lanes.test.ts addition
it('pages the earlier list by day', () => {
  const groups = Array.from({ length: 9 }, (_, i) => ({ label: `d${i}`, runs: [] })) as unknown as DayGroup[];
  expect(earlierPage(groups, 7)).toEqual({ shown: groups.slice(0, 7), more: true });
  expect(earlierPage(groups, 14)).toEqual({ shown: groups, more: false });
});
```

- [ ] **Step 2: Run** `bunx vitest run src/app/runs/derive` → FAIL on the new tests.
- [ ] **Step 3: Implement** the five functions as specified (extend `runTitle`'s `run` param with `outcome?: { reviewed?: { iid: number } | null } | null`; update its callers' types).
- [ ] **Step 4: Run** → PASS (fix any existing expectation that asserted a run-id title; list each in the commit body).
- [ ] **Step 5: Commit** — `git commit -m "console runs: derive question counts, field labels, review titles, finding parts, earlier paging"`.

---

### Task 9: Gate panel polish

**Files:**
- Modify: `apps/console/src/app/runs/run-page/GatePanel.tsx`, `GatePanel.module.css`, `GatePanel.test.tsx`, `GatePanel.stories.tsx`
- Modify: `apps/console/src/app/runs/run-page/RunPage.tsx` (gate panels render inside the main column, above the story; the side column stays beside them)

**Behaviour (board: After · Gate open; After · states "gate submit refused"):**
- Header: hand icon; title "The <stage> stage needs <one|two|three|N> answers" (one answer → "needs one answer"); sub "Opened <age> ago · the agent waits until you submit" (herd-owned keeps its existing herd sub copy). Steps: a compact strip at the header's right — each step `n` + name; current step raised (surface fill + border), others plain; a completed step shows a check instead of its number. Built with Mantine `SegmentedControl`-like styling through a CSS module on plain buttons, or Mantine `Tabs` variant `pills` if it matches the board — pick the kit component first and note the board-fix if it differs.
- Context column: "WHAT THE AGENT FOUND" label + `GateContext`; the "expand" link and its modal are removed. With no context, the column is not rendered and the question column takes the full width.
- Options: Mantine `Radio.Card` / `Checkbox.Card` as today; inside: title row (label + green "Recommended" `Badge` light), description in dimmed text; when the description holds a command (text after `From <dir>:` or a backticked span or a line starting with a known CLI word: `jest`, `bun`, `pnpm`, `npm`, `git`, `rt`), the command renders on its own line as a mono chip (`Code`), the prose stays above it. Extract `splitCommand(description): { prose: string; command: string | null }` as a pure function in `derive/gates.ts` with tests.
- Key caps: a 22px `Kbd` with the option number at the card's right for options 1-9; none for 10+; the selected option's cap uses the accent tone.
- Footer: "Open the pane" as a subtle `Button` (variant `subtle`, gray); "Draft saved" dimmed; primary `Button` "Next"/"Submit" with a `Kbd` "⌘↵" inside at 70% white.
- Submit failure (non-409): keep picks, note and step; render an inline `Alert`-styled strip (bad tone) above the footer: "Couldn't submit: <reason from the response body, else 'the daemon refused the answer'>. Your picks and note are kept." with a **Try again** button that re-posts the same payload. A 409 keeps today's "Answered elsewhere" behaviour.

- [ ] **Step 1: Write failing tests** in `GatePanel.test.tsx`:
  - a 403 response keeps the selected option checked, the note text present, and shows "Try again"; clicking it posts again (spy `fetch`/client mock count = 2);
  - a 409 response still shows "Answered elsewhere";
  - a gate with no context renders no `[data-parity="context"]` element;
  - an eleven-option question renders key caps `1`…`9` and none for options 10 and 11;
  - `splitCommand('From apps/backend: jest --selectProjects unit -t x, red then green.')` → `{ prose: 'From apps/backend, red then green.', command: 'jest --selectProjects unit -t x' }` (in `derive/gates.test.ts`).
- [ ] **Step 2: Run** `bunx vitest run src/app/runs/run-page/GatePanel.test.tsx src/app/runs/derive/gates.test.ts` → FAIL.
- [ ] **Step 3: Implement** to the board; keep `data-testid="gate-panel"`, `data-tone`, `data-gate-id`, `tabIndex={-1}` and the number-key handling; add `data-parity` keys matching the board layers.
- [ ] **Step 4: Run** the tests → PASS; run the existing RunDetail gate tests (`bunx vitest run src/app/runs/RunDetail.test.tsx`) → PASS.
- [ ] **Step 5: Parity:** follow `apps/console/scripts/parity/run.md` for board `runs-p2-gate` light and dark → 0 mismatches outside the board-fix list; Fast Browser screenshots in both schemes, read them.
- [ ] **Step 6: Commit** — `git commit -m "console gate panel: quieter header, split commands, key caps, failure keeps your picks"`.

---

### Task 10: Live run page — quiet story and no metadata chips

**Files:**
- Create: `apps/console/src/app/runs/run-page/StageRow.tsx`, `StageRow.module.css`, `StageRow.test.tsx`
- Modify: `Story.tsx` (renders one bordered surface of `StageRow`s), `DecisionRow.tsx` (plain row + opened detail), `RunHeader.tsx` (drop the ticket `Kbd`), `StageRail.tsx` (drop per-stage decision count), `SideCards.tsx` (drop the `Kbd` per fact; drop the Decisions card entirely), `useRunParts.ts` (drop the `t b w m c` copy hotkeys), `RunPage.tsx` (no `onOpenDecision`), `RecordPage.tsx` (Story tab side column without the Decisions card), `StageDoc.tsx` (link becomes "Stage doc" in the stage row header; it opens the shared drawer from Task 14 — until Task 14 lands keep the current modal)
- Test: `StageRow.test.tsx`, `RunDetail.test.tsx` (update expectations that referenced the side decisions card or hotkeys)

**Behaviour (boards: After · Live run page; After · Story details):**
- `StageRow` props: `{ entry: StoryEntry; open: boolean; onToggle: () => void; repo; runId; evidenceField; pathHref }`. Head: status bullet (18px), name (14/600), duration (dimmed), one-line summary, "Stage doc" link (accent, 12.5/500) when open, chevron. Summary text = `stageSummary(entry)` (pure, in `derive/story.ts`): `"<n> decision(s) · <first answered pick>"` when it has decisions, else the first story field as `"<Label>: <value>"` truncated to one line, else the failure reason, else "".
- The newest finished entry starts open; the rest closed; open state per row kept in component state.
- Open body (left inset 46px): field rows (label column 160px), decisions as plain rows (question dimmed 146px column, answer 13/500, "who · time", chevron), evidence (Task 13 renders it).
- An opened decision (chevron) shows within a `surface-2` bordered block: the answer bold, "Passed on" with a dash per unpicked option, the note in quotes with a message icon, the text answer in italics, and the "What the agent found · N lines" disclosure when the gate has context.
- Story surface: one `Paper` with border and radius 12, rows divided by hairlines; label "STORY SO FAR" above.

- [ ] **Step 1: Write failing tests** (`StageRow.test.tsx`): renders the summary "3 decisions · Backend gap-fill + component work" for an entry with three answered questions; closed rows render no decision rows; clicking the head opens the body; an opened decision shows "Passed on" and both unpicked option texts; no element with text "t", "m", "b", "w" inside a `kbd` exists on the run page (`RunDetail.test.tsx`); pressing `b` on the run page copies nothing (clipboard spy not called).
- [ ] **Step 2: Run** `bunx vitest run src/app/runs/run-page/StageRow.test.tsx src/app/runs/RunDetail.test.tsx` → FAIL.
- [ ] **Step 3: Implement** as specified with `data-parity` keys from the board.
- [ ] **Step 4: Run** → PASS; also `bunx vitest run src/app/runs/run-page src/app/runs/derive`.
- [ ] **Step 5: Parity:** boards `runs-p2-live` and `runs-p2-story-details`, light and dark, 0 mismatches outside the board-fix list.
- [ ] **Step 6: Commit** — `git commit -m "console run page: fold finished stages, plain decision rows, drop metadata key chips and the duplicate decisions card"`.

---

### Task 11: Record — stats, counts, decision cards, stage timeline, labels, abandoned

**Files:**
- Modify: `derive/record.ts` (`recordStats` returns duration, decisions (`answeredQuestionCount`), took, waiting — no evidence, no commits), `RecordHeader.tsx`, `DecisionsTab.tsx` (no "By stage" sidebar, no legend; log with a 2px left rule and a check bullet per stage header reading "<stage> · N decision(s) · <duration>[ · N override(s)]"), `DecisionCard.tsx` (pick highlighted + "recommended" small text when it was the recommendation; "N other option(s)[ · recommended was “X”]" line expandable to list them; note; context disclosure; "overrode recommendation" tag), `RecordPage.tsx` (tab badge uses `answeredQuestionCount`; abandoned line under the hero: "Abandoned by <who> · <when> · “<reason>”" when recorded), `OutputRow.tsx`/`FieldValue.tsx` (labels via `fieldLabel`)
- Test: `derive/record.test.ts`, `DecisionsTab.test.tsx`, `DecisionCard.test.tsx`, `RecordPage` tests in `RunDetail.test.tsx`

- [ ] **Step 1: Failing tests:** `recordStats` ids for a work run are exactly `['duration','decisions','took','waiting']` (with data for all); decisions stat equals the question count; the Decisions tab has no element with text "BY STAGE" or "you overrode the pick"; a stage header reads "plan · 3 decisions · 12m · 1 override"; a decision card with three options shows only the pick plus "2 other options"; an override card shows "recommended was “The tracking service we already call”"; a field `ShipTarget` renders label "Ship target"; an abandoned fixture run shows "Superseded by WEB-430".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** to board After · Record (finished run).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Parity:** `runs-p2-record` light/dark.
- [ ] **Step 6: Commit** — `git commit -m "console record: four stats, one decision count, stage timeline in the log, folded options"`.

---

### Task 12: Review run record

**Files:**
- Create: `apps/console/src/app/runs/run-page/ReviewVerdict.tsx`, `ReviewVerdict.test.tsx`
- Modify: `RecordPage.tsx` (review/respond: verdict card first, decisions after; no Evidence tab), `OutcomeBadge.tsx` (review pill copy: "Requested changes on !412", "Approved !406", "Commented on !N"), `derive/record.ts` (a `reviewVerdict(gates)` selector: the verdict question's pick and the picked findings across "Post which findings" questions → `{ verdict: string; findings: ReturnType<typeof parseFinding>[]; mrIid: string | null }`)

- [ ] **Step 1: Failing tests:** `reviewVerdict` over the WEB-388 fixture gates returns verdict "Request changes" and four findings with severities `important, important, minor, minor` and `where` set on two; `ReviewVerdict` renders "Posted to !412", "Request changes · 4 findings", an "Open the MR" link, badges "Important"/"Minor" and no literal "[Important]"; a review record has no Evidence tab.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** to board After · Review run record.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Parity:** `runs-p2-review` light/dark.
- [ ] **Step 6: Commit** — `git commit -m "console review record: lead with the verdict and findings"`.

---

### Task 13: Evidence UI — legacy images, story thumbnails, compare, no empty tab

**Files:**
- Modify: `EvidenceCard.tsx` (legacy: `legacyItems` → image thumbnails via `legacyImageUrl` with the file name under each in mono; files stay editor links; urls stay links with an external-link icon), story variant (v1: two thumbnails + "Open full size →" instead of the full-width image), `EvidenceCompare.tsx` (modal `fullScreen`-like: Mantine `Modal` size `calc(100vw - 48px)`; one `SegmentedControl` Before / After / Side by side; the prev/next arrows removed; image `object-fit: contain`), `RecordPage.tsx` (no Evidence tab when the run recorded none), `evidenceImages.ts` (`legacyImageUrl`)
- Test: `EvidenceCard.test.tsx`, `EvidenceCompare.test.tsx`

- [ ] **Step 1: Failing tests:** legacy evidence with two png paths and a url renders two `img` elements whose `src` hits `/evidence-file?path=` and one link with the url text; the junk-fraction fixture value renders no `/12` link; the compare modal has a segmented control with three options and no "previous"/"next" buttons; a record whose evidence parses to `version: null` has no Evidence tab.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** to boards After · Story details and After · overlays (compare tile).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Parity:** `runs-p2-story-details` evidence roots and `runs-p2-overlays` compare root, light/dark.
- [ ] **Step 6: Commit** — `git commit -m "console evidence: legacy screenshots as images, thumbnails in the story, one compare control"`.

---

### Task 14: Effective inputs drawer and the one stage doc drawer

**Files:**
- Modify: `apps/console/src/app/runs/EffectiveInputs.tsx` (sections Packs / Stage docs / Decisions in force / Configuration (current values) per board; stage rows expand inline showing the rendered doc; config rows expand inline with description, per-scope values, "in effect", "Change it in Settings →"; the nested `StageDocDrawer` and the `ExplainModal` launch from here are removed), `run-page/StageDoc.tsx` (one `StageDocDrawer` used by the story's "Stage doc" link: title "<stage> · stage doc", sub "<pack> @ <sha> · <sync>", body rendered with `GateContext`'s markdown after stripping a leading `---` frontmatter block; no modal), `InputsDrawer.tsx`
- Create: `derive/inputs.ts` additions `decisionSentence(row: RunDecisionRow): { label: string; value: string; meta: string }` and `stripFrontmatter(md: string): string`
- Test: `EffectiveInputs.test.tsx`, `derive/inputs.test.ts`

- [ ] **Step 1: Failing tests:** `stripFrontmatter('---\nname: x\n---\n# Plan\nbody')` → `'# Plan\nbody'`; `decisionSentence` of `execution-strategy@1 → {"strategy":"subagent-driven","tasks":5}` → `{ label: 'Execution strategy', value: 'Subagent-driven, 5 tasks', meta: 'implement · agent · 3:49 PM' }` (time formatted with `formatClock`); in the drawer, clicking stage "plan" shows the doc text inline and opens no second `[role="dialog"]`; a stage whose route answers 404 shows "no doc at this version" in its row; clicking `rt.worktrees` expands inline (still exactly one dialog in the document).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** to boards After · Effective inputs drawer and After · overlays (stage doc drawer, setting inline).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Parity:** `runs-p2-inputs`, `runs-p2-overlays` (stage doc root), light/dark.
- [ ] **Step 6: Commit** — `git commit -m "console inputs: readable drawer, inline stage docs and settings, one stage doc drawer"`.

---

### Task 15: Failure, loading and the "..." menu

**Files:**
- Modify: `apps/console/src/app/runs/useRuns.ts` (`runQuery`: `retry: (n, err) => !isNotFound(err) && n < 1`; the thrown error carries the body's `error` text and the status), `RunDetail.tsx` (error boundary renders `RunLoadError`: "Couldn't load <crumb>" with the reason, or "No run <id> in this repo" on 404; buttons Retry and Back to runs; the `LazyLoader` fallback becomes `RunPageSkeleton`), `runs-page/RunsPage.tsx` (pending → skeleton stat line and list, never zeros; error → warn banner "Can't reach the rt daemon" + Retry, stats "—", skeleton list), `RunHeader.tsx` (the "..." `Menu` renders only with two or more items; one item renders as its own button; the abandon dialog becomes a custom `modals.open` content per board with the reason input, Cancel and red "Mark abandoned"; on failure the dialog stays open with an inline error and the reason kept)
- Create: `run-page/RunLoadError.tsx`, `run-page/RunPageSkeleton.tsx`
- Test: `RunDetail.test.tsx`, `runs-page/RunsPage.test.tsx`

- [ ] **Step 1: Failing tests:** a 404 run shows "No run <id> in this repo" within one retry (`retry` called at most once, assert with fake timers); a 502 shows "Couldn't load" with "daemon unreachable"; Retry refetches; the runs page while pending shows no "0" stat text and no "Nothing running."; on error it shows "Can't reach the rt daemon"; a run whose menu would hold only "View inputs" renders a "View inputs" button and no "more run actions" button; abandon failure keeps "Superseded by WEB-430" in the input and shows the error (update the existing "says so when marking a run abandoned fails" test to the dialog behaviour).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** to board After · states and After · overlays (abandon tile).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Parity:** `runs-p2-states` light/dark using the `runs-outage` scenario and an unknown run id.
- [ ] **Step 6: Commit** — `git commit -m "console runs: fast clear errors, skeletons instead of zeros, abandon keeps your reason"`.

---

### Task 16: Runs page — stat line, quieter Earlier list, paging, titles

**Files:**
- Modify: `runs-page/RunsPage.tsx` (stat line replaces `StatCards`), `runs-page/StatCards.tsx` (becomes `StatLine`: dot · value · label per stat), `runs-page/WaitingBanner.tsx` (the "press g to jump" hint moves under Answer gate as "<k> of <n> questions · or press [g]"), `runs-page/EarlierList.tsx` (drop the decisions and evidence columns; render `earlierPage(groups, days)` with a "Show earlier days" row that adds 7), `derive/lanes.ts` (drop `evidenceText`/`decisionsText` uses from the Earlier row), row titles via `runTitle`
- Test: `runs-page/RunsPage.test.tsx`, `EarlierList.test.tsx`

- [ ] **Step 1: Failing tests:** the page renders "waiting on you", "live", "finished today", "median work run" as one line and no stat card `Paper`s; Earlier rows contain no "decision" or "evidence" text; with 9 day groups only 7 render plus "Show earlier days", and clicking it renders all 9; a review row without ticket/MR title reads "Review of !412", never a run id.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** to board After · Runs page.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Parity:** `runs-p2-runs` light/dark.
- [ ] **Step 6: Commit** — `git commit -m "console runs page: one stat line, quieter earlier list, day paging"`.

---

### Task 17: Search, ⌘K, 404 and the timeline hover card

**Files:**
- Modify: `apps/console/src/app/runs/RunSearch.tsx` (page title "Search", large input with "<n> runs · last 30 days", rows in the Earlier row shape with `runTitle`; no graph paper), `apps/console/src/app/palette/ConsolePalette.tsx` (520px; "Runs" section rows: ticket, title, status pill; "Go to" section: Runs, "Search runs for “<q>”"; selected row ↵ cap; footer "↑↓ move · ↵ open · esc close"), `apps/console/src/app/NotFoundPage.tsx` ("Nothing at this address", "The link may be from an older console, or the run was pruned after 30 days.", Back to runs; no graph paper), `runs-page/DayTimeline.tsx` (bar `Tooltip` → `HoverCard` with stage and state, "<from> → <to> · <dur>", and for a waiting bar the gate question and your pick from `barDetail(bar, gates)` in `derive/day.ts`)
- Test: `RunSearch.test.tsx`, `palette/ConsolePalette.test.tsx`, `NotFoundPage` test (create `NotFoundPage.test.tsx`), `derive/day.test.ts` (`barDetail`)

- [ ] **Step 1: Failing tests** for each listed text and structure; `barDetail` of a waiting bar returns `{ title: 'plan · waiting on you', span: '1:39 PM → 1:45 PM · 6m', gate: 'Which approach should the plan take? You picked Server-side filter.' }` for the fixture.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** to board After · search etc.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Parity:** `runs-p2-search` light/dark.
- [ ] **Step 6: Commit** — `git commit -m "console: search, palette and 404 on the runs look; timeline hover card"`.

---

### Task 18: Final sweep (controller)

- [ ] **Step 1:** Parity run for every `runs-p2-*` board and every first-pass board still in use, light and dark; 0 mismatches outside the board-fix list.
- [ ] **Step 2:** Targeted tests for every touched file pass; `bun run console:typecheck` and `bun run console:lint` pass; `bun run --cwd packages/ui typecheck` passes.
- [ ] **Step 3:** Live read-only check in Fast Browser against a console built from this branch (run it on a spare port with `PORT=<port> bun apps/console/src/server/index.ts` after `bun run console:build`, never restarting the deck-managed console): a team-pack run's stage docs open; a legacy-evidence run shows its screenshots and no junk links; a review run leads with its verdict. Screenshots stay in the scratchpad.
- [ ] **Step 4:** Commit any parity fixes; push the branch and open the PR with the repo template.
