# Skill blocks, plan 5 of 5: the upgrade path for existing users

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mac that is already set up moves to block engines without silent breakage: a hand-written overrides file in the old form is flagged with what to change, an older app holds its org pull instead of choking on converted packs, and the release notes tell every kind of user what to do.

**Architecture:** Three changes, each behind an existing mechanism. A non-required setup verify row (the `skills.writing-style` row is the model) reads `~/.mattstack/user/skills/overrides.jsonc` and turns needs-you on old slot keys. An `ORG_LAYOUT` bump to 5, with a conversion script in the shape of the layout 3 and 4 scripts, marks an org whose packs are converted, so every app that cannot read block packs holds its pull at the last layout-4 commit (`lib/team/org-layout.ts` already holds a pull whose fetched marker is above `ORG_LAYOUT`). Release notes and the skill-packs docs carry the rest.

**Tech Stack:** Bun, TypeScript, `bun:test`, the setup row contract (`lib/setup/contract.ts`), the org marker (`lib/team/org-marker.ts`), the conversion helpers in `scripts/lib/`.

**Spec:** `docs/superpowers/specs/2026-10-22-skill-blocks-design.md` (block engines, props, the refusal of old slot bindings). The upgrade rulings below are Matt's (2026-10-23), from an audit of this branch against rt:release's "what set-up Macs miss" check; they are the authority for this plan.

| Gap | What a set-up Mac gets without this plan | Matt's ruling |
|---|---|---|
| G1 | A hand-written `overrides.jsonc` with old slot keys makes every `rt skills compile`, `check`, `sync` and bind fail, with an error that says "the repo override" | a setup verify row listing each old key and its successor, and the error names the file |
| G2 | An older app pulls converted pack fragments through the org clone; its merge code throws on block-keyed bindings and that pack's materialize fails on every pull | bump `ORG_LAYOUT` so older apps hold their org pull until they update |
| G3 | Between the release and the converted packs landing, check and sync on the packs refuse; installed verbs keep working | converted packs carry `pack/requires.json` minEngine (compile writes it; checked during the pack conversion, outside this repo) and a notes line for the window |
| G4 | A pack author outside the org breaks on update, even on an untouched `rt skills init` scaffold | a release note with the old-to-new mapping table |

## Global Constraints

- Public repo: never name a real org, team or pack. Tests and fixtures use invented names (acme, widgets, gadgets). `bun run purity` before every commit.
- `ORG_LAYOUT` moves only with a change to the org repo's shape an older app would misread; this plan's change is exactly that. `ORG_LAYOUT_ABSENT_DEFAULT` never moves. A migration never writes the org or team stores (`no-shared-store-migrations`).
- Setup rows follow `.claude/rules/setup.md`: a verify row reads, never writes. `required` blocks Install and `finishGated` blocks Finish, independently; this plan's row sets `required: false` and no `finishGated`, so it blocks neither.
- Everything a person reads goes through the output layer (`.claude/rules/output-layer.md`); copy is plain short sentences.
- The mapping table, verbatim (old key and slot → new key and prop, contract):

  | Old key and slot | New key and prop | Contract |
  |---|---|---|
  | `mattstack:work` tiering | `mattstack:work/sub-agent-tiering` tiering | model-tiering@1 |
  | `mattstack:watch-ci`, `mattstack:stage-watch-ci` forge | `<engine>/forge` forge | ci-forge@1 |
  | `mattstack:review`, `mattstack:self-review`, `mattstack:receive-review` criteria | `<engine>/criteria` criteria | review-criteria@1 |
  | the same three engines, reviewer | `<engine>/reviewer` reviewer | reviewer-dispatch@1 |
  | `mattstack:receive-review` reply-rules | `mattstack:receive-review/reply-rules` reply-rules | reply-rules@1 |
  | `mattstack:shepherdr` tiering, strategy, accounts | unchanged: the root block still declares them | same |
  | any engine's `domain` | a person decides: `<engine>/domain-rules` rules, or a step's own `rules` prop; `rules` adds to lower layers where `domain` replaced them | none |

  Before writing it into code or docs, confirm each row against the engines' `replaced-slots` frontmatter and the blocks' `props:` in `plugins/mattstack/attachments/` (one row wrong is a wrong instruction to every user). In code, this table is the source of truth for old slot keys (`lib/skills/old-slots.ts`, Task 1): it works on a Mac whose installed plugin has not updated yet, and a test keeps it in step with the engines.

