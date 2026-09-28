# Board skills compile in place (RT-358)

Board's three launcher skills (`board:review`, `board:respond`,
`board:doctor`) need the mattstack plugin's `gate-protocol` rules. Today they
name them by a filesystem path that leaves board's own artifact
(`${CLAUDE_SKILL_DIR}/../../../../plugins/mattstack/...`), which resolves from
a source checkout and from nowhere else. The app bundle ships board's skills
at `Contents/Helpers/skills/board`, and the plugin ships separately, so no
runtime path can work in both.

This spec makes `apps/board` a compiled pack: its skill sources carry an
`{{include:gate-protocol}}` line, `rt skills compile` pastes the rules in, and
the compiled output is committed where the bundle build, the bundled linker
and the dev symlinks already read. Distribution does not change.

## Decisions

- **Board's skills stay in the app bundle.** They drive board's status CLI, so
  they version with the binary. A marketplace plugin (`board@mattstack`) was
  considered and set aside: same exposure in the user's Claude Code as today,
  a second version stream for text that must match the CLI, and a bump loop
  on every wrapper edit. A private plugin passed with `--plugin-dir` at every
  launch was set aside too: it has to thread every launch and resume path and
  the agent daemon payload, and a session resumed by hand loses the skill.
- **The compiler is the paste tool.** Board has no slots to fill and no
  pipeline; it needs one shared block inlined. The compiler brings the
  bookkeeping worth reusing: a seam marker recording which plugin version was
  pasted, the drift check, and the lint that refuses any path leaving the
  pack root. A second, smaller include-expander was set aside.
- **The whole attachment is included.** Every gated pack verb (ship,
  stage-plan, checkout, sync-open-mrs) inlines all of gate-protocol. Board
  follows that precedent rather than splitting two sections out.
- **The wrappers become model-hidden.** All three carry
  `disable-model-invocation: true`. The board types the slash command into the
  pane it launches, which still works; a stray session's model can no longer
  pick a wrapper up on a description match.
- **Includes come from the tree, not the installed plugin.** Board compiles
  with `--mattstack-dir <repo root>`, which resolves `plugins/mattstack` in
  the same commit. The compiled skill therefore carries the gate rules of its
  own commit, never whatever the compiling machine has installed.

## Layout

```
apps/board/
  pack/stubs.jsonc            roster: review, respond, doctor
  pack/skills.jsonc           standalone manifest, bindings: {} (no slots)
  surface.jsonc               public: the three; namespace: board
  attachments/
    review/SKILL.md           source (type: pipeline-step), scripts/
    respond/SKILL.md          source, scripts/
    doctor/SKILL.md           source, scripts/
  skills/
    review/SKILL.md           compiled output, committed; scripts/ vendored
    respond/SKILL.md
    doctor/SKILL.md
    gate-cli-recipes/SKILL.md hand-written, unchanged
```

`skills/` keeps its shape, so `scripts/build-apps.ts` (copies
`apps/board/skills` into the bundle), `lib/setup/skills-link-bundled.ts`, the
`deps-lock-live` naming guard (`<app>:<dir>`) and board's dev
`scripts/setup.ts` symlinks need no change. `gate-cli-recipes` has no
`compiled:` metadata, so the compiler's stale-dir sweep leaves it alone, and
the wrappers keep reading it as a sibling (`${CLAUDE_SKILL_DIR}/../gate-cli-recipes`),
a path that stays inside board's artifact.

Step files vendor at their own relative path, so `scripts/resolve-args.sh`
and `scripts/open-gate.sh` land at `skills/<verb>/scripts/` and the
`${CLAUDE_SKILL_DIR}/scripts/...` entries in `allowed-tools` and the prose
stay as written. `apps/board/skills/review/scripts/open-gate.test.ts` moves
to `apps/board/src/__tests__/skills-open-gate.test.ts`, reading the
attachment sources and the compiled output by path; a test file inside a
vendored `scripts/` dir would otherwise ship in the bundle.

## Compiler extension

Three additions to `lib/skills/` and `commands/skills.ts`, each a unit test
against a fixture pack under `lib/skills/__tests__/fixtures/`.

