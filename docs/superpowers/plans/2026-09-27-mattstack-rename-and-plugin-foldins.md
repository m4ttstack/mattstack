# Rename rt to mattstack and fold in herdr-chat and skills: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `m4ttstack/rt` becomes `m4ttstack/mattstack` (repo and local folder) without any installed app or per-repo state going dark, and the `mattstack` Claude plugin and the `herdr-chat` herdr plugin move into the tree at `plugins/mattstack` and `plugins/herdr-chat` with their history.

**Architecture:** A new `rt repos reidentify <old> <new>` verb moves every identity-keyed store between two serialized identities (kv rows, state.db tables, the data dir, tracking, settings sections, herds), verify-persisted and idempotent per store, reachable through the daemon or locally; the daemon runs it on its own when a tracked repo's fresh remote derives a new identity that GitHub confirms as a rename. The rename ships in three parts (2a code that names nothing new, 2b the machine cutover, 2c the name flips) because the release code writes to the repo by name. Each plugin is imported with `git filter-repo --to-subdirectory-filter` and a merge commit, gets a path-scoped CI job, and `scripts/ci/test-scope.ts` learns a `plugins/` tree so plugin-only PRs never run rt's unit shards.

**Tech Stack:** Bun 1.4.2, bun:sqlite, git-filter-repo, GitHub Actions (ubuntu + macOS), Rust/cargo (herdr-chat), graphviz (skills digraph check), bash.

**Spec:** `docs/superpowers/specs/2026-09-27-mattstack-rename-and-plugin-foldins-design.md`

Stages and their tasks: Stage 1 (Task 1), Stage 2a (Tasks 2 to 10), Stage 2b (Task 11), Stage 2c (Tasks 12 to 13), Stage 3 (Tasks 14 to 18), Stage 4 (Tasks 19 to 27). Every stage's PR merges with a merge commit after CI is green and an Opus whole-branch review; do not start a stage's import until the previous stage's Matt-gated steps are done.

## Global Constraints

- rt code style: double quotes, two-space indent, no `.tsx`, no UI code in `commands/` or `lib/`. Imported plugins keep their own style (herdr-chat is rustfmt Rust; the skills tree is Markdown plus shell); never reformat one with the other's rules.
- No em dashes or en dashes anywhere: code, comments, commit messages, workflow text, READMEs, the plan's own edits.
- Comments state constraints the code cannot show; never task numbers, rulings, review findings or history.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (or the implementer's own model line, same shape).
- Never run a built `rt` binary outside `env -i HOME=<temp> ...`; never rebuild `/Applications/mattstack.app` or `/Applications/mattstack-dev.app` in place.
- Imports are merge commits (`git merge --allow-unrelated-histories --no-ff`); every PR merges with `gh pr merge --merge`, never squash or rebase.
- `git filter-repo` scrub rule files (`--replace-text`, `--replace-message`) live outside the repo (under `$(mktemp -d)`), never in the tree.
- Tests first for every code task: write the failing test, run it, see it fail, then implement.
- `bun test` runs from the repo root only (`bunfig.toml` preload isolates HOME); rt's unit suite is `bun run test`; a test that spawns `cli.ts` or reads source as text is named `no-*.test.ts` or it never runs on a PR.
- The skills import (Task 20 onward) starts only after every RT-338 wave-1 lane has merged and `m4ttstack/skills` has no open PR; that check is Matt-gated.
- Matt-gated (the executor stops and asks before acting): the Stage 1 throwaway repo, `gh repo rename`, the folder move, each `gh repo archive`, every release cut, any edit to Matt's global `~/.claude/CLAUDE.md`.
- Nothing in Stage 2a names `m4ttstack/mattstack` in code, docs, tests or the feed; the repo does not have that name until Stage 2b.
- The Sparkle feed, `RT_REPO`, `GH_REPO`, `RELEASE_REPO`, `RELEASES_URL` and `appcast.sh`'s default flip only in Stage 2c.
- `rt repos reidentify` never moves the worktree pool directory (`~/.mattstack/rt/worktrees/gh-m4ttstack-rt/`); registry rows hold absolute tree paths, so trees stay where they are.

## Review Focus

1. A reidentify whose new identity already holds rows in one store (say `rt.repoTracking`) while the others are empty must move the empty-target stores, report that one store as `refused`, exit non-zero, and leave the refused store untouched. Pinned by Task 5's "one store populated on both sides" test and Task 7's refused-store handler test.
2. A reidentify run twice must report every store as `already` or `none` on the second run and exit 0; a run where the old identity holds nothing anywhere must exit 0 with all `none`. Pinned by Task 5's idempotence tests.
3. `rt repos locate` after reidentify (new identity, path still the old one on disk) must find the index row by the new identity and re-point it; a locate before reidentify must refuse `identity-mismatch`. Pinned by Task 6's locate-after-reidentify test.
4. The daemon rename detector must not fire when the fresh remote derives the same identity, when the remote is not GitHub, when GitHub answers anything but 301, or when the 301 Location names a repo other than the derived one. Pinned by Task 8's tests.
5. A PR touching only `plugins/mattstack/**` (Markdown and shell) must produce `mode=skip` for the unit shards and `plugins=plugins/mattstack`; one touching `plugins/herdr-chat/src/lib.rs` plus `lib/foo.ts` must produce `mode=full` and `plugins=plugins/herdr-chat`. Pinned by Task 16's test-scope tests.

---

## File structure

Stage 2a (rt code):

- `lib/state/reidentify.ts` (new): `moveKvKey`, `moveTableRows`, `dropTableRows`, the `StoreReport` type. One responsibility: verify-persisted moves of one kv key or one table column between two serialized identities.
- `packages/rt-client/src/settings/write.ts`: `renameRepoSection(storePath, oldId, newId)`.
- `lib/repo-tracking.ts`: `moveRepoTrackingEntry(oldKey, newKey)`.
- `lib/state/cursors-store.ts`: export `CURSOR_NS`.
- `lib/repo-reidentify.ts` (new): `normalizeIdentityArg`, `reidentify` (the orchestrator over every store), `ReidentifyReport`.
- `lib/repo-reidentify-dispatch.ts` (new): daemon-or-local dispatch, same shape as `lib/repo-locate-dispatch.ts`.
- `lib/daemon/handlers/repos.ts`: `repos:reidentify` handler.
- `commands/repos-reidentify.ts` (new): `reposReidentify`; `lib/command-tree-def.ts` node; `lib/module-registry.ts` entry.
- `lib/daemon/rename-detect.ts` (new): `detectRenamedRepos`; wired in `lib/daemon.ts` after the boot identity migration.
- `lib/release/shared-checkout.ts` (new): `resolveSharedCheckout(home)`; used by `commands/release.ts` and `commands/settings.ts`.
- Path sweep: `commands/settings.ts`, `commands/release.ts`, `lib/command-tree-def.ts`, `AGENTS.md`, `docs/*.md`, `skills/rt-*/SKILL.md`, tests that pin the folder.

Stage 2c: `scripts/gen-docs.ts`, `scripts/update-docs.ts`, `rt-tray/project.yml`, `rt-tray/Info.plist`, `rt-tray/build.sh`, `rt-tray/check-bundle.sh`, `lib/release/release-app.ts`, `lib/release/verify.ts`, `lib/release/update-machine.ts`, `scripts/release/appcast.sh`, `commands/update.ts`, `lib/team/invite.ts`, `scripts/build-dev-app.ts`, `scripts/e2e-cleanroom.sh`, `website/docusaurus.config.ts`, `apps/gitq/website/docusaurus.config.ts`, `extensions/vscode/rt-context/package.json`, every `package.json` `repository`, `README.md`, `rt-tray/vm/README.md`, `marketplace/README.md`, `.github/renovate-global.json5`, `docs/*.md`, `skills/`, plus regenerated `website/docs/reference/**`.

Stage 3: `plugins/herdr-chat/**` (imported), `scripts/repo-purity.sh` (scoped terms), `scripts/ci/test-scope.ts` (`plugins/` rule and `plugins=` output), `.github/workflows/checks.yml` (`plugin-herdr-chat` job), `skills/rt-chat/SKILL.md`, `plugins/herdr-chat/README.md`, `plugins/herdr-chat/AGENTS.md`.

Stage 4: `plugins/mattstack/**` (imported), `scripts/repo-purity.sh` (three scoped terms), `.github/workflows/checks.yml` (`plugin-mattstack` job), `scripts/release/marketplace.sh` (second copy), `marketplace/marketplace.json`, `lib/skills/packs.ts` (`git-subdir`), `lib/skills/sync.ts` and `commands/skills-sync.ts` (in-tree engine), deleted `lib/mcp/__tests__/tools-payload-hash.test.ts`, `plugins/mattstack/README.md`.

---

## Stage 1: prove the update redirect

### Task 1: Throwaway rename proof (Matt-gated)

**Files:** none in the repo. Record the results in the PR body of Stage 2a.

- [ ] **Step 1: Ask Matt for the go** to create and delete a throwaway public repo `m4ttstack/rename-probe` in the org. Stop until he answers.

- [ ] **Step 2: Create the repo, one release, one asset, one branch**

```bash
PROBE="$(mktemp -d)/rename-probe"
mkdir -p "$PROBE" && cd "$PROBE"
git init -q -b main
printf '<?xml version="1.0"?><rss version="2.0"><channel><title>probe</title></channel></rss>\n' > appcast.xml
git add appcast.xml && git commit -qm "probe: appcast asset"
gh repo create m4ttstack/rename-probe --public --source=. --push
git checkout -qb probe-ref && git push -q origin probe-ref && git checkout -q main
gh release create v0.0.1 appcast.xml --repo m4ttstack/rename-probe --title v0.0.1 --notes probe
curl -sSL -o /dev/null -w '%{http_code} %{url_effective}\n' https://github.com/m4ttstack/rename-probe/releases/latest/download/appcast.xml
```
Expected: the last line is `200 https://github.com/m4ttstack/rename-probe/releases/download/v0.0.1/appcast.xml`.

- [ ] **Step 3: Rename and probe the three paths**

```bash
gh repo rename rename-probe-renamed --repo m4ttstack/rename-probe --yes
sleep 5
echo "asset:"; curl -sSL -o /dev/null -w '%{http_code} %{url_effective}\n' https://github.com/m4ttstack/rename-probe/releases/latest/download/appcast.xml
echo "api read (no follow):"; curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://api.github.com/repos/m4ttstack/rename-probe/releases/latest
echo "api read (gh follows):"; gh api repos/m4ttstack/rename-probe/releases/latest --jq .tag_name
SHA=$(gh api repos/m4ttstack/rename-probe-renamed/git/refs/heads/main --jq .object.sha)
echo "api write through old name:"
gh api -X PATCH repos/m4ttstack/rename-probe/git/refs/heads/probe-ref -f sha="$SHA" -F force=true --jq .object.sha; echo "exit=$?"
```
Expected: asset line `200 .../rename-probe-renamed/releases/download/v0.0.1/appcast.xml`; api read `301 https://api.github.com/repositories/<id>/releases/latest`; `gh api` prints `v0.0.1`. The write line prints either the sha (writes follow the 307) or an error; record which. Both reads passing is the gate; the write result decides whether any release may be cut between Stage 2b and 2c (this plan assumes none is).

- [ ] **Step 4: Delete the throwaway**

```bash
gh repo delete m4ttstack/rename-probe-renamed --yes
cd / && rm -rf "$(dirname "$PROBE")"
```

- [ ] **Step 5: Report** the four results to Matt verbatim. If the asset or the API read did not resolve, stop: the rename does not happen and Stages 2 to 4 are not started.

---

## Stage 2a: the re-key verb and the folder paths

### Task 2: Store-move primitives

**Files:**
- Create: `lib/state/reidentify.ts`
- Test: `lib/state/__tests__/reidentify-primitives.test.ts`

**Interfaces:**
- Consumes: `getStateDb`, `getKvValue`, `setKvValue`, `deleteKvValue`, `hasKvValue` from `lib/state/index.ts` (existing).
- Produces:

```ts
export type StoreStatus = "moved" | "already" | "none" | "refused";
export interface StoreReport { store: string; status: StoreStatus; count: number; detail?: string }
export function moveKvKey(ns: string, from: string, to: string, opts?: { dryRun?: boolean }): StoreReport;
export function moveTableRows(table: string, col: string, from: string, to: string, opts?: { dryRun?: boolean; db?: Database }): StoreReport;
export function dropTableRows(table: string, col: string, from: string, opts?: { dryRun?: boolean; db?: Database }): StoreReport;
```
Semantics, identical for every primitive: `from` present and `to` absent → move, re-read, `moved` (or `refused` with `detail` when the re-read does not show the move); `from` absent and `to` present → `already`; neither → `none`; both → `refused` with `detail: "both populated"`. `count` is rows (or 1 for a kv key) under `from` before the move. `dropTableRows` is for regenerable caches: `from` present → delete, `moved` with the deleted count; absent → `none`.

- [ ] **Step 1: Write the failing tests**

`lib/state/__tests__/reidentify-primitives.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb, getKvValue, getStateDb, hasKvValue, setKvValue } from "../index.ts";
import { dropTableRows, moveKvKey, moveTableRows } from "../reidentify.ts";

const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";

describe("reidentify primitives", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-reidentify-home-")));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("moveKvKey moves a key and reads it back under the new one", () => {
    setKvValue("probe", OLD, { a: 1 });
    const r = moveKvKey("probe", OLD, NEW);
    expect(r).toMatchObject({ store: "kv:probe", status: "moved", count: 1 });
    expect(getKvValue("probe", NEW, null)).toEqual({ a: 1 });
    expect(hasKvValue("probe", OLD)).toBe(false);
  });

  test("moveKvKey is already when only the new key exists, none when neither", () => {
    setKvValue("probe", NEW, 1);
    expect(moveKvKey("probe", OLD, NEW).status).toBe("already");
    expect(moveKvKey("other", OLD, NEW).status).toBe("none");
  });

  test("moveKvKey refuses when both keys exist and touches nothing", () => {
    setKvValue("probe", OLD, "o");
    setKvValue("probe", NEW, "n");
    const r = moveKvKey("probe", OLD, NEW);
    expect(r.status).toBe("refused");
    expect(r.detail).toBe("both populated");
    expect(getKvValue("probe", OLD, null)).toBe("o");
    expect(getKvValue("probe", NEW, null)).toBe("n");
  });

  test("moveKvKey dry run reports moved without writing", () => {
    setKvValue("probe", OLD, 1);
    expect(moveKvKey("probe", OLD, NEW, { dryRun: true }).status).toBe("moved");
    expect(hasKvValue("probe", OLD)).toBe(true);
    expect(hasKvValue("probe", NEW)).toBe(false);
  });

  test("moveTableRows rewrites every row's column and counts them", () => {
    const db = getStateDb();
    db.run("CREATE TABLE IF NOT EXISTS probe_rows (repo TEXT NOT NULL, n INTEGER NOT NULL)");
    db.run("INSERT INTO probe_rows (repo, n) VALUES (?, 1), (?, 2), (?, 3)", [OLD, OLD, "remote:github.com%2Facme%2Fother"]);
    const r = moveTableRows("probe_rows", "repo", OLD, NEW, { db });
    expect(r).toMatchObject({ store: "probe_rows.repo", status: "moved", count: 2 });
    const rows = db.query("SELECT repo, n FROM probe_rows ORDER BY n").all() as { repo: string; n: number }[];
    expect(rows).toEqual([{ repo: NEW, n: 1 }, { repo: NEW, n: 2 }, { repo: "remote:github.com%2Facme%2Fother", n: 3 }]);
  });

  test("moveTableRows refuses when both identities hold rows", () => {
    const db = getStateDb();
    db.run("CREATE TABLE IF NOT EXISTS probe_rows (repo TEXT NOT NULL, n INTEGER NOT NULL)");
    db.run("INSERT INTO probe_rows (repo, n) VALUES (?, 1), (?, 2)", [OLD, NEW]);
    expect(moveTableRows("probe_rows", "repo", OLD, NEW, { db }).status).toBe("refused");
    expect((db.query("SELECT COUNT(*) AS c FROM probe_rows WHERE repo = ?").get(OLD) as { c: number }).c).toBe(1);
  });

  test("moveTableRows is none on a missing table", () => {
    expect(moveTableRows("no_such_table", "repo", OLD, NEW).status).toBe("none");
  });

  test("dropTableRows deletes the old identity's rows and reports the count", () => {
    const db = getStateDb();
    db.run("CREATE TABLE IF NOT EXISTS probe_cache (repo TEXT NOT NULL, v TEXT)");
    db.run("INSERT INTO probe_cache (repo, v) VALUES (?, 'a'), (?, 'b')", [OLD, OLD]);
    expect(dropTableRows("probe_cache", "repo", OLD, { db })).toMatchObject({ status: "moved", count: 2 });
    expect((db.query("SELECT COUNT(*) AS c FROM probe_cache").get() as { c: number }).c).toBe(0);
    expect(dropTableRows("probe_cache", "repo", OLD, { db }).status).toBe("none");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/state/__tests__/reidentify-primitives.test.ts`
Expected: FAIL, `Cannot find module "../reidentify.ts"`.

- [ ] **Step 3: Implement `lib/state/reidentify.ts`**

```ts
/**
 * lib/state/reidentify.ts: verify-persisted moves of one identity-keyed row set
 * from one serialized identity to another.
 *
 * `setKvValue`/`persistOrWarn` swallow SQLITE_BUSY, so every move re-reads
 * before it reports success; a write that did not land is a refusal, never a
 * silent partial.
 */

import type { Database } from "bun:sqlite";
import { deleteKvValue, getKvValue, getStateDb, hasKvValue, setKvValue } from "./index.ts";

export type StoreStatus = "moved" | "already" | "none" | "refused";

export interface StoreReport {
  store: string;
  status: StoreStatus;
  count: number;
  detail?: string;
}

const BOTH = "both populated";

export function moveKvKey(ns: string, from: string, to: string, opts: { dryRun?: boolean } = {}): StoreReport {
  const store = `kv:${ns}`;
  const hasFrom = hasKvValue(ns, from);
  const hasTo = hasKvValue(ns, to);
  if (!hasFrom && hasTo) return { store, status: "already", count: 0 };
  if (!hasFrom) return { store, status: "none", count: 0 };
  if (hasTo) return { store, status: "refused", count: 1, detail: BOTH };
  if (opts.dryRun) return { store, status: "moved", count: 1 };
  const value = getKvValue<unknown>(ns, from, undefined);
  setKvValue(ns, to, value);
  if (JSON.stringify(getKvValue<unknown>(ns, to, undefined)) !== JSON.stringify(value)) {
    return { store, status: "refused", count: 1, detail: `${to} did not persist` };
  }
  deleteKvValue(ns, from);
  return { store, status: "moved", count: 1 };
}

function tableExists(db: Database, table: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return row !== null && row !== undefined;
}

function countWhere(db: Database, table: string, col: string, value: string): number {
  // `table` and `col` are caller literals, never user input.
  return (db.query(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col} = ?`).get(value) as { c: number }).c;
}

