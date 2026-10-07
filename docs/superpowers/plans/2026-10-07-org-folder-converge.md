# Org folder converge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Mac's org clone folder follows the org's name: `convergeOrgFolder` moves a marked clone out of `~/.mattstack/teams/` or from a mismatched `orgs/<folder>` to `orgs/<marker org>`, carrying its rt records, repo index row and Claude marketplace along, idempotently, on every `rt setup update` and `rt setup apply`.

**Architecture:** A shared move module (`lib/team/org-folder-move.ts`) performs the record copy, the folder rename, the repo relocation and the old-record removal in that order, with the relocation injected so the daemon verb `org:move` calls `planLocate`/`applyLocate` directly under the reconciler hold while the no-daemon path calls `locateMovedRepo`. The update-safe step `org.folder` (`lib/setup/steps/org-folder.ts`) scans both roots, decides per clone which pieces are off, refuses a dirty or mid-rebase clone, dispatches the folder piece to the daemon or runs it locally, then re-registers the Claude marketplace and reinstalls its plugins (`lib/setup/steps/org-folder-marketplace.ts`). The team snapshot supervisor gains a per-clone pause so the engine never pulls into a folder mid-rename.

**Tech Stack:** Bun, TypeScript, bun:test, the `Probes` seam (`lib/setup/probes.ts`) for every fs and process effect, the daemon's `HandlerMap` factories, real git in the handler test and the e2e test.

**Spec:** `docs/superpowers/specs/2026-10-06-orgs-root-design.md`, sections 1, 3 and 10 (converge lines). Builds on `docs/superpowers/plans/2026-10-06-orgs-root-paths.md` (PR 1, branch `org-rename`).

## Global Constraints

- Every rt command or built binary run for testing runs under an isolated HOME (`env -i HOME=<temp> CLAUDE_CONFIG_DIR=<temp> ...`); never the real `~/.mattstack`, the real daemon or the real Claude config.
- `bun test <file>` from the repo root only, targeted files; never the full suite locally.
- No em or en dashes anywhere (code, comments, tests, commit messages, plan text).
- Placeholder names only in committed text and fixtures: acme, widgets, gadgets, dev1, dev2, gitlab.example.com.
- Only `lib/setup/steps/org-folder.ts`, `lib/setup/validators/rt-health.ts`, `lib/rt-paths.ts`, `packages/rt-client/src/settings/paths.ts` and `lib/home/init-plan.ts` may name the legacy teams root (`lib/__tests__/no-legacy-teams-root.test.ts`, already allowing `lib/setup/steps/org-folder.ts`); `lib/team/org-folder-move.ts` and `lib/daemon/handlers/org.ts` take paths as arguments and never spell it.
- `org.folder` is update-safe only as AGENTS.md defines it: idempotent, never calls `ctx.need`, never overwrites a value the user chose; `applies: () => true`, `kind: "rt"`; added to `UPDATE_SAFE` in `lib/setup/__tests__/update-safe.test.ts` in contract order.
- No `console.*` under `lib/`; a person reads steps' `detail`/`remedy` copy in plain sentences with the command in the remedy, never mid-sentence.
- The step never writes into the clone (no commit, no checkout, no file inside it).
- Write fence: `lib/setup/`, `lib/team/`, `lib/daemon/`, `lib/repo-locate*.ts`, `lib/repos*.ts`, `commands/setup.ts`, `commands/daemon*.ts`, `commands/__tests__/setup*.ts`, `lib/rt-paths.ts` (only if a helper is missing), `e2e/tests/` (only an org-folder test), `docs/superpowers/plans/`.
- Commit trailer on every commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Branch `converge` stacks on `org-rename`: `git merge origin/org-rename` whenever it moves, never rebase. The PR's base is `org-rename`, not a draft.

## Review Focus

1. **Two marked clones under `teams/` with the same marker org** (a leaked copy): the second one's target exists with the same origin, so it must be refused and named, never moved over or merged into the first. Task 7's test "a second clone with the same org is refused".
2. **A clone whose marker is unreadable JSON or has no `org`**: skipped and named, and the detail says why, so a Mac whose marker was hand-edited is not silently left behind. Task 7's test "an unmarked or malformed folder is skipped and named".
3. **`org:move` with a `to` outside `orgsDir()` or a `from` outside `~/.mattstack`**: the daemon verb must refuse, since a daemon verb that renames arbitrary folders is a hazard to every estate machine. Task 5's tests "refuses a target outside the orgs root" and "refuses a source outside ~/.mattstack".
4. **A marketplace whose plugins include one the member disabled**: the reinstall must restore the disabled state, since `claude plugin install` enables. Task 6's test "a disabled plugin is reinstalled, then disabled again".
5. **The orphan-record sweep running while a record was just written for a clone that is still being cloned** (a concurrent `rt team join`): the sweep only removes a record whose name has no folder under either root AND which is not the current clone's own `<org>.json`; Task 3's test "the sweep leaves the current clone's record alone" pins the second half, and the step's detail names every removed record so a wrong removal is visible (Task 7's test "an orphan record is removed and named").

---

### Task 1: Verify what `claude plugin marketplace remove` does to installed plugins

**Files:**
- Modify: `docs/superpowers/plans/2026-10-07-org-folder-converge.md` (this file: fill the Findings block below)

**Interfaces:**
- Consumes: the `claude` CLI on PATH (`which claude`), run only under an isolated HOME and `CLAUDE_CONFIG_DIR`.
- Produces: the Findings block, which Task 6 reads before writing the marketplace piece.

- [ ] **Step 1: Run the probe under an isolated HOME and config dir**

Write this script to the scratchpad directory and run it with `bash <script>`. It never touches `~/.claude` or `~/.mattstack`.

```bash
set -e
S="$(mktemp -d)"
mkdir -p "$S/home" "$S/cfg" "$S/orgs/acme/.claude-plugin" "$S/orgs/acme/plugins/widgets/.claude-plugin" "$S/orgs/acme/plugins/widgets/skills/hello"
cat > "$S/orgs/acme/.claude-plugin/marketplace.json" <<'EOF'
{ "name": "acme", "owner": { "name": "acme" }, "plugins": [ { "name": "widgets", "source": "./plugins/widgets", "description": "probe" } ] }
EOF
cat > "$S/orgs/acme/plugins/widgets/.claude-plugin/plugin.json" <<'EOF'
{ "name": "widgets", "version": "0.0.1", "description": "probe" }
EOF
printf -- '---\nname: hello\ndescription: probe\n---\nhi\n' > "$S/orgs/acme/plugins/widgets/skills/hello/SKILL.md"
( cd "$S/orgs/acme" && git init -q && git add -A && git -c user.email=dev1@gitlab.example.com -c user.name=dev1 commit -qm init )
export HOME="$S/home" CLAUDE_CONFIG_DIR="$S/cfg"
echo "== add";      claude plugin marketplace add "$S/orgs/acme" 2>&1 | tail -1
echo "== install";  claude plugin install widgets@acme --scope user 2>&1 | tail -1
echo "== disable";  claude plugin disable widgets@acme 2>&1 | tail -1
echo "== list";     claude plugin list --json
echo "== remove";   claude plugin marketplace remove acme 2>&1 | tail -3
echo "== list after remove"; claude plugin list --json
echo "== installed_plugins after remove"; cat "$S/cfg/plugins/installed_plugins.json"; echo
echo "== settings after remove"; cat "$S/cfg/settings.json"; echo
echo "== re-add";   claude plugin marketplace add "$S/orgs/acme" 2>&1 | tail -1
echo "== reinstall"; claude plugin install widgets@acme --scope user 2>&1 | tail -1
echo "== list after reinstall"; claude plugin list --json
echo "== remove help"; claude plugin marketplace remove --help 2>&1 | tail -6
rm -rf "$S"
```

- [ ] **Step 2: Compare with the expected findings and record them**

Expected (probed on claude 2.1.292 while writing this plan):

- `marketplace remove <name>` uninstalls every plugin installed from that marketplace: `plugin list --json` is `[]` afterwards, `plugins/installed_plugins.json` has `plugins: {}`, and `settings.json` loses both the `enabledPlugins` entry and the `extraKnownMarketplaces` entry. The command prints "The removal also deletes their saved options, secrets and data where it can. To use a plugin again, add the marketplace back and reinstall the plugin."
- `plugin list --json` entries carry `id` (`widgets@acme`), `scope` (`user`), `enabled` (boolean), `installPath`, `readFromFolder`.
- `plugin install <id> --scope <scope>` after the re-add installs and ENABLES the plugin, so a plugin that was disabled before the remove needs `plugin disable <id>` after the reinstall.
- `marketplace list --json` entries carry `name`, `source: "directory"`, `path`, `installLocation`; `parseMarketplaceList` maps `path` to `source`.
- None of the commands prompt when run without a TTY for a directory marketplace.

Replace this paragraph with "Findings (claude <version>): confirmed" when the probe matches, or with the exact differences when it does not; Task 6 follows what is written here. If `plugin list --json` has no `scope`, Task 6 reinstalls with `--scope user`.

**Findings:** (fill in)

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-10-07-org-folder-converge.md
git commit -m "plan: record what claude plugin marketplace remove does to its plugins"
```

---

### Task 2: The shared marker reader, the exported record lock and the widened `org.folder` row

**Files:**
- Create: `lib/team/org-marker.ts`
- Modify: `lib/setup/validators/rt-health.ts` (drop its private `markerOrg`; import the shared one; widen `orgFolderRow` to every git clone under `orgs/`)
- Modify: `lib/team/team-local.ts` (export `withRecordLock`)
- Test: `lib/team/__tests__/org-marker.test.ts`, `lib/setup/__tests__/validators-rt-health.test.ts`

**Interfaces:**
- Consumes: `stripJsonc` from `lib/jsonc.ts`, `validateSlug` from `lib/secrets/store.ts`, `Probes` from `lib/setup/probes.ts`.
- Produces: `export const ORG_MARKER_REL = join("mattstack", "mattstack.jsonc")`; `export function markerOrg(p: Pick<Probes, "readFile">, dir: string): string | null` (null for no file, bad JSON, a role that is neither `org` nor `team`, a missing or invalid slug); `export function withRecordLock<T>(p, slug, fn): T` from `team-local.ts` (same body, now exported); `orgFolderRow(p, orgs)` now also judges folders under `orgs/` that hold `.git/config` but no `settings.org.jsonc`.

- [ ] **Step 1: Write the failing marker test**

`lib/team/__tests__/org-marker.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { markerOrg, ORG_MARKER_REL } from "../org-marker.ts";

const dir = "/h/.mattstack/orgs/acme";
const at = (raw: string) => fakeProbes({ home: "/h", files: { [`${dir}/${ORG_MARKER_REL}`]: raw } });

