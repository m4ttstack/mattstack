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
- Setup rows follow `.claude/rules/setup.md`: a verify row reads, never writes; a non-required row never blocks finishing.
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

  Before writing it into code or docs, confirm each row against the engines' `replaced-slots` frontmatter and the blocks' `props:` in `plugins/mattstack/attachments/` (one row wrong is a wrong instruction to every user).

## Review Focus

1. `overrides.jsonc` absent, empty, or not valid JSONC: the row is quiet (absent/empty) or says it cannot read the file; it never reads as failed and never throws. (Task 1.)
2. An overrides file holding both old and new keys: needs-you lists only the old ones, each with its successor; a file holding only new keys is ok. (Task 1.)
3. The conversion script on a clone with uncommitted changes, unpublished commits, or team sync on: refuses with the command to fix it, writes nothing. (Task 2.)
4. The conversion script on an org where any pack still has an old slot binding: refuses naming the pack and the binding layer, writes nothing. (Task 2.)
5. An org on layout 3 (no data branch): the script refuses and says to move to layout 4 first. (Task 2.)

---

## File structure

| File | Responsibility |
|---|---|
| `lib/setup/validators/skills-overrides.ts` (new) | the `skills.overrides` verify row: read the file, find old slot keys, build the row |
| `lib/skills/old-slots.ts` (new, only if no existing helper does it) | one place that says which keys in a bindings object are old slot keys and what each one's successor is; shared by the row and, if it fits, by the compile refusal |
| `lib/skills/compile-blocks.ts` | `layerWords("override")` names the overrides file |
| `lib/team/org-marker.ts` | `ORG_LAYOUT = 5`, `READABLE_LAYOUTS = [3, 4, 5]` |
| `scripts/move-to-block-packs.ts` (new), `scripts/lib/block-packs-move.ts` (new) | the layout 5 conversion: plan, refuse, `--write` |
| `RELEASE_NOTES.md`, `website/docs/skills/packs.mdx` (or the page the skill-packs docs live on), `.claude/rules/settings.md` | notes, docs, the layout list |

---

### Task 1: Flag an old-form overrides file

