# Board skills expand in place (RT-358)

Board's three launcher skills (`board:review`, `board:respond`,
`board:doctor`) need the mattstack plugin's `gate-protocol` rules. Today they
name them by a filesystem path that leaves board's own artifact
(`${CLAUDE_SKILL_DIR}/../../../../plugins/mattstack/...`), which resolves from
a source checkout and from nowhere else. The app bundle ships board's skills
at `Contents/Helpers/skills/board`, and the plugin ships separately, so no
runtime path can work in both.

This spec adds one small verb, `rt skills expand`, that takes hand-written
skills containing `{{include:<attachment>}}` lines, pastes the attachment in,
and writes the result to an output directory. Board's sources move to
`apps/board/skills-src`, the expanded output is committed to
`apps/board/skills` where the bundle build, the bundled linker and the dev
symlinks already read, and CI fails when the two drift. Distribution does
not change, and the pack compiler is not touched.

## Decisions

- **Board's skills stay in the app bundle.** They drive board's status CLI,
  so they version with the binary. A marketplace plugin (`board@mattstack`)
  was set aside: same exposure in the user's Claude Code as today, a second
  version stream for text that must match the CLI, a bump loop on every
  wrapper edit. A private plugin passed with `--plugin-dir` at every launch
  was set aside: it threads every launch and resume path and the agent daemon
  payload, and a session resumed by hand loses the skill.
- **Expand, not compile.** Making board a pack needed an empty bindings
  manifest, a `pipeline-step` label on skills that are not steps, an optional
  roster description, a pack-local engine lookup and a namespace field, all
  so the verb pipeline that team packs and mattstack run on could paste one
  block. A hand-written skill with include lines is a different, simpler
  thing: the frontmatter is already right, there are no blanks to fill, and
  the only job is the paste plus the bookkeeping around it. Expand reuses
  that bookkeeping (include loading, seam markers, drift diff, path lint,
  vendoring rules) and leaves `compileSkill` and `rt skills compile` alone.
- **The whole attachment is included.** Every gated pack verb inlines all of
  gate-protocol. Board follows that precedent rather than splitting two
  sections out.
- **The wrappers become model-hidden.** All three carry
  `disable-model-invocation: true`. The board types the slash command into
  the pane it launches, which still works; a stray session's model can no
  longer pick a wrapper up on a description match.
- **Includes come from the tree.** Board expands with `--mattstack-dir <repo
  root>`, which resolves `plugins/mattstack` in the same commit through the
  existing `resolvePluginRootsFromDir`. The expanded skill carries the gate
  rules of its own commit, never whatever the expanding machine has
  installed. That resolver's "test-mode-only" comment is corrected, since CI
  and board both rely on it.

## `rt skills expand`

```
rt skills expand --src <dir> --out <dir> [--mattstack-dir <root>] [--check] [--strict] [--dry-run] [--json]
```

- `--src` holds one directory per skill, each with a `SKILL.md`. `--out` is
  where the expanded copies go. `--mattstack-dir` picks the plugin root the
  way `compile` and `check` already do; without it the installed plugin is
  used.
- For each source skill: the frontmatter is copied verbatim and
  `metadata.compiled` is set to the plugin id and version of every include
  pasted (`mattstack:gate-protocol@0.27.1`), or omitted for a skill with no
  includes. The body gets the compiler's header comment, a `step` seam marker
  naming the source path, and each `{{include:<name>}}` line replaced by the
  attachment body under its own `include:<name>` seam marker, as
  `includeText` in `lib/skills/placeholders.ts` already renders it. Any other
  placeholder, and any literal `{{` left over, is an error.
- Includes load through `loadInclude`, which already refuses an attachment
  with slots or placeholders. An include's extra files vendor to
  `parts/include-<name>/` as `compile` does.
- Every file in the source skill directory that the compiler's vendoring
  rules admit (no dotfiles, `tests/`, `__pycache__`, READMEs) is copied to
  the output directory at the same relative path, so `scripts/` stays
  `scripts/` and `${CLAUDE_SKILL_DIR}/scripts/...` in `allowed-tools` and
  prose keeps meaning what it means.
- The output directory is owned by expand: a skill directory in `--out`
  with no counterpart in `--src` is removed, but only when its `SKILL.md`
  body starts with expand's header. Any other directory in `--out` stops
  the run, named, before anything is deleted or written, and `--check`
  reports it as `foreign`.
- Lint: a `${CLAUDE_SKILL_DIR}/...` path in the expanded body must resolve
  inside `--out`. A sibling (`../gate-cli-recipes`) passes; the old
  `../../../../plugins/...` fails with the path named. `--strict` runs the
  mcp lint `skills check --strict` runs, and a line the lint flags takes the
  existing `<!-- mcp-lint: allow -->` marker.