## Review Focus

1. `overrides.jsonc` absent, empty, or not valid JSONC: absent is `skipped`, empty is `ready`, unparseable is `needs-you` saying it cannot read the file; never `error`, never a throw. (Task 1.)
2. An overrides file holding both old and new keys, at the top level or inside a pipeline object's `bindings`: needs-you lists only the old ones, each with its successor; a file holding only new keys is `ready`. (Task 1.)
3. The conversion script on a clone with uncommitted changes, unpublished commits, or team sync on: refuses with the command to fix it, writes nothing. (Task 2.)
4. The conversion script on an org where any pack still has an old slot binding, top level or in a pipeline object: refuses naming the pack and the key, writes nothing. (Task 2.)
5. An org on layout 3 (no data branch): the script refuses and says to move to layout 4 first. (Task 2.)

---

## File structure

| File | Responsibility |
|---|---|
| `lib/setup/validators/skills-overrides.ts` (new) | the `skills.overrides` verify row: read the file, find old slot keys, build the row |
| `lib/skills/old-slots.ts` (new) | the mapping table as data, and `findOldSlotKeys`: which keys in a fragment are old slot keys and each one's successor; shared by the row (Task 1) and the conversion script (Task 2). The compile refusal keeps its own engine-based check. |
| `lib/skills/compile-blocks.ts` | `layerWords("override")` names the overrides file |
| `lib/team/org-marker.ts` | `ORG_LAYOUT = 5`, `READABLE_LAYOUTS = [3, 4, 5]` |
| `scripts/move-to-block-packs.ts` (new), `scripts/lib/block-packs-move.ts` (new) | the layout 5 conversion: plan, refuse, `--write` |
| `RELEASE_NOTES.md`, `website/docs/skills/packs.mdx` (or the page the skill-packs docs live on), `website/docs/start/teams.mdx`, `.claude/rules/settings.md`, `docs/settings-architecture.md` | notes, docs, the layout list |

---

### Task 1: Flag an old-form overrides file