**Files:**
- Create: `lib/setup/validators/skills-overrides.ts`; `lib/skills/old-slots.ts` only if needed (first look for the code `compile-blocks.ts` uses to detect old slot keys from each engine root's `replaced-slots`, and reuse it)
- Modify: the place the `skills.writing-style` row is registered (find `writingStyleRowFor`'s caller, `lib/setup/validators/tools.ts` today) to add this row beside it; `lib/skills/compile-blocks.ts:181-187` (`layerWords`)
- Test: `lib/setup/__tests__/validators-skills-overrides.test.ts`, and the existing compile-blocks refusal test for the override wording

**Interfaces:**
- Produces: `SKILLS_OVERRIDES_ROW_ID = "skills.overrides"`; `skillsOverridesRow(input: { file: string; text: string | null; oldKeys: OldSlotKey[] }): Row`; `skillsOverridesRowFor(p: Pick<Probes, "home" | "exists">): Row`; `type OldSlotKey = { key: string; slot: string; successor: string | null }` (`successor` null means a person decides, the `domain` row).

- [ ] **Step 1: Write the failing tests**
  - `"is quiet when the overrides file is absent"`: the row is ok with no detail (follow how the writing-style row reads when nothing applies).
  - `"is ok when every key is in block form"`: `{ "mattstack:work/sub-agent-tiering": { "tiering": "..." } }` → ok.
  - `"turns needs-you on an old slot key and names its successor"`: `{ "mattstack:work": { "tiering": "mattstack:model-tiering" } }` → `needs-you`, detail contains `mattstack:work tiering` and `mattstack:work/sub-agent-tiering tiering`.
  - `"says a person decides for domain"`: `{ "mattstack:stage-ship": { "domain": "acme:ship-rules" } }` → `needs-you`, detail names `domain-rules` and says it adds to lower layers.
  - `"lists only the old keys when old and new are mixed"`.
  - `"says it cannot read a broken file and does not fail"`: text `"{ nope"` → not `failed`.
  - The row is `required: false` and never `finishGated`.
  - In the compile-blocks test: an old slot bound by the override layer reads "your overrides file (~/.mattstack/user/skills/overrides.jsonc)" and no longer "the repo override".
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/validators-skills-overrides.test.ts lib/skills/__tests__/compile-blocks.test.ts` → FAIL
- [ ] **Step 3: Implement** the row (title "Skill overrides"; why: one plain sentence; action: edit the file as listed, then `rt skills materialize`), register it, and fix `layerWords`. Check whether the app's Swift setup views need anything for a new generic row (`rt-tray/Tests/MattstackCoreChecks/` reference rows by id); if rows render generically, change nothing there and say so in the report.
- [ ] **Step 4: Run** the same tests → PASS; then `bun test lib/setup` and the skills tests that cover the refusal.
- [ ] **Step 5: Commit** `setup: flag an old-form skill overrides file`

### Task 2: Layout 5 marks an org whose packs are block packs

**Files:**
- Modify: `lib/team/org-marker.ts:30,33` (`ORG_LAYOUT = 5`, `READABLE_LAYOUTS = [3, 4, 5]`, both doc comments)
- Create: `scripts/move-to-block-packs.ts`, `scripts/lib/block-packs-move.ts`
- Test: `lib/team/__tests__/org-marker.test.ts`, `lib/team/__tests__/org-layout.test.ts`, `scripts/__tests__/move-to-block-packs.test.ts`

**Interfaces:**
- Consumes: `preflight`, `cloneRoot`, `assertNoLink`, `ConversionRefusal` (`scripts/lib/org-conversion.ts`); `markerWithLayout` (`scripts/lib/move-team-packs.ts`); `pointerText` (`lib/team/org-marker.ts:25`); the pointer-landing flow `scripts/move-to-data-branch.ts` uses for `main` (push, or a `<data branch>-pointer` branch when `main` refuses).
- Produces: `planBlockPacksMove(cloneDir: string): BlockPacksPlan` and `applyBlockPacksMove(plan: BlockPacksPlan): void`, with `BlockPacksPlan = { dataBranch: string; markerPath: string; pointerChange: boolean; packs: { name: string; ok: boolean; oldBindings: string[] }[] }` and `BlockPacksRefusal` (a `ConversionRefusal`).

The script does not convert packs: the admin converts each pack by hand (outside this repo) on a trial branch first. The script is the last step: it proves every pack in the clone is already in block form, then writes layout 5.

- [ ] **Step 1: Write the failing tests**
  - org-marker: `ORG_LAYOUT` is 5; `READABLE_LAYOUTS` includes 3, 4 and 5; a marker with no `layout` still reads `ORG_LAYOUT_ABSENT_DEFAULT` (2).
  - org-layout: a fetched marker with layout 5 is not `above` for this rt; a marker with layout 6 is (keeps the hold working for the next bump).
  - move-to-block-packs (fixture clone on layout 4 with a data branch, invented org `acme`, packs `acme-base`, `widgets`, `gadgets`):
    - `"plans the bump when every pack is in block form"`: plan lists the three packs ok and the marker path; `--write` writes `layout: 5` to the data-branch marker and the `main` pointer, and commits.
    - `"refuses when a pack still has an old slot binding"`: a `widgets` `pack/skills.jsonc` with `"mattstack:stage-ship": { "domain": ... }` → refusal names `widgets` and the key; nothing written.
    - `"refuses on a layout 3 org"`: the next step names the layout 4 script.
    - `"refuses while team sync is on"`, `"refuses with uncommitted changes"` (follow the existing scripts' tests).
    - `"plans only without --write"`.
- [ ] **Step 2: Run** the three test files → FAIL
- [ ] **Step 3: Implement.** Bump the constants. Write the script in the shape of `scripts/move-to-team-directory.ts`: `USAGE = "bun scripts/move-to-block-packs.ts <clone-dir> --admin <username> [--write]"`, `BLOCK_PACKS_LAYOUT = 5`; the old-binding check uses the same detection `rt skills check` uses (find it from `old-slot-binding` in `lib/skills/`), over the org base pack and every team pack the clone holds; the marker and pointer writes reuse `markerWithLayout` and `pointerText`.
- [ ] **Step 4: Run** the tests → PASS; then `bun test lib/team scripts/__tests__`.
- [ ] **Step 5: Commit** `team: layout 5 marks an org on block packs`

### Task 3: Notes and docs for every kind of user

**Files:**
- Modify: `RELEASE_NOTES.md` (the early notes' `### Skill packs` section plan 2 started), the skill-packs docs page under `website/docs/` (plan 2 Task 8b edited `packs.mdx`; add a "Move a pack to blocks" section there or beside it), `.claude/rules/settings.md` (the layout list: 5 = block packs, readable 3-5), and the rt:settings skill's runbook if its source lives in this repo (`grep -rln "move-to-data-branch" skills docs .claude`): one line for layout 5 and its script.
- Test: `bun run purity`; the docs build (`bun run docs:build` or the repo's docs check).

- [ ] **Step 1: Write** the existing-installs lines, each one plain sentence plus the command where there is one:
  - G2: update the app before your org moves its packs to block engines; an older app keeps working on the old packs and holds its org pull until it updates.
  - G3: until your team's pack update lands, `rt skills check` and `sync` on it report old slot bindings; your team's verbs keep working.
  - G1: if you hand-wrote `~/.mattstack/user/skills/overrides.jsonc`, setup's Skill overrides row lists what to change.
  - G4: a pack you made yourself needs its bindings moved to block form; `rt skills check` lists each old binding; the table shows each one's new key (the mapping table from Global Constraints).
  - The org admin's order: convert every pack on a trial branch (`rt team branch use <name>`), run `bun scripts/move-to-block-packs.ts <clone-dir> --admin <you> --write`, publish, then merge into the data branch; members on the new app follow on their next pull.
- [ ] **Step 2: Write** the docs section with the same table and the admin order, following the rt:docs skill (load it).
- [ ] **Step 3: Run** purity and the docs build → PASS
- [ ] **Step 4: Commit** `docs: moving packs and orgs to block engines`

## Release-time checks (no code; for the release)

- Sparkle minimum: if any org member could be on an app older than v2.21.1 (which cannot hold a pull above its layout), declare the intermediate update in `rt-tray/sparkle-minimum-update` per rt:settings' runbook step 4.
- The release must run rt:release's setup-gap audit again over the whole range, plan 4 included (its `extension.install` step runs on update).

## Self-review notes

- Gap coverage: G1 Task 1; G2 Task 2 (+ notes in Task 3); G3 notes in Task 3 (the `requires.json` check belongs to the pack conversion, outside this repo); G4 Task 3.
- The packs themselves are converted by hand outside this repo, on a trial branch of the org clone, and are not part of this plan.