describe("markerOrg", () => {
  test("reads an org marker", () => {
    expect(markerOrg(at('{ "role": "org", "org": "acme" }'), dir)).toBe("acme");
  });
  test("accepts the old one-team marker when it names an org", () => {
    expect(markerOrg(at('// legacy\n{ "role": "team", "org": "widgets" }'), dir)).toBe("widgets");
  });
  test("rejects a marker with another role, no org, a bad slug, bad JSON or no file", () => {
    expect(markerOrg(at('{ "role": "pack", "org": "acme" }'), dir)).toBeNull();
    expect(markerOrg(at('{ "role": "org" }'), dir)).toBeNull();
    expect(markerOrg(at('{ "role": "org", "org": "Not A Slug" }'), dir)).toBeNull();
    expect(markerOrg(at("{ nope"), dir)).toBeNull();
    expect(markerOrg(fakeProbes({ home: "/h" }), dir)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/team/__tests__/org-marker.test.ts`
Expected: FAIL, cannot resolve `../org-marker.ts`.

- [ ] **Step 3: Write the module and point rt-health at it**

`lib/team/org-marker.ts`:

```ts
import { join } from "path";
import { stripJsonc } from "../jsonc.ts";
import { validateSlug } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";

export const ORG_MARKER_REL = join("mattstack", "mattstack.jsonc");

/** An old clone may still carry a `role: "team"` marker with an `org` field; any other marker is not an org clone. */
export function markerOrg(p: Pick<Probes, "readFile">, dir: string): string | null {
  const raw = p.readFile(join(dir, ORG_MARKER_REL));
  if (raw === null) return null;
  let marker: unknown;
  try {
    marker = JSON.parse(stripJsonc(raw));
  } catch {
    return null;
  }
  if (!marker || typeof marker !== "object") return null;
  const { role, org } = marker as Record<string, unknown>;
  if ((role !== "org" && role !== "team") || typeof org !== "string") return null;
  try {
    validateSlug(org);
  } catch {
    return null;
  }
  return org;
}
```

In `lib/setup/validators/rt-health.ts`: delete the private `markerOrg` function and its doc comment, add `import { markerOrg } from "../../team/org-marker.ts";`, and drop the now-unused `stripJsonc` and `validateSlug` imports if nothing else in the file uses them (grep the file first; keep an import another row still needs).

In `lib/team/team-local.ts` change `function withRecordLock<T>(` to `export function withRecordLock<T>(`.

- [ ] **Step 4: Widen the row to every git clone under `orgs/`**

Add to `lib/setup/__tests__/validators-rt-health.test.ts`, inside the existing `describe("org.folder row")` block, using that block's `fakeProbes` and `marker` helpers exactly as its other tests do:

```ts
  test("a one-team-layout clone under orgs/ with a mismatched folder reads as error even though discoverOrgs misses it", () => {
    const p = fakeProbes({
      files: {
        "/h/.mattstack/orgs/widgets/mattstack/mattstack.jsonc": JSON.stringify({ role: "team", org: "acme" }),
        "/h/.mattstack/orgs/widgets/.git/config": '[remote "origin"]\n\turl = https://gitlab.example.com/acme/org.git\n',
      },
      dirs: { "/h/.mattstack/orgs": ["widgets"], "/h/.mattstack/teams": [] },
    });
    const r = orgFolderRow(p, []);
    expect(r?.status).toBe("error");
    expect(r?.detail).toContain("widgets");
    expect(r?.detail).toContain("acme");
  });
```

Run `bun test lib/setup/__tests__/validators-rt-health.test.ts -t "one-team-layout"` and watch it fail (the row returns null with `orgs: []`). Then in `orgFolderRow` replace the opening lines with:

```ts
export function orgFolderRow(p: Probes, orgs: string[]): Row | null {
  const legacyRoot = join(p.home, ".mattstack", "teams");
  const orgsRoot = orgsDirUnder(p.home);
  // discoverOrgs lists only clones with an org settings file; a clone still on the one-team layout has none, and its folder may still disagree with its marker.
  const folders = [...new Set([...orgs, ...p.readDir(orgsRoot).filter((name) => p.exists(join(orgsRoot, name, ".git", "config")))])].sort();
```

and use `folders` wherever the body used `orgs` (the early `return null`, `mismatched`, `inBoth`, the `ready` detail). Add `orgsDirUnder` to the `rt-paths.ts` import.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/team/__tests__/org-marker.test.ts lib/setup/__tests__/validators-rt-health.test.ts lib/team/__tests__ lib/__tests__/no-legacy-teams-root.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/team/org-marker.ts lib/team/__tests__/org-marker.test.ts lib/team/team-local.ts lib/setup/validators/rt-health.ts lib/setup/__tests__/validators-rt-health.test.ts
git commit -m "orgs: one marker reader; the org.folder row judges every clone under orgs/"
```

---

### Task 3: The shared move pieces (`lib/team/org-folder-move.ts`)

**Files:**
- Create: `lib/team/org-folder-move.ts`
- Test: `lib/team/__tests__/org-folder-move.test.ts`

**Interfaces:**
- Consumes: `teamLocalPath`, `withRecordLock` from `lib/team/team-local.ts`; `inviteRecordsPath` from `lib/team/invite-records.ts`; `Probes`.
- Produces (every later task imports these names exactly):

```ts
export type RecordPiece = "copied" | "present" | "none";
export interface RecordCopies { teams: RecordPiece; invites: RecordPiece }
export type LocateFn = (newPath: string) => Promise<{ ok: true; moved: boolean } | { ok: false; error: string }>;
export type MoveStage = "records" | "folder" | "index" | "cleanup";
export interface OrgMoveResult {
  ok: boolean;
  from: string;
  to: string;
  records: RecordCopies;
  folderMoved: boolean;
  index: "moved" | "already" | "failed";
  removed: string[];
  stage?: MoveStage;
  error?: string;
}
export type MoveProbes = Pick<Probes, "home" | "exists" | "readFile" | "writeFile" | "mkdirp" | "mkdirExclusive" | "removeDir" | "removeFile" | "chmod" | "rename" | "readDir">;
export function copyOrgRecords(p: MoveProbes, folder: string, org: string): RecordCopies;
export function removeOldOrgRecords(p: MoveProbes, folder: string, org: string): string[];
export function sweepOrphanOrgRecords(p: MoveProbes, presentFolders: ReadonlySet<string>, keep: ReadonlySet<string>): string[];
export function classifyLocate(error: string): "done" | "failed";
export async function runOrgMove(p: MoveProbes, req: { from: string; to: string; locate: LocateFn }): Promise<OrgMoveResult>;
```

- [ ] **Step 1: Write the failing tests**

`lib/team/__tests__/org-folder-move.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { classifyLocate, copyOrgRecords, removeOldOrgRecords, runOrgMove, sweepOrphanOrgRecords, type LocateFn } from "../org-folder-move.ts";

const HOME = "/h";
const RT = `${HOME}/.mattstack/rt`;
const record = JSON.stringify({ createdByRt: false, joinedByRt: true, rtMayManageMembership: false, forgeUsername: "dev1" });
const invites = JSON.stringify({ dev2: { id: "i1", creatorSecret: "s", keyB64: "k", expiresAt: "2099-01-01T00:00:00.000Z" } });

function probes(files: Record<string, string>, dirs: Record<string, string[]> = {}) {
  return fakeProbes({ home: HOME, files, dirs: { [`${RT}/teams`]: [], [`${RT}/invites`]: [], ...dirs } });
}

describe("copyOrgRecords", () => {
  test("copies both records to the org's name when only the folder's exist", () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${RT}/invites/widgets.json`]: invites });
    expect(copyOrgRecords(p, "widgets", "acme")).toEqual({ teams: "copied", invites: "copied" });
    expect(p.readFile(`${RT}/teams/acme.json`)).toBe(record);
    expect(p.readFile(`${RT}/invites/acme.json`)).toBe(invites);
    expect(p.readFile(`${RT}/teams/widgets.json`)).toBe(record);
  });
  test("a record already under the org's name is left as it is", () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${RT}/teams/acme.json`]: '{"forgeUsername":"dev2"}' });
    expect(copyOrgRecords(p, "widgets", "acme")).toEqual({ teams: "present", invites: "none" });
    expect(p.readFile(`${RT}/teams/acme.json`)).toBe('{"forgeUsername":"dev2"}');
  });
  test("nothing to copy when folder and org agree or no record exists", () => {
    expect(copyOrgRecords(probes({ [`${RT}/teams/acme.json`]: record }), "acme", "acme")).toEqual({ teams: "present", invites: "none" });
    expect(copyOrgRecords(probes({}), "widgets", "acme")).toEqual({ teams: "none", invites: "none" });
  });
});

describe("removeOldOrgRecords", () => {
  test("removes the folder-named records once the org-named ones exist", () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${RT}/teams/acme.json`]: record, [`${RT}/invites/widgets.json`]: invites, [`${RT}/invites/acme.json`]: invites });
    expect(removeOldOrgRecords(p, "widgets", "acme")).toEqual([`${RT}/teams/widgets.json`, `${RT}/invites/widgets.json`]);
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(false);
    expect(p.exists(`${RT}/teams/acme.json`)).toBe(true);
  });
  test("never removes a record the org-named copy is missing for, and nothing when the names agree", () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record });
    expect(removeOldOrgRecords(p, "widgets", "acme")).toEqual([]);
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(true);
    expect(removeOldOrgRecords(probes({ [`${RT}/teams/acme.json`]: record }), "acme", "acme")).toEqual([]);
  });
});

describe("sweepOrphanOrgRecords", () => {
  test("removes a record whose name has no clone folder and names it", () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${RT}/invites/widgets.json`]: invites, [`${RT}/teams/acme.json`]: record }, { [`${RT}/teams`]: ["widgets.json", "acme.json", "acme.json.lock"], [`${RT}/invites`]: ["widgets.json"] });
    expect(sweepOrphanOrgRecords(p, new Set(["acme"]), new Set(["acme"]))).toEqual([`${RT}/teams/widgets.json`, `${RT}/invites/widgets.json`]);
    expect(p.exists(`${RT}/teams/acme.json`)).toBe(true);
  });
  test("the sweep leaves the current clone's record alone even when its folder is not listed yet", () => {
    const p = probes({ [`${RT}/teams/acme.json`]: record }, { [`${RT}/teams`]: ["acme.json"] });
    expect(sweepOrphanOrgRecords(p, new Set(), new Set(["acme"]))).toEqual([]);
    expect(p.exists(`${RT}/teams/acme.json`)).toBe(true);
  });
});

describe("classifyLocate", () => {
  test("nothing-lost is done; identity-mismatch and old-path-exists fail", () => {
    expect(classifyLocate("nothing-lost: rt never registered it")).toBe("done");
    expect(classifyLocate("identity-mismatch: another repo")).toBe("failed");
    expect(classifyLocate("old-path-exists: still there")).toBe("failed");
    expect(classifyLocate("locate failed")).toBe("failed");
  });
});

describe("runOrgMove", () => {
  const from = `${HOME}/.mattstack/teams/widgets`;
  const to = `${HOME}/.mattstack/orgs/acme`;
  const locateOk: LocateFn = async () => ({ ok: true, moved: true });

  test("copies records, moves the folder, relocates, then removes the old records, in that order", async () => {
    const order: string[] = [];
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${from}/.git/config`]: "[core]\n" }, { [`${HOME}/.mattstack/teams`]: ["widgets"], [`${HOME}/.mattstack`]: ["teams", "rt"] });
    const rename = p.rename.bind(p);
    p.rename = (a, b) => { if (a === from) order.push("folder"); rename(a, b); };
    const locate: LocateFn = async (newPath) => { order.push(`index:${newPath}`); expect(p.exists(`${RT}/teams/acme.json`)).toBe(true); return { ok: true, moved: true }; };
    const result = await runOrgMove(p, { from, to, locate });
    expect(result).toMatchObject({ ok: true, from, to, records: { teams: "copied", invites: "none" }, folderMoved: true, index: "moved", removed: [`${RT}/teams/widgets.json`] });
    expect(order).toEqual(["folder", `index:${to}`]);
    expect(p.calls.renames).toContainEqual([from, to]);
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(false);
  });
  test("creates the orgs root before the move", async () => {
    const p = probes({ [`${from}/.git/config`]: "[core]\n" }, { [`${HOME}/.mattstack/teams`]: ["widgets"], [`${HOME}/.mattstack`]: ["teams", "rt"] });
    await runOrgMove(p, { from, to, locate: locateOk });
    expect(p.exists(`${HOME}/.mattstack/orgs`)).toBe(true);
  });
  test("a failed relocation keeps the old records and reports the stage", async () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${from}/.git/config`]: "[core]\n" }, { [`${HOME}/.mattstack/teams`]: ["widgets"], [`${HOME}/.mattstack`]: ["teams", "rt"] });
    const result = await runOrgMove(p, { from, to, locate: async () => ({ ok: false, error: "identity-mismatch: another repo sits there" }) });
    expect(result).toMatchObject({ ok: false, stage: "index", index: "failed", folderMoved: true, removed: [] });
    expect(result.error).toContain("identity-mismatch");
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(true);
    expect(p.exists(`${RT}/teams/acme.json`)).toBe(true);
  });
  test("a nothing-lost relocation counts as done", async () => {
    const p = probes({ [`${from}/.git/config`]: "[core]\n" }, { [`${HOME}/.mattstack/teams`]: ["widgets"], [`${HOME}/.mattstack`]: ["teams", "rt"] });
    const result = await runOrgMove(p, { from, to, locate: async () => ({ ok: false, error: "nothing-lost: rt never registered it" }) });
    expect(result).toMatchObject({ ok: true, index: "already" });
  });
  test("a folder already at its target is not renamed again and only the other pieces run", async () => {
    const p = probes({ [`${RT}/teams/widgets.json`]: record, [`${to}/.git/config`]: "[core]\n" }, { [`${HOME}/.mattstack/orgs`]: ["acme"], [`${HOME}/.mattstack`]: ["orgs", "rt"] });
    const result = await runOrgMove(p, { from: `${HOME}/.mattstack/orgs/widgets`, to, locate: locateOk });
    expect(result).toMatchObject({ ok: true, folderMoved: false, records: { teams: "copied", invites: "none" }, removed: [`${RT}/teams/widgets.json`] });
    expect(p.calls.renames.find(([a]) => a === `${HOME}/.mattstack/orgs/widgets`)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/org-folder-move.test.ts`
Expected: FAIL, cannot resolve `../org-folder-move.ts`.

- [ ] **Step 3: Write the module**

`lib/team/org-folder-move.ts`:

```ts
/**
 * The pieces that move an org clone to the folder its marker names, shared by
 * the daemon's `org:move` verb and the no-daemon path of the org.folder step.
 * Record copies go first because the folder is the only thing that remembers
 * the old name; old records go last so an interrupted move leaves every
 * reader keyed on the old folder with its record.
 */

import { basename, dirname, join } from "path";
import type { Probes } from "../setup/probes.ts";
import { inviteRecordsPath } from "./invite-records.ts";
import { teamLocalPath, withRecordLock } from "./team-local.ts";

export type RecordPiece = "copied" | "present" | "none";
export interface RecordCopies {
  teams: RecordPiece;
  invites: RecordPiece;
}
export type LocateFn = (newPath: string) => Promise<{ ok: true; moved: boolean } | { ok: false; error: string }>;
export type MoveStage = "records" | "folder" | "index" | "cleanup";
export interface OrgMoveResult {
  ok: boolean;
  from: string;
  to: string;
  records: RecordCopies;
  folderMoved: boolean;
  index: "moved" | "already" | "failed";
  removed: string[];
  stage?: MoveStage;
  error?: string;
}
export type MoveProbes = Pick<Probes, "home" | "exists" | "readFile" | "writeFile" | "mkdirp" | "mkdirExclusive" | "removeDir" | "removeFile" | "chmod" | "rename" | "readDir">;

const RECORD_MODE = 0o600;

function copyRecord(p: MoveProbes, from: string, to: string): RecordPiece {
  if (p.exists(to)) return "present";
  const raw = p.readFile(from);
  if (raw === null) return "none";
  p.mkdirp(dirname(to));
  p.writeFile(to, raw, RECORD_MODE);
  p.chmod(to, RECORD_MODE);
  return "copied";
}

/** `rt/teams/<folder>.json` and `rt/invites/<folder>.json` to `<org>.json`, under the team record lock so a concurrent share or publish cannot land between the read and the copy. */
export function copyOrgRecords(p: MoveProbes, folder: string, org: string): RecordCopies {
  if (folder === org) {
    return {
      teams: p.exists(teamLocalPath(p.home, org)) ? "present" : "none",
      invites: p.exists(inviteRecordsPath(p.home, org)) ? "present" : "none",
    };
  }
  return withRecordLock(p, folder, () => ({
    teams: copyRecord(p, teamLocalPath(p.home, folder), teamLocalPath(p.home, org)),
    invites: copyRecord(p, inviteRecordsPath(p.home, folder), inviteRecordsPath(p.home, org)),
  }));
}

/** The folder-named records, removed only once the org-named copy of each exists. */
export function removeOldOrgRecords(p: MoveProbes, folder: string, org: string): string[] {
  if (folder === org) return [];
  const removed: string[] = [];
  for (const [old, current] of [
    [teamLocalPath(p.home, folder), teamLocalPath(p.home, org)],
    [inviteRecordsPath(p.home, folder), inviteRecordsPath(p.home, org)],
  ] as const) {
    if (!p.exists(old) || !p.exists(current)) continue;
    p.removeFile(old);
    removed.push(old);
  }
  return removed;
}

/** A record whose name has no clone folder under either root is a leftover of an earlier move; `keep` names the clones this run knows, so a record written for a clone still being made is left alone. */
export function sweepOrphanOrgRecords(p: MoveProbes, presentFolders: ReadonlySet<string>, keep: ReadonlySet<string>): string[] {
  const removed: string[] = [];
  const teamsDir = dirname(teamLocalPath(p.home, "x"));
  for (const entry of p.readDir(teamsDir)) {
    if (!entry.endsWith(".json")) continue;
    const name = basename(entry, ".json");
    if (presentFolders.has(name) || keep.has(name)) continue;
    for (const path of [join(teamsDir, entry), inviteRecordsPath(p.home, name)]) {
      if (!p.exists(path)) continue;
      p.removeFile(path);
      removed.push(path);
    }
  }
  return removed;
}

/** A relocation that found nothing to move (rt never registered the clone, or the row already carries the path) is done; everything else is a failure. */
export function classifyLocate(error: string): "done" | "failed" {
  return error.startsWith("nothing-lost:") ? "done" : "failed";
}

export async function runOrgMove(p: MoveProbes, req: { from: string; to: string; locate: LocateFn }): Promise<OrgMoveResult> {
  const folder = basename(req.from);
  const org = basename(req.to);
  const base: OrgMoveResult = { ok: false, from: req.from, to: req.to, records: { teams: "none", invites: "none" }, folderMoved: false, index: "failed", removed: [] };
  const fail = (stage: MoveStage, error: string): OrgMoveResult => ({ ...base, ok: false, stage, error });

  try {
    base.records = copyOrgRecords(p, folder, org);
  } catch (err) {
    return fail("records", err instanceof Error ? err.message : String(err));
  }

  if (req.from !== req.to) {
    if (p.exists(req.to)) {
      if (p.exists(req.from)) return fail("folder", `${req.to} already exists`);
    } else {
      try {
        p.mkdirp(dirname(req.to));
        p.rename(req.from, req.to);
        base.folderMoved = true;
      } catch (err) {
        return fail("folder", err instanceof Error ? err.message : String(err));
      }
    }
  }

  const located = await req.locate(req.to);
  if (located.ok) base.index = located.moved ? "moved" : "already";
  else if (classifyLocate(located.error) === "done") base.index = "already";
  else return { ...fail("index", located.error), folderMoved: base.folderMoved, records: base.records };

  try {
    base.removed = removeOldOrgRecords(p, folder, org);
  } catch (err) {
    return { ...fail("cleanup", err instanceof Error ? err.message : String(err)), folderMoved: base.folderMoved, records: base.records, index: base.index };
  }
  return { ...base, ok: true };
}
```

Note on the fake: `fakeProbes.rename` moves a single file entry; a directory rename is recorded in `calls.renames` and nothing under it moves. The tests above assert the call and the order, not the moved children. `p.exists(req.to)` after a fake rename of a directory stays false, which is why the "already at its target" test seeds the clone at `to` itself.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/team/__tests__/org-folder-move.test.ts lib/team/__tests__/team-local.test.ts`
Expected: PASS. If the fake's `exists` does not see a directory seeded only through `dirs`, seed `[`${from}/.git/config`]` as the tests do (a file under it) and check `p.exists(join(req.from, ".git"))`; keep the module's `p.exists(req.from)` and adjust the fixture, not the module.

- [ ] **Step 5: Commit**

```bash
git add lib/team/org-folder-move.ts lib/team/__tests__/org-folder-move.test.ts
git commit -m "orgs: the shared pieces that move a clone to its marker's name"
```

---

### Task 4: A per-clone pause in the team snapshot supervisor

**Files:**
- Modify: `lib/daemon/team-snapshots.ts`
- Test: `lib/daemon/__tests__/team-snapshots.test.ts`

**Interfaces:**
- Produces on `TeamSnapshotsHandle`: `pause(slugs: string[]): void` (stops the running engine of each slug and holds it: `rescan` starts none of them until resumed) and `resume(slugs: string[]): Promise<void>` (releases the hold, re-arms the `orgs/` watch when it never armed, then rescans). `status()` omits a held slug.

- [ ] **Step 1: Write the failing tests**

Read the `harness()` helper at the top of `lib/daemon/__tests__/team-snapshots.test.ts` (it builds `root`, `deps`, a fake `start` that records specs, a fake `watch` with `emit`, `clone(root, slug, withOrigin)` and `flush()`). Add a `describe("pause and resume")` block using those helpers by their existing names:

```ts
describe("pause and resume", () => {
  test("pause stops a clone's engine and a rescan does not restart it; resume brings it back", async () => {
    const h = harness();
    clone(h.root, "acme", true);
    const handle = startTeamSnapshots(h.deps);
    await handle.ready;
    expect(handle.status().map((e) => e.slug)).toEqual(["acme"]);
    handle.pause(["acme", "widgets"]);
    expect(handle.status()).toEqual([]);
    expect(h.stopped).toEqual(["team:acme"]);
    await handle.rescan();
    expect(handle.status()).toEqual([]);
    renameSync(join(h.root, "acme"), join(h.root, "widgets"));
    await handle.resume(["acme", "widgets"]);
    expect(handle.status().map((e) => e.slug)).toEqual(["widgets"]);
    handle.stop();
  });

  test("resume re-arms the orgs/ watch when it never armed", async () => {
    const h = harness({ orgsMissingAtBoot: true });
    const handle = startTeamSnapshots(h.deps);
    await handle.ready;
    expect(h.watchCalls).toBe(0);
    mkdirSync(h.root, { recursive: true });
    clone(h.root, "acme", true);
    await handle.resume([]);
    expect(h.watchCalls).toBe(1);
    expect(handle.status().map((e) => e.slug)).toEqual(["acme"]);
    handle.stop();
  });
});
```

Extend `harness()` so it records `stopped` (push the spec id when the fake handle's `stop` runs), counts `watchCalls` (increment in the fake `watch`), and takes `{ orgsMissingAtBoot?: boolean }`: when set, point `deps.orgsDir` at `join(tmp, "orgs")` without creating it and make the fake `watch` throw `ENOENT` while the directory is missing (`if (!existsSync(path)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })`). Import `renameSync` and `mkdirSync` from `fs` if the file does not already.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/daemon/__tests__/team-snapshots.test.ts -t "pause and resume"`
Expected: FAIL, `handle.pause is not a function`.