export function moveTableRows(
  table: string,
  col: string,
  from: string,
  to: string,
  opts: { dryRun?: boolean; db?: Database } = {},
): StoreReport {
  const store = `${table}.${col}`;
  const db = opts.db ?? getStateDb();
  if (!tableExists(db, table)) return { store, status: "none", count: 0 };
  const fromCount = countWhere(db, table, col, from);
  const toCount = countWhere(db, table, col, to);
  if (fromCount === 0 && toCount > 0) return { store, status: "already", count: 0 };
  if (fromCount === 0) return { store, status: "none", count: 0 };
  if (toCount > 0) return { store, status: "refused", count: fromCount, detail: BOTH };
  if (opts.dryRun) return { store, status: "moved", count: fromCount };
  db.run(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, [to, from]);
  if (countWhere(db, table, col, from) !== 0 || countWhere(db, table, col, to) !== fromCount) {
    return { store, status: "refused", count: fromCount, detail: "rows did not persist under the new identity" };
  }
  return { store, status: "moved", count: fromCount };
}

export function dropTableRows(table: string, col: string, from: string, opts: { dryRun?: boolean; db?: Database } = {}): StoreReport {
  const store = `${table}.${col}`;
  const db = opts.db ?? getStateDb();
  if (!tableExists(db, table)) return { store, status: "none", count: 0 };
  const fromCount = countWhere(db, table, col, from);
  if (fromCount === 0) return { store, status: "none", count: 0 };
  if (opts.dryRun) return { store, status: "moved", count: fromCount };
  db.run(`DELETE FROM ${table} WHERE ${col} = ?`, [from]);
  if (countWhere(db, table, col, from) !== 0) return { store, status: "refused", count: fromCount, detail: "rows did not delete" };
  return { store, status: "moved", count: fromCount };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/state/__tests__/reidentify-primitives.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/state/reidentify.ts lib/state/__tests__/reidentify-primitives.test.ts
git commit -m "state: verify-persisted kv and table moves between identities"
```

### Task 3: Rename a `repos.<identity>` settings section in one store

**Files:**
- Modify: `packages/rt-client/src/settings/write.ts` (append)
- Test: `packages/rt-client/src/settings/__tests__/rename-repo-section.test.ts`

**Interfaces:**
- Consumes: `writeIntoStore`, `removeFromStore` and `readStore` already in `write.ts`/`stores.ts`.
- Produces:

```ts
export type SectionRename = "moved" | "already" | "none" | "refused";
export function renameRepoSection(storePath: string, oldId: string, newId: string, opts?: { dryRun?: boolean }): { status: SectionRename; keys: number; detail?: string };
```
`oldId`/`newId` are the raw `host/path` form (`github.com/m4ttstack/rt`), the form `repos.<id>` sections key on. `keys` is the number of top-level keys in the old section. A store file that does not exist is `none`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readStore } from "../stores.ts";
import { renameRepoSection } from "../write.ts";

const OLD = "github.com/acme/old";
const NEW = "github.com/acme/new";

describe("renameRepoSection", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-rename-section-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function store(body: string): string {
    const file = join(dir, "settings.machine.jsonc");
    writeFileSync(file, body);
    return file;
  }

  test("moves the section and keeps the rest of the file", () => {
    const file = store(`// header comment\n{\n  "rt.cron": { "a": 1 },\n  "repos": {\n    "${OLD}": { "rt.worktrees": { "onDeck": 2 } }\n  }\n}\n`);
    const r = renameRepoSection(file, OLD, NEW);
    expect(r).toEqual({ status: "moved", keys: 1 });
    const s = readStore(file);
    expect(s.repos[NEW]).toEqual({ "rt.worktrees": { onDeck: 2 } });
    expect(s.repos[OLD]).toBeUndefined();
    expect(s.global["rt.cron"]).toEqual({ a: 1 });
  });

  test("already when only the new section exists, none when neither or no file", () => {
    const file = store(`{ "repos": { "${NEW}": { "x": 1 } } }\n`);
    expect(renameRepoSection(file, OLD, NEW).status).toBe("already");
    expect(renameRepoSection(store(`{ "a": 1 }\n`), OLD, NEW).status).toBe("none");
    expect(renameRepoSection(join(dir, "missing.jsonc"), OLD, NEW).status).toBe("none");
  });

  test("refuses when both sections exist", () => {
    const file = store(`{ "repos": { "${OLD}": { "x": 1 }, "${NEW}": { "y": 2 } } }\n`);
    const r = renameRepoSection(file, OLD, NEW);
    expect(r.status).toBe("refused");
    expect(readStore(file).repos[OLD]).toEqual({ x: 1 });
  });

  test("dry run reports without writing", () => {
    const file = store(`{ "repos": { "${OLD}": { "x": 1 } } }\n`);
    expect(renameRepoSection(file, OLD, NEW, { dryRun: true })).toEqual({ status: "moved", keys: 1 });
    expect(readStore(file).repos[OLD]).toEqual({ x: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/rename-repo-section.test.ts`
Expected: FAIL, `renameRepoSection is not a function` (or not exported).

- [ ] **Step 3: Append to `packages/rt-client/src/settings/write.ts`**

```ts
export type SectionRename = "moved" | "already" | "none" | "refused";

/**
 * Moves one `repos.<oldId>` section onto `repos.<newId>` in a single store
 * file, keeping every other key and comment. The rename is two edits on the
 * same jsonc document (set the new section, remove the old), then a re-read
 * proves both landed.
 */
export function renameRepoSection(
  storePath: string,
  oldId: string,
  newId: string,
  opts: { dryRun?: boolean } = {},
): { status: SectionRename; keys: number; detail?: string } {
  if (!existsSync(storePath)) return { status: "none", keys: 0 };
  const before = readStore(storePath);
  const oldSection = before.repos[oldId];
  const hasNew = before.repos[newId] !== undefined;
  if (oldSection === undefined && hasNew) return { status: "already", keys: 0 };
  if (oldSection === undefined) return { status: "none", keys: 0 };
  const keys = Object.keys(oldSection).length;
  if (hasNew) return { status: "refused", keys, detail: "both populated" };
  if (opts.dryRun) return { status: "moved", keys };
  writeIntoStore(storePath, () => [{ path: ["repos", newId], value: oldSection }], false);
  removeFromStore(storePath, () => [["repos", oldId]]);
  const after = readStore(storePath);
  if (JSON.stringify(after.repos[newId]) !== JSON.stringify(oldSection) || after.repos[oldId] !== undefined) {
    return { status: "refused", keys, detail: `${storePath} did not persist the rename` };
  }
  return { status: "moved", keys };
}
```
`readStore` is imported from `./stores.ts` (add the import if `write.ts` does not already have it); `existsSync` is already imported.

- [ ] **Step 4: Run the test and rebuild the package**

Run: `bun test packages/rt-client/src/settings/__tests__/rename-repo-section.test.ts && (cd packages/rt-client && bun run build) && bun test packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS on both.

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/settings/write.ts packages/rt-client/src/settings/__tests__/rename-repo-section.test.ts
git commit -m "rt-client: renameRepoSection moves one repos.<id> section between identities"
```

### Task 4: Move an `rt.repoTracking` entry and export the cursor namespace

**Files:**
- Modify: `lib/repo-tracking.ts` (append), `lib/state/cursors-store.ts:37` (`const CURSOR_NS` becomes `export const CURSOR_NS`)
- Test: `lib/__tests__/repo-tracking-move.test.ts`

**Interfaces:**
- Consumes: `loadMachineRepoTrackingRaw`, `saveRepoTrackingRaw` (exported, `lib/repo-tracking.ts:221,274`).
- Produces: `export function moveRepoTrackingEntry(from: string, to: string, opts?: { dryRun?: boolean }): StoreReport` (keys are serialized identities, `remote:github.com%2Fm4ttstack%2Frt`).

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../state/index.ts";
import { loadMachineRepoTrackingRaw, moveRepoTrackingEntry, saveRepoTrackingRaw } from "../repo-tracking.ts";

const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";

describe("moveRepoTrackingEntry", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-tracking-move-")));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("moves the entry and re-reads it under the new key", () => {
    saveRepoTrackingRaw({ [OLD]: { mode: "full" }, other: { mode: "off" } });
    expect(moveRepoTrackingEntry(OLD, NEW)).toMatchObject({ store: "rt.repoTracking", status: "moved", count: 1 });
    const raw = loadMachineRepoTrackingRaw();
    expect(raw[NEW]).toEqual({ mode: "full" });
    expect(raw[OLD]).toBeUndefined();
    expect(raw.other).toEqual({ mode: "off" });
  });

  test("already, none and refused", () => {
    saveRepoTrackingRaw({ [NEW]: { mode: "full" } });
    expect(moveRepoTrackingEntry(OLD, NEW).status).toBe("already");
    saveRepoTrackingRaw({});
    expect(moveRepoTrackingEntry(OLD, NEW).status).toBe("none");
    saveRepoTrackingRaw({ [OLD]: { mode: "full" }, [NEW]: { mode: "off" } });
    expect(moveRepoTrackingEntry(OLD, NEW).status).toBe("refused");
    expect(loadMachineRepoTrackingRaw()[OLD]).toEqual({ mode: "full" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test lib/__tests__/repo-tracking-move.test.ts`
Expected: FAIL, `moveRepoTrackingEntry` is not exported.

- [ ] **Step 3: Append to `lib/repo-tracking.ts`**

```ts
import type { StoreReport } from "./state/reidentify.ts";

/**
 * Moves one tracking grant between serialized identities. The setting is one
 * blob whose write the resolver can drop silently, so the re-read decides.
 */
export function moveRepoTrackingEntry(from: string, to: string, opts: { dryRun?: boolean } = {}): StoreReport {
  const store = "rt.repoTracking";
  const raw = loadMachineRepoTrackingRaw();
  const hasFrom = Object.prototype.hasOwnProperty.call(raw, from);
  const hasTo = Object.prototype.hasOwnProperty.call(raw, to);
  if (!hasFrom && hasTo) return { store, status: "already", count: 0 };
  if (!hasFrom) return { store, status: "none", count: 0 };
  if (hasTo) return { store, status: "refused", count: 1, detail: "both populated" };
  if (opts.dryRun) return { store, status: "moved", count: 1 };
  const next: Record<string, unknown> = { ...raw, [to]: raw[from] };
  delete next[from];
  saveRepoTrackingRaw(next);
  const after = loadMachineRepoTrackingRaw();
  if (JSON.stringify(after[to]) !== JSON.stringify(raw[from]) || Object.prototype.hasOwnProperty.call(after, from)) {
    return { store, status: "refused", count: 1, detail: "rt.repoTracking did not persist the move" };
  }
  return { store, status: "moved", count: 1 };
}
```
Put the `import type` with the file's other imports. In `lib/state/cursors-store.ts` change line 37 to `export const CURSOR_NS = "events-cursor";`.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/__tests__/repo-tracking-move.test.ts lib/__tests__/repo-tracking.test.ts lib/state/__tests__/cursors-store.test.ts`
Expected: PASS (the last two are the existing suites for the touched files; if a name differs, run `ls lib/__tests__ | grep tracking` and `ls lib/state/__tests__ | grep cursor` and use those).

- [ ] **Step 5: Commit**

```bash
git add lib/repo-tracking.ts lib/state/cursors-store.ts lib/__tests__/repo-tracking-move.test.ts
git commit -m "repo-tracking: moveRepoTrackingEntry between identities; export CURSOR_NS"
```

### Task 5: The `reidentify` orchestrator

**Files:**
- Create: `lib/repo-reidentify.ts`
- Test: `lib/__tests__/repo-reidentify.test.ts`

**Interfaces:**
- Consumes: Task 2 primitives; Task 3 `renameRepoSection`; Task 4 `moveRepoTrackingEntry`, `CURSOR_NS`; `migrateRepoData` and `REPO_INDEX_NS` from `lib/repo-index.ts`; `parseIdentity`, `serializeIdentity` from `lib/settings/identity.ts`; `userSettingsPath`, `machineSettingsPath`, `teamSettingsPath` from `packages/rt-client/src/settings/paths.ts`; `listTeams` from `packages/rt-client/src/settings/stores.ts`; `RT_DIR` from `lib/daemon-config.ts` (the herds db is `join(RT_DIR, "herds.db")`, `lib/daemon.ts:679`).
- Produces:

```ts
export interface IdentityPair { serialized: string; raw: string }
export function normalizeIdentityArg(arg: string): IdentityPair | null;
export interface ReidentifyReport {
  from: IdentityPair; to: IdentityPair; dryRun: boolean;
  stores: StoreReport[];
  /** True when no store is refused. */
  ok: boolean;
}
export async function reidentify(fromArg: string, toArg: string, opts?: { dryRun?: boolean }): Promise<ReidentifyReport | { error: string }>;
```
`normalizeIdentityArg` accepts either form: a serialized identity (`remote:github.com%2Fm4ttstack%2Frt`, parsed by `parseIdentity`) or the raw remote form (`github.com/m4ttstack/rt`, which becomes `serializeIdentity({ kind: "remote", id: raw })`). Path-kind identities are refused (`error`).

The store list, in this order (each entry is one `StoreReport`; the run continues past a refusal so the report is complete):

1. `kv:repo-index` (`moveKvKey(REPO_INDEX_NS, ...)`)
2. `data-dir` (`migrateRepoData(from, to, { dryRun })`: `~/.mattstack/rt/repos/<id>/` plus the worktree registry kv row; `count` = `moved.length + merged.length`; status `refused` when `migrationIncomplete`, `none` when nothing existed under `from`, else `moved`)
3. `rt.repoTracking` (`moveRepoTrackingEntry`)
4. `kv:events-cursor` (`moveKvKey(CURSOR_NS, ...)`)
5. `run_history.repo`, `endpoint_claims.repo`, `project_mrs.repo`, `project_mrs_meta.repo`, `project_mr_demands.repo`, `project_mr_sections.repo`, `discussions.repo`, `agents.repo` (`moveTableRows` on state.db)
6. `branch_cache.repo`, `git_badges.repo` (`dropTableRows`: both are regenerable caches the next sweep rebuilds, and `branch_cache` also embeds the identity in its key column)
7. `herds.repo` in `~/.mattstack/rt/herds.db` (`moveTableRows` with `db: new Database(path)` when the file exists, `none` otherwise; close the handle after)
8. `settings:user`, `settings:machine`, and one `settings:team:<name>` per `listTeams()` (`renameRepoSection(path, from.raw, to.raw)`; the report's `count` is `keys`)

- [ ] **Step 1: Write the failing tests**

`lib/__tests__/repo-reidentify.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RT_DIR } from "../daemon-config.ts";
import { REPO_INDEX_NS, loadRepoIndex } from "../repo-index.ts";
import { loadMachineRepoTrackingRaw, saveRepoTrackingRaw } from "../repo-tracking.ts";
import { repoDataDir } from "../rt-paths.ts";
import { closeStateDb, getKvValue, getStateDb, setKvValue } from "../state/index.ts";
import { CURSOR_NS } from "../state/cursors-store.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../worktree/registry.ts";
import { machineSettingsPath, userSettingsPath } from "../../packages/rt-client/src/settings/paths.ts";
import { readStore } from "../../packages/rt-client/src/settings/stores.ts";
import { normalizeIdentityArg, reidentify } from "../repo-reidentify.ts";

const OLD_RAW = "github.com/acme/old";
const NEW_RAW = "github.com/acme/new";
const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";

describe("normalizeIdentityArg", () => {
  test("accepts raw and serialized forms and refuses path-kind", () => {
    expect(normalizeIdentityArg(OLD_RAW)).toEqual({ serialized: OLD, raw: OLD_RAW });
    expect(normalizeIdentityArg(OLD)).toEqual({ serialized: OLD, raw: OLD_RAW });
    expect(normalizeIdentityArg("path:%2Ftmp%2Fx")).toBeNull();
    expect(normalizeIdentityArg("")).toBeNull();
  });
});

describe("reidentify", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-reidentify-")));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  /** Seeds one row in every store under `id`. */
  function seedAll(id: string, raw: string): void {
    setKvValue(REPO_INDEX_NS, id, join(home, "checkout"));
    mkdirSync(repoDataDir(id), { recursive: true });
    writeFileSync(join(repoDataDir(id), "run-history.jsonl"), `{"ts":"2026-01-01T00:00:00Z","id":"r1"}\n`);
    const tree: TreeRecord = { name: "main", path: join(home, "checkout"), kind: "main", branch: "main", state: "claimed", createdAt: "2026-01-01T00:00:00.000Z" } as TreeRecord;
    saveRegistry(id, [tree]);
    saveRepoTrackingRaw({ [id]: { mode: "full" } });
    setKvValue(CURSOR_NS, id, 42);
    const db = getStateDb();
    db.run(
      "INSERT INTO run_history (repo, ts, cmd, cwd, worktree, branch, pkg, script, exit) VALUES (?, '2026-01-01T00:00:00Z', 'bun test', '/c', '/c', 'main', 'rt', 'test', 0)",
      [id],
    );
    db.run("INSERT INTO git_badges (repo, worktree, badge, updated_at) VALUES (?, '/c', '{}', 1)", [id]);
    mkdirSync(RT_DIR, { recursive: true });
    const herds = new Database(join(RT_DIR, "herds.db"), { create: true });
    herds.run("CREATE TABLE IF NOT EXISTS herds (id TEXT PRIMARY KEY, repo TEXT NOT NULL)");
    herds.run("INSERT OR REPLACE INTO herds (id, repo) VALUES ('h1', ?)", [id]);
    herds.close();
    mkdirSync(join(machineSettingsPath(), ".."), { recursive: true });
    writeFileSync(machineSettingsPath(), `{ "repos": { "${raw}": { "rt.worktrees": { "onDeck": 1 } } } }\n`);
    mkdirSync(join(userSettingsPath(), ".."), { recursive: true });
    writeFileSync(userSettingsPath(), `{ "repos": { "${raw}": { "rt.mr": { "a": 1 } } } }\n`);
  }

  test("moves every store and reads each back under the new identity", async () => {
    seedAll(OLD, OLD_RAW);
    const r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.ok).toBe(true);
    const byStore = Object.fromEntries(r.stores.map((s) => [s.store, s.status]));
    expect(byStore["kv:repo-index"]).toBe("moved");
    expect(byStore["data-dir"]).toBe("moved");
    expect(byStore["rt.repoTracking"]).toBe("moved");
    expect(byStore["kv:events-cursor"]).toBe("moved");
    expect(byStore["run_history.repo"]).toBe("moved");
    expect(byStore["git_badges.repo"]).toBe("moved");
    expect(byStore["herds.repo"]).toBe("moved");
    expect(byStore["settings:machine"]).toBe("moved");
    expect(byStore["settings:user"]).toBe("moved");
    expect(loadRepoIndex()[NEW]).toBe(join(home, "checkout"));
    expect(loadRepoIndex()[OLD]).toBeUndefined();
    expect(loadRegistry(NEW).map((t) => t.name)).toEqual(["main"]);
    expect(loadRegistry(OLD)).toEqual([]);
    expect(loadMachineRepoTrackingRaw()[NEW]).toEqual({ mode: "full" });
    expect(getKvValue(CURSOR_NS, NEW, null)).toBe(42);
    const db = getStateDb();
    expect((db.query("SELECT COUNT(*) AS c FROM run_history WHERE repo = ?").get(NEW) as { c: number }).c).toBe(1);
    expect((db.query("SELECT COUNT(*) AS c FROM git_badges").get() as { c: number }).c).toBe(0);
    const herds = new Database(join(RT_DIR, "herds.db"), { readonly: true });
    expect((herds.query("SELECT repo FROM herds WHERE id = 'h1'").get() as { repo: string }).repo).toBe(NEW);
    herds.close();
    expect(readStore(machineSettingsPath()).repos[NEW_RAW]).toEqual({ "rt.worktrees": { onDeck: 1 } });
    expect(readStore(userSettingsPath()).repos[NEW_RAW]).toEqual({ "rt.mr": { a: 1 } });
  });

  test("a second run is already or none everywhere and still ok", async () => {
    seedAll(OLD, OLD_RAW);
    await reidentify(OLD_RAW, NEW_RAW);
    const r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.ok).toBe(true);
    expect(r.stores.every((s) => s.status === "already" || s.status === "none")).toBe(true);
  });

  test("nothing under the old identity is ok with all none", async () => {
    const r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.ok).toBe(true);
    expect(r.stores.every((s) => s.status === "none")).toBe(true);
  });

  test("one store populated on both sides is refused there, moved elsewhere, and not ok", async () => {
    seedAll(OLD, OLD_RAW);
    saveRepoTrackingRaw({ [OLD]: { mode: "full" }, [NEW]: { mode: "off" } });
    const r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.ok).toBe(false);
    const tracking = r.stores.find((s) => s.store === "rt.repoTracking")!;
    expect(tracking.status).toBe("refused");
    expect(r.stores.find((s) => s.store === "kv:repo-index")!.status).toBe("moved");
    expect(loadMachineRepoTrackingRaw()[OLD]).toEqual({ mode: "full" });
  });

  test("dry run writes nothing and reports moved with counts", async () => {
    seedAll(OLD, OLD_RAW);
    const r = await reidentify(OLD_RAW, NEW_RAW, { dryRun: true });
    if ("error" in r) throw new Error(r.error);
    expect(r.dryRun).toBe(true);
    expect(r.stores.find((s) => s.store === "run_history.repo")).toMatchObject({ status: "moved", count: 1 });
    expect(loadRepoIndex()[OLD]).toBe(join(home, "checkout"));
    expect(readStore(machineSettingsPath()).repos[OLD_RAW]).toBeDefined();
  });

  test("refuses a path-kind identity", async () => {
    const r = await reidentify("path:%2Ftmp%2Fx", NEW_RAW);
    expect("error" in r && r.error).toContain("remote");
  });
});
```
If `run_history` or `git_badges` column names differ from the seed above, read their `CREATE TABLE` in `lib/state/db.ts` (lines 156 and 327) and adjust only the INSERT columns; the `repo` column is what the test asserts on. Likewise `TreeRecord`'s required fields come from `lib/worktree/registry.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/__tests__/repo-reidentify.test.ts`
Expected: FAIL, `Cannot find module "../repo-reidentify.ts"`.

- [ ] **Step 3: Implement `lib/repo-reidentify.ts`**

```ts
/**
 * lib/repo-reidentify.ts: move every identity-keyed store from one serialized
 * identity to another. Store by store, verify-persisted, idempotent; a
 * refusal in one store never stops the others, so the report is complete.
 * The worktree pool directory is deliberately not a store here: the registry
 * holds absolute tree paths and the segment is a derived name, never a key.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { RT_DIR } from "./daemon-config.ts";
import { migrateRepoData, migrationIncomplete, REPO_INDEX_NS } from "./repo-index.ts";
import { moveRepoTrackingEntry } from "./repo-tracking.ts";
import { parseIdentity, serializeIdentity } from "./settings/identity.ts";
import { CURSOR_NS } from "./state/cursors-store.ts";
import { dropTableRows, moveKvKey, moveTableRows, type StoreReport } from "./state/reidentify.ts";
import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "../packages/rt-client/src/settings/paths.ts";
import { listTeams } from "../packages/rt-client/src/settings/stores.ts";
import { renameRepoSection } from "../packages/rt-client/src/settings/write.ts";

export interface IdentityPair {
  serialized: string;
  raw: string;
}

export interface ReidentifyReport {
  from: IdentityPair;
  to: IdentityPair;
  dryRun: boolean;
  stores: StoreReport[];
  ok: boolean;
}

export function normalizeIdentityArg(arg: string): IdentityPair | null {
  const trimmed = arg.trim();
  if (trimmed === "") return null;
  const parsed = parseIdentity(trimmed);
  if (parsed) {
    if (parsed.kind !== "remote") return null;
    return { serialized: trimmed, raw: parsed.id };
  }
  if (trimmed.includes(":") || !trimmed.includes("/")) return null;
  return { serialized: serializeIdentity({ kind: "remote", id: trimmed }), raw: trimmed };
}

const MOVED_TABLES = [
  "run_history",
  "endpoint_claims",
  "project_mrs",
  "project_mrs_meta",
  "project_mr_demands",
  "project_mr_sections",
  "discussions",
  "agents",
];
const DROPPED_TABLES = ["branch_cache", "git_badges"];

function dataDirReport(from: string, to: string, dryRun: boolean): StoreReport {
  const store = "data-dir";
  const m = migrateRepoData(from, to, { dryRun });
  const count = m.moved.length + m.merged.length;
  if (migrationIncomplete(m)) return { store, status: "refused", count, detail: `refused: ${[...m.refused, ...(m.registry === "refused" ? ["worktree-registry"] : [])].join(", ")}` };
  if (count === 0 && m.registry === "none") return { store, status: "none", count: 0 };
  return { store, status: "moved", count: count + (m.registry === "none" ? 0 : 1) };
}

function herdsReport(from: string, to: string, dryRun: boolean): StoreReport {
  const path = join(RT_DIR, "herds.db");
  if (!existsSync(path)) return { store: "herds.repo", status: "none", count: 0 };
  const db = new Database(path, { create: false });
  try {
    return moveTableRows("herds", "repo", from, to, { dryRun, db });
  } finally {
    db.close();
  }
}

function settingsReport(label: string, path: string, from: string, to: string, dryRun: boolean): StoreReport {
  const r = renameRepoSection(path, from, to, { dryRun });
  return { store: `settings:${label}`, status: r.status, count: r.keys, ...(r.detail ? { detail: r.detail } : {}) };
}

export async function reidentify(fromArg: string, toArg: string, opts: { dryRun?: boolean } = {}): Promise<ReidentifyReport | { error: string }> {
  const from = normalizeIdentityArg(fromArg);
  const to = normalizeIdentityArg(toArg);
  if (!from || !to) return { error: "both identities must be remote-kind: github.com/owner/repo or remote:github.com%2Fowner%2Frepo" };
  if (from.serialized === to.serialized) return { error: "old and new identities are the same" };
  const dryRun = opts.dryRun === true;
  const stores: StoreReport[] = [];

  stores.push(moveKvKey(REPO_INDEX_NS, from.serialized, to.serialized, { dryRun }));
  stores.push(dataDirReport(from.serialized, to.serialized, dryRun));
  stores.push(moveRepoTrackingEntry(from.serialized, to.serialized, { dryRun }));
  stores.push(moveKvKey(CURSOR_NS, from.serialized, to.serialized, { dryRun }));
  for (const table of MOVED_TABLES) stores.push(moveTableRows(table, "repo", from.serialized, to.serialized, { dryRun }));
  for (const table of DROPPED_TABLES) stores.push(dropTableRows(table, "repo", from.serialized, { dryRun }));
  stores.push(herdsReport(from.serialized, to.serialized, dryRun));
  stores.push(settingsReport("user", userSettingsPath(), from.raw, to.raw, dryRun));
  stores.push(settingsReport("machine", machineSettingsPath(), from.raw, to.raw, dryRun));
  for (const team of listTeams()) stores.push(settingsReport(`team:${team}`, teamSettingsPath(team), from.raw, to.raw, dryRun));

  return { from, to, dryRun, stores, ok: stores.every((s) => s.status !== "refused") };
}
```
`parseIdentity` returns `{ kind: "remote" | "path"; id: string } | null` and `serializeIdentity` takes that shape (`packages/rt-client/src/settings/identity.ts`). If `listTeams` needs an argument in the current source, pass what `readStores` in `resolve.ts:242` passes.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/__tests__/repo-reidentify.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/repo-reidentify.ts lib/__tests__/repo-reidentify.test.ts
git commit -m "repo-reidentify: move every identity-keyed store between identities"
```

### Task 6: Locate after reidentify, and the per-store refusal exit

**Files:**
- Test: `lib/__tests__/repo-reidentify-locate.test.ts`

**Interfaces:** consumes Task 5's `reidentify`, `planLocate`/`applyLocate`/`isRefusal` from `lib/repo-locate.ts`. Produces nothing new; this task pins Review Focus 1 to 3.

- [ ] **Step 1: Write the test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadRepoIndex, REPO_INDEX_NS } from "../repo-index.ts";
import { applyLocate, isRefusal, planLocate } from "../repo-locate.ts";
import { reidentify } from "../repo-reidentify.ts";
import { closeStateDb, setKvValue } from "../state/index.ts";
import { saveRegistry, loadRegistry, type TreeRecord } from "../worktree/registry.ts";

const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";

describe("reidentify then locate", () => {
  const origHome = process.env.HOME;
  let home: string;
  let scratch: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-reid-locate-home-")));
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "rt-reid-locate-repos-")));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  function repo(remote: string): string {
    const dir = join(scratch, "checkout");
    mkdirSync(dir, { recursive: true });
    execSync(`git init -q -b main && git remote add origin ${remote} && git commit -q --allow-empty -m init`, { cwd: dir });
    return dir;
  }

  test("locate refuses before reidentify and re-points after", async () => {
    const path = repo("https://github.com/acme/old.git");
    setKvValue(REPO_INDEX_NS, OLD, path);
    saveRegistry(OLD, [{ name: "main", path, kind: "main", branch: "main", state: "claimed", createdAt: "2026-01-01T00:00:00.000Z" } as TreeRecord]);
    execSync("git remote set-url origin https://github.com/acme/new.git", { cwd: path });
    const moved = join(scratch, "moved");
    renameSync(path, moved);

    const before = await planLocate({ newPath: moved });
    expect(isRefusal(before) && before.refusal).toBe("identity-mismatch");

    const r = await reidentify("github.com/acme/old", "github.com/acme/new");
    if ("error" in r) throw new Error(r.error);
    expect(r.ok).toBe(true);

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(plan.message);
    expect(plan.identity).toBe(NEW);
    const result = await applyLocate(plan);
    expect(result.ok).toBe(true);
    expect(loadRepoIndex()[NEW]).toBe(moved);
    expect(loadRegistry(NEW)[0]!.path).toBe(moved);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `bun test lib/__tests__/repo-reidentify-locate.test.ts`
Expected: PASS. If `planLocate` derives the identity through the process-wide memo and returns the old identity for the moved path, the test is telling the truth about a real trap: call `clearIdentityMemo()` (exported from `lib/settings/identity.ts`) between the two `planLocate` calls in the test and note in the Task 9 command that `rt repos reidentify` runs in its own process, so no memo carries over.

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/repo-reidentify-locate.test.ts
git commit -m "repo-reidentify: locate finds the re-keyed row under the new identity"
```

### Task 7: Daemon handler, dispatch, command, node, registry

**Files:**
- Modify: `lib/daemon/handlers/repos.ts` (add `"repos:reidentify"`), `lib/command-tree-def.ts` (node under `repos`, after `locate`), `lib/module-registry.ts` (entry)
- Create: `lib/repo-reidentify-dispatch.ts`, `commands/repos-reidentify.ts`
- Test: `lib/daemon/__tests__/repos-reidentify-handler.test.ts`, `lib/__tests__/repo-reidentify-dispatch.test.ts`, `commands/__tests__/repos-reidentify.test.ts`

**Interfaces:**
- Consumes: Task 5 `reidentify`; `daemonSocketQuery`, `DAEMON_SOCK_PATH`, `isDaemonProcessRunning` (as `lib/repo-locate-dispatch.ts` does); `exitUserError`, `UserActionableError` from `lib/setup/errors.ts`; `envelope` from `lib/setup/contract.ts`.
- Produces:

```ts
// lib/repo-reidentify-dispatch.ts
export type ReidentifyOutcome =
  | { via: "daemon" | "local"; ok: true; report: ReidentifyReport }
  | { via: "daemon" | "local"; ok: false; error: string };
export async function reidentifyRepo(req: { from: string; to: string; dryRun?: boolean }): Promise<ReidentifyOutcome>;
// daemon: "repos:reidentify" payload { from, to, dryRun? } -> { ok: true, data: ReidentifyReport } | { ok: false, error }
// commands/repos-reidentify.ts
export async function reposReidentify(args: string[], _ctx?: CommandContext, deps?: { print: (s: string) => void }): Promise<void>;
```
Exit code: 0 when `report.ok`; 1 (through `exitUserError` with code `refused`) when any store is refused, after printing the full per-store table so the operator sees what moved.

- [ ] **Step 1: Write the failing handler test**

`lib/daemon/__tests__/repos-reidentify-handler.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { REPO_INDEX_NS, loadRepoIndex } from "../../repo-index.ts";
import { closeStateDb, setKvValue } from "../../state/index.ts";
import { createReposHandlers } from "../handlers/repos.ts";

const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";

describe("repos:reidentify", () => {
  const origHome = process.env.HOME;
  let home: string;
  let held: number;
  let events: { topic: string; payload: unknown }[];
  let handlers: ReturnType<typeof createReposHandlers>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-reid-handler-")));
    process.env.HOME = home;
    closeStateDb();
    held = 0;
    events = [];
    handlers = createReposHandlers({
      withReconcilerHeld: async (fn) => { held++; return fn(); },
      refreshWatchedRepos: () => {},
      emitEvent: (topic, payload) => events.push({ topic, payload }),
    });
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("runs inside the reconciler hold, moves the index row, emits repo:reidentified", async () => {
    setKvValue(REPO_INDEX_NS, OLD, "/x");
    const res = await handlers["repos:reidentify"]({ from: "github.com/acme/old", to: "github.com/acme/new" });
    expect(res.ok).toBe(true);
    expect(held).toBe(1);
    expect(loadRepoIndex()[NEW]).toBe("/x");
    expect(events).toEqual([{ topic: "repo:reidentified", payload: { from: OLD, to: NEW } }]);
  });

  test("dry run emits nothing and moves nothing", async () => {
    setKvValue(REPO_INDEX_NS, OLD, "/x");
    const res = await handlers["repos:reidentify"]({ from: OLD, to: NEW, dryRun: true });
    expect(res.ok).toBe(true);
    expect(res.data.dryRun).toBe(true);
    expect(loadRepoIndex()[OLD]).toBe("/x");
    expect(events).toEqual([]);
  });

  test("missing identities are a payload error", async () => {
    const res = await handlers["repos:reidentify"]({ from: OLD });
    expect(res).toEqual({ ok: false, error: "from-and-to-required" });
  });

  test("a refused store is ok:false with the report attached", async () => {
    setKvValue(REPO_INDEX_NS, OLD, "/x");
    setKvValue(REPO_INDEX_NS, NEW, "/y");
    const res = await handlers["repos:reidentify"]({ from: OLD, to: NEW });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("refused");
    expect(res.data.stores.find((s: { store: string }) => s.store === "kv:repo-index").status).toBe("refused");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/daemon/__tests__/repos-reidentify-handler.test.ts`
Expected: FAIL, `handlers["repos:reidentify"] is not a function`.

- [ ] **Step 3: Add the handler in `lib/daemon/handlers/repos.ts`**

Change the return type to `Record<"repos:locate" | "repos:reidentify", (payload: any) => Promise<any>> & HandlerMap` and add after the locate handler:

```ts
    "repos:reidentify": async (payload) => {
      const from = payload?.from;
      const to = payload?.to;
      if (typeof from !== "string" || typeof to !== "string" || from === "" || to === "") {
        return { ok: false, error: "from-and-to-required" };
      }
      const dryRun = payload?.dryRun === true;
      return opts.withReconcilerHeld(async () => {
        const report = await reidentify(from, to, { dryRun });
        if ("error" in report) return { ok: false, error: report.error };
        if (!report.ok) {
          const refused = report.stores.filter((s) => s.status === "refused").map((s) => s.store).join(", ");
          return { ok: false, error: `refused: ${refused}`, data: report };
        }
        if (!dryRun) {
          opts.refreshWatchedRepos();
          opts.emitEvent("repo:reidentified", { from: report.from.serialized, to: report.to.serialized });
        }
        return { ok: true, data: report };
      });
    },
```
with `import { reidentify } from "../../repo-reidentify.ts";`.

- [ ] **Step 4: Run the handler test**

Run: `bun test lib/daemon/__tests__/repos-reidentify-handler.test.ts lib/daemon/__tests__/repos-handlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing dispatch test**

`lib/__tests__/repo-reidentify-dispatch.test.ts` mirrors `lib/__tests__/repo-locate-dispatch.test.ts`: read that file first and copy its seam approach (it fakes daemon presence and `daemonSocketQuery`). The two cases to pin:

```ts
test("daemon present but silent is a hard stop, never a local apply", async () => {
  // arrange: socket file exists, daemonSocketQuery resolves null
  const out = await reidentifyRepo({ from: "github.com/acme/old", to: "github.com/acme/new" });
  expect(out.ok).toBe(false);
  expect(out.via).toBe("daemon");
  expect(!out.ok && out.error).toContain("did not answer repos:reidentify");
});

test("no daemon runs locally and returns the report", async () => {
  setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fold", "/x");
  const out = await reidentifyRepo({ from: "github.com/acme/old", to: "github.com/acme/new" });
  expect(out.ok && out.via).toBe("local");
  expect(out.ok && out.report.stores[0]!.status).toBe("moved");
});
```
Use exactly the mechanism the locate dispatch test uses to fake presence and the socket query (it may be `mock.module` on `../daemon-client.ts` and `../daemon-config.ts`, or an injected seam; follow the existing file).

- [ ] **Step 6: Implement `lib/repo-reidentify-dispatch.ts`**

```ts
/**
 * Daemon-or-local dispatch for `rt repos reidentify`, the same rule as
 * repo-locate-dispatch: the daemon is the registry's single writer, so when
 * evidence says one is present (pid or socket file) an unanswered request is
 * a hard stop, never a local fallback that would race the reconciler.
 */

import { existsSync } from "fs";
import { daemonSocketQuery } from "./daemon-client.ts";
import { DAEMON_SOCK_PATH, isDaemonProcessRunning } from "./daemon-config.ts";
import { reidentify, type ReidentifyReport } from "./repo-reidentify.ts";

export const REIDENTIFY_TIMEOUT_MS = 2 * 60_000;

export type ReidentifyOutcome =
  | { via: "daemon" | "local"; ok: true; report: ReidentifyReport }
  | { via: "daemon" | "local"; ok: false; error: string; report?: ReidentifyReport };

function daemonPresent(): boolean {
  return isDaemonProcessRunning() || existsSync(DAEMON_SOCK_PATH);
}

export async function reidentifyRepo(req: { from: string; to: string; dryRun?: boolean }): Promise<ReidentifyOutcome> {
  const dryRun = req.dryRun === true;
  if (daemonPresent()) {
    const res = await daemonSocketQuery("repos:reidentify", { from: req.from, to: req.to, dryRun }, REIDENTIFY_TIMEOUT_MS);
    if (!res) {
      return { via: "daemon", ok: false, error: "the rt daemon is present but did not answer repos:reidentify; not applying locally (would race the worktree reconciler); check `rt daemon status` and retry" };
    }
    if (!res.ok) return { via: "daemon", ok: false, error: res.error ?? "repos:reidentify failed", ...(res.data ? { report: res.data as ReidentifyReport } : {}) };
    return { via: "daemon", ok: true, report: res.data as ReidentifyReport };
  }
  const report = await reidentify(req.from, req.to, { dryRun });
  if ("error" in report) return { via: "local", ok: false, error: report.error };
  if (!report.ok) {
    const refused = report.stores.filter((s) => s.status === "refused").map((s) => s.store).join(", ");
    return { via: "local", ok: false, error: `refused: ${refused}`, report };
  }
  return { via: "local", ok: true, report };
}
```

- [ ] **Step 7: Run the dispatch test**

Run: `bun test lib/__tests__/repo-reidentify-dispatch.test.ts`
Expected: PASS.

- [ ] **Step 8: Write the failing command test**

`commands/__tests__/repos-reidentify.test.ts` (model: `commands/__tests__/cd-identity-match.test.ts` for how commands are called with a `print` seam; the command takes `deps.print` like `reposLocate`):

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { REPO_INDEX_NS } from "../../lib/repo-index.ts";
import { closeStateDb, setKvValue } from "../../lib/state/index.ts";
import { reposReidentify } from "../repos-reidentify.ts";

describe("rt repos reidentify", () => {
  const origHome = process.env.HOME;
  let home: string;
  let out: string[];
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-reid-cmd-")));
    process.env.HOME = home;
    closeStateDb();
    out = [];
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("--dry-run --json prints the per-store report inside the envelope", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fold", "/x");
    await reposReidentify(["github.com/acme/old", "github.com/acme/new", "--dry-run", "--json"], {}, { print: (s) => out.push(s) });
    const doc = JSON.parse(out.join("\n"));
    expect(doc.ok).toBe(true);
    expect(doc.data.dryRun).toBe(true);
    expect(doc.data.stores.find((s: { store: string }) => s.store === "kv:repo-index")).toMatchObject({ status: "moved", count: 1 });
  });

  test("plain output lists one line per store with its status and count", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fold", "/x");
    await reposReidentify(["github.com/acme/old", "github.com/acme/new"], {}, { print: (s) => out.push(s) });
    expect(out.some((l) => /kv:repo-index\s+moved\s+1/.test(l))).toBe(true);
    expect(out.some((l) => /run_history\.repo\s+none/.test(l))).toBe(true);
  });

  test("usage error on a missing positional", async () => {
    await expect(reposReidentify(["github.com/acme/old"], {}, { print: (s) => out.push(s) })).rejects.toThrow();
  });
});
```
`exitUserError` calls `process.exit` in production; if the existing command tests stub it (check `commands/__tests__/cd-identity-match.test.ts` for the pattern), use the same stub so the usage case is observable, and replace the last assertion with what that pattern asserts.

- [ ] **Step 9: Implement `commands/repos-reidentify.ts`**

```ts
/**
 * rt repos reidentify <old> <new> [--dry-run] [--json]
 *
 * Moves every identity-keyed store between two remote identities. The daemon
 * owns the apply whenever it answers; a local apply only happens when nothing
 * is up to race.
 */

import type { CommandContext } from "../lib/command-tree.ts";
import { reidentifyRepo } from "../lib/repo-reidentify-dispatch.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, exitUserError } from "../lib/setup/errors.ts";
import type { StoreReport } from "../lib/state/reidentify.ts";

const USAGE = "usage: rt repos reidentify <old-identity> <new-identity> [--dry-run] [--json]";
const FLAGS = ["--json", "--dry-run"];

export interface ReidentifyDeps {
  print: (line: string) => void;
}

function table(stores: StoreReport[]): string[] {
  const width = Math.max(...stores.map((s) => s.store.length));
  return stores.map((s) => `  ${s.store.padEnd(width)}  ${s.status.padEnd(8)}${s.count}${s.detail ? `  (${s.detail})` : ""}`);
}

export async function reposReidentify(args: string[], _ctx: CommandContext = {}, deps: ReidentifyDeps = { print: console.log }): Promise<void> {
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  for (const a of args) {
    if (a.startsWith("--") && !FLAGS.includes(a)) {
      exitUserError(new UserActionableError("usage", `unknown flag "${a}"; ${USAGE}`), json, "repos reidentify", deps.print);
    }
  }
  const positionals = args.filter((a) => !a.startsWith("--"));
  if (positionals.length !== 2) {
    exitUserError(new UserActionableError("usage", `reidentify takes two identities, got ${positionals.length}; ${USAGE}`), json, "repos reidentify", deps.print);
  }
  const [from, to] = positionals as [string, string];

  const outcome = await reidentifyRepo({ from, to, dryRun });
  if (!outcome.ok && !outcome.report) {
    exitUserError(new UserActionableError("refused", outcome.error), json, "repos reidentify", deps.print);
  }
  const report = outcome.ok ? outcome.report : outcome.report!;

  if (json) {
    deps.print(JSON.stringify(envelope({ ok: outcome.ok, data: report })));
  } else {
    deps.print(`${dryRun ? "would move" : "moved"} ${report.from.serialized} to ${report.to.serialized} (${outcome.via})`);
    for (const line of table(report.stores)) deps.print(line);
  }
  if (!outcome.ok) {
    exitUserError(new UserActionableError("refused", outcome.error), json, "repos reidentify", deps.print);
  }
}
```
`envelope(body)` (`lib/setup/contract.ts:159`) spreads `body` under `contract` and `at`, so the printed document is `{ contract, at, ok, data }`, which is what the command test reads.

- [ ] **Step 10: Add the node and the registry entry**

In `lib/command-tree-def.ts`, directly after the `locate:` node inside `repos`:

```ts
      reidentify: {
        description: "Move every per-repo store from one remote identity to another after a repo rename (github.com/owner/old to github.com/owner/new)",
        module: "./commands/repos-reidentify.ts",
        fn: "reposReidentify",
        omitBehavior: { exempt: "agent-facing; identities are not enumerable" },
        args: [
          { name: "Old identity", type: "text", placeholder: "github.com/owner/old", hint: "The identity every store is keyed on today; raw host/path or serialized remote: form" },
          { name: "New identity", type: "text", placeholder: "github.com/owner/new", hint: "The identity the repo's remote derives now" },
          { name: "Dry run", flag: "--dry-run", type: "boolean", default: false, hint: "Print per-store counts without writing" },
          SETUP_JSON_ARG,
        ],
      },
```
In `lib/module-registry.ts`, in alphabetical position: `"./commands/repos-reidentify.ts": () => import("../commands/repos-reidentify.ts"),`.

- [ ] **Step 11: Run the command test and the gates that read the tree**

Run: `bun test commands/__tests__/repos-reidentify.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/no-eager-tui.test.ts && bun run picker:check && bun run typecheck`
Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
git add lib/daemon/handlers/repos.ts lib/daemon/__tests__/repos-reidentify-handler.test.ts lib/repo-reidentify-dispatch.ts lib/__tests__/repo-reidentify-dispatch.test.ts commands/repos-reidentify.ts commands/__tests__/repos-reidentify.test.ts lib/command-tree-def.ts lib/module-registry.ts
git commit -m "rt repos reidentify: daemon handler, dispatch, command and node"
```

### Task 8: The daemon's rename detector

**Files:**
- Create: `lib/daemon/rename-detect.ts`
- Modify: `lib/daemon.ts` (after the `runBootIdentityMigration(log)` call at line 828)
- Test: `lib/daemon/__tests__/rename-detect.test.ts`

**Interfaces:**
- Consumes: `loadRepoIndexEntries` (`lib/repo-index.ts:385`, entries `{ repoName, path }`), `identityFromRemote` and `serializeIdentity` from `lib/settings/identity.ts`, `runCapture` from `lib/subprocess.ts`, `reidentify` from Task 5.
- Produces:

```ts
export interface RenameDetectDeps {
  entries: () => { repoName: string; path: string }[];
  /** Fresh `git config --get remote.origin.url`; null when the path has no remote or is gone. */
  readRemote: (path: string) => Promise<string | null>;
  /** GitHub's answer for GET repos/<owner>/<repo> with redirects NOT followed: the 301 Location, or null for any other status. */
  redirectFor: (owner: string, repo: string) => Promise<string | null>;
  reidentify: (from: string, to: string) => Promise<{ ok: boolean } | { error: string }>;
  log: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
}
export interface DetectedRename { from: string; to: string; applied: boolean }
export async function detectRenamedRepos(deps: RenameDetectDeps): Promise<DetectedRename[]>;
export function realRenameDetectDeps(log: Logger): RenameDetectDeps;
```
Rule: for each entry whose `repoName` parses as a remote-kind GitHub identity (`github.com/<owner>/<repo>`), read the remote fresh; derive `serializeIdentity(identityFromRemote(remote))`; skip when equal to `repoName`, when the derived identity is not `github.com/...`, or when `redirectFor(oldOwner, oldRepo)` is null or its Location does not end with `/repos/<newOwner>/<newRepo>` (case-insensitive). Otherwise call `reidentify(repoName, derived)`, log the outcome, and report `applied: true` only when it returned `ok: true`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { detectRenamedRepos, type RenameDetectDeps } from "../rename-detect.ts";

const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";

function deps(over: Partial<RenameDetectDeps>): RenameDetectDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    entries: () => [{ repoName: OLD, path: "/repo" }],
    readRemote: async () => "https://github.com/acme/new.git",
    redirectFor: async (o, r) => (o === "acme" && r === "old" ? "https://api.github.com/repos/acme/new" : null),
    reidentify: async (from, to) => { calls.push(`${from}->${to}`); return { ok: true }; },
    log: { info: () => {}, warn: () => {} },
    calls,
    ...over,
  };
}

describe("detectRenamedRepos", () => {
  test("applies when the fresh remote derives a new identity and GitHub redirects to it", async () => {
    const d = deps({});
    expect(await detectRenamedRepos(d)).toEqual([{ from: OLD, to: NEW, applied: true }]);
    expect(d.calls).toEqual([`${OLD}->${NEW}`]);
  });

  test("does nothing when the remote still derives the same identity", async () => {
    const d = deps({ readRemote: async () => "git@github.com:acme/old.git" });
    expect(await detectRenamedRepos(d)).toEqual([]);
    expect(d.calls).toEqual([]);
  });

  test("does nothing for a non-GitHub remote", async () => {
    const d = deps({ readRemote: async () => "https://gitlab.com/acme/new.git" });
    expect(await detectRenamedRepos(d)).toEqual([]);
  });

  test("does nothing when GitHub does not report a redirect", async () => {
    const d = deps({ redirectFor: async () => null });
    expect(await detectRenamedRepos(d)).toEqual([]);
    expect(d.calls).toEqual([]);
  });

  test("does nothing when the redirect names a different repo than the remote derives", async () => {
    const d = deps({ redirectFor: async () => "https://api.github.com/repos/acme/elsewhere" });
    expect(await detectRenamedRepos(d)).toEqual([]);
  });

  test("a missing remote or path is skipped, not thrown", async () => {
    const d = deps({ readRemote: async () => null });
    expect(await detectRenamedRepos(d)).toEqual([]);
  });

  test("reports applied false when reidentify refuses", async () => {
    const d = deps({ reidentify: async () => ({ ok: false }) });
    expect(await detectRenamedRepos(d)).toEqual([{ from: OLD, to: NEW, applied: false }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/__tests__/rename-detect.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/daemon/rename-detect.ts`**

```ts
/**
 * Detects a GitHub repo rename for indexed repos and re-keys their state.
 * The remote is read fresh from git config every time: deriveRepoIdentity
 * memoizes a remote-kind identity for the process lifetime, so a cached
 * derivation would never see a `set-url`. GitHub's 301 is the confirmation
 * that the two names are one repo; a mismatch anywhere is a no-op.
 */

import type { Logger } from "pino";
import { loadRepoIndexEntries } from "../repo-index.ts";
import { reidentify } from "../repo-reidentify.ts";
import { identityFromRemote, parseIdentity, serializeIdentity } from "../settings/identity.ts";
import { runCapture } from "../subprocess.ts";

export interface RenameDetectDeps {
  entries: () => { repoName: string; path: string }[];
  readRemote: (path: string) => Promise<string | null>;
  redirectFor: (owner: string, repo: string) => Promise<string | null>;
  reidentify: (from: string, to: string) => Promise<{ ok: boolean } | { error: string }>;
  log: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
}

export interface DetectedRename {
  from: string;
  to: string;
  applied: boolean;
}

function githubParts(serialized: string): { owner: string; repo: string } | null {
  const parsed = parseIdentity(serialized);
  if (!parsed || parsed.kind !== "remote") return null;
  const m = /^github\.com\/([^/]+)\/([^/]+)$/i.exec(parsed.id);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

export async function detectRenamedRepos(deps: RenameDetectDeps): Promise<DetectedRename[]> {
  const out: DetectedRename[] = [];
  for (const entry of deps.entries()) {
    const old = githubParts(entry.repoName);
    if (!old) continue;
    const remote = await deps.readRemote(entry.path);
    if (!remote) continue;
    const derived = identityFromRemote(remote);
    if (!derived) continue;
    const to = serializeIdentity(derived);
    if (to === entry.repoName) continue;
    const next = githubParts(to);
    if (!next) continue;
    const location = await deps.redirectFor(old.owner, old.repo);
    if (!location) continue;
    if (!location.toLowerCase().endsWith(`/repos/${next.owner}/${next.repo}`.toLowerCase())) continue;
    const result = await deps.reidentify(entry.repoName, to);
    const applied = "ok" in result && result.ok === true;
    if (applied) deps.log.info({ from: entry.repoName, to }, "rename-detect: re-keyed repo state after GitHub rename");
    else deps.log.warn({ from: entry.repoName, to, result }, "rename-detect: reidentify did not complete");
    out.push({ from: entry.repoName, to, applied });
  }
  return out;
}

export function realRenameDetectDeps(log: Logger): RenameDetectDeps {
  return {
    entries: () => loadRepoIndexEntries().map((e) => ({ repoName: e.repoName, path: e.path })),
    readRemote: async (path) => {
      const r = await runCapture(["git", "-C", path, "config", "--get", "remote.origin.url"], { timeoutMs: 5_000 });
      return r.exitCode === 0 && r.stdout.trim() !== "" ? r.stdout.trim() : null;
    },
    redirectFor: async (owner, repo) => {
      try {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { redirect: "manual", headers: { "User-Agent": "rt", Accept: "application/vnd.github+json" } });
        return res.status === 301 ? res.headers.get("location") : null;
      } catch {
        return null;
      }
    },
    reidentify: async (from, to) => {
      const r = await reidentify(from, to);
      return "error" in r ? r : { ok: r.ok };
    },
    log,
  };
}
```

- [ ] **Step 4: Wire it in `lib/daemon.ts`**

Directly after the existing `runBootIdentityMigration(log).catch(...)` statement (line 828), add:

```ts
        const detectRenames = () =>
          detectRenamedRepos(realRenameDetectDeps(log)).catch((err) => {
            log.warn({ err }, "rename-detect: pass failed");
          });
        void detectRenames();
        setInterval(detectRenames, RENAME_DETECT_INTERVAL_MS).unref();
```
with `import { detectRenamedRepos, realRenameDetectDeps } from "./daemon/rename-detect.ts";` and `const RENAME_DETECT_INTERVAL_MS = 6 * 60 * 60 * 1000;` near the file's other interval constants. Read the surrounding code first: the detector must run after the boot migration's promise chain, not before, so if line 828 awaits inside an async block, place the call after that await.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/daemon/__tests__/rename-detect.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/daemon/rename-detect.ts lib/daemon/__tests__/rename-detect.test.ts lib/daemon.ts
git commit -m "daemon: re-key repo state when GitHub reports a rename"
```

### Task 9: The folder paths sweep and the doc line

**Files:**
- Create: `lib/release/shared-checkout.ts`
- Modify: `commands/settings.ts:405-418`, `commands/release.ts:139`, `lib/release/update-machine.ts:44`, `lib/command-tree-def.ts` (every `placeholder: "repo-tools"` and the `~/Documents/GitHub/repo-tools` placeholder at line 1909), `AGENTS.md`, `skills/rt-release/SKILL.md`, `skills/rt-build-dev-app/SKILL.md`, `skills/rt-repo-identity/SKILL.md`, `skills/rt-settings/SKILL.md`, `apps/chat/AGENTS.md`, `apps/chat/ARCHITECTURE.md`, `lib/release/__tests__/update-machine.test.ts`, `lib/worktree/__tests__/trash.test.ts`, `lib/daemon/__tests__/trust-dialog.test.ts`, `lib/state/__tests__/identity-migrate-resolve.test.ts`, `apps/chat/src/app/doing.test.ts`, `apps/chat/src/server/fixtures.ts`
- Test: `lib/release/__tests__/shared-checkout.test.ts`

**Interfaces:**
- Produces: `export function resolveSharedCheckout(home: string, exists: (p: string) => boolean = existsSync): string` returning the first of `<home>/Documents/GitHub/mattstack`, `<home>/Documents/GitHub/repo-tools` whose `cli.ts` exists, else the first candidate. `export const SHARED_CHECKOUT_CANDIDATES = ["Documents/GitHub/mattstack", "Documents/GitHub/repo-tools"] as const;`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { resolveSharedCheckout, SHARED_CHECKOUT_CANDIDATES } from "../shared-checkout.ts";

describe("resolveSharedCheckout", () => {
  test("prefers the mattstack folder when both exist", () => {
    expect(resolveSharedCheckout("/h", () => true)).toBe("/h/Documents/GitHub/mattstack");
  });
  test("falls back to repo-tools when only it has a cli.ts", () => {
    expect(resolveSharedCheckout("/h", (p) => p === "/h/Documents/GitHub/repo-tools/cli.ts")).toBe("/h/Documents/GitHub/repo-tools");
  });
  test("names the mattstack folder when neither exists", () => {
    expect(resolveSharedCheckout("/h", () => false)).toBe("/h/Documents/GitHub/mattstack");
  });
  test("the candidate order is mattstack then repo-tools", () => {
    expect([...SHARED_CHECKOUT_CANDIDATES]).toEqual(["Documents/GitHub/mattstack", "Documents/GitHub/repo-tools"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `lib/release/shared-checkout.ts`:

```ts
import { existsSync } from "fs";
import { join } from "path";

/** Where the dev daemon and deck's from-source apps run from; the older folder name stays a fallback for a machine that has not moved it. */
export const SHARED_CHECKOUT_CANDIDATES = ["Documents/GitHub/mattstack", "Documents/GitHub/repo-tools"] as const;

export function resolveSharedCheckout(home: string, exists: (p: string) => boolean = existsSync): string {
  for (const rel of SHARED_CHECKOUT_CANDIDATES) {
    const dir = join(home, rel);
    if (exists(join(dir, "cli.ts"))) return dir;
  }
  return join(home, SHARED_CHECKOUT_CANDIDATES[0]);
}
```

- [ ] **Step 3: Use it**

`commands/release.ts:139`: `sharedCheckoutPath: resolveSharedCheckout(homedir()),`. `lib/release/update-machine.ts:44`: reword the doc comment to "The shared checkout (`~/Documents/GitHub/mattstack`, or the older `repo-tools` folder) the dev daemon and deck's from-source apps run from." `commands/settings.ts:410-418`: replace the five-guess loop with

```ts
  const home = Bun.env.HOME!;
  for (const guess of [
    ...SHARED_CHECKOUT_CANDIDATES.map((rel) => `${home}/${rel}`),
    `${home}/GitHub/mattstack`,
    `${home}/GitHub/repo-tools`,
    `${home}/code/mattstack`,
    `${home}/code/repo-tools`,
  ]) {
    if (existsSync(`${guess}/cli.ts`)) return guess;
  }
  return null;
```
`lib/command-tree-def.ts`: every `placeholder: "repo-tools"` becomes `placeholder: "mattstack"`, `"repo-tools-main"` becomes `"mattstack-main"`, and line 1909's placeholder becomes `~/Documents/GitHub/mattstack`. Docs and skills: replace `~/Documents/GitHub/repo-tools` with `~/Documents/GitHub/mattstack` in `AGENTS.md`, the four `skills/rt-*/SKILL.md`, `apps/chat/AGENTS.md`, `apps/chat/ARCHITECTURE.md`; leave `docs/superpowers/**`, `apps/*/docs/superpowers/**`, `docs/apps/superpowers/**` and the `.dc.html` design boards as written. Tests that pin the literal folder (`update-machine.test.ts`, `trash.test.ts`, `trust-dialog.test.ts`, `identity-migrate-resolve.test.ts`, `apps/chat/src/app/doing.test.ts`, `apps/chat/src/server/fixtures.ts`, `apps/chat/design/build.py` files) follow only where the string is an expectation of the code's output; a fixture that merely needs some path keeps its text.

- [ ] **Step 4: The doc line**

In `AGENTS.md` under "Release & distribution" add one paragraph: "The GitHub repo is `m4ttstack/mattstack`; the old name `m4ttstack/rt` is never recreated. Every installed app before the rename fetches its Sparkle feed through GitHub's redirect from the old name, and a new repo under that name would capture those requests." In `skills/rt-release/SKILL.md` add the same sentence in the section that names the release repo. (Stage 2a merges before the rename; the sentence is a rule, not a report, so it is true when it lands.)

- [ ] **Step 5: Run the suite and the grep**

Run: `bun run test && bun run typecheck && git grep -n 'Documents/GitHub/repo-tools' -- . ':!docs/superpowers' ':!apps/*/docs' ':!docs/apps' ':!*.dc.html' ':!*.py'`
Expected: tests PASS; the grep prints only `lib/release/shared-checkout.ts`, `commands/settings.ts` and tests that assert the fallback.

- [ ] **Step 6: Commit**

```bash
git add -A lib/release/shared-checkout.ts lib/release/__tests__/shared-checkout.test.ts commands/settings.ts commands/release.ts lib/release/update-machine.ts lib/command-tree-def.ts AGENTS.md skills apps/chat lib/release/__tests__ lib/worktree/__tests__ lib/daemon/__tests__ lib/state/__tests__
git commit -m "shared checkout resolves ~/Documents/GitHub/mattstack first, repo-tools as fallback"
```

### Task 10: Stage 2a PR and release (Matt-gated)

- [ ] **Step 1: Full gates from the branch**: `bun run test:all && bun run check && bun run picker:check && scripts/repo-purity.sh`. Expected: all green.
- [ ] **Step 2: Open the PR** titled `rt repos reidentify and the shared-checkout folder paths` with the Task 1 results in the body; wait for green `checks`, `e2e`, `purity` and the Opus whole-branch review; address CodeRabbit findings.
- [ ] **Step 3: Merge** with `gh pr merge --merge` on Matt's confirmation.
- [ ] **Step 4: Release (Matt-gated)**: with the `rt:release` skill, cut the next mattstack.app release from main. This release still uses `m4ttstack/rt` everywhere; that is by design. Then `rt release update-machine` on this machine so the installed rt carries `reidentify`. Verify: `rt repos reidentify --help` (or `rt repos reidentify` with no args) prints the usage line.

---

## Stage 2b: rename the repo and the folder (machine list, Matt-gated)

### Task 11: The cutover

No code. Each numbered step needs Matt's go; stop after each and report.

- [ ] **Step 1: Announce** in `#rt`: `rt chat post rt "Shared checkout moves from ~/Documents/GitHub/repo-tools to ~/Documents/GitHub/mattstack in a few minutes; sessions with their cwd there must /cd afterwards. Worktrees under ~/.mattstack stay where they are."`
- [ ] **Step 2: Stop the dev daemon** through the dev app or `rt daemon stop`; then `rt daemon status` must report it absent and `ls ~/.mattstack/rt/rt.sock` must fail. Never `kill` it.
- [ ] **Step 3: Rename (Matt-gated)**: `gh repo rename mattstack --repo m4ttstack/rt --yes`, then in the shared checkout `git -C ~/Documents/GitHub/repo-tools remote set-url origin https://github.com/m4ttstack/mattstack.git` (linked pool worktrees share this config; no per-tree step).
- [ ] **Step 4: Reidentify**: `rt repos reidentify github.com/m4ttstack/rt github.com/m4ttstack/mattstack --dry-run`; read the table (expect `moved` on `kv:repo-index`, `data-dir`, `rt.repoTracking`, `settings:user`, `settings:machine`, and the populated tables; `none` elsewhere); then run it without `--dry-run`. Exit 0 is the gate; a `refused` line stops here.
- [ ] **Step 5: Move the folder (Matt-gated)**: `mv ~/Documents/GitHub/repo-tools ~/Documents/GitHub/mattstack`, then `rt repos locate ~/Documents/GitHub/mattstack` (expect `moved github.com/m4ttstack/mattstack from .../repo-tools to .../mattstack`), then `rt settings source-path ~/Documents/GitHub/mattstack`.
- [ ] **Step 6: Start the dev daemon**; `rt daemon status` healthy.
- [ ] **Step 7: Deck**: for each of board, boxscore, chat, console, deck: `deck register --dir ~/Documents/GitHub/mattstack/apps/<name>`, then `deck restart <name>`; `grep -l repo-tools ~/Library/LaunchAgents/com.mattstack.deck.*.plist` prints nothing.
- [ ] **Step 8: Symlinks and settings**: `for l in ~/.claude/skills/*; do t=$(readlink "$l"); case "$t" in *repo-tools*) ln -sfn "${t/repo-tools/mattstack}" "$l";; esac; done` (18 links); `rt settings set rt.cron --scope machine` with the board-triage command's path under `mattstack`; `rt settings set gitq.board --scope machine` with the gitq entry's path under `mattstack` (read each with `rt settings get <key> --json` first and edit only the path).
- [ ] **Step 9: Legacy row**: `rt repos status`; if a row named `mattstack` with a missing path appears, `rt repos prune` and remove `~/.mattstack/rt/repos/mattstack` once the prune reports it dropped.
- [ ] **Step 10: Matt's CLAUDE.md (Matt-gated)**: ask before touching `~/.claude/CLAUDE.md`; it references `~/Documents/GitHub` generally, so there may be nothing to change.
- [ ] **Step 11: Verify**: `rt daemon status` healthy; `rt settings source-path` prints the `mattstack` path; `rt worktree list` shows the rt pool under `github.com/m4ttstack/mattstack`; `deck list` shows the five apps `up` and `curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>/` is 200 for each; `grep -rl repo-tools ~/.mattstack/rt ~/.mattstack/user ~/Library/LaunchAgents ~/.claude/skills 2>/dev/null` prints nothing (logs excluded). Post the same in `#rt`.

---

## Stage 2c: flip the repo name in code

### Task 12: The name sweep

**Files:**
- Modify: `scripts/gen-docs.ts:29`, `scripts/update-docs.ts:18`, `rt-tray/project.yml:73`, `rt-tray/Info.plist:57`, `rt-tray/build.sh:47`, `rt-tray/check-bundle.sh:552`, `lib/release/release-app.ts:20`, `lib/release/verify.ts:56`, `lib/release/update-machine.ts:62`, `scripts/release/appcast.sh:28`, `commands/update.ts:18`, `lib/team/invite.ts:69`, `scripts/build-dev-app.ts:12,151`, `scripts/e2e-cleanroom.sh:40`, `website/docusaurus.config.ts:28,40,45`, `apps/gitq/website/docusaurus.config.ts:33,45`, `apps/gitq/website/docs/getting-started/install.mdx`, `website/docs/getting-started/install.mdx`, `website/docs/intro.mdx`, `extensions/vscode/rt-context/package.json`, every `package.json` with a `repository` field (`apps/gitq`, `packages/glance`, `packages/glance-react`, `packages/rt-client`, `packages/server`, `packages/tokyo`, `packages/ui`, root), `README.md:71,408,457`, `rt-tray/vm/README.md`, `marketplace/README.md:35`, `.github/renovate-global.json5:15,38`, `docs/*.md`, `skills/rt-*/SKILL.md`, `apps/*/README.md`, `docs/apps/README.md`, `docs/glance/README.md`, `packages/tui-kit/README.md`, `rt-tray/Tests/stub-rt/stub.ts:310`, `rt-tray/Tests/MattstackCoreChecks/*.swift` and `rt-tray/Tests/fixtures/*.json` where they assert the name, and every test under `lib/`, `commands/`, `scripts/__tests__`, `e2e/tests` that pins `m4ttstack/rt`
- Regenerate: `website/docs/reference/**` via `bun run docs:gen`

- [ ] **Step 1: Write the failing pin test**

Add to `lib/release/__tests__/release-app.test.ts` (or a new `lib/release/__tests__/repo-name.test.ts`):

```ts
import { describe, expect, test } from "bun:test";
import { RT_REPO } from "../release-app.ts";
import { RELEASE_REPO } from "../update-machine.ts";
import { RELEASES_URL } from "../../../commands/update.ts";

describe("the release code names the renamed repo", () => {
  test("every constant says m4ttstack/mattstack", () => {
    expect(RT_REPO).toBe("m4ttstack/mattstack");
    expect(RELEASE_REPO).toBe("m4ttstack/mattstack");
    expect(RELEASES_URL).toBe("https://github.com/m4ttstack/mattstack/releases/latest");
  });
});
```
Run: `bun test lib/release/__tests__/repo-name.test.ts`. Expected: FAIL on the first expectation.

- [ ] **Step 2: Flip the constants and the feed**

`m4ttstack/rt` becomes `m4ttstack/mattstack` in every file listed above; `GH_REPO` in `verify.ts` is not exported, so its test (`lib/release/__tests__/verify.test.ts`) follows through the URLs it asserts. The feed URL becomes `https://github.com/m4ttstack/mattstack/releases/latest/download/appcast.xml` in `project.yml`, `Info.plist`, `build.sh` and the `check-bundle.sh` assertion, all in this commit. `renovate-global.json5` lists `m4ttstack/mattstack`. `scripts/gen-docs.ts:29` becomes `https://github.com/m4ttstack/mattstack/blob/main/` and then:

```bash
bun run docs:gen
git status --short website/docs/reference | wc -l
git grep -c 'github.com/m4ttstack/rt' -- website | wc -l
```
Expected: about 220 changed files; the second count is 0.

- [ ] **Step 3: Tests follow**

```bash
git grep -ln 'm4ttstack/rt\b\|m4ttstack%2Frt\|m4ttstack-rt' -- lib commands scripts e2e rt-tray/Tests packages ui apps/chat/src ':!docs/superpowers'
```
For each: if the string is an expected output of code that now says `mattstack`, change it; if it is a fixture whose value is arbitrary (a chat fixture's sample repo, a trust-dialog screen capture, a mission fixture), leave it. The `ui/fixtures/*.json` and `ui/internal/views/mission/mission_test.go` fixtures are captured screens: leave them.

- [ ] **Step 4: Run everything**

Run: `bun run test:all && bun run check && bun run typecheck && scripts/repo-purity.sh && (cd rt-tray && ./check-bundle.sh --help >/dev/null 2>&1 || true)` and, for the Swift side, `rt-tray/Tests` through the project's usual `swift test` invocation named in `docs/development.md`.
Expected: green. `git grep -n 'github.com/m4ttstack/rt\b' -- . ':!docs/superpowers' ':!RELEASE_NOTES.md' ':!*CHANGELOG*' ':!ui/fixtures' ':!ui/internal' ':!rt-tray/Tests/fixtures' ':!apps/chat/src/server/fixtures.ts' ':!apps/chat/design' ':!docs/apps/superpowers' ':!apps/*/docs' ':!lib/daemon/__tests__/trust-dialog.test.ts'` prints nothing.

- [ ] **Step 5: Commit** in two commits: `release: the repo is m4ttstack/mattstack; feed and constants follow` (code, feed, tests) and `docs: regenerate the reference against m4ttstack/mattstack` (the generated site).

### Task 13: Stage 2c PR and the release after it (Matt-gated)

- [ ] **Step 1: PR** titled `rename: flip every repo-name constant to m4ttstack/mattstack`; CI green (the purity job, e2e, checks), Opus review, CodeRabbit addressed; merge with a merge commit.
- [ ] **Step 2: Release (Matt-gated)**: cut the next mattstack.app release with the `rt:release` skill. This is the first release whose feed URL is the new name; after `rt release update-machine`, `defaults read /Applications/mattstack.app/Contents/Info.plist SUFeedURL` prints the `mattstack` URL. Confirm the dev app too if the dev bundle leg ran.
- [ ] **Step 3: READMEs elsewhere**: `mattstack-skills/README.md:10-16` and `fast-browser/README.md:25-26` link `m4ttstack/rt`; the skills README moves in Stage 4 with the tree, and fast-browser's is a one-line PR in that repo (open it now; it is outside this tree and needs no gate).

---

## Stage 3: fold in herdr-chat

### Task 14: Scoped purity terms

**Files:**
- Modify: `scripts/repo-purity.sh` (after the global `HITS` block)
- Test: `scripts/__tests__/no-repo-purity-scoped.test.ts` (named `no-*` because it runs the script as a subprocess)

**Interfaces:**
- Produces: a `SCOPED` list in the script, one entry per line as `<dir>|<pattern>`; each pattern is grepped only under that directory's tracked files and file names. herdr-chat's fragment list is a subset of rt's (verified 2026-09-27: `comm -23` of the two lists is empty), so the herdr-chat entry is empty and the mechanism is exercised by the test alone until Stage 4 adds the three skills terms.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SCRIPT = join(import.meta.dir, "..", "repo-purity.sh");

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-purity-scoped-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(dir, "scripts", "repo-purity.sh"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]);
  return dir;
}

function run(dir: string, env: Record<string, string> = {}): { code: number; out: string } {
  const r = spawnSync("sh", [join(dir, "scripts", "repo-purity.sh")], { encoding: "utf8", env: { ...process.env, PURITY_BASE: "HEAD", ...env } });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe("scoped purity terms", () => {
  test("a scoped term inside its directory fails the gate", () => {
    const dir = repoWith({ "plugins/probe/README.md": "uses PROBE_SCOPED_TERM here\n" });
    const r = run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe|PROBE_SCOPED_TERM" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL repo-purity (plugins/probe)");
  });

  test("the same term outside the directory passes", () => {
    const dir = repoWith({ "lib/x.ts": "// PROBE_SCOPED_TERM is fine here\n" });
    expect(run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe|PROBE_SCOPED_TERM" }).code).toBe(0);
  });

  test("a scoped term in a file name inside the directory fails", () => {
    const dir = repoWith({ "plugins/probe/probe_scoped_term.md": "clean\n" });
    expect(run(dir, { PURITY_SCOPED_EXTRA: "plugins/probe|PROBE_SCOPED_TERM" }).code).toBe(1);
  });
});
```
`PURITY_SCOPED_EXTRA` is a test seam: extra `<dir>|<pattern>` lines appended to the built-in list so the test never has to know the real banned words.

- [ ] **Step 2: Run to verify failure**: `bun test scripts/__tests__/no-repo-purity-scoped.test.ts`. Expected: FAIL (exit 0 where 1 is expected; no "FAIL repo-purity (plugins/probe)" text).

- [ ] **Step 3: Add the scoped block** to `scripts/repo-purity.sh` after the global `NAME_HITS` block and before the commit-message block:

```sh
# Terms an imported plugin's own gate banned that rt's global list cannot
# carry (some are legitimate rt vocabulary elsewhere in the tree). One
# "<dir>|<pattern>" per line, scanned only under that directory's tracked
# files and file names. Empty until a plugin brings its own terms.
SCOPED="
plugins/herdr-chat|
"
if [ -n "${PURITY_SCOPED_EXTRA:-}" ]; then
  SCOPED="$SCOPED
$PURITY_SCOPED_EXTRA"
fi
printf '%s\n' "$SCOPED" | while IFS='|' read -r SDIR SPAT; do
  [ -n "$SDIR" ] && [ -n "$SPAT" ] || continue
  S_HITS=$(cd "$ROOT" && git ls-files -z -- "$SDIR" | xargs -0 grep -IniE "$SPAT" 2>/dev/null || true)
  S_NAMES=$(cd "$ROOT" && git ls-files -- "$SDIR" | grep -iE "$SPAT" || true)
  if [ -n "$S_HITS" ] || [ -n "$S_NAMES" ]; then
    echo "FAIL repo-purity ($SDIR):"
    [ -n "$S_HITS" ] && printf '%s\n' "$S_HITS"
    [ -n "$S_NAMES" ] && printf '%s\n' "$S_NAMES"
    exit 1
  fi
done || exit 1
```
The trailing `|| exit 1` is what turns the subshell's `exit 1` into the script's exit, since `while` runs in a pipeline.

- [ ] **Step 4: Run the test and the real gate**: `bun test scripts/__tests__/no-repo-purity-scoped.test.ts && scripts/repo-purity.sh`. Expected: PASS and `ok   repo-purity`.

- [ ] **Step 5: Commit**: `git add scripts/repo-purity.sh scripts/__tests__/no-repo-purity-scoped.test.ts && git commit -m "repo-purity: per-directory scoped terms for imported plugins"`.

### Task 15: Import herdr-chat with history (Matt-gated on PR #14)

**Files:**
- Create: `plugins/herdr-chat/**`

- [ ] **Step 1: Gate**: `gh pr list --repo m4ttstack/herdr-chat --state open --json number,title` must print `[]`. If #14 is still open, stop and ask Matt whether to merge or close it in the old repo.

- [ ] **Step 2: Clone, scan, rewrite**

```bash
brew list git-filter-repo >/dev/null 2>&1 || brew install git-filter-repo
SCRATCH="$(mktemp -d)/herdr-chat-import"
git clone --single-branch --branch main https://github.com/m4ttstack/herdr-chat.git "$SCRATCH"
cd "$SCRATCH"
PAT="$(sed -n 's/^PATTERN=//p' <rt-worktree>/scripts/repo-purity.sh)"
git ls-files -z | xargs -0 grep -IniE "$(eval echo "$PAT")" | wc -l
git log --format='%h %s %b' | grep -icE "$(eval echo "$PAT")"
```
Expected: both counts `0` (herdr-chat's own gate is a subset of rt's and passes). If either is non-zero, write a `--replace-text`/`--replace-message` file under `$(mktemp -d)` with one literal rule per hit and apply it with `git filter-repo --force --replace-text <file>` before the next step; the file never enters the tree.

```bash
git filter-repo --force --invert-paths --path .github
git filter-repo --force --to-subdirectory-filter plugins/herdr-chat
git ls-files | grep -v '^plugins/herdr-chat/' || echo "all under plugins/herdr-chat"
```
Expected: `all under plugins/herdr-chat`. `Cargo.toml`, `Cargo.lock`, `herdr-plugin.toml`, `src/`, `docs/`, `scripts/repo-purity.sh`, `README.md`, `AGENTS.md`, `LICENSE`, `.gitignore` all sit inside the subdirectory.

- [ ] **Step 3: Merge**

From the rt worktree:
```bash
git remote add herdr-chat-import "$SCRATCH"
git fetch herdr-chat-import main
git merge --allow-unrelated-histories --no-ff -m "plugins: import m4ttstack/herdr-chat main with history" herdr-chat-import/main
git remote remove herdr-chat-import
git status --short | head
```
Expected: clean, no conflicts.

- [ ] **Step 4: The plugin's own purity script retires**: `git rm plugins/herdr-chat/scripts/repo-purity.sh` (rt's gate covers the tree). Then `scripts/repo-purity.sh` must print `ok   repo-purity` and `git ls-files plugins/herdr-chat | grep -c .` prints the file count. Commit: `plugins/herdr-chat: retire the standalone purity script`.

### Task 16: test-scope learns `plugins/` and the herdr-chat CI job

**Files:**
- Modify: `scripts/ci/test-scope.ts` (`isPluginTree`, `pluginDirs`, `plugins=` output), `.github/workflows/checks.yml` (`scope` outputs `plugins`; new `plugin-herdr-chat` job; `checks` gate)
- Test: `scripts/ci/__tests__/test-scope.test.ts` (add cases)

**Interfaces:**
- Produces: `export function isPluginTree(f: string): boolean` (true for `plugins/<name>/...`), `export function pluginDirs(changed: string[]): string[]` (sorted unique `plugins/<name>` prefixes touched). `decide` treats a plugin tree as skippable like an apps tree. The `$GITHUB_OUTPUT` gains `plugins=<comma-joined pluginDirs, or every plugins/* dir that exists when the event is not a pull request>`.

- [ ] **Step 1: Write the failing tests** (append to `scripts/ci/__tests__/test-scope.test.ts`):

```ts
import { isPluginTree, pluginDirs } from "../test-scope.ts";

describe("plugins", () => {
  test("a plugins-only diff skips the shards and names the plugin", () => {
    const changed = ["plugins/mattstack/skills/a/SKILL.md", "plugins/mattstack/tests/certify.sh"];
    expect(decide(pr(changed)).mode).toBe("skip");
    expect(pluginDirs(changed)).toEqual(["plugins/mattstack"]);
  });
  test("a plugin change beside rt code is full and still names the plugin", () => {
    const changed = ["plugins/herdr-chat/src/lib.rs", "lib/foo.ts"];
    expect(decide(pr(changed)).mode).toBe("full");
    expect(pluginDirs(changed)).toEqual(["plugins/herdr-chat"]);
  });
  test("isPluginTree needs a plugin name segment", () => {
    expect(isPluginTree("plugins/herdr-chat/Cargo.toml")).toBe(true);
    expect(isPluginTree("plugins/README.md")).toBe(false);
    expect(isPluginTree("lib/plugins/x.ts")).toBe(false);
  });
});
```
Run: `bun test scripts/ci/__tests__/test-scope.test.ts`. Expected: FAIL (`isPluginTree` not exported; the first `mode` is `full` because `.sh` is "not typescript").

- [ ] **Step 2: Implement** in `scripts/ci/test-scope.ts`:

```ts
export function isPluginTree(f: string): boolean {
  return /^plugins\/[^/]+\//.test(f);
}

export function pluginDirs(changed: string[]): string[] {
  const out = new Set<string>();
  for (const f of changed) {
    const m = /^(plugins\/[^/]+)\//.exec(f);
    if (m) out.add(m[1]!);
  }
  return [...out].sort();
}
```
In `decide`, the `skippable` predicate becomes `input.changed.every((f) => isAppsTree(f) || isPluginTree(f) || ((isDocs(f) || isSwift(f)) && !isFixture(f)))` and the `checkable` filter excludes plugin trees the same way it excludes apps trees (`!isAppsTree(f) && !isPluginTree(f)` plus the root-files exception). In the `$GITHUB_OUTPUT` writer, add a `plugins=` line: for a pull request, `pluginDirs(changed).join(",")`; otherwise every directory under `plugins/` that exists (`readdirSync(join(ROOT, "plugins"))` when the folder exists), so main runs every plugin job.

- [ ] **Step 3: The workflow**

In `.github/workflows/checks.yml`: the `scope` job gains `plugins: ${{ steps.scope.outputs.plugins }}` under `outputs`. Add the job:

```yaml
  # herdr-chat is a Rust herdr plugin; build and test it only when its tree
  # changed (every push to main runs it). rt's unit shards never read it.
  plugin-herdr-chat:
    needs: scope
    if: contains(needs.scope.outputs.plugins, 'plugins/herdr-chat')
    runs-on: macos-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            plugins/herdr-chat/target
          key: cargo-${{ runner.os }}-${{ hashFiles('plugins/herdr-chat/Cargo.lock') }}
      - name: Build and test herdr-chat
        working-directory: plugins/herdr-chat
        run: cargo build --release --locked && cargo test --locked
```
(`platforms = ["macos"]` in `herdr-plugin.toml`, so the build runs on macOS.) The `checks` gate job adds `plugin-herdr-chat` to `needs`, a `HERDR_CHAT: ${{ needs.plugin-herdr-chat.result }}` env, and the rule `[ "$HERDR_CHAT" = success ] || [ "$HERDR_CHAT" = skipped ] || { echo "plugin-herdr-chat did not succeed"; exit 1; }` (skipped is the not-touched case; `if:` false on a needed job reads as skipped).

- [ ] **Step 4: Run**: `bun test scripts/ci/__tests__/test-scope.test.ts && bun scripts/ci/test-scope.ts --explain && (cd plugins/herdr-chat && cargo build --release --locked && cargo test --locked)`. Expected: tests PASS; the explain line prints a decision; cargo green locally (rustup stable is on this machine because the plugin is installed).

- [ ] **Step 5: Commit**: `git add scripts/ci/test-scope.ts scripts/ci/__tests__/test-scope.test.ts .github/workflows/checks.yml && git commit -m "ci: plugins/ trees route to their own job; herdr-chat builds on change"`.

### Task 17: Install path docs

**Files:**
- Modify: `plugins/herdr-chat/README.md:123-133,223`, `plugins/herdr-chat/AGENTS.md:59`, `skills/rt-chat/SKILL.md` (the line that names the herdr-chat plugin), `AGENTS.md` (the "rt chat" section gains one sentence: the herdr plugin lives at `plugins/herdr-chat`)

- [ ] **Step 1**: the install line becomes `herdr plugin install m4ttstack/mattstack/plugins/herdr-chat` (with `--yes` where AGENTS.md had it); the clone line becomes `git clone https://github.com/m4ttstack/mattstack.git` plus `cd mattstack/plugins/herdr-chat`. Add to the README's install section: "herdr clones the whole mattstack repository to build this plugin; the first install takes <N> seconds and <M> MB on a 2026 MacBook Pro (measured on <date>)", with N and M filled in from Task 18 step 2 (leave the sentence with `<N>`/`<M>` until then and fill it in the same PR before merge).
- [ ] **Step 2**: `git grep -n 'm4ttstack/herdr-chat' -- plugins skills AGENTS.md docs/*.md` prints nothing. Commit: `herdr-chat: install from m4ttstack/mattstack/plugins/herdr-chat`.

### Task 18: Stage 3 PR, this machine, archive (Matt-gated)

- [ ] **Step 1: PR** titled `plugins: fold in herdr-chat`; wait for `checks` (including `plugin-herdr-chat`), `purity`, e2e, Opus review, CodeRabbit; merge with a merge commit.
- [ ] **Step 2: Install proof on this machine**: `time herdr plugin install m4ttstack/mattstack/plugins/herdr-chat --yes` and `du -sh ~/.config/herdr/plugins/*chat*` (or wherever `herdr plugin list` says the clone lives); `herdr plugin list` shows `m4ttstack.chat` enabled from `github:m4ttstack/mattstack`. Write N and M into the README (Task 17 step 1) if the PR is still open, else as a one-line follow-up commit on main.
- [ ] **Step 3: Pool and tracking**: `rt worktree list --json | grep -c herdr-chat` shows the trees under `remote:github.com%2Fm4ttstack%2Fherdr-chat`; for each, Matt says carry or drop (carry = `git -C <tree> format-patch main` in that tree, `git am` into a mattstack branch with `--directory=plugins/herdr-chat`); then `rt worktree dispose <tree>` for each; `rt settings get rt.repoTracking --json`, remove the `remote:github.com%2Fm4ttstack%2Fherdr-chat` entry with `rt settings set rt.repoTracking --scope machine <the map without it>`; delete `~/Documents/GitHub/herdr-chat`; `rt repos prune`; `rm -rf ~/.mattstack/rt/repos/remote:github.com%2Fm4ttstack%2Fherdr-chat` once `rt worktree list` shows no tree there.
- [ ] **Step 4: Archive (Matt-gated)**: `gh repo archive m4ttstack/herdr-chat --yes`.

---

## Stage 4: fold in skills

### Task 19: The RT-338 gate (Matt-gated)

- [ ] **Step 1**: Ask Matt to confirm every RT-338 wave-1 lane has merged (tom's herd, skills PR #41 among them). `gh pr list --repo m4ttstack/skills --state open --json number,title` must print `[]`. Do not start Task 20 until both hold.

### Task 20: Import skills with history

**Files:**
- Create: `plugins/mattstack/**`

- [ ] **Step 1: Clone, scan, rewrite**

```bash
SCRATCH="$(mktemp -d)/skills-import"
git clone --single-branch --branch main https://github.com/m4ttstack/skills.git "$SCRATCH"
cd "$SCRATCH"
PAT="$(sed -n 's/^PATTERN=//p' <rt-worktree>/scripts/repo-purity.sh)"
git ls-files -z | xargs -0 grep -IniE "$(eval echo "$PAT")" | grep -v '^tests/repo-purity.sh:' | wc -l
git log --format='%h %s %b' | grep -icE "$(eval echo "$PAT")"
```
Expected: both `0`. Any hit gets a literal rule in a scrub file under `$(mktemp -d)` (`--replace-text` for tree hits, `--replace-message` for messages), applied before the rename; the rule file never enters the tree. Then:

```bash
git filter-repo --force --invert-paths --path .github --path tests/repo-purity.sh
git filter-repo --force --to-subdirectory-filter plugins/mattstack
git ls-files | grep -v '^plugins/mattstack/' || echo "all under plugins/mattstack"
git ls-files | grep -c '^plugins/mattstack/.claude-plugin/plugin.json$'
```
Expected: `all under plugins/mattstack` and `1`. `.claude-plugin`, `skills/`, `attachments/`, `hooks/`, `pack/`, `plugin/`, `scripts/`, `tests/` (minus the purity script), `docs/`, `surface.jsonc`, `.mcp.json`, `CERTIFICATION.md`, `README.md`, `LICENSE`, `.gitignore` all sit inside.

- [ ] **Step 2: Merge**

```bash
git remote add skills-import "$SCRATCH"
git fetch skills-import main
git merge --allow-unrelated-histories --no-ff -m "plugins: import m4ttstack/skills main with history" skills-import/main
git remote remove skills-import
git status --short | head
bun install --frozen-lockfile && git diff --exit-code -- bun.lock
```
Expected: clean; the lockfile does not move (the plugin has no `package.json`, so bun's workspaces ignore it).

### Task 21: The three scoped purity terms

**Files:**
- Modify: `scripts/repo-purity.sh` (the `SCOPED` list)

- [ ] **Step 1**: rebuild the three terms from fragments the way the file does for its global words (the terms are the ones `comm -23` between the skills list and rt's printed on 2026-09-27: a feature-flag vendor, an access-tool vendor, and a two-word phrase joined by a hyphen). Add fragment variables `P1`, `P2`, `P3` beside `A1..A11`, and the entry `plugins/mattstack|$P1|$P2|$P3` to `SCOPED` (the `|` inside the pattern is the regex alternation; the list's field separator is the FIRST `|`, so change the `read -r SDIR SPAT` line to `IFS='|' read -r SDIR SPAT_REST` is wrong; instead make the separator a tab: write the list entries as `plugins/mattstack<TAB>$P1|$P2|$P3` and read with `IFS="$(printf '\t')"`). Update the Task 14 test seam and the herdr-chat line to the tab form.
- [ ] **Step 2**: `scripts/repo-purity.sh` prints `ok   repo-purity` against the imported tree (the skills tree passed its own gate, so it is clean of these terms); `bun test scripts/__tests__/no-repo-purity-scoped.test.ts` PASS. Commit: `repo-purity: the skills pack's three extra terms, scoped to plugins/mattstack`.

### Task 22: The plugin-mattstack CI job and the retired payload pin

**Files:**
- Modify: `.github/workflows/checks.yml` (new job, `checks` gate), `scripts/ci/test-scope.ts` (nothing new; the `plugins=` output already names `plugins/mattstack`)
- Delete: `lib/mcp/__tests__/tools-payload-hash.test.ts`
- Keep: `lib/skills/__tests__/mcp-lint-rules-hash.test.ts` (its refresh text now says `bun cli.ts skills check --pack-dir plugins/mattstack --strict`; edit the two strings that name `<mattstack-skills>`)

- [ ] **Step 1: The job**

```yaml
  # The skills pack's own five checks, run in-tree when plugins/mattstack
  # changed (every push to main runs them). --mattstack-dir names an empty
  # root so rt resolves plugins from it instead of `claude plugin list`.
  plugin-mattstack:
    needs: scope
    if: contains(needs.scope.outputs.plugins, 'plugins/mattstack')
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      RT_SKIP_SETUP: "1"
      RT_BATCH: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
      - name: Install graphviz
        run: sudo apt-get update -qq && sudo apt-get install -y -qq graphviz
      - name: Digraph checker cases
        run: bash plugins/mattstack/plugin/skills/process-digraphs/test-check-dot.sh
      - name: Certify every skill and attachment dir
        working-directory: plugins/mattstack
        run: |
          set -e
          for d in skills/*/ attachments/*/ attachments/*/*/; do
            [ -f "${d}SKILL.md" ] || continue
            sh tests/certify.sh "$d"
          done
      - name: skills check (compile drift and strict mcp lint)
        run: |
          mkdir -p "$RUNNER_TEMP/mattstack"
          bun cli.ts skills check --pack-dir "$GITHUB_WORKSPACE/plugins/mattstack" --mattstack-dir "$RUNNER_TEMP/mattstack" --strict
      - name: mcp-tools reference is current
        run: |
          set -o pipefail
          bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts | cmp - plugins/mattstack/attachments/mcp-tools/reference.md || {
            echo "reference.md is stale. Regenerate: bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md"
            exit 1
          }
```
Purity is the existing `purity.yml` workflow (now scoped-aware from Task 21). The `checks` gate adds `plugin-mattstack` with the same success-or-skipped rule as `plugin-herdr-chat`.

- [ ] **Step 2: Locally**: run the four steps' commands from the repo root (skip apt; `brew install graphviz` if `dot` is missing). Expected: each exits 0. If `cmp` fails, regenerate `reference.md` in this PR (rt's payload may have moved since the skills repo's pin) and clear any strict hits it introduces the way the deleted test's refresh steps described.
- [ ] **Step 3**: `git rm lib/mcp/__tests__/tools-payload-hash.test.ts`; edit the two refresh strings in `mcp-lint-rules-hash.test.ts`; `bun test lib/skills/__tests__/mcp-lint-rules-hash.test.ts` PASS. Commit: `ci: plugin-mattstack runs the skills pack's five checks in-tree; retire the payload hash pin`.

### Task 23: `marketplace.sh` copies `plugins/mattstack`; the catalog entry becomes in-tree

**Files:**
- Modify: `scripts/release/marketplace.sh` (after the `$SRC/plugins` copy), `marketplace/marketplace.json` (the `mattstack` entry), `marketplace/README.md` (the sentence that says the mattstack plugin is pinned from another repo)
- Test: `scripts/__tests__/release-marketplace.test.ts` (add cases)

**Interfaces:**
- Produces: the script accepts `RT_TREE_PLUGINS` (default `$ROOT/plugins`) and, for every catalog entry whose `source` is the string `./plugins/<name>` and whose directory is missing from `$SRC/plugins`, copies `$RT_TREE_PLUGINS/<name>` into the stage as `plugins/<name>`. A relative source that exists in neither place stays the error it is today.

- [ ] **Step 1: Write the failing tests** (append inside the validation `describe`; helpers `sourceDir`, `run`, `bareRepo`, `publishedFiles` exist):

```ts
  test("an in-tree plugin outside the source dir is copied from RT_TREE_PLUGINS", () => {
    const tree = scratch("tree");
    mkdirSync(join(tree, "mattstack", ".claude-plugin"), { recursive: true });
    writeFileSync(join(tree, "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "0.0.1" }));
    writeFileSync(join(tree, "mattstack", "README.md"), "# pack\n");
    const src = sourceDir([{ name: "mattstack", source: "./plugins/mattstack", description: "pack" }]);
    const bare = bareRepo();
    const r = run([src], { RT_MARKETPLACE_REPO: bare, RT_TREE_PLUGINS: tree });
    expect(r.code).toBe(0);
    expect(publishedFiles(bare)).toEqual(expect.arrayContaining(["plugins/mattstack/.claude-plugin/plugin.json", "plugins/mattstack/README.md"]));
  });

  test("a relative source missing from both places is still refused", () => {
    const src = sourceDir([{ name: "ghost", source: "./plugins/ghost", description: "x" }]);
    const r = run(["--dry-run", src], { RT_TREE_PLUGINS: scratch("empty") });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("is not in the published tree");
  });
```
Run: `bun test scripts/__tests__/release-marketplace.test.ts`. Expected: the first new test FAILS on `is not in the published tree`.

- [ ] **Step 2: Implement** in `marketplace.sh`, after `if [ -d "$SRC/plugins" ]; then cp -R "$SRC/plugins" "$STAGE/plugins"; fi`:

```bash
# Plugins that live in this repo's tree rather than under marketplace/: a
# relative catalog source with no directory in $SRC/plugins is copied from
# the tree (never symlinked; the guard below refuses links).
TREE_PLUGINS="${RT_TREE_PLUGINS:-$ROOT/plugins}"
for name in $(python3 -c 'import json,sys; [print(p["source"][len("./plugins/"):]) for p in json.load(open(sys.argv[1]))["plugins"] if isinstance(p.get("source"), str) and p["source"].startswith("./plugins/")]' "$CATALOG"); do
    if [ ! -d "$STAGE/plugins/$name" ] && [ -d "$TREE_PLUGINS/$name" ]; then
        mkdir -p "$STAGE/plugins"
        cp -R "$TREE_PLUGINS/$name" "$STAGE/plugins/$name"
        rm -rf "$STAGE/plugins/$name/.git" "$STAGE/plugins/$name/.worktrees"
    fi
done
```
`marketplace/marketplace.json`'s `mattstack` entry becomes `{ "name": "mattstack", "source": "./plugins/mattstack", "description": "<unchanged>" }`. `marketplace/README.md:35`'s sentence about the plugin being pinned from another repo becomes "The `mattstack` and `chat` plugins publish from this repository's tree (`plugins/mattstack`, `marketplace/plugins/chat`); `fast-browser` is a pinned URL source."

- [ ] **Step 3: Run**: `bun test scripts/__tests__/release-marketplace.test.ts lib/release/__tests__/preflight.test.ts && bash scripts/release/marketplace.sh --dry-run`. Expected: PASS; the dry run prints `claude accepts the staged catalog` and `staged and validated, not pushed`. `bun cli.ts release preflight` (if it runs offline) shows `catalog mattstack ... in-tree plugin, nothing to drift`.

- [ ] **Step 4: Commit**: `git add scripts/release/marketplace.sh scripts/__tests__/release-marketplace.test.ts marketplace/marketplace.json marketplace/README.md && git commit -m "marketplace: publish the mattstack plugin from plugins/mattstack"`.

### Task 24: `packs.ts` learns `git-subdir`; `sync.ts` treats an in-tree engine as read-only

**Files:**
- Modify: `lib/skills/packs.ts:66-83` (`MarketplaceEntry`, `pluginDirOf`), `lib/skills/sync.ts:9-18,150-235` (`SyncDeps.inTreeRoot`, the guard and pull steps)
- Test: `lib/skills/__tests__/packs.test.ts`, `lib/skills/__tests__/sync.test.ts` (add cases)

**Interfaces:**
- `pluginDirOf(marketDir, source)`: for `{ source: "git-subdir", url: "file:///abs/repo", path: "plugins/x" }` returns `/abs/repo/plugins/x`; for any `git-subdir` with a non-`file://` url returns null (a remote clone is not a checkout rt can read).
- `SyncDeps` gains `inTreeRoot: string | null` (the shared checkout from `resolveSharedCheckout(homedir())`, Task 9; the real deps builder in `commands/skills.ts` passes it). When `engine.dir` starts with `inTreeRoot + "/"`, the guard skips `git status`/`branch`/`pull` for the engine, records the step as `skipped("engine is in-tree at <dir>; kept current by update-machine")`, reads the engine version from `engine.dir`, and still runs the `claude plugin update` refresh.

- [ ] **Step 1: Failing pack test** (append to `packs.test.ts`):

```ts
describe("pluginDirOf through discoverPacks", () => {
  test("a git-subdir file source resolves to the checkout subdirectory", () => {
    const checkout = tmp("rt-packs-checkout-");
    const pack = join(checkout, "plugins", "mattstack");
    writeFile(join(pack, "surface.jsonc"), `{ "public": [] }\n`);
    writeFile(join(pack, ".claude-plugin", "plugin.json"), `{ "name": "mattstack", "version": "1.0.0" }\n`);
    const market = tmp("rt-packs-market2-");
    writeFile(join(market, ".claude-plugin", "marketplace.json"), JSON.stringify({
      plugins: [{ name: "mattstack", source: { source: "git-subdir", url: pathToFileURL(checkout).href, path: "plugins/mattstack", ref: "main" } }],
    }));
    const settingsPath = join(tmp("rt-packs-settings2-"), "settings.json");
    writeFile(settingsPath, JSON.stringify({ extraKnownMarketplaces: { local: { source: { source: "directory", path: market } } } }));
    const found = discoverPacks({ settingsPath });
    expect(found.map((p) => [p.name, p.dir])).toEqual([["mattstack", realpathSync(pack)]]);
  });

  test("a git-subdir with a remote url is not a readable pack", () => {
    const market = tmp("rt-packs-market3-");
    writeFile(join(market, ".claude-plugin", "marketplace.json"), JSON.stringify({
      plugins: [{ name: "mattstack", source: { source: "git-subdir", url: "https://github.com/x/y.git", path: "plugins/mattstack" } }],
    }));
    const settingsPath = join(tmp("rt-packs-settings3-"), "settings.json");
    writeFile(settingsPath, JSON.stringify({ extraKnownMarketplaces: { local: { source: { source: "directory", path: market } } } }));
    expect(discoverPacks({ settingsPath })).toEqual([]);
  });
});
```
(`tmp`, `writeFile` and `realpathSync` are what the file already uses.) Run: FAIL on the first (`dir` resolves under the marketplace).

- [ ] **Step 2: Implement `pluginDirOf`**:

```ts
type MarketplaceEntry = { name?: string; source?: string | { source?: string; path?: string; url?: string } };

function fileUrlPath(url: string | undefined): string | null {
  if (typeof url !== "string" || !url.startsWith("file://")) return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

/**
 * Where a catalog entry's pack lives on this machine. A relative or absolute
 * `source` is a directory next to the marketplace. A url source with a
 * file:// url is the dev marketplace's shape: Claude Code refuses symlinked
 * plugin paths, so a checkout is served as a clone of itself, and the
 * checkout (not the cache clone) is the pack to read. A git-subdir source
 * with a file:// url is the same idea one level down: the checkout plus the
 * subdirectory. Any other git-subdir is a remote clone rt cannot read.
 */
function pluginDirOf(marketDir: string, source: MarketplaceEntry["source"]): string | null {
  if (typeof source === "string") return isAbsolute(source) ? source : resolve(marketDir, source);
  if (!source || typeof source !== "object") return null;
  if (source.source === "git-subdir") {
    const root = fileUrlPath(source.url);
    return root && typeof source.path === "string" && source.path !== "" ? resolve(root, source.path) : null;
  }
  if (source.path) return isAbsolute(source.path) ? source.path : resolve(marketDir, source.path);
  return source.source === "url" ? fileUrlPath(source.url) : null;
}
```

- [ ] **Step 3: Failing sync test** (append to `sync.test.ts`; `fixturePack`, `makeDeps`, `World` exist):

```ts
describe("in-tree engine", () => {
  test("skips every git step for an engine inside inTreeRoot and still refreshes the plugin", async () => {
    const engine = fixturePack("mattstack", "mattstack", "1.2.3");
    const pack = fixturePack("acme", "mattstack", "0.1.0");
    const world: World = { calls: [], installed: { "mattstack@mattstack": "1.2.2", "acme@mattstack": "0.1.0" } };
    const deps = { ...makeDeps(pack, engine, world), inTreeRoot: dirname(engine.dir) };
    const report = await syncPack(pack, engine, deps);
    const gitInEngine = world.calls.filter((c) => c.cmd === "git" && c.cwd === engine.dir);
    expect(gitInEngine).toEqual([]);
    expect(report.steps.find((s) => s.name === "pull-engine")).toMatchObject({ status: "skipped" });
    expect(report.steps.find((s) => s.name === "update-engine")).toMatchObject({ status: "ran" });
  });
});
```
(`dirname` from `path`; `makeDeps` returns a `SyncDeps` without `inTreeRoot` until Step 4 adds it, so add `inTreeRoot: null` to `makeDeps`'s return as part of the same change.) Run: FAIL (`git status` is called with `cwd: engine.dir`).

- [ ] **Step 4: Implement in `sync.ts`**: add `inTreeRoot: string | null;` to `SyncDeps`; compute `const engineInTree = deps.inTreeRoot !== null && engine.dir.startsWith(deps.inTreeRoot.endsWith("/") ? deps.inTreeRoot : deps.inTreeRoot + "/");` before the guards; in the guard step wrap the engine `git status`/`branch` checks in `if (!engineInTree) { ... }`; in `pullEngine`, when `engineInTree`, return `skipped(\`engine is in-tree at ${engine.dir}; kept current by update-machine\`)` after setting `engineSourceVersion = readManifestVersion(engine.dir)`. In `commands/skills-sync.ts:113` (the real `SyncDeps` builder, next to `cswapSessionsDir`), pass `inTreeRoot: resolveSharedCheckout(homedir())`.

- [ ] **Step 5: Run**: `bun test lib/skills/__tests__/packs.test.ts lib/skills/__tests__/sync.test.ts && bun run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**: `git add lib/skills/packs.ts lib/skills/sync.ts lib/skills/__tests__/packs.test.ts lib/skills/__tests__/sync.test.ts commands/skills-sync.ts && git commit -m "skills: git-subdir dev marketplace sources; in-tree engines skip git in sync"`.

### Task 25: READMEs and the skills self-references

**Files:**
- Modify: `plugins/mattstack/README.md:10-16,387-388`, `AGENTS.md` ("Writing-style presets": the presets now ship from `plugins/mattstack`, not "the mattstack plugin (mattstack-skills), not here"), `lib/command-tree-def.ts:2281` (the `--strict` hint says "the plugin-mattstack CI job uses this")

- [ ] **Step 1**: README lines 10-16 link `m4ttstack/mattstack` paths (`apps/gitq`, `apps/board`, `packages/glance`, `apps/deck`); 387-388 become `git clone https://github.com/m4ttstack/mattstack.git` and `cd mattstack/plugins/mattstack`. Add one sentence under the README's install heading: "This plugin is part of the mattstack monorepo; install it from the `mattstack` marketplace (`rt plugins install` adds it) or serve `plugins/mattstack` from a directory marketplace for development."
- [ ] **Step 2**: `git grep -n 'mattstack-skills\|m4ttstack/skills' -- . ':!docs/superpowers' ':!plugins/mattstack/docs' ':!lib/legacy-repo-data.ts'` prints only the lint-rules test's refresh text if any remains; fix those too. Commit: `plugins/mattstack: the pack lives in the monorepo`.

### Task 26: Dev marketplace probe and switch (this machine)

- [ ] **Step 1: Probe** in a throwaway config dir (the pattern `marketplace.sh` uses):

```bash
VHOME="$(mktemp -d)"
PROBE="$(mktemp -d)/probe-market"
mkdir -p "$PROBE/.claude-plugin"
cat > "$PROBE/.claude-plugin/marketplace.json" <<'EOF'
{ "name": "probe", "owner": { "name": "probe" }, "plugins": [
  { "name": "mattstack", "source": { "source": "git-subdir", "url": "file:///Users/matt/Documents/GitHub/mattstack", "path": "plugins/mattstack", "ref": "main" }, "description": "probe" } ] }
EOF
env -u CLAUDE_CONFIG_DIR HOME="$VHOME" claude plugin marketplace add "$PROBE"
env -u CLAUDE_CONFIG_DIR HOME="$VHOME" claude plugin install mattstack@probe
env -u CLAUDE_CONFIG_DIR HOME="$VHOME" claude plugin list --json | grep -c '"mattstack"'
rm -rf "$VHOME" "$(dirname "$PROBE")"
```
Expected: install succeeds and the count is 1. If it fails, stop Stage 4 here and bring the error to Matt (there is no fallback by design).
- [ ] **Step 2: Switch**: in `~/Documents/GitHub/mattstack-marketplace/.claude-plugin/marketplace.json` replace the `mattstack` entry's source with `{ "source": "git-subdir", "url": "file:///Users/matt/Documents/GitHub/mattstack", "path": "plugins/mattstack", "ref": "main" }`; commit it there (that repo is Matt's dev marketplace, not this tree). Then `claude plugin update mattstack@mattstack` and, in this pane, `/reload-plugins`.
- [ ] **Step 3: Verify**: `rt skills packs` lists `mattstack` with `dir` under `~/Documents/GitHub/mattstack/plugins/mattstack`; `rt skills sync --pack <a team pack>` reports `pull-engine skipped (engine is in-tree ...)` and finishes clean.

### Task 27: Stage 4 PR, this machine, archive (Matt-gated)

- [ ] **Step 1: PR** titled `plugins: fold in the mattstack skills pack`; `checks` (with `plugin-mattstack`), `purity`, e2e, Opus review, CodeRabbit; merge with a merge commit. Then on this machine: confirm `git -C ~/Documents/GitHub/mattstack branch --show-current` is `main`, `git pull`, `deck restart` is not needed (no served app changed), `rt daemon restart` is not needed.
- [ ] **Step 2: Pool and tracking**: `rt worktree list --json | grep -c 'm4ttstack%2Fskills'` shows the three trees under `remote:github.com%2Fm4ttstack%2Fskills`; carry or drop each on Matt's word (carry = `git format-patch main` there, `git am --directory=plugins/mattstack` here); `rt worktree dispose` each; remove the `remote:github.com%2Fm4ttstack%2Fskills` entry from `rt.repoTracking` (`rt settings set rt.repoTracking --scope machine` with the map without it); delete `~/Documents/GitHub/mattstack-skills`; `rt repos prune`; `rm -rf ~/.mattstack/rt/repos/remote:github.com%2Fm4ttstack%2Fskills` once no tree remains.
- [ ] **Step 3: Install proof**: Task 26 step 3 again against merged main; `rt skills sync` clean.
- [ ] **Step 4: Archive (Matt-gated)**: `gh repo archive m4ttstack/skills --yes`.
- [ ] **Step 5: Release (Matt-gated)**: the next mattstack.app release publishes the catalog with the in-tree `mattstack` plugin (`scripts/release/marketplace.sh` runs in `release.yml`); after it, `claude plugin marketplace update mattstack` on a machine that installed from the published catalog picks the plugin up from `./plugins/mattstack`.

---

## Self-review notes

- Spec coverage: Stage 1 (Task 1), the re-key verb with dry run, idempotence, daemon-or-local dispatch, the `omitBehavior` exemption and module registry (Tasks 2 to 7), the daemon trigger reading the remote fresh and gated on the redirect (Task 8), folder paths and the doc line (Task 9), the 2a release (Task 10), the 2b machine list (Task 11), the 2c sweep with generator regen and the release after it (Tasks 12 to 13), herdr-chat purity diff, import, CI, test-scope, install path, machine cleanup and archive (Tasks 14 to 18), the RT-338 gate, skills import, scoped terms, the five-check job with the payload pin retired, marketplace copy and catalog, git-subdir in packs, in-tree engine in sync, READMEs, dev marketplace probe, machine cleanup and archive (Tasks 19 to 27).
- The spec lists "the daemon's run, herd and chat rows" among stores. Runs live under `~/.mattstack/runs/<label>/` keyed by the label the pipeline passed, not by identity, so they need no move; `chat_presence.repo` is a display label and stays; `herds.repo` (herds.db) and `agents.repo` (state.db) move; `git_badges` and `branch_cache` are dropped as regenerable caches. These are the plan's readings of the spec, recorded here so a reviewer can disagree in one place.
- Type consistency: `StoreReport`/`StoreStatus` (Task 2) are the shape every later store function returns, including `moveRepoTrackingEntry` (Task 4) and the `settings:*`/`data-dir`/`herds.repo` adapters in Task 5; `ReidentifyReport` (Task 5) is what the handler's `data`, the dispatch outcome and the command's JSON envelope carry; `reidentifyRepo` (Task 7) is the only caller of `daemonSocketQuery("repos:reidentify")`; `resolveSharedCheckout` (Task 9) feeds `commands/release.ts`, `commands/settings.ts` and Task 24's `inTreeRoot`.