1. **A roster engine may live in the pack's own tree.** `stubs.jsonc` gains
   the form `"engine": "<pack>:<name>"`. An unqualified engine resolves from
   the mattstack root as today. A qualified one resolves from
   `pluginRoots.byName[<pack>]`, so `resolve()` registers the pack under its
   own name whether or not it carries `.claude-plugin/plugin.json`
   (`packPluginIdentity` falls back to the directory basename and the
   `version` in a sibling `package.json`, else `""`). The step's `plugin` and
   seam-marker `source=` name that pack.
2. **Frontmatter pass-through.** `buildFrontmatter` emits, in addition to
   what it emits today: `disable-model-invocation` when the engine sets it,
   and every `metadata.*` key of the engine except `compiled` (board's
   `slots` and `slot-<name>` keys, which `manifest-bindings.ts` reads at
   launch). The roster `description` becomes optional; when absent, the
   engine's own `description` is used, the way stages already do.
3. **A surface namespace.** `surface.jsonc` gains optional
   `"namespace": "<prefix>"`. When set, a compiled public verb's `name:` is
   `<prefix>:<verb>`. Verb names stay `[a-z][a-z0-9-]*`; only the emitted
   name carries the colon. A pack installed as a Claude plugin never sets
   it, since the plugin supplies the namespace.

`resolvePluginRootsFromDir` already resolves `<dir>/plugins/<name>`; its
"test-mode-only" comment is corrected, since CI and the board compile both
rely on it.

`{{include:gate-protocol}}` sits once near the end of each wrapper, after the
wrapper's own rules, as the pack verbs place it. `loadInclude` refuses an
include target with slots or placeholders; gate-protocol has neither.

## Prose fixes in the wrappers

- The cited sections "Acting on the response" and "CAS and the doorbell" no
  longer exist. Cites move to the current headings ("Present the in-pane gate
  form", "Map the gate answer to exact option values", "Discard the form's
  gate answer; say which surface won", "Answers are option values",
  "Doorbell") and say the protocol is included below.
- The translation lines that map to `rt gate answer <id> --answers ... --by
  pane` map to `gate_answer {id, answers}`, which is what gate-protocol
  uses now.
- Every `cat ${CLAUDE_SKILL_DIR}/../../../../plugins/...` line goes.

## Commands and CI

Two root package scripts, so nobody types the flags:

```
skills:compile:board   bun cli.ts skills compile --pack-dir apps/board --mattstack-dir .
skills:check:board     bun cli.ts skills check   --pack-dir apps/board --mattstack-dir . --strict
```

`skills:check:board` joins `bun run check`, which the `static` job in
`checks.yml` runs on every PR. It needs no `claude` binary (the root flag
skips `claude plugin list`) and takes seconds, so it is not scoped by path.
If strict mcp-lint flags a `<status-bin>` line, that line takes the
existing `<!-- mcp-lint: allow -->` marker; the status CLI is board's own,
not a shell form of a tool.

The board loop is edit source, compile, commit both. There is no sync step,
because nothing installs separately.

## Tests

- Compiler: fixture pack with a pack-local engine, a namespace, a
  `disable-model-invocation` engine and extra `metadata` keys; compile
  output and `check` drift on each. Existing compiler tests unchanged.
- `lib/__tests__/deps-lock-live.test.ts` keeps passing unchanged (names
  remain `board:<dir>`).
- `apps/board/src/__tests__/skills-open-gate.test.ts` replaces the in-skill
  test.
- A test that the three compiled wrappers contain no `plugins/mattstack`
  path and do contain the `include:gate-protocol` seam marker.
- Skill edits follow writing-skills: RED with a fresh agent reading the old
  wrapper at a gate, GREEN with the compiled one.

## Acceptance (from RT-358)

- No board skill names a filesystem path to another artifact's file.
- An installed board skill carries the gate rules it needs, from a source
  checkout and from the bundled app alike.
- CI fails when compiled board skills drift from their sources.
- The `${CLAUDE_SKILL_DIR}/../../../../plugins/...` stopgap is gone.

Out of scope: deck and gitq skills (no cross-artifact references, no
launcher), certifying board's skills with the plugin's `certify.sh`, and any
change to how the bundle or dev setup links skills.