- [ ] **Step 3: Implement pause, resume and the extracted watch arming**

In `lib/daemon/team-snapshots.ts`:

Add to `TeamSnapshotsHandle`:

```ts
  /** Stops these clones' engines and keeps `rescan` from starting them until `resume`: `org:move` renames a clone's folder and must not race a pull into it. */
  pause(slugs: string[]): void;
  /** Lifts `pause`, arms the orgs/ watch when boot could not, then rescans. */
  resume(slugs: string[]): Promise<void>;
```

Inside `startTeamSnapshots`, beside `instances`, add `const held = new Set<string>();`. In `rescan()`, inside the `for (const slug of readdirSync(orgsRoot).sort())` loop, right after `if (!existsSync(join(dir, ".git"))) continue;` add:

```ts
        if (held.has(slug)) continue;
```

(A held slug is then absent from `present`, so the trailing loop stops its instance if one is still running.)

Extract the watch arming out of `boot()` into a function placed above `boot`:

```ts
  /** Arms the non-recursive orgs/ watch once; a boot on a Mac whose orgs/ does not exist yet leaves it unarmed, and `resume` tries again after a move created the root. */
  function armWatch(): void {
    if (watcher || stopped) return;
    try {
      watcher = watch(orgsRoot, { recursive: false }, () => {
        if (debounce) clearTimer(debounce);
        debounce = setTimer(() => { debounce = null; void safeRescan(); }, RESCAN_DEBOUNCE_MS);
      });
    } catch (err) {
      rawDeps.log.warn({ err, orgsRoot }, "team-snapshots: cannot watch orgs/; new clones are picked up on the interval rescan");
    }
  }
```

and in `boot()` replace the `try { watcher = watch(...) } catch (...) {...}` block with `armWatch();`.

Add to the returned handle:

```ts
    pause(slugs) {
      for (const slug of slugs) {
        held.add(slug);
        const inst = instances.get(slug);
        if (!inst) continue;
        inst.handle.stop();
        instances.delete(slug);
        rawDeps.log.info({ slug }, "team-snapshots: paused for a folder move");
      }
    },
    async resume(slugs) {
      for (const slug of slugs) held.delete(slug);
      armWatch();
      await safeRescan();
    },
```

- [ ] **Step 4: Run the whole supervisor test file**

Run: `bun test lib/daemon/__tests__/team-snapshots.test.ts lib/daemon/__tests__/handlers-team-snapshot.test.ts`
Expected: PASS. `handlers-team-snapshot.test.ts` casts a stub handle; if its stub is typed as `TeamSnapshotsHandle` and now fails to compile, add `pause: () => {}, resume: async () => {}` to the stub.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/team-snapshots.ts lib/daemon/__tests__/team-snapshots.test.ts lib/daemon/__tests__/handlers-team-snapshot.test.ts
git commit -m "daemon: team snapshots can pause one clone and re-arm the orgs watch"
```

---

### Task 5: The `org:move` daemon verb

**Files:**
- Create: `lib/daemon/handlers/org.ts`
- Modify: `lib/daemon/handlers/types.ts` (`InternalCommands`), `lib/daemon/command-router.ts` (spread the factory)
- Test: `lib/daemon/__tests__/org-move-handler.test.ts`

**Interfaces:**
- Consumes: `runOrgMove`, `OrgMoveResult`, `LocateFn` from `lib/team/org-folder-move.ts`; `markerOrg` from `lib/team/org-marker.ts`; `planLocate`, `applyLocate`, `isRefusal` from `lib/repo-locate.ts`; `orgsDir`, `mattstackHome` from `lib/rt-paths.ts`; `validateSlug` from `lib/secrets/store.ts`; `createRealProbes` from `lib/setup/probes.ts`; `TeamSnapshotsHandle` (`pause`, `resume`).
- Produces:

```ts
export interface OrgHandlerOpts {
  withReconcilerHeld: <T>(fn: () => Promise<T>) => Promise<T>;
  refreshWatchedRepos: () => void;
  emitEvent: (topic: string, payload: unknown) => void;
  teamSnapshots: Pick<TeamSnapshotsHandle, "pause" | "resume">;
  probes?: MoveProbes;
}
export function createOrgHandlers(opts: OrgHandlerOpts): Record<"org:move", (payload: any) => Promise<any>> & HandlerMap;
```

The reply is `{ ok: true, data: OrgMoveResult }`, or `{ ok: false, error: string, failure: { code, message } }` with codes `from-required`, `to-required`, `to-outside-orgs`, `from-outside-home`, `from-missing`, `not-an-org-clone`, `marker-mismatch`, `to-exists`, and `move-failed` (whose `message` is the move's own `error`, prefixed with its stage). The `InternalCommands` entry: `"org:move": { payload: { from: string; to: string }; data: OrgMoveResult }`.

- [ ] **Step 1: Write the failing tests**

`lib/daemon/__tests__/org-move-handler.test.ts` (real git, a temp HOME, a fake hold, after the pattern of `repos-handlers.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb, setKvValue, getKvValue } from "../../state/index.ts";
import { saveRegistry, loadRegistry } from "../../worktree/registry.ts";
import { deriveRepoIdentity, serializeIdentity } from "../../settings/identity.ts";
import { createOrgHandlers } from "../handlers/org.ts";