- `--check` expands in memory and compares: `SKILL.md` through
  `skillMdDriftCauses` (frontmatter, source, include, structure) with the
  seam versions and `compiled:` stamp masked as `skills check` masks them,
  vendored files byte for byte (the cause names the first path that
  differs), and the set of directories. It prints one line per
  drifted skill naming the cause and exits 1; clean is exit 0. `--json`
  prints the same as an envelope.

The verb is a new module, `commands/skills-expand.ts` over
`lib/skills/expand.ts`, registered in `lib/module-registry.ts` and declared
under `skills` in `lib/command-tree-def.ts`. It takes only flags, so no
`omitBehavior` applies. It is not agent-safe: it writes to a caller-named
path, and CI and package scripts run it on Bash.

## Board layout

```
apps/board/
  skills-src/
    review/SKILL.md            hand-written; {{include:gate-protocol}} near the end; scripts/
    respond/SKILL.md           same
    doctor/SKILL.md            same
    gate-cli-recipes/SKILL.md  hand-written, no includes
  skills/                      expanded output, committed; never edited
    review/  respond/  doctor/  gate-cli-recipes/
```

`skills/` keeps its shape and names, so `scripts/build-apps.ts` (copies
`apps/board/skills` into the bundle), `lib/setup/skills-link-bundled.ts`,
the `deps-lock-live` naming guard (`board:<dir>`) and board's dev
`scripts/setup.ts` symlinks need no change. `gate-cli-recipes` moves to
`skills-src` too, so `skills-src` is the one place anyone edits and `skills`
is entirely generated.

`apps/board/skills/review/scripts/open-gate.test.ts` moves to
`apps/board/src/__tests__/skills-open-gate.test.ts` and reads `skills-src`;
a test file inside `scripts/` would otherwise vendor into the bundle.

## Prose fixes in the wrappers

- The cited sections "Acting on the response" and "CAS and the doorbell" no
  longer exist. Cites move to the current headings ("Present the in-pane
  gate form", "Map the gate answer to exact option values", "Discard the
  form's gate answer; say which surface won", "Answers are option values",
  "Doorbell") and say the protocol is included below.
- The translation lines that map to `rt gate answer <id> --answers ... --by
  pane` map to `gate_answer {id, answers}`, which is what gate-protocol uses
  now.
- Every `cat ${CLAUDE_SKILL_DIR}/../../../../plugins/...` line goes.

## Commands and CI

Two root package scripts, so nobody types the flags:

```
skills:expand:board   bun cli.ts skills expand --src apps/board/skills-src --out apps/board/skills --mattstack-dir . --strict
skills:check:board    the same with --check
```

`skills:check:board` joins the root `check` task that `bun run check` runs
through turbo, which the `static` job in `checks.yml` runs on every PR. It
needs no `claude` binary and takes seconds, so it is not scoped by path.

The board loop is edit `skills-src`, run `skills:expand:board`, commit both.
There is no sync step, because nothing installs separately.

`plugins/mattstack/plugin/skills/editing-skills/SKILL.md` gains a short
section: a hand-written skill that needs shared plugin text uses `rt skills
expand`; a skill built from a template with blanks uses `compile`. That edit
bumps the plugin's `plugin.json` version in the same PR, as its CI job
requires, and follows writing-skills.

## Tests

- `lib/skills/__tests__/expand.test.ts` against a fixture under
  `lib/skills/__tests__/fixtures/expand/`: frontmatter verbatim with the
  `compiled` stamp, include pasted under its marker, scripts vendored at the
  same path, orphan output removed, stray `{{` refused, a path leaving
  `--out` refused, `--check` clean after expand and drifted after a source,
  include or output edit.
- `lib/__tests__/deps-lock-live.test.ts` keeps passing unchanged.
- `apps/board/src/__tests__/skills-open-gate.test.ts` replaces the in-skill
  test.
- A test that the three expanded wrappers contain no `plugins/mattstack`
  path and do contain the `include:gate-protocol` seam marker.
- Skill edits follow writing-skills: RED with a fresh agent reading the old
  wrapper at a gate, GREEN with the expanded one.

## Acceptance (from RT-358)

- No board skill names a filesystem path to another artifact's file.
- An installed board skill carries the gate rules it needs, from a source
  checkout and from the bundled app alike.
- CI fails when expanded board skills drift from their sources.
- The `${CLAUDE_SKILL_DIR}/../../../../plugins/...` stopgap is gone.

Out of scope: deck and gitq skills (no cross-artifact references, no
launcher; they can adopt expand later without a change to the verb),
certifying board's skills with the plugin's `certify.sh`, and any change to
how the bundle or dev setup links skills.