**Files:**
- Create: `lib/skills/old-slots.ts`, `lib/setup/validators/skills-overrides.ts`
- Modify: the place the `skills.writing-style` row is registered (`writingStyleRowFor`'s caller, `lib/setup/validators/tools.ts:809` today) to add this row beside it; `lib/skills/compile-blocks.ts:181-187` (`layerWords`)
- Test: `lib/skills/__tests__/old-slots.test.ts`, `lib/setup/__tests__/validators-skills-overrides.test.ts`, and the existing compile-blocks refusal test for the override wording (`lib/skills/__tests__/compile-blocks.test.ts`)

**Interfaces:**
- Produces, in `lib/skills/old-slots.ts`: `type OldSlotKey = { key: string; slot: string; successor: string | null; pipeline: string | null }` (`successor` is the new key and prop as the table writes it, e.g. `mattstack:work/sub-agent-tiering tiering`; null means a person decides, the `domain` row; `pipeline` names the pipeline object the binding sits in, null at the top level); `findOldSlotKeys(fragment: Fragment): OldSlotKey[]`, with `Fragment` from `lib/skills/manifest-merge.ts`.
- Produces, in the validator: `SKILLS_OVERRIDES_ROW_ID = "skills.overrides"`; `skillsOverridesRow(input: { file: string; text: string | null }): Row`; `skillsOverridesRowFor(p: Pick<Probes, "home" | "readFile">): Row` (`Probes.readFile` returns null for an absent file, `lib/setup/probes.ts:44`).

The overrides file is a pack fragment (`materialize.ts` reads it with the same reader as a pack's `pack/skills.jsonc`): bindings sit under `bindings`, and a pipeline object (`pipelines.<name>` as `{ stages?, bindings? }`) carries its own. `findOldSlotKeys` walks the top-level `bindings` and every object pipeline's `bindings`. The detection is the Global Constraints table as data, not the installed engines: a key `mattstack:<engine>` with no `/`, bound to a slot the table lists for that engine, or to `domain` on any engine. `mattstack:shepherdr`'s `tiering`, `strategy` and `accounts` are never old (its root still declares them), although its `replaced-slots` lists them.

- [ ] **Step 1: Write the failing tests**
  - old-slots, each case a fragment:
    - `"finds an old slot key and names its successor"`: `{ bindings: { "mattstack:work": { tiering: "mattstack:model-tiering" } } }` → one `OldSlotKey` `{ key: "mattstack:work", slot: "tiering", successor: "mattstack:work/sub-agent-tiering tiering", pipeline: null }`.
    - `"finds an old slot key inside a pipeline object"`: `{ pipelines: { bugfix: { bindings: { "mattstack:stage-ship": { domain: "acme:ship-rules" } } } } }` → `successor: null`, `pipeline: "bugfix"`.
    - `"ignores block-form keys and shepherdr's kept props"`: `mattstack:work/sub-agent-tiering` `tiering` and `mattstack:shepherdr` `strategy` → `[]`.
    - `"matches the engines"`: for every `plugins/mattstack/attachments/**/index.block.md` whose frontmatter (read with `parseBlockFile` from `lib/skills/blocks/frontmatter.ts`) lists `replaced-slots`, each listed slot is in the table for that engine or `domain`, or is one of shepherdr's three kept props; and every engine and slot in the table appears in some engine's `replaced-slots`.
  - validator, through `skillsOverridesRow`:
    - `"is skipped when the overrides file is absent"`: `text: null` → `skipped`, detail `No overrides file`.
    - `"is ready when the file is empty or every key is in block form"`: `""` and `{ "bindings": { "mattstack:work/sub-agent-tiering": { "tiering": "mattstack:model-tiering" } } }` → `ready`.
    - `"turns needs-you on an old slot key and names its successor"`: `{ "bindings": { "mattstack:work": { "tiering": "mattstack:model-tiering" } } }` → `needs-you`, detail contains `mattstack:work tiering` and `mattstack:work/sub-agent-tiering tiering`.
    - `"says a person decides for domain"`: `{ "bindings": { "mattstack:stage-ship": { "domain": "acme:ship-rules" } } }` → `needs-you`, detail names `domain-rules` and says it adds to lower layers.
    - `"lists only the old keys when old and new are mixed"`.
    - `"says it cannot read a broken file"`: `"{ nope"` → `needs-you`, detail starts `Could not read the file`; never `error`, and the call does not throw.
    - The row is `required: false` and has no `finishGated`; its action is a `steps` action (`lib/setup/contract.ts:36`) whose steps say to edit the file as listed, then run `rt skills materialize`.
  - In the compile-blocks test: an old slot bound by the override layer reads "your overrides file (~/.mattstack/user/skills/overrides.jsonc)" and no longer "the repo override".
- [ ] **Step 2: Run** `bun test lib/skills/__tests__/old-slots.test.ts lib/setup/__tests__/validators-skills-overrides.test.ts lib/skills/__tests__/compile-blocks.test.ts` → FAIL
- [ ] **Step 3: Implement** `old-slots.ts`, then the row (title "Skill overrides"; why: one plain sentence), register it, and fix `layerWords`. Parse the text with `parseFragment(text, path)` (`lib/skills/manifest-merge.ts:90`, throws `FragmentError`), so the row's idea of a fragment is materialize's; check `text.trim() === ""` first, since an empty file is `ready`, not unreadable. In the drift test, label a `parseBlockFile` throw with the file it came from. Check whether the app's Swift setup views need anything for a new generic row (`rt-tray/Tests/MattstackCoreChecks/` reference rows by id); if rows render generically, change nothing there and say so in the report.
- [ ] **Step 4: Run** the same tests → PASS; then `bun test lib/setup` and the skills tests that cover the refusal.
- [ ] **Step 5: Commit** `setup: flag an old-form skill overrides file`

### Task 2: Layout 5 marks an org whose packs are block packs

**Files:**
- Modify: `lib/team/org-marker.ts:30,33` (`ORG_LAYOUT = 5`, `READABLE_LAYOUTS = [3, 4, 5]`, both doc comments)
- Create: `scripts/move-to-block-packs.ts`, `scripts/lib/block-packs-move.ts`
- Test: `lib/team/__tests__/org-marker.test.ts`, `lib/team/__tests__/org-layout.test.ts`, `scripts/__tests__/move-to-block-packs.test.ts`

**Interfaces:**
- Consumes: `preflight`, `cloneRoot`, `assertNoLink`, `ConversionRefusal` (`scripts/lib/org-conversion.ts`); `markerWithLayout` (`scripts/lib/move-team-packs.ts`); `findOldSlotKeys` (Task 1, `lib/skills/old-slots.ts`).
- Produces: `planBlockPacksMove(cloneDir: string): BlockPacksPlan` and `applyBlockPacksMove(plan: BlockPacksPlan): void`, with `BlockPacksPlan = { branch: string; markerPath: string; packs: { name: string; ok: boolean; oldBindings: string[] }[] }` (`oldBindings` as `<key> <slot>`, with ` in pipeline <name>` when it sits in one) and `BlockPacksRefusal` (a `ConversionRefusal`).

The script does not convert packs: the admin converts each pack by hand (outside this repo) on a trial branch first and publishes that branch. The script is the last step: on the checked-out branch (the published trial branch), it proves every pack in the clone is already in block form, then writes layout 5 to that branch's folder marker and commits. `preflight` already requires the branch to exist on origin with nothing unpublished, which is why the packs are published before the script runs.

It writes no pointer on `main`. The hold reads the fetched tip's folder marker on the data branch (`lib/team/org-layout.ts`; `showMarkerAt` on the data branch falls through to the folder marker), nothing reads `main`'s pointer layout for it, and `rt team create` already writes `ORG_LAYOUT` into new pointers.

- [ ] **Step 1: Write the failing tests**
  - org-marker: `ORG_LAYOUT` is 5; `READABLE_LAYOUTS` includes 3, 4 and 5; a marker with no `layout` still reads `ORG_LAYOUT_ABSENT_DEFAULT` (2). Move the tests that pin the old numbers: `lib/team/__tests__/org-marker.test.ts:80-97`, including the self-rewriting test at `:87-97` that regex-replaces `ORG_LAYOUT = 4` (it becomes 5 → 6).
  - org-layout: a fetched marker with layout 5 is not `above` for this rt; a marker with layout 6 is (keeps the hold working for the next bump). Move `lib/team/__tests__/org-layout.test.ts:70-72` ("reads up to 4") and `:96-97` ("a tip on layout 4 is not above; 5 is").
  - move-to-block-packs. The fixture clone: `seedOrg` (`packages/rt-client/test/org-fixture.ts:23-41`) has no `dataBranch`, so the test writes the layout 4 marker with `dataBranch` and creates the branch and a bare origin itself, the way `scripts/__tests__/move-to-data-branch.test.ts` builds its origin; invented org `acme`, packs `acme-base` (the org base pack), `widgets`, `gadgets`; the trial branch is checked out and published.
    - `"plans the bump when every pack is in block form"`: the plan lists the three packs ok and the marker path; `--write` writes `layout: 5` to the checked-out branch's folder marker, keeps `dataBranch`, and commits; nothing else changes.
    - `"refuses when a pack still has an old slot binding"`: a `widgets` `pack/skills.jsonc` with `"mattstack:stage-ship": { "domain": ... }` under `bindings` → refusal names `widgets` and the key; nothing written.
    - `"refuses on an old slot binding inside a pipeline object"`: the same binding under `pipelines.bugfix.bindings` in `gadgets` → refusal names `gadgets`, the key and `bugfix`.
    - `"refuses on a layout 3 org"`: the next step names the layout 4 script (`scripts/move-to-data-branch.ts`).
    - `"refuses while team sync is on"`, `"refuses with uncommitted changes"`, `"refuses with unpublished commits"` (follow the existing scripts' tests).
    - `"plans only without --write"`.
- [ ] **Step 2: Run** the three test files → FAIL
- [ ] **Step 3: Implement.** Bump the constants and both doc comments. Write the script in the shape of `scripts/move-to-team-directory.ts`: `USAGE = "bun scripts/move-to-block-packs.ts <clone-dir> --admin <username> [--write]"`, `BLOCK_PACKS_LAYOUT = 5`. The old-binding check runs `findOldSlotKeys` on the parsed `pack/skills.jsonc` of the org base pack and of every team pack the clone holds. The marker write reuses `markerWithLayout`. If the script reads a settings store file directly, add it to `lib/__tests__/no-settings-bypass.test.ts`'s allowlist (lines 54-94, by path and count); one that reads only markers and manifests needs no entry.
- [ ] **Step 4: Run** the tests → PASS; then `bun test lib/team scripts/__tests__`.
- [ ] **Step 5: Commit** `team: layout 5 marks an org on block packs`

### Task 3: Notes and docs for every kind of user

**Files:**
- Modify: `RELEASE_NOTES.md` (the early notes' `### Skill packs` section plan 2 started), the skill-packs docs page under `website/docs/` (plan 2 Task 8b edited `packs.mdx`; add a "Move a pack to blocks" section there or beside it), `website/docs/start/teams.mdx` (the layout 3 and 4 admin conversions sit at about lines 109 and 206 with their app-version holds; add the layout 5 conversion beside them), `.claude/rules/settings.md` (the layout list: 5 = block packs, readable 3-5), `docs/settings-architecture.md:73-82` (the layouts and their scripts: add layout 5 and `scripts/move-to-block-packs.ts`), and the rt:settings skill's runbook if its source lives in this repo (`grep -rln "move-to-data-branch" skills docs .claude`): one line for layout 5 and its script.
- Test: `bun run purity`; the docs build (`bun run docs:build` or the repo's docs check).

- [ ] **Step 1: Write** the existing-installs lines, each one plain sentence plus the command where there is one:
  - G2: update the app before your org moves its packs to block engines; an older app keeps working on the old packs and holds its org pull until it updates.
  - G3: until your team's pack update lands, `rt skills check` and `sync` on it report old slot bindings; your team's verbs keep working.
  - G1: if you hand-wrote `~/.mattstack/user/skills/overrides.jsonc`, setup's Skill overrides row lists what to change.
  - G4: a pack you made yourself needs its bindings moved to block form; `rt skills check` lists each old binding; the table shows each one's new key (the mapping table from Global Constraints).
  - The org admin's order: switch to a trial branch (`rt team branch use <name>`), convert every pack and publish the branch (`rt team publish`), run `bun scripts/move-to-block-packs.ts <clone-dir> --admin <you> --write`, publish again, then merge into the data branch after the release; members on the new app follow on their next pull. (The script refuses unpublished commits, so the packs are published before it runs.)
- [ ] **Step 2: Write** the docs sections with the same table and the admin order, following the rt:docs skill (load it): the skill-packs page, and the layout 5 conversion on `teams.mdx` beside the layout 3 and 4 ones.
- [ ] **Step 3: Run** purity and the docs build → PASS
- [ ] **Step 4: Commit** `docs: moving packs and orgs to block engines`

## Release-time checks (no code; for the release)

- Sparkle minimum: if any org member could be on an app older than v2.21.1 (which cannot hold a pull above its layout), declare the intermediate update in `rt-tray/sparkle-minimum-update` per rt:settings' runbook step 4.
- The release must run rt:release's setup-gap audit again over the whole range, plan 4 included (its `extension.install` step runs on update).

## Self-review notes

- Gap coverage: G1 Task 1; G2 Task 2 (+ notes in Task 3); G3 notes in Task 3 (the `requires.json` check belongs to the pack conversion, outside this repo); G4 Task 3.
- The packs themselves are converted by hand outside this repo, on a trial branch of the org clone, and are not part of this plan.