describe("org:move", () => {
  const origHome = process.env.HOME;
  let home: string;
  let order: string[];
  let events: { topic: string; payload: unknown }[];
  let paused: string[][];
  let resumed: string[][];
  let handlers: ReturnType<typeof createOrgHandlers>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-org-move-home-")));
    process.env.HOME = home;
    closeStateDb();
    order = [];
    events = [];
    paused = [];
    resumed = [];
    handlers = createOrgHandlers({
      withReconcilerHeld: async (fn) => {
        order.push("hold-start");
        try {
          return await fn();
        } finally {
          order.push("hold-end");
        }
      },
      refreshWatchedRepos: () => order.push("refresh"),
      emitEvent: (topic, payload) => {
        order.push(`emit:${topic}`);
        events.push({ topic, payload });
      },
      teamSnapshots: {
        pause: (slugs) => { order.push("pause"); paused.push(slugs); },
        resume: async (slugs) => { order.push("resume"); resumed.push(slugs); },
      },
    });
  });

  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  function clone(root: string, folder: string, org: string, opts: { register?: boolean; role?: "org" | "team" } = {}): string {
    const dir = join(home, ".mattstack", root, folder);
    mkdirSync(join(dir, "mattstack"), { recursive: true });
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    execSync("git remote add origin https://gitlab.example.com/acme/org.git", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: opts.role ?? "org", org }));
    execSync("git add -A && git -c user.email=dev1@gitlab.example.com -c user.name=dev1 commit -q -m init", { cwd: dir, stdio: "pipe" });
    return dir;
  }

  async function register(dir: string): Promise<string> {
    const identity = serializeIdentity(await deriveRepoIdentity(dir));
    setKvValue("repo-index", identity, dir);
    saveRegistry(identity, [{ name: "main", path: dir, kind: "main", branch: "main", createdAt: "2026-01-01T00:00:00.000Z" }]);
    return identity;
  }

  test("moves a legacy clone under the hold, pausing both slugs, copying records first and resuming after", async () => {
    const from = clone("teams", "widgets", "acme");
    const identity = await register(from);
    mkdirSync(join(home, ".mattstack", "rt", "teams"), { recursive: true });
    writeFileSync(join(home, ".mattstack", "rt", "teams", "widgets.json"), JSON.stringify({ forgeUsername: "dev1" }));
    const to = join(home, ".mattstack", "orgs", "acme");

    const res = await handlers["org:move"]({ from, to });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ ok: true, from, to, folderMoved: true, index: "moved", records: { teams: "copied", invites: "none" } });
    expect(existsSync(to)).toBe(true);
    expect(existsSync(from)).toBe(false);
    expect(JSON.parse(readFileSync(join(home, ".mattstack", "rt", "teams", "acme.json"), "utf8"))).toEqual({ forgeUsername: "dev1" });
    expect(existsSync(join(home, ".mattstack", "rt", "teams", "widgets.json"))).toBe(false);
    expect(getKvValue("repo-index", identity)).toBe(to);
    expect(loadRegistry(identity)[0]?.path).toBe(to);
    expect(paused).toEqual([["widgets", "acme"]]);
    expect(resumed).toEqual([["widgets", "acme"]]);
    expect(order).toEqual(["pause", "hold-start", "refresh", "emit:repo:moved", "emit:org:moved", "hold-end", "resume"]);
    expect(events[1]).toEqual({ topic: "org:moved", payload: { from, to } });
  });

  test("a clone rt never registered moves with index already", async () => {
    const from = clone("teams", "acme", "acme", { role: "team" });
    const res = await handlers["org:move"]({ from, to: join(home, ".mattstack", "orgs", "acme") });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ folderMoved: true, index: "already", records: { teams: "none", invites: "none" } });
    expect(order).toEqual(["pause", "hold-start", "emit:org:moved", "hold-end", "resume"]);
  });

  test("refuses a target outside the orgs root", async () => {
    const from = clone("teams", "acme", "acme");
    const res = await handlers["org:move"]({ from, to: join(home, "elsewhere", "acme") });
    expect(res).toMatchObject({ ok: false, failure: { code: "to-outside-orgs" } });
    expect(order).toEqual([]);
    expect(existsSync(from)).toBe(true);
  });

  test("refuses a source outside ~/.mattstack and a source whose marker names another org", async () => {
    const outside = mkdtempSync(join(tmpdir(), "rt-org-move-outside-"));
    try {
      expect(await handlers["org:move"]({ from: outside, to: join(home, ".mattstack", "orgs", "acme") })).toMatchObject({ ok: false, failure: { code: "from-outside-home" } });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    const from = clone("teams", "widgets", "widgets");
    expect(await handlers["org:move"]({ from, to: join(home, ".mattstack", "orgs", "acme") })).toMatchObject({ ok: false, failure: { code: "marker-mismatch" } });
    expect(await handlers["org:move"]({ from: join(home, ".mattstack", "teams", "gadgets"), to: join(home, ".mattstack", "orgs", "gadgets") })).toMatchObject({ ok: false, failure: { code: "from-missing" } });
    expect(await handlers["org:move"]({ to: join(home, ".mattstack", "orgs", "acme") })).toMatchObject({ ok: false, failure: { code: "from-required" } });
    expect(order).toEqual([]);
  });

  test("refuses when the target already exists and resumes even when the move fails", async () => {
    const from = clone("teams", "widgets", "acme");
    clone("orgs", "acme", "acme");
    const res = await handlers["org:move"]({ from, to: join(home, ".mattstack", "orgs", "acme") });
    expect(res).toMatchObject({ ok: false, failure: { code: "to-exists" } });
    expect(existsSync(from)).toBe(true);
    expect(order).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/daemon/__tests__/org-move-handler.test.ts`
Expected: FAIL, cannot resolve `../handlers/org.ts`.

- [ ] **Step 3: Write the handler, the type entry and the wiring**

`lib/daemon/handlers/org.ts`:

```ts
import { existsSync } from "fs";
import { basename, dirname, isAbsolute, resolve } from "path";
import { applyLocate, isRefusal, planLocate } from "../../repo-locate.ts";
import { mattstackHome, orgsDir } from "../../rt-paths.ts";
import { validateSlug } from "../../secrets/store.ts";
import { createRealProbes } from "../../setup/probes.ts";
import { runOrgMove, type LocateFn, type MoveProbes } from "../../team/org-folder-move.ts";
import { markerOrg } from "../../team/org-marker.ts";
import type { TeamSnapshotsHandle } from "../team-snapshots.ts";
import type { HandlerMap } from "./types.ts";

export interface OrgHandlerOpts {
  /** Excludes reconciler passes for the duration of `fn`; `org:move` relocates the clone's registry rows itself, so it must never go through `repos:locate`, which takes this same hold. */
  withReconcilerHeld: <T>(fn: () => Promise<T>) => Promise<T>;
  refreshWatchedRepos: () => void;
  emitEvent: (topic: string, payload: unknown) => void;
  teamSnapshots: Pick<TeamSnapshotsHandle, "pause" | "resume">;
  probes?: MoveProbes;
}

const refuse = (code: string, message: string) => ({ ok: false as const, error: `${code}: ${message}`, failure: { code, message } });

/** Relocates the clone's index row in this process: the hold is already held, so the `repos:locate` handler (which takes it) would deadlock. */
const locateDirect: LocateFn = async (newPath) => {
  const plan = await planLocate({ newPath });
  if (isRefusal(plan)) return { ok: false, error: `${plan.refusal}: ${plan.message}` };
  const result = await applyLocate(plan);
  return result.ok ? { ok: true, moved: true } : { ok: false, error: result.error ?? "locate failed" };
};

export function createOrgHandlers(opts: OrgHandlerOpts): Record<"org:move", (payload: any) => Promise<any>> & HandlerMap {
  const probes = opts.probes ?? createRealProbes();
  return {
    "org:move": async (payload) => {
      const from = payload?.from;
      const to = payload?.to;
      if (typeof from !== "string" || from.length === 0 || !isAbsolute(from)) return refuse("from-required", "from must be an absolute path");
      if (typeof to !== "string" || to.length === 0 || !isAbsolute(to)) return refuse("to-required", "to must be an absolute path");
      const target = resolve(to);
      const org = basename(target);
      let slugOk = true;
      try {
        validateSlug(org);
      } catch {
        slugOk = false;
      }
      if (dirname(target) !== orgsDir() || !slugOk) return refuse("to-outside-orgs", `${to} is not a folder directly under ${orgsDir()}`);
      const source = resolve(from);
      const homeRoot = `${mattstackHome()}/`;
      if (!source.startsWith(homeRoot)) return refuse("from-outside-home", `${from} is not under ${mattstackHome()}`);
      if (!existsSync(source)) return refuse("from-missing", `${from} does not exist`);
      const marked = markerOrg(probes, source);
      if (marked === null) return refuse("not-an-org-clone", `${from} carries no org marker`);
      if (marked !== org) return refuse("marker-mismatch", `${from} holds the ${marked} org, not ${org}`);
      if (source !== target && existsSync(target)) return refuse("to-exists", `${to} already exists`);

      const slugs = [...new Set([basename(source), org])];
      opts.teamSnapshots.pause(slugs);
      try {
        return await opts.withReconcilerHeld(async () => {
          const result = await runOrgMove(probes, { from: source, to: target, locate: locateDirect });
          if (!result.ok) return refuse("move-failed", `${result.stage}: ${result.error}`);
          if (result.index === "moved") {
            opts.refreshWatchedRepos();
            opts.emitEvent("repo:moved", { from: source, to: target });
          }
          opts.emitEvent("org:moved", { from: source, to: target });
          return { ok: true, data: result };
        });
      } finally {
        await opts.teamSnapshots.resume(slugs);
      }
    },
  };
}
```

`repo:moved` carried `identity` from `repos:locate`; here `runOrgMove` does not surface it, so the payload is `{ from, to }`. Check `lib/daemon/__tests__` and `apps/` for a consumer of `repo:moved` that reads `identity` (`grep -rn "repo:moved" lib apps/board/src apps/console/src`); if one does, extend `LocateFn`'s ok shape with `identity?: string`, set it from `result.identity` in `locateDirect`, thread it through `OrgMoveResult` as `identity?: string`, and emit it. Otherwise leave the payload as written and say so in the commit.

In `lib/daemon/handlers/types.ts` add to `InternalCommands`:

```ts
  /** The org.folder step's folder move: records, folder, index row and old records under the reconciler hold with that clone's snapshot engine paused. */
  "org:move": { payload: { from: string; to: string }; data: OrgMoveResult };
```

with `import type { OrgMoveResult } from "../../team/org-folder-move.ts";` beside the other type imports.

In `lib/daemon/command-router.ts`, import `createOrgHandlers` from `./handlers/org.ts` and add, directly after the `createReposHandlers` spread:

```ts
    ...createOrgHandlers({ ...opts.repos, emitEvent, teamSnapshots: opts.teamSnapshots }),
```

- [ ] **Step 4: Run the tests and the daemon's registration guards**

Run: `bun test lib/daemon/__tests__/org-move-handler.test.ts lib/daemon/__tests__/repos-handlers.test.ts lib/daemon/__tests__/rt-client-commands.test.ts lib/daemon/__tests__/unknown-command.test.ts lib/daemon/__tests__/handle-command-envelope.test.ts`
Expected: PASS. Then `bun run typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/handlers/org.ts lib/daemon/handlers/types.ts lib/daemon/command-router.ts lib/daemon/__tests__/org-move-handler.test.ts
git commit -m "daemon: org:move renames an org clone under the reconciler hold"
```

---

### Task 6: The Claude marketplace piece

**Files:**
- Create: `lib/setup/steps/org-folder-marketplace.ts`
- Test: `lib/setup/__tests__/steps-org-folder-marketplace.test.ts`

**Interfaces:**
- Consumes: `resolveTool` from `lib/deps/resolve.ts`; `parseMarketplaceList`, `claudeMessage` from `lib/setup/steps/plugins.ts` (export `claudeMessage` if it is not already); `PACK_EXEC_TIMEOUT_MS` from `lib/setup/pack-cache.ts`; `claudeConfigDirs` from `lib/setup/tools-install.ts`; `updateSetupState` from `lib/setup/state.ts`; `stripJsonc` from `lib/jsonc.ts`; `ApplyContext`.
- Produces:

```ts
export interface MarketplaceOutcome {
  state: "done" | "skipped" | "partial";
  detail: string;
  /** The exact claude commands to finish by hand, joined for the remedy; set only on partial. */
  commands?: string[];
}
export function marketplaceName(p: Pick<Probes, "readFile">, cloneDir: string): string | null;
export async function convergeMarketplace(ctx: ApplyContext, clone: { dir: string; stalePaths: string[] }): Promise<MarketplaceOutcome>;
```

`clone.stalePaths` is every earlier spelling of the clone's folder this run knows (`from` when the folder moved this run); every `setup-state.json` `marketplaces[]` entry equal to one of them, or to the stale registered path, is rewritten to `clone.dir`.

Follow Task 1's Findings. The piece, per Claude config dir:

1. `claude plugin marketplace list --json`; `parseMarketplaceList`. Not registered (name absent) → skipped for this dir. Registered with `source` equal to `clone.dir` (compare with `resolve()` on both sides) → done for this dir.
2. Else `claude plugin list --json` (own parse below, keeping `id`, `scope`, `enabled` for ids ending in `@<name>`), then `marketplace remove <name>`, `marketplace add <clone.dir>`, `plugin install <id> --scope <scope>` for each, `plugin disable <id>` for each that was not enabled.
3. Any non-zero exit → stop, `partial`, `commands` = the commands not yet run successfully (from the one that failed onwards) as `claude plugin ...` strings, with `CLAUDE_CONFIG_DIR=<dir>` prefixed when the dir is not the default one.
4. `claude` missing (`resolveTool(...).exec` null) → `partial` with the full command list for the default dir.

- [ ] **Step 1: Write the failing tests**

`lib/setup/__tests__/steps-org-folder-marketplace.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ApplyContext } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import { convergeMarketplace, marketplaceName } from "../steps/org-folder-marketplace.ts";
import { fakeProbes, ok, type ExecScript } from "./fakes.ts";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-org-mkt-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

const CLAUDE = "/usr/local/bin/claude";
const clone = () => join(home, ".mattstack", "orgs", "acme");
const old = () => join(home, ".mattstack", "teams", "acme");

function ctxFor(p: Probes): ApplyContext {
  return { p, emit: () => {}, log: () => {}, intent: null, team: { slug: "", name: "", mode: "none" }, snapshot: null, reqs: [], nonInteractive: true, teamOfOne: false, appPath: null, ci: false, secrets: {} as never, teamSecrets: () => ({}) as never, relay: {} as never, secretPresence: { has: async () => null }, redact: () => {}, need: async () => "no-app" } as ApplyContext;
}

function claudeFake(opts: { registeredAt: string | null; plugins: { id: string; scope?: string; enabled: boolean }[]; fail?: string }) {
  const calls: string[][] = [];
  const exec: ExecScript = (argv) => {
    calls.push(argv);
    const [, , verb, sub] = argv;
    const sliced = argv.slice(1).join(" ");
    if (opts.fail && sliced.startsWith(opts.fail)) return { code: 1, stdout: "", stderr: `boom: ${sliced}` };
    if (verb === "marketplace" && sub === "list") return ok(JSON.stringify(opts.registeredAt === null ? [] : [{ name: "acme", source: "directory", path: opts.registeredAt, installLocation: opts.registeredAt }]));
    if (verb === "list") return ok(JSON.stringify(opts.plugins.map((pl) => ({ id: pl.id, version: "1.0.0", scope: pl.scope ?? "user", enabled: pl.enabled }))));
    return ok("");
  };
  return { calls, exec };
}

function probes(exec: ExecScript | undefined, files: Record<string, string> = {}) {
  return fakeProbes({
    home,
    env: exec ? { PATH: "/usr/local/bin" } : {},
    files: { ...(exec ? { [CLAUDE]: "bin" } : {}), [join(clone(), ".claude-plugin", "marketplace.json")]: '{ "name": "acme", "plugins": [] }', ...files },
    exec,
  });
}

describe("marketplaceName", () => {
  test("reads the clone's marketplace name and returns null without one", () => {
    expect(marketplaceName(probes(undefined), clone())).toBe("acme");
    expect(marketplaceName(fakeProbes({ home }), clone())).toBeNull();
  });
});

describe("convergeMarketplace", () => {
  test("done when the registered path is already the clone", async () => {
    const claude = claudeFake({ registeredAt: clone(), plugins: [] });
    const out = await convergeMarketplace(ctxFor(probes(claude.exec)), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("done");
    expect(claude.calls.map((c) => c.slice(1).join(" "))).toEqual(["plugin marketplace list --json"]);
  });

  test("skipped when the marketplace is not registered", async () => {
    const claude = claudeFake({ registeredAt: null, plugins: [] });
    const out = await convergeMarketplace(ctxFor(probes(claude.exec)), { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("skipped");
  });

  test("a stale path is removed, re-added and its plugins reinstalled; a disabled plugin is reinstalled, then disabled again", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [{ id: "widgets@acme", enabled: true }, { id: "gadgets@acme", scope: "local", enabled: false }, { id: "other@mattstack", enabled: true }] });
    const p = probes(claude.exec);
    updateSetupState(p, (s) => ({ ...s, marketplaces: [...s.marketplaces, old(), "https://github.com/acme/mattstack-marketplace.git"] }));
    const out = await convergeMarketplace(ctxFor(p), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("done");
    expect(claude.calls.map((c) => c.slice(1).join(" "))).toEqual([
      "plugin marketplace list --json",
      "plugin list --json",
      "plugin marketplace remove acme",
      `plugin marketplace add ${clone()}`,
      "plugin install widgets@acme --scope user",
      "plugin install gadgets@acme --scope local",
      "plugin disable gadgets@acme",
    ]);
    expect(readSetupState(p).marketplaces).toEqual([clone(), "https://github.com/acme/mattstack-marketplace.git"]);
  });

  test("a failing reinstall ends partial with the commands left to run", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [{ id: "widgets@acme", enabled: true }, { id: "gadgets@acme", enabled: false }], fail: "plugin install widgets@acme" });
    const out = await convergeMarketplace(ctxFor(probes(claude.exec)), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.commands).toEqual([
      "claude plugin install widgets@acme --scope user",
      "claude plugin install gadgets@acme --scope user",
      "claude plugin disable gadgets@acme",
    ]);
    expect(out.detail).toContain("boom");
  });

  test("claude missing ends partial with every command", async () => {
    const out = await convergeMarketplace(ctxFor(probes(undefined)), { dir: clone(), stalePaths: [old()] });
    expect(out.state).toBe("partial");
    expect(out.commands).toEqual([
      "claude plugin marketplace remove acme",
      `claude plugin marketplace add ${clone()}`,
    ]);
    expect(out.detail).toContain("Claude Code");
  });

  test("a second config dir is driven with CLAUDE_CONFIG_DIR and named in its commands", async () => {
    const claude = claudeFake({ registeredAt: old(), plugins: [], fail: "plugin marketplace add" });
    const p = probes(claude.exec);
    const envs: (string | undefined)[] = [];
    const exec = p.exec.bind(p);
    p.exec = (argv, o) => { envs.push(o?.env?.CLAUDE_CONFIG_DIR); return exec(argv, o); };
    const ctx = ctxFor(p);
    ctx.p.env.CLAUDE_CONFIG_DIR = join(home, "cfg2");
    const out = await convergeMarketplace(ctx, { dir: clone(), stalePaths: [] });
    expect(out.state).toBe("partial");
    expect(new Set(envs)).toEqual(new Set([join(home, "cfg2")]));
    expect(out.commands?.[0]).toBe(`CLAUDE_CONFIG_DIR=${join(home, "cfg2")} claude plugin marketplace add ${clone()}`);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/steps-org-folder-marketplace.test.ts`
Expected: FAIL, cannot resolve `../steps/org-folder-marketplace.ts`.

- [ ] **Step 3: Write the module**

`lib/setup/steps/org-folder-marketplace.ts`:

```ts
/**
 * The Claude marketplace piece of the org.folder step. `claude plugin
 * marketplace remove` uninstalls every plugin that came from the marketplace
 * (verified against claude 2.1.292), so re-pointing a moved clone is remove,
 * add, reinstall each plugin at its scope, then disable the ones that were off.
 */

import { join, resolve } from "path";
import { stripJsonc } from "../../jsonc.ts";
import { resolveTool } from "../../deps/resolve.ts";
import type { ApplyContext } from "../apply.ts";
import { PACK_EXEC_TIMEOUT_MS } from "../pack-cache.ts";
import type { ExecResult, Probes } from "../probes.ts";
import { updateSetupState } from "../state.ts";
import { claudeConfigDirs } from "../tools-install.ts";
import { claudeMessage, parseMarketplaceList } from "./plugins.ts";

export interface MarketplaceOutcome {
  state: "done" | "skipped" | "partial";
  detail: string;
  commands?: string[];
}

interface InstalledPlugin {
  id: string;
  scope: string;
  enabled: boolean;
}

export function marketplaceName(p: Pick<Probes, "readFile">, cloneDir: string): string | null {
  const raw = p.readFile(join(cloneDir, ".claude-plugin", "marketplace.json"));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(stripJsonc(raw)) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : null;
  } catch {
    return null;
  }
}

/** The plugins installed from one marketplace, with the scope and enabled state a reinstall must restore. */
export function parseInstalledFrom(stdout: string, marketplace: string): InstalledPlugin[] | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return null;
    const out: InstalledPlugin[] = [];
    for (const item of parsed as { id?: unknown; scope?: unknown; enabled?: unknown }[]) {
      if (typeof item?.id !== "string" || !item.id.endsWith(`@${marketplace}`)) continue;
      out.push({ id: item.id, scope: typeof item.scope === "string" && item.scope.length > 0 ? item.scope : "user", enabled: item.enabled === true });
    }
    return out;
  } catch {
    return null;
  }
}

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

function rewriteSetupState(ctx: ApplyContext, stale: string[], current: string): void {
  if (stale.length === 0) return;
  updateSetupState(ctx.p, (s) => ({ ...s, marketplaces: s.marketplaces.map((m) => (stale.some((old) => samePath(old, m)) ? current : m)) }));
}

export async function convergeMarketplace(ctx: ApplyContext, clone: { dir: string; stalePaths: string[] }): Promise<MarketplaceOutcome> {
  const name = marketplaceName(ctx.p, clone.dir);
  if (name === null) return { state: "skipped", detail: "the clone declares no Claude marketplace" };
  const configDirs = claudeConfigDirs(ctx.p, []);
  const defaultDir = configDirs[0]!;
  const commandsFor = (dir: string, plugins: InstalledPlugin[]): string[] => {
    const prefix = dir === defaultDir && ctx.p.env.CLAUDE_CONFIG_DIR === undefined ? "" : `CLAUDE_CONFIG_DIR=${dir} `;
    return [
      `${prefix}claude plugin marketplace remove ${name}`,
      `${prefix}claude plugin marketplace add ${clone.dir}`,
      ...plugins.map((pl) => `${prefix}claude plugin install ${pl.id} --scope ${pl.scope}`),
      ...plugins.filter((pl) => !pl.enabled).map((pl) => `${prefix}claude plugin disable ${pl.id}`),
    ];
  };

  const claude = resolveTool(ctx.p, "claude");
  if (!claude.exec) {
    rewriteSetupState(ctx, clone.stalePaths, clone.dir);
    return { state: "partial", detail: `Claude Code is not installed, so the ${name} marketplace still points at the old folder`, commands: commandsFor(defaultDir, []) };
  }

  const notes: string[] = [];
  for (const dir of configDirs) {
    const run = (args: string[]): Promise<ExecResult> => ctx.p.exec([...claude.exec!, ...args], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
    const listed = await run(["plugin", "marketplace", "list", "--json"]);
    const known = listed.code === 0 ? parseMarketplaceList(listed.stdout) : null;
    if (known === null) {
      return { state: "partial", detail: `Claude Code's marketplace list could not be read: ${claudeMessage(listed, `exited ${listed.code}`)}`, commands: commandsFor(dir, []) };
    }
    const registered = known.find((m) => m.name === name);
    if (!registered) {
      notes.push(`${name} is not registered in ${dir}`);
      continue;
    }
    const stale = registered.source !== null && !samePath(registered.source, clone.dir) ? registered.source : null;
    if (stale === null) {
      notes.push(`${name} already points at the clone`);
      continue;
    }
    const plugins = await run(["plugin", "list", "--json"]);
    const installed = plugins.code === 0 ? parseInstalledFrom(plugins.stdout, name) : null;
    if (installed === null) {
      return { state: "partial", detail: `Claude Code's plugin list could not be read: ${claudeMessage(plugins, `exited ${plugins.code}`)}`, commands: commandsFor(dir, []) };
    }
    const steps: { argv: string[]; command: string }[] = [
      { argv: ["plugin", "marketplace", "remove", name], command: "" },
      { argv: ["plugin", "marketplace", "add", clone.dir], command: "" },
      ...installed.map((pl) => ({ argv: ["plugin", "install", pl.id, "--scope", pl.scope], command: "" })),
      ...installed.filter((pl) => !pl.enabled).map((pl) => ({ argv: ["plugin", "disable", pl.id], command: "" })),
    ];
    const commands = commandsFor(dir, installed);
    for (let i = 0; i < steps.length; i++) {
      const res = await run(steps[i]!.argv);
      if (res.code === 0) continue;
      ctx.log("org.folder", `claude ${steps[i]!.argv.join(" ")} (${dir}): ${claudeMessage(res, `exited ${res.code}`)}`);
      rewriteSetupState(ctx, [...clone.stalePaths, stale], clone.dir);
      return { state: "partial", detail: `re-pointing the ${name} marketplace stopped at claude ${steps[i]!.argv.join(" ")}: ${claudeMessage(res, `exited ${res.code}`)}`, commands: commands.slice(i) };
    }
    rewriteSetupState(ctx, [...clone.stalePaths, stale], clone.dir);
    notes.push(`${name} re-pointed in ${dir}${installed.length ? `, ${installed.length} plugin${installed.length === 1 ? "" : "s"} reinstalled` : ""}`);
  }
  rewriteSetupState(ctx, clone.stalePaths, clone.dir);
  const touched = notes.some((n) => n.includes("re-pointed"));
  const skipped = notes.every((n) => n.includes("not registered"));
  return { state: skipped ? "skipped" : "done", detail: notes.join("; "), ...(touched ? {} : {}) };
}
```

Drop the unused `command: ""` field and the no-op spread before committing; they are placeholders in this listing only so the shape reads in one pass. Export `claudeMessage` from `lib/setup/steps/plugins.ts` if it is not already exported (it is `export function claudeMessage` at the time of writing).

- [ ] **Step 4: Run the tests**

Run: `bun test lib/setup/__tests__/steps-org-folder-marketplace.test.ts lib/setup/__tests__/steps-c.test.ts`
Expected: PASS. If the fake's `fileMode`/`writeFile` under `updateSetupState` needs `dirs` seeded for `~/.mattstack/rt`, call `p.mkdirp(join(home, ".mattstack", "rt"))` in `probes()` before returning.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/steps/org-folder-marketplace.ts lib/setup/__tests__/steps-org-folder-marketplace.test.ts lib/setup/steps/plugins.ts
git commit -m "setup: re-point a moved org clone's Claude marketplace and reinstall its plugins"
```

---

### Task 7: The `org.folder` step and its registration

**Files:**
- Create: `lib/setup/steps/org-folder.ts`
- Modify: `lib/setup/contract.ts` (`STEP_IDS`), `lib/setup/steps/index.ts` (`STEPS`), `lib/setup/__tests__/update-safe.test.ts`, `commands/__tests__/setup-copy.test.ts` (+ its snapshot)
- Test: `lib/setup/__tests__/steps-org-folder.test.ts`

**Interfaces:**
- Consumes: `markerOrg` (Task 2); `runOrgMove`, `sweepOrphanOrgRecords`, `classifyLocate`, `type LocateFn`, `type OrgMoveResult` (Task 3); `convergeMarketplace` (Task 6); `locateMovedRepo` from `lib/repo-locate-dispatch.ts`; `parseOriginUrl` from `lib/setup/team-settings.ts`; `orgsDirUnder`, `orgDirUnder` from `lib/rt-paths.ts`; `validateSlug`; `toFailedOutcome`.
- Produces:

```ts
export const ORG_MOVE_TIMEOUT_MS = 120_000;
export const ORG_FOLDER_REMEDY = "Run rt setup update --force after the fix";
export const DAEMON_STALE_REMEDY = "Run rt daemon restart, then rt setup update --force";
export const orgFolderSeams = { locate: locateMovedRepo, marketplace: convergeMarketplace };
export async function convergeOrgFolder(ctx: ApplyContext): Promise<StepOutcome>;
export const orgFolderStep: StepDef;   // id "org.folder", title "Move your org folder", kind "rt", updateSafe: true, applies: () => true
```

Behaviour of `convergeOrgFolder`:

1. Scan `orgsDirUnder(home)` and `join(home, ".mattstack", "teams")` (this file may name it). For each entry not starting with `.`: `markerOrg` null → `skipped.push(path)` (named in the detail as "not an org clone"). Else `clones.push({ dir, root, folder, org, target: orgDirUnder(home, org) })`.
2. No clones at all → `{ state: "skipped", detail: "No org on this Mac" }` (plus the skipped folders when any).
3. Per clone, when `dir !== target` (folder piece pending):
   - dirty: `ctx.p.exec(["git", "-C", dir, "status", "--porcelain", "--untracked-files=no"])` non-empty stdout → refusal "has uncommitted changes to tracked files. Commit them if they are yours, or discard them with a checkout of the tracked files on a Mac that only pulls, then run the update again".
   - mid-rebase: `.git/rebase-merge` or `.git/rebase-apply` exists → refusal "is in the middle of a rebase".
   - target exists: compare `parseOriginUrl` of both `.git/config`; different → refusal "`<target>` already holds a clone of a different origin"; same → refusal "sits in both <dir> and <target>. Move the old copy aside".
   - a second clone in this run already claimed `target` → refusal "a second clone of the <org> org".
   - Otherwise: daemon present (`ctx.p.exists(join(home, ".mattstack", "rt", "rt.sock"))`) → `ctx.p.daemon("org:move", { from: dir, to: target }, ORG_MOVE_TIMEOUT_MS)`: `null` → failed "The rt daemon is running but did not answer" with `DAEMON_STALE_REMEDY`; `code === "unknown-command"` → failed "The running rt daemon does not know how to move an org folder" with `DAEMON_STALE_REMEDY`; `!ok` → failed with `res.failure?.message ?? res.error`; ok → the `OrgMoveResult`. No daemon → `runOrgMove(ctx.p, { from: dir, to: target, locate })` with `locate = async (newPath) => { const o = await orgFolderSeams.locate({ newPath }); return o.ok ? { ok: true, moved: !o.dryRun } : { ok: false, error: o.error }; }`.
4. Per clone, when `dir === target`: the records and index pieces still run: `locate(dir)` through the same `locate` closure, classified with `classifyLocate`; a failure is a failed outcome naming the folder.
5. After every clone: `sweepOrphanOrgRecords(ctx.p, presentFolders, keep)` where `presentFolders` is every folder name seen under either root at scan time plus every `org` moved to, and `keep` is every clone's `org`.
6. Marketplace piece per clone that is now at its target (moved this run or already there): `orgFolderSeams.marketplace(ctx, { dir: target, stalePaths: movedThisRun ? [dir] : [] })`.
7. Combine: any refusal or failed → `failed` (detail: every clone's line joined with "; ", remedy `ORG_FOLDER_REMEDY`, or `DAEMON_STALE_REMEDY` when that was the cause); else any marketplace `partial` → `partial` (remedy: `Run ${commands.join(", then ")}`); else `done` with a detail naming what moved ("Moved acme to ~/.mattstack/orgs/acme", "acme already in place", skipped folders, removed records).
8. `ctx.reloadTeam?.()` after any move.

- [ ] **Step 1: Write the failing tests**

`lib/setup/__tests__/steps-org-folder.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import type { ApplyContext } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { convergeOrgFolder, DAEMON_STALE_REMEDY, ORG_FOLDER_REMEDY, orgFolderSeams, orgFolderStep } from "../steps/org-folder.ts";
import { fakeProbes as baseFakeProbes, ok } from "./fakes.ts";

const HOME = "/h";
const ORGS = `${HOME}/.mattstack/orgs`;
const TEAMS = `${HOME}/.mattstack/teams`;
const RT = `${HOME}/.mattstack/rt`;
const marker = (org: string, role: "org" | "team" = "org") => JSON.stringify({ role, org });
const gitConfig = (url = "https://gitlab.example.com/acme/org.git") => `[remote "origin"]\n\turl = ${url}\n`;

function clone(root: string, folder: string, org: string, opts: { url?: string; role?: "org" | "team" } = {}): Record<string, string> {
  return {
    [`${root}/${folder}/mattstack/mattstack.jsonc`]: marker(org, opts.role),
    [`${root}/${folder}/.git/config`]: gitConfig(opts.url),
  };
}

function fakeProbes(opts: Parameters<typeof baseFakeProbes>[0] & { dirty?: string[] } = {}) {
  return baseFakeProbes({
    home: HOME,
    ...opts,
    dirs: { [ORGS]: [], [TEAMS]: [], [`${RT}/teams`]: [], [`${RT}/invites`]: [], ...opts.dirs },
    exec: (argv, o) => {
      if (argv[0] === "git" && argv[3] === "status") return ok(opts.dirty?.includes(argv[2]!) ? " M mattstack/org/settings.org.jsonc\n" : "");
      return opts.exec?.(argv, o) ?? ok("");
    },
  });
}

function makeCtx(p: Probes, overrides: Partial<ApplyContext> = {}): { ctx: ApplyContext; logs: string[] } {
  const logs: string[] = [];
  const ctx = { p, emit: () => {}, log: (_id: string, line: string) => { logs.push(line); }, intent: null, team: { slug: "", name: "", mode: "none" }, snapshot: null, reqs: [], nonInteractive: true, teamOfOne: false, appPath: null, ci: false, secrets: {} as never, teamSecrets: () => ({}) as never, relay: {} as never, secretPresence: { has: async () => null }, redact: () => {}, need: async () => "no-app", ...overrides } as ApplyContext;
  return { ctx, logs };
}

const origSeams = { ...orgFolderSeams };
afterEach(() => Object.assign(orgFolderSeams, origSeams));

function seams(opts: { locate?: (newPath: string) => Promise<{ ok: boolean; error?: string }>; marketplace?: typeof orgFolderSeams.marketplace } = {}) {
  const located: string[] = [];
  const marketplaces: { dir: string; stalePaths: string[] }[] = [];
  orgFolderSeams.locate = (async (req: { newPath: string }) => {
    located.push(req.newPath);
    const r = await (opts.locate ?? (async () => ({ ok: true })))(req.newPath);
    return r.ok ? { via: "local", ok: true, dryRun: false, result: {} as never } : { via: "local", ok: false, error: r.error ?? "locate failed" };
  }) as typeof orgFolderSeams.locate;
  orgFolderSeams.marketplace = opts.marketplace ?? (async (_ctx, c) => { marketplaces.push(c); return { state: "done", detail: "acme already points at the clone" }; });
  return { located, marketplaces };
}

describe("org.folder: the step", () => {
  test("is update-safe, applies always and is rt-kind", () => {
    expect(orgFolderStep).toMatchObject({ id: "org.folder", kind: "rt", updateSafe: true });
    expect(orgFolderStep.applies({} as ApplyContext)).toBe(true);
  });

  test("skipped with no org and names a stray folder", async () => {
    seams();
    const p = fakeProbes({ dirs: { [TEAMS]: ["notes"] }, files: { [`${TEAMS}/notes/readme.md`]: "x" } });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("skipped");
    expect(out.detail).toContain("No org on this Mac");
    expect(out.detail).toContain(`${TEAMS}/notes`);
  });

  test("a clean move from teams/ without a daemon: records, folder, index, marketplace, in order", async () => {
    const s = seams();
    const p = fakeProbes({ dirs: { [TEAMS]: ["acme"] }, files: { ...clone(TEAMS, "acme", "acme"), [`${RT}/teams/acme.json`]: '{"forgeUsername":"dev1"}' } });
    let reloaded = 0;
    const out = await convergeOrgFolder(makeCtx(p, { reloadTeam: () => { reloaded += 1; } }).ctx);
    expect(out).toMatchObject({ state: "done" });
    expect(out.detail).toContain(`Moved acme to ${ORGS}/acme`);
    expect(p.calls.renames).toContainEqual([`${TEAMS}/acme`, `${ORGS}/acme`]);
    expect(s.located).toEqual([`${ORGS}/acme`]);
    expect(s.marketplaces).toEqual([{ dir: `${ORGS}/acme`, stalePaths: [`${TEAMS}/acme`] }]);
    expect(p.exists(`${RT}/teams/acme.json`)).toBe(true);
    expect(reloaded).toBe(1);
  });

  test("a rename inside orgs/ copies the record to the new name and removes the old one", async () => {
    seams();
    const p = fakeProbes({ dirs: { [ORGS]: ["widgets"] }, files: { ...clone(ORGS, "widgets", "acme"), [`${RT}/teams/widgets.json`]: '{"forgeUsername":"dev1"}', [`${RT}/invites/widgets.json`]: "{}" } });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(p.calls.renames).toContainEqual([`${ORGS}/widgets`, `${ORGS}/acme`]);
    expect(p.readFile(`${RT}/teams/acme.json`)).toBe('{"forgeUsername":"dev1"}');
    expect(p.readFile(`${RT}/invites/acme.json`)).toBe("{}");
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(false);
    expect(p.exists(`${RT}/invites/widgets.json`)).toBe(false);
  });

  test("a member's clone still on the one-team layout moves the same way", async () => {
    seams();
    const p = fakeProbes({ dirs: { [TEAMS]: ["acme"] }, files: clone(TEAMS, "acme", "acme", { role: "team" }) });
    expect((await convergeOrgFolder(makeCtx(p).ctx)).state).toBe("done");
    expect(p.calls.renames).toContainEqual([`${TEAMS}/acme`, `${ORGS}/acme`]);
  });

  test("every piece already matching is done with no work", async () => {
    const s = seams({ locate: async () => ({ ok: false, error: "nothing-lost: the row already carries this path" }) });
    const p = fakeProbes({ dirs: { [ORGS]: ["acme"] }, files: clone(ORGS, "acme", "acme") });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(out.detail).toContain("acme already in place");
    expect(p.calls.renames).toEqual([]);
    expect(s.located).toEqual([`${ORGS}/acme`]);
    expect(s.marketplaces).toEqual([{ dir: `${ORGS}/acme`, stalePaths: [] }]);
  });

  test("a folder in place with a stale index row runs only the index piece, and an index failure is failed", async () => {
    seams({ locate: async () => ({ ok: false, error: "identity-mismatch: another repo" }) });
    const p = fakeProbes({ dirs: { [ORGS]: ["acme"] }, files: clone(ORGS, "acme", "acme") });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "failed", remedy: ORG_FOLDER_REMEDY });
    expect(out.detail).toContain("identity-mismatch");
    expect(p.calls.renames).toEqual([]);
  });

  test("an orphan record is removed and named", async () => {
    seams();
    const p = fakeProbes({ dirs: { [ORGS]: ["acme"], [`${RT}/teams`]: ["acme.json", "widgets.json"] }, files: { ...clone(ORGS, "acme", "acme"), [`${RT}/teams/acme.json`]: "{}", [`${RT}/teams/widgets.json`]: "{}" } });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(out.detail).toContain(`${RT}/teams/widgets.json`);
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(false);
    expect(p.exists(`${RT}/teams/acme.json`)).toBe(true);
  });

  test("an unmarked or malformed folder is skipped and named", async () => {
    seams();
    const p = fakeProbes({ dirs: { [ORGS]: ["acme", "broken"] }, files: { ...clone(ORGS, "acme", "acme"), [`${ORGS}/broken/mattstack/mattstack.jsonc`]: "{ nope", [`${ORGS}/broken/.git/config`]: gitConfig() } });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(out.detail).toContain(`${ORGS}/broken`);
    expect(out.detail).toContain("not an org clone");
  });

  test("a dirty clone is refused with the commit-or-discard wording and nothing moves", async () => {
    seams();
    const p = fakeProbes({ dirs: { [TEAMS]: ["acme"] }, files: clone(TEAMS, "acme", "acme"), dirty: [`${TEAMS}/acme`] });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "failed", remedy: ORG_FOLDER_REMEDY });
    expect(out.detail).toContain(`${TEAMS}/acme`);
    expect(out.detail).toContain("uncommitted changes");
    expect(out.detail).toContain("Commit them if they are yours");
    expect(p.calls.renames).toEqual([]);
  });

  test("a clone mid-rebase is refused", async () => {
    seams();
    const p = fakeProbes({ dirs: { [TEAMS]: ["acme"], [`${TEAMS}/acme/.git`]: ["config", "rebase-merge"] }, files: { ...clone(TEAMS, "acme", "acme"), [`${TEAMS}/acme/.git/rebase-merge/head-name`]: "x" } });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("failed");
    expect(out.detail).toContain("rebase");
  });

  test("a target that exists with a different origin is refused; the same origin in both roots too", async () => {
    seams();
    const other = fakeProbes({ dirs: { [TEAMS]: ["acme"], [ORGS]: ["acme"] }, files: { ...clone(TEAMS, "acme", "acme"), ...clone(ORGS, "acme", "acme", { url: "https://gitlab.example.com/widgets/org.git" }) } });
    const out1 = await convergeOrgFolder(makeCtx(other).ctx);
    expect(out1.state).toBe("failed");
    expect(out1.detail).toContain("different origin");
    const same = fakeProbes({ dirs: { [TEAMS]: ["acme"], [ORGS]: ["acme"] }, files: { ...clone(TEAMS, "acme", "acme"), ...clone(ORGS, "acme", "acme") } });
    const out2 = await convergeOrgFolder(makeCtx(same).ctx);
    expect(out2.state).toBe("failed");
    expect(out2.detail).toContain("Move the old copy aside");
    expect(same.calls.renames).toEqual([]);
  });

  test("a second clone with the same org is refused", async () => {
    seams();
    const p = fakeProbes({ dirs: { [TEAMS]: ["acme", "acme-copy"] }, files: { ...clone(TEAMS, "acme", "acme"), ...clone(TEAMS, "acme-copy", "acme") } });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("failed");
    expect(out.detail).toContain("acme-copy");
    expect(p.calls.renames.length).toBe(1);
  });

  test("with a daemon present the move goes through org:move and the step renames nothing itself", async () => {
    const s = seams();
    const sent: { cmd: string; payload: unknown }[] = [];
    const p = fakeProbes({
      dirs: { [TEAMS]: ["acme"], [RT]: ["rt.sock"] },
      files: { ...clone(TEAMS, "acme", "acme"), [`${RT}/rt.sock`]: "" },
      daemon: async (cmd, payload) => {
        sent.push({ cmd, payload });
        return { ok: true, data: { ok: true, from: `${TEAMS}/acme`, to: `${ORGS}/acme`, records: { teams: "none", invites: "none" }, folderMoved: true, index: "already", removed: [] } };
      },
    });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(sent).toEqual([{ cmd: "org:move", payload: { from: `${TEAMS}/acme`, to: `${ORGS}/acme` } }]);
    expect(p.calls.renames).toEqual([]);
    expect(s.located).toEqual([]);
    expect(s.marketplaces).toEqual([{ dir: `${ORGS}/acme`, stalePaths: [`${TEAMS}/acme`] }]);
  });

  test("a daemon that does not know org:move fails with the restart remedy, and so does one that does not answer", async () => {
    seams();
    const stale = fakeProbes({ dirs: { [TEAMS]: ["acme"], [RT]: ["rt.sock"] }, files: { ...clone(TEAMS, "acme", "acme"), [`${RT}/rt.sock`]: "" }, daemon: async () => ({ ok: false, code: "unknown-command", version: "2.0.0", error: 'daemon at version 2.0.0 does not know "org:move"' }) as never });
    const out = await convergeOrgFolder(makeCtx(stale).ctx);
    expect(out).toMatchObject({ state: "failed", remedy: DAEMON_STALE_REMEDY });
    expect(stale.calls.renames).toEqual([]);
    const silent = fakeProbes({ dirs: { [TEAMS]: ["acme"], [RT]: ["rt.sock"] }, files: { ...clone(TEAMS, "acme", "acme"), [`${RT}/rt.sock`]: "" }, daemon: async () => null });
    expect(await convergeOrgFolder(makeCtx(silent).ctx)).toMatchObject({ state: "failed", remedy: DAEMON_STALE_REMEDY });
    expect(silent.calls.renames).toEqual([]);
  });

  test("a daemon refusal is failed with the daemon's message", async () => {
    seams();
    const p = fakeProbes({ dirs: { [TEAMS]: ["acme"], [RT]: ["rt.sock"] }, files: { ...clone(TEAMS, "acme", "acme"), [`${RT}/rt.sock`]: "" }, daemon: async () => ({ ok: false, error: "move-failed: index: identity-mismatch: another repo", failure: { code: "move-failed", message: "index: identity-mismatch: another repo" } }) as never });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "failed", remedy: ORG_FOLDER_REMEDY });
    expect(out.detail).toContain("identity-mismatch");
  });

  test("the marketplace piece failing ends partial with the commands as the remedy", async () => {
    seams({ marketplace: async () => ({ state: "partial", detail: "claude is missing", commands: ["claude plugin marketplace remove acme", `claude plugin marketplace add ${ORGS}/acme`] }) });
    const p = fakeProbes({ dirs: { [TEAMS]: ["acme"] }, files: clone(TEAMS, "acme", "acme") });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out).toMatchObject({ state: "partial", remedy: `Run claude plugin marketplace remove acme, then claude plugin marketplace add ${ORGS}/acme` });
    expect(p.calls.renames).toContainEqual([`${TEAMS}/acme`, `${ORGS}/acme`]);
  });

  test("a rerun after an interruption between the move and the index piece finishes the rest", async () => {
    const s = seams();
    const p = fakeProbes({ dirs: { [ORGS]: ["acme"], [`${RT}/teams`]: ["widgets.json", "acme.json"] }, files: { ...clone(ORGS, "acme", "acme"), [`${RT}/teams/widgets.json`]: "{}", [`${RT}/teams/acme.json`]: "{}" } });
    const out = await convergeOrgFolder(makeCtx(p).ctx);
    expect(out.state).toBe("done");
    expect(s.located).toEqual([`${ORGS}/acme`]);
    expect(p.exists(`${RT}/teams/widgets.json`)).toBe(false);
    expect(s.marketplaces).toEqual([{ dir: `${ORGS}/acme`, stalePaths: [] }]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/steps-org-folder.test.ts`
Expected: FAIL, cannot resolve `../steps/org-folder.ts`.

- [ ] **Step 3: Write the step**

`lib/setup/steps/org-folder.ts`:

```ts
/**
 * The org clone's folder follows the org's name (the marker's `org`). This
 * step runs on every update and every full apply: it checks each piece
 * (records, folder, repo index, Claude marketplace) against the clone as it
 * stands and does only what is off, so a run that stopped halfway finishes at
 * the next one. The folder piece runs in the daemon (`org:move`) when one is
 * up, because the daemon owns the registry the move rewrites; it never
 * renames beside a daemon that cannot do it.
 */

import { join } from "path";
import { orgDirUnder, orgsDirUnder } from "../../rt-paths.ts";
import { locateMovedRepo } from "../../repo-locate-dispatch.ts";
import { classifyLocate, runOrgMove, sweepOrphanOrgRecords, type LocateFn, type OrgMoveResult } from "../../team/org-folder-move.ts";
import { markerOrg } from "../../team/org-marker.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { parseOriginUrl } from "../team-settings.ts";
import { convergeMarketplace } from "./org-folder-marketplace.ts";
import { toFailedOutcome } from "./step-utils.ts";

export const ORG_MOVE_TIMEOUT_MS = 120_000;
export const ORG_FOLDER_REMEDY = "Run rt setup update --force after the fix";
export const DAEMON_STALE_REMEDY = "Run rt daemon restart, then rt setup update --force";

/** Replaceable in tests: the repo relocation and the marketplace piece both reach outside the Probes seam. */
export const orgFolderSeams = { locate: locateMovedRepo, marketplace: convergeMarketplace };

interface Clone {
  dir: string;
  folder: string;
  org: string;
  target: string;
}

interface MoveReply {
  ok: boolean;
  code?: string;
  data?: OrgMoveResult;
  error?: string;
  failure?: { code: string; message: string };
}

function scan(p: Probes): { clones: Clone[]; strays: string[]; folders: Set<string> } {
  const clones: Clone[] = [];
  const strays: string[] = [];
  const folders = new Set<string>();
  for (const root of [orgsDirUnder(p.home), join(p.home, ".mattstack", "teams")]) {
    for (const folder of p.readDir(root).sort()) {
      // A dotfile the Finder leaves (.DS_Store) is not a folder anyone leaked.
      if (folder.startsWith(".")) continue;
      const dir = join(root, folder);
      folders.add(folder);
      const org = markerOrg(p, dir);
      if (org === null) {
        strays.push(dir);
        continue;
      }
      clones.push({ dir, folder, org, target: orgDirUnder(p.home, org) });
    }
  }
  return { clones, strays, folders };
}

function originOf(p: Probes, dir: string): string | null {
  const raw = p.readFile(join(dir, ".git", "config"));
  return raw === null ? null : parseOriginUrl(raw);
}

async function refusal(p: Probes, clone: Clone, claimed: Set<string>): Promise<string | null> {
  if (claimed.has(clone.target)) return `${clone.dir} is a second clone of the ${clone.org} org, so it stayed where it is`;
  const status = await p.exec(["git", "-C", clone.dir, "status", "--porcelain", "--untracked-files=no"]);
  if (status.code === 0 && status.stdout.trim() !== "") {
    return `${clone.dir} has uncommitted changes to tracked files. Commit them if they are yours, or discard them with a checkout of the tracked files on a Mac that only pulls, then run the update again`;
  }
  if (p.exists(join(clone.dir, ".git", "rebase-merge")) || p.exists(join(clone.dir, ".git", "rebase-apply"))) {
    return `${clone.dir} is in the middle of a rebase. Finish or abort it, then run the update again`;
  }
  if (p.exists(clone.target)) {
    const same = originOf(p, clone.dir) !== null && originOf(p, clone.dir) === originOf(p, clone.target);
    return same
      ? `the ${clone.org} org sits in both ${clone.dir} and ${clone.target}. Move the old copy aside`
      : `${clone.target} already holds a clone of a different origin, so ${clone.dir} stayed where it is`;
  }
  return null;
}

const locate: LocateFn = async (newPath) => {
  const outcome = await orgFolderSeams.locate({ newPath });
  return outcome.ok ? { ok: true, moved: !outcome.dryRun } : { ok: false, error: outcome.error };
};

async function moveViaDaemon(p: Probes, clone: Clone): Promise<{ result: OrgMoveResult } | { failed: string; remedy: string }> {
  const res = (await p.daemon("org:move", { from: clone.dir, to: clone.target }, ORG_MOVE_TIMEOUT_MS)) as MoveReply | null;
  if (res === null) return { failed: `The rt daemon is running but did not answer, so ${clone.dir} stayed where it is`, remedy: DAEMON_STALE_REMEDY };
  if (!res.ok && res.code === "unknown-command") return { failed: `The running rt daemon does not know how to move an org folder, so ${clone.dir} stayed where it is`, remedy: DAEMON_STALE_REMEDY };
  if (!res.ok || !res.data) return { failed: `${clone.dir} was not moved: ${res.failure?.message ?? res.error ?? "the daemon gave no reason"}`, remedy: ORG_FOLDER_REMEDY };
  return { result: res.data };
}

export async function convergeOrgFolder(ctx: ApplyContext): Promise<StepOutcome> {
  const p = ctx.p;
  const { clones, strays, folders } = scan(p);
  const strayNote = strays.length ? `not an org clone, left alone: ${strays.join(", ")}` : null;
  if (clones.length === 0) return { state: "skipped", detail: ["No org on this Mac", strayNote].filter(Boolean).join("; ") };

  const notes: string[] = [];
  const failures: { detail: string; remedy: string }[] = [];
  const partials: string[][] = [];
  const claimed = new Set<string>();
  const keep = new Set(clones.map((c) => c.org));
  let moved = false;
  const daemonUp = p.exists(join(p.home, ".mattstack", "rt", "rt.sock"));

  for (const clone of clones) {
    let movedNow = false;
    if (clone.dir !== clone.target) {
      const why = await refusal(p, clone, claimed);
      if (why !== null) {
        failures.push({ detail: why, remedy: ORG_FOLDER_REMEDY });
        continue;
      }
      claimed.add(clone.target);
      const outcome = daemonUp ? await moveViaDaemon(p, clone) : { result: await runOrgMove(p, { from: clone.dir, to: clone.target, locate }) };
      if ("failed" in outcome) {
        failures.push({ detail: outcome.failed, remedy: outcome.remedy });
        continue;
      }
      if (!outcome.result.ok) {
        failures.push({ detail: `${clone.dir} was not moved (${outcome.result.stage}): ${outcome.result.error}`, remedy: ORG_FOLDER_REMEDY });
        continue;
      }
      movedNow = moved = true;
      folders.add(clone.org);
      notes.push(`Moved ${clone.org} to ${clone.target}`);
      if (outcome.result.removed.length) notes.push(`removed ${outcome.result.removed.join(", ")}`);
    } else {
      claimed.add(clone.target);
      const located = await locate(clone.dir);
      if (!located.ok && classifyLocate(located.error) === "failed") {
        failures.push({ detail: `${clone.dir} is in place but its repo index row was not updated: ${located.error}`, remedy: ORG_FOLDER_REMEDY });
        continue;
      }
      notes.push(`${clone.org} already in place`);
    }
    const market = await orgFolderSeams.marketplace(ctx, { dir: clone.target, stalePaths: movedNow ? [clone.dir] : [] });
    ctx.log("org.folder", `${clone.org}: marketplace ${market.state}: ${market.detail}`);
    if (market.state === "partial") partials.push(market.commands ?? []);
  }

  const swept = sweepOrphanOrgRecords(p, folders, keep);
  if (swept.length) notes.push(`removed ${swept.join(", ")}`);
  if (strayNote) notes.push(strayNote);
  if (moved) ctx.reloadTeam?.();

  if (failures.length) {
    const remedy = failures.some((f) => f.remedy === DAEMON_STALE_REMEDY) ? DAEMON_STALE_REMEDY : ORG_FOLDER_REMEDY;
    return { state: "failed", detail: [...failures.map((f) => f.detail), ...notes].join("; "), remedy };
  }
  if (partials.length) {
    const commands = partials.flat();
    return { state: "partial", detail: [...notes, "the Claude marketplace still points at the old folder"].join("; "), remedy: `Run ${commands.join(", then ")}` };
  }
  return { state: "done", detail: notes.join("; ") };
}

export const orgFolderStep: StepDef = {
  id: "org.folder",
  title: "Move your org folder",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: async (ctx) => {
    try {
      return await convergeOrgFolder(ctx);
    } catch (err) {
      return toFailedOutcome(err);
    }
  },
};
```

In the daemon-present branch, `locate` is never called for the moved clone: `org:move` relocated it. The fake's `exists` for a directory seeded through `dirs` only: `p.exists(clone.target)` must read true when `dirs[ORGS]` lists it; check `fakes.ts`'s `exists` (it consults `dirs` keys and entries); if it only answers for files and dir keys, seed the test's "target exists" fixtures through `clone(ORGS, ...)`, which puts files under the target, as the tests above already do.

- [ ] **Step 4: Register the step**

`lib/setup/contract.ts`: insert `"org.folder",` directly before `"org.pull",` in `STEP_IDS`.

`lib/setup/steps/index.ts`: `import { orgFolderStep } from "./org-folder.ts";` and insert `orgFolderStep,` directly before `orgPullStep,` in `STEPS`.

`lib/setup/__tests__/update-safe.test.ts`: insert `"org.folder",` as the first entry of `UPDATE_SAFE`.

`commands/__tests__/setup-copy.test.ts`, in "apply emits the org pull and identity titles after a join": change the two assertions to

```ts
    expect(event.steps.slice(at, at + 4).map((step) => step.id)).toEqual(["team.join", "org.folder", "org.pull", "team.identity"]);
    expect(event.steps.slice(at + 1, at + 4).map((step) => ({ id: step.id, title: step.title }))).toMatchSnapshot();
```

and rename the test to "apply emits the org folder, pull and identity titles after a join".

- [ ] **Step 5: Run the tests, update the one snapshot deliberately, read the diff**

Run: `bun test lib/setup/__tests__/steps-org-folder.test.ts lib/setup/__tests__/update-safe.test.ts lib/setup/__tests__/apply.test.ts lib/__tests__/no-legacy-teams-root.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

Run: `bun test --update-snapshots commands/__tests__/setup-copy.test.ts`, then `git diff commands/__tests__/__snapshots__/setup-copy.test.ts.snap`. Only the renamed test's snapshot may change, gaining `{ id: "org.folder", title: "Move your org folder" }` before the two existing entries. Any other snapshot change is a bug: revert and investigate.

Run: `bun test commands/__tests__/setup-copy.test.ts commands/__tests__/setup-update.test.ts` and `bun run typecheck`.
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add lib/setup/steps/org-folder.ts lib/setup/__tests__/steps-org-folder.test.ts lib/setup/contract.ts lib/setup/steps/index.ts lib/setup/__tests__/update-safe.test.ts commands/__tests__/setup-copy.test.ts commands/__tests__/__snapshots__/setup-copy.test.ts.snap
git commit -m "setup: the org.folder step moves every org clone to its marker's name"
```

---

### Task 8: `org.pull` re-runs converge when a pull changed the marker

**Files:**
- Modify: `lib/setup/steps/org.ts`
- Test: `lib/setup/__tests__/steps-org.test.ts`

**Interfaces:**
- Consumes: `markerOrg` (Task 2), `convergeOrgFolder` (Task 7), `orgDirUnder`.
- Produces: `export const orgSeams = { converge: convergeOrgFolder }` in `lib/setup/steps/org.ts`; `orgPullRun` reads each slug's marker org before pulling and again after, and when any differs calls `orgSeams.converge(ctx)` once, folding a failed or partial converge into a `partial` pull outcome whose detail and remedy are the converge's.

- [ ] **Step 1: Write the failing tests**

Add to `lib/setup/__tests__/steps-org.test.ts`, inside `describe("org.pull")`, using that file's `fakeProbes`, `makeCtx`, `HOME`, `CLONE`, `gitConfig` and `TEAMS_DIR` by their existing names; add `import { orgSeams } from "../steps/org.ts";` to the existing import of that module and `afterEach` from `bun:test`:

```ts
  const origConverge = orgSeams.converge;
  afterEach(() => { orgSeams.converge = origConverge; });

  test("re-runs converge when a pull changed the marker's org", async () => {
    let marker = JSON.stringify({ role: "org", org: "acme" });
    const converged: string[] = [];
    orgSeams.converge = async () => { converged.push("ran"); return { state: "done", detail: "Moved widgets to /h/.mattstack/orgs/widgets" }; };
    const p = fakeProbes({
      home: HOME,
      dirs: TEAMS_DIR,
      files: { [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git") },
      daemon: async () => {
        marker = JSON.stringify({ role: "org", org: "widgets" });
        return { ok: true, data: { outcome: "fast-forwarded", detail: null } };
      },
    });
    const read = p.readFile.bind(p);
    p.readFile = (path) => (path === `${CLONE}/mattstack/mattstack.jsonc` ? marker : read(path));
    const out = await orgPullStep.run(makeCtx(p).ctx);
    expect(converged).toEqual(["ran"]);
    expect(out.state).toBe("done");
    expect(out.detail).toContain("Pulled acme");
    expect(out.detail).toContain("Moved widgets");
  });

  test("a pull that kept the marker does not converge, and a failed converge makes the pull partial with its remedy", async () => {
    const converged: string[] = [];
    orgSeams.converge = async () => { converged.push("ran"); return { state: "failed", detail: "dirty", remedy: "Run rt setup update --force after the fix" }; };
    const files = { [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"), [`${CLONE}/mattstack/mattstack.jsonc`]: JSON.stringify({ role: "org", org: "acme" }) };
    const same = await orgPullStep.run(makeCtx(fakeProbes({ home: HOME, dirs: TEAMS_DIR, files, daemon: async () => ({ ok: true, data: { outcome: "fast-forwarded", detail: null } }) })).ctx);
    expect(converged).toEqual([]);
    expect(same.state).toBe("done");

    let marker = JSON.stringify({ role: "org", org: "acme" });
    const p = fakeProbes({ home: HOME, dirs: TEAMS_DIR, files, daemon: async () => { marker = JSON.stringify({ role: "org", org: "widgets" }); return { ok: true, data: { outcome: "fast-forwarded", detail: null } }; } });
    const read = p.readFile.bind(p);
    p.readFile = (path) => (path === `${CLONE}/mattstack/mattstack.jsonc` ? marker : read(path));
    const out = await orgPullStep.run(makeCtx(p).ctx);
    expect(converged).toEqual(["ran"]);
    expect(out).toMatchObject({ state: "partial", remedy: "Run rt setup update --force after the fix" });
    expect(out.detail).toContain("dirty");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/steps-org.test.ts -t "converge"`
Expected: FAIL, `orgSeams` is not exported.

- [ ] **Step 3: Implement**

In `lib/setup/steps/org.ts` add the imports `import { markerOrg } from "../../team/org-marker.ts";` and `import { convergeOrgFolder } from "./org-folder.ts";`, then `export const orgSeams = { converge: convergeOrgFolder };` above `orgPullRun`. In `orgPullRun`, before the loop: `const before = new Map(slugs.map((slug) => [slug, markerOrg(ctx.p, orgDirUnder(ctx.p.home, slug))]));`. After the loop and before `ctx.reloadTeam?.()`:

```ts
  const renamed = slugs.filter((slug) => markerOrg(ctx.p, orgDirUnder(ctx.p.home, slug)) !== before.get(slug));
  let converge: StepOutcome | null = null;
  if (renamed.length) {
    // A pull that changed the marker's org means this folder no longer matches it; the move runs now rather than at the next update.
    converge = await orgSeams.converge(ctx);
    if (converge.detail) notes.push(converge.detail);
  }
```

and change the final returns to:

```ts
  ctx.reloadTeam?.();
  if (converge && (converge.state === "failed" || converge.state === "partial")) {
    return { state: "partial", detail: [...notes, ...skips, ...stuck].join("; "), ...(converge.remedy !== undefined ? { remedy: converge.remedy } : {}) };
  }
  if (stuck.length) return { state: "partial", detail: [...notes, ...skips, ...stuck].join("; "), remedy: "Run rt team status to see what is in the way" };
  if (skips.length) return { state: "skipped", detail: [...notes, ...skips].join("; ") };
  return { state: "done", detail: notes.join("; ") };
```

`org-folder.ts` must not import from `org.ts` (it does not), so there is no cycle.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/setup/__tests__/steps-org.test.ts lib/setup/__tests__/steps-org-folder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/steps/org.ts lib/setup/__tests__/steps-org.test.ts
git commit -m "setup: org.pull moves the folder when a pull renamed the org"
```

---

### Task 9: An end-to-end `org:move` through a real daemon

**Files:**
- Create: `e2e/tests/org-folder.test.ts`

**Interfaces:**
- Consumes: `createTestHome`, `RT_BINARY` from `e2e/harness.ts`; the daemon's unix socket protocol (`fetch("http://localhost/<cmd>", { unix, method: "POST", body })`).

- [ ] **Step 1: Write the test**

`e2e/tests/org-folder.test.ts`, after the daemon-spawn pattern of `e2e/tests/events.test.ts` (copy its `waitForSocket`, `freePort` and `runRt` helpers verbatim, including the `children` list and the `afterAll` that kills them):

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestHome, RT_BINARY } from "../harness.ts";

// waitForSocket, freePort, runRt, children: copied from events.test.ts

describe("org:move through the daemon", () => {
  let home: string;
  let cleanup: () => void;
  let sock: string;
  let daemon: ReturnType<typeof Bun.spawn>;

  function clone(root: string, folder: string, org: string): string {
    const dir = join(home, ".mattstack", root, folder);
    mkdirSync(join(dir, "mattstack", "org"), { recursive: true });
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    execSync("git remote add origin https://gitlab.example.com/acme/org.git", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org }));
    writeFileSync(join(dir, "mattstack", "org", "settings.org.jsonc"), "{}\n");
    execSync("git add -A && git -c user.email=dev1@gitlab.example.com -c user.name=dev1 commit -q -m init", { cwd: dir, stdio: "pipe" });
    return dir;
  }

  async function send(cmd: string, payload: unknown): Promise<any> {
    const res = await fetch(`http://localhost/${cmd}`, { unix: sock, method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } });
    return res.json();
  }

  beforeAll(async () => {
    apiPort = freePort();
    ({ path: home, cleanup } = createTestHome());
    mkdirSync(join(home, ".mattstack", "rt", "teams"), { recursive: true });
    writeFileSync(join(home, ".mattstack", "rt", "teams", "widgets.json"), JSON.stringify({ forgeUsername: "dev1" }));
    clone("teams", "widgets", "acme");
    daemon = runRt(["--daemon"], home);
    sock = join(home, ".mattstack", "rt", "rt.sock");
    await waitForSocket(sock);
  });

  afterAll(async () => {
    for (const child of children) { try { child.kill(); } catch { /* already gone */ } }
    await Promise.all(children.map((c) => c.exited));
    cleanup();
  });

  test("moves a legacy clone, carries its record and the snapshot engine follows", async () => {
    const from = join(home, ".mattstack", "teams", "widgets");
    const to = join(home, ".mattstack", "orgs", "acme");
    const res = await send("org:move", { from, to });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ ok: true, folderMoved: true, records: { teams: "copied", invites: "none" } });
    expect(existsSync(to)).toBe(true);
    expect(existsSync(from)).toBe(false);
    expect(JSON.parse(readFileSync(join(home, ".mattstack", "rt", "teams", "acme.json"), "utf8"))).toEqual({ forgeUsername: "dev1" });
    expect(existsSync(join(home, ".mattstack", "rt", "teams", "widgets.json"))).toBe(false);

    const status = await send("team:snapshot-status", {});
    expect(status.ok).toBe(true);
    expect(status.data.map((e: { slug: string }) => e.slug)).toEqual(["acme"]);
    expect(status.data[0].repoDir).toBe(to);
  });

  test("a second move of the same clone is refused because the source is gone", async () => {
    const res = await send("org:move", { from: join(home, ".mattstack", "teams", "widgets"), to: join(home, ".mattstack", "orgs", "acme") });
    expect(res).toMatchObject({ ok: false, failure: { code: "from-missing" } });
  });
});
```

If the daemon's socket handler reads the payload only from a POST body of a specific content type, match `lib/daemon.ts`'s request parsing (grep `req.json()` or `await req.text()` near `routeCommand`); if `team:snapshot-status` lists nothing because the engine needs `rt.teamSnapshot.enabled` or a pull interval setting, read `lib/daemon/team-snapshots.ts`'s `settings()` defaults and seed the user settings store the way `e2e/tests/org-teams.test.ts` does, rather than weakening the assertion.

- [ ] **Step 2: Run it**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/org-folder.test.ts`
Expected: PASS (the preload builds `dist/rt` when stale; the first run can take a minute).

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/org-folder.test.ts
git commit -m "e2e: org:move moves a legacy clone through a real daemon"
```

---

### Task 10: Whole-branch gates

**Files:**
- Modify: none expected; fix whatever the gates surface within the write fence.

- [ ] **Step 1: Merge the base branch forward and run the gates**

```bash
git merge origin/org-rename --no-edit
bun run typecheck
bun test lib/__tests__ lib/setup/__tests__
bun test lib/team/__tests__ lib/daemon/__tests__/org-move-handler.test.ts lib/daemon/__tests__/team-snapshots.test.ts lib/daemon/__tests__/handlers-team-snapshot.test.ts lib/daemon/__tests__/repos-handlers.test.ts lib/daemon/__tests__/rt-client-commands.test.ts commands/__tests__/setup-copy.test.ts commands/__tests__/setup-update.test.ts
bun run check
```

Expected: every command clean. `bun run check` runs the static gates (`no-*` guards, picker conformance, format); it adds no command-tree node, so `docs:gen` is not needed.

- [ ] **Step 2: Grep the branch for forbidden text**

```bash
git diff main...HEAD --name-only | xargs grep -nE '—|–' || echo "no dashes"
git diff main...HEAD | grep -nE '^\+' | grep -niE 'assured|claimview' || echo "no real names"
```

Expected: "no dashes", "no real names".

- [ ] **Step 3: Commit any fixes**

```bash
git add -A lib commands e2e docs/superpowers/plans
git commit -m "orgs: whole-branch gate fixes"
```

(Skip when nothing changed.)

---

## Self-review

- **Spec coverage.** Section 3 items: skip unmarked (Task 7 scan/strays), derive target with the slug rule (Task 2 `markerOrg` validates; Task 7 `orgDirUnder`), refuse dirty/rebase/target-exists (Task 7 `refusal`), hold the daemon with a per-clone pause and the copy-move-relocate-remove order (Tasks 4, 5, 3), no-daemon path same order (Task 7 local branch), unknown verb → failed with the restart remedy (Task 7), copy records under the record lock (Task 3 with Task 2's export), move folder and remove old records after relocation (Task 3 `runOrgMove`), orphan sweep on later runs (Task 3 `sweepOrphanOrgRecords`, Task 7), repo index via direct plan/apply in the daemon and `locateMovedRepo` outside (Tasks 5, 7), `nothing-lost` as done and mismatch/old-path as failures (Task 3 `classifyLocate`), marketplace remove/add/reinstall with enabled state and setup-state rewrite (Task 6), secrets untouched (nothing moves them), outcomes done/failed/partial (Task 7), step placement before `org.pull` and `org.pull` re-run (Tasks 7, 8), the Claude CLI verification first (Task 1). Section 10 converge lines: clean move, rename inside orgs/, no work, stale index, unmarked skipped, dirty refused, rerun after interruption, nothing-lost, claude absent partial, daemon without the verb, one-team layout, org.pull re-run (Tasks 6, 7, 8); real-git `org:move` under the hold (Tasks 5, 9). Shepherd's notes: `mkdirp` of `orgs/` before the move (Task 3), the re-armed watch (Task 4), the one-team layout under `orgs/` in the row and the step (Tasks 2, 7).
- **Placeholders.** Task 6's listing names two artefacts (`command: ""`, the empty spread) to delete before committing; every other step carries its code. Task 1's Findings block is filled by Task 1 itself.
- **Type consistency.** `markerOrg(p, dir)`; `withRecordLock(p, slug, fn)`; `RecordCopies`, `LocateFn`, `OrgMoveResult`, `MoveProbes`, `runOrgMove(p, { from, to, locate })`, `sweepOrphanOrgRecords(p, presentFolders, keep)`, `classifyLocate(error)`; `pause(slugs)`, `resume(slugs)`; `createOrgHandlers({ withReconcilerHeld, refreshWatchedRepos, emitEvent, teamSnapshots, probes? })`; `convergeMarketplace(ctx, { dir, stalePaths })` returning `MarketplaceOutcome`; `orgFolderSeams`, `convergeOrgFolder(ctx)`, `orgFolderStep`; `orgSeams.converge`.
- **Review Focus.** 1 is Task 7's "a second clone with the same org is refused" and "a target that exists ... same origin"; 2 is Task 7's "an unmarked or malformed folder is skipped and named"; 3 is Task 5's refusal tests; 4 is Task 6's "a disabled plugin is reinstalled, then disabled again"; 5 is Task 3's "the sweep leaves the current clone's record alone" and Task 7's "an orphan record is removed and named".
