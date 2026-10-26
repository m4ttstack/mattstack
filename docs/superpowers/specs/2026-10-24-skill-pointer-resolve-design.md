# Skill pointers that resolve by id (skill blocks, plan 7)

Status: draft for Matt's approval, 2026-10-24. Part of the skill blocks
epic (`docs/superpowers/specs/2026-10-22-skill-blocks-design.md`); ships in
the epic's one PR.

## Why

A compiled skill points at its own files: a `references/` copy, a vendored
script under `parts/`, a sibling verb. Today those pointers are paths
anchored at `${CLAUDE_SKILL_DIR}`:

- `${CLAUDE_SKILL_DIR}/references/<unit>/SKILL.md` in a public verb;
- `${CLAUDE_SKILL_DIR}/../../attachments/<verb>/...` in an internal verb
  (`attachments/<verb>/SKILL.md`), which `lib/skills/placeholders.ts`
  writes through `ctx.stageDir`;
- `${CLAUDE_SKILL_DIR}/parts/<name>/...` for vendored files;
- `{{verb.path:x}}`, which renders relative to the file.

Claude Code fills `${CLAUDE_SKILL_DIR}` in only for the skill it loaded.
Every file read by path (internal verbs, stages, `references/` copies,
base copies) carries the literal text, and the agent has to guess whose
folder it means. The guess is right when the reader entered through one of
the pack's own verbs, and wrong when it did not: `board:respond` reads the
pack's board-respond file, which reads receive-review, and two folders up
from the board's skill is the board's folder, not the pack's. One real
team pack's build carries 10 such pointers, one of them a script
(`gate-ctx.sh`).

Matt's ruling: pointers name what they point at, and rt says where it is.

## Goals

- A compiled or expanded skill's pointers land on the right file whoever
  opens it: Claude Code loading it, a verb reading it by path, the board
  reading a pack's file, a skill that is later surfaced or un-surfaced.
- One call per started skill. The skill a person, the board or the Skill
  tool starts makes one `skills_resolve` call, and the answer covers every
  pointer reachable from it by reading files: stages, internal verbs,
  `references/` copies and base copies included. A `work` run is one call.
  The board is two: one for its own skill, and one for the pack skill it
  enters, which it only learns at run time (`scripts/resolve-args.sh`). A
  skill started through the Skill tool (a writing style, say) makes its
  own.
- A dangling pointer fails `rt skills check`, not a run.
- When resolving fails, the agent stops and says so. It never hunts for a
  file.

## Non-goals

- Hand-written skills. Claude Code loads them, so their
  `${CLAUDE_SKILL_DIR}` is real; they keep it. `broken-skill-path` still
  checks them.
- `allowed-tools` frontmatter. It keeps `${CLAUDE_SKILL_DIR}`, which Claude
  Code fills in and which permission matching needs.
- Cross-machine or remote lookups. rt resolves on the machine the session
  runs on.

## Anti-goals

- Resolving a different version of a pack than the one the session is
  running. A wrong-version answer is the silent bug this replaces, moved.
- Absolute paths of one machine written into a compiled file. Compiled
  files stay machine-independent; only `skills_resolve` answers with
  absolute paths.
- A call for each file read by path. Whatever a started skill reads is
  covered by its one call.
- A command that no longer matches `allowed-tools`. A script path resolve
  returns must be the same text Claude Code makes of the matching
  `allowed-tools` rule, or every vendored script starts asking for
  permission.

## Approaches considered

1. **Relative paths everywhere.** Every body points relative to its own
   file, with one opening line on running scripts by absolute path. No tool
   calls, and it covers every in-pack case. It cannot cross a plugin or
   pack boundary, and a script still depends on the agent joining paths.
2. **The caller passes a pack-root token.** The board, or any outside
   caller, hands the pack root to the internal verbs. Every caller then
   carries the burden of passing it right.
3. **Ids resolved by rt, one batched call (chosen).** Each pointer is a
   key; one MCP call returns the map for everything the started skill can
   reach. It works for any caller, crosses boundaries, and lets compile
   check every key. It costs one call per run and needs rt reachable,
   which every member has.

Matt picked 3, with the batched call ("a single call that returns all
pointers"), and the reach set to everything from the started skill.

## The design

### Ids

Compile, and `rt skills expand` for the board, give every skill they write
an id stamped with where it is installed from and which version:

- a pack or plugin skill: `<plugin>@<version>:<unit>`, for example
  `widgets@0.4.2:receive-review`, where `<unit>` is the folder name under
  `skills/` or `attachments/`;
- a board skill Claude Code loads from `~/.claude/skills/<name>` (the
  board's wrappers are symlinks there, into the checkout or the app
  bundle): `skills:<name>`, with no version, since the link target is what
  Claude Code runs.

The version is the plugin's `.claude-plugin/plugin.json` version at
compile time. `rt skills check` fails a compiled skill whose stamped
version is not its plugin's current version, the same way it fails other
drift. This adds a step: check ignores the version in the `compiled:`
header and the `part:` comments on purpose, but a stamp in an id cannot be
ignored, so every plugin version bump now needs a recompile. Matt chose
this over a version-free id read from Claude Code's
`installed_plugins.json`, which could hand a session started before an
update the newer copy's paths. `rt skills sync` already bumps before it
compiles; the bump right before a merge gains a recompile.

### Keys in the text

Every pointer the compiler or expander writes in a body becomes a key,
written `@<key>` in code spans and prose alike. The key names its target,
for example `@capture-evidence` or `@gate-ctx`. Keys are unique within the
map of the skill a run starts from, and stable: the same target keeps the
same key across recompiles.

Each written skill opens with one line, ahead of its body:

> Pointers here are `@keys`. Resolve them once per run: if you already
> hold a `skills_resolve` map that covers `<id>`, use it; otherwise call
> `skills_resolve {id: "<id>"}` and use the path it returns for each key,
> in anything you hand a subagent or a tool too. If it fails, stop and say
> so; never look for the file another way.

(The clause about subagents and tools was added 2026-10-25, Matt's call,
after two keys reached a worker and a reviewer unresolved.)

### The map

Compile writes each skill's map beside it, in its `compiled.json` (base
copies already carry one; every compiled unit gets one). An entry is a key
and its target, as a path relative to that skill's own folder, written the
way `allowed-tools` writes it: `../../attachments/stage-plan/parts/x.sh`
from `skills/work`, with the `../` kept. Every target is inside the same
plugin; there are no entries into another plugin, so no plugin pins
another's version.

The started skill's map is its own entries plus the maps of every skill it
reaches by reading files: the stages a pipeline verb runs, the files a
`{{verb.path:}}` reads, a base copy's vendored targets, carried
transitively and rewritten relative to the started skill's folder. The
reach stops at the Skill tool: a skill started that way has its own id and
makes its own call. Compile computes the closure at build time, so resolve
never walks files.

A stage that hands work to a subagent passes the subagent the resolved
absolute paths its brief names. A subagent that reads a written skill
itself makes that skill's one call; it holds no map from the parent.

### Resolving

`rt skills resolve <id> --json` returns:

```json
{ "id": "widgets@0.4.2:work", "root": "<absolute plugin root>",
  "covers": ["widgets@0.4.2:work", "widgets@0.4.2:stage-plan", "..."],
  "keys": { "capture-evidence": "<absolute path>", "gate-ctx": "<absolute path>" } }
```

- For `<plugin>@<version>`, rt looks under
  `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, for that
  exact version, across marketplaces. It never falls back to another
  version (unlike `findInstalledPluginDir` in
  `lib/skills/installed-plugins.ts`, which takes the newest). It ignores
  Claude Code's transient `temp_git_*` folders. When more than one other
  marketplace holds that plugin at that version, it refuses and names
  each one. (Today every plugin on Matt's Mac sits in one marketplace.)
- A unit is named by its leaf folder, which compile already keeps unique
  within a plugin. Resolve finds it under `skills/<leaf>`,
  `attachments/<leaf>` or a grouped `attachments/<group>/<leaf>`, by the
  `id` its `compiled.json` records, and refuses if more than one matches.
- For `skills:<name>`, rt uses `~/.claude/skills/<name>` as the folder,
  the link path itself, never the link's target, because that is the text
  Claude Code fills `${CLAUDE_SKILL_DIR}` with.
- Each returned path is the skill's folder as Claude Code names it, joined
  to the entry's relative path as text: no `../` folded, no link followed.
  So a script path matches the `allowed-tools` rule that names it, and a
  test pins that equality.
- It refuses, with the reason and what is missing named, when the id is
  malformed, the version is not installed, the map is absent, or a target
  file is missing. A refusal is a `UserActionableError` under
  `.claude/rules/output-layer.md`.

The MCP tool `skills_resolve {id}` runs the same code and returns the same
JSON. The verb is agent-safe (`lib/command-tree-def.ts`), so a session
without the tool can reach it through `rt_verb` or Bash.

### Check

`rt skills check` fails:
- a `@key` in a body with no entry in the closure's map;
- an entry whose target file is missing from the build;
- two targets sharing one key within a closure;
- a stamp that does not match the plugin's version;
- a `${CLAUDE_SKILL_DIR}` left in a written body outside `allowed-tools`.

## Constraints

- **The tool's reach.** It is on the mattstack MCP server, so every estate
  machine can call it with no permission check (`.claude/rules/mcp-and-gates.md`).
  It reads only the plugin cache and `~/.claude/skills`, takes only an id
  (validated, no caller paths), writes nothing, and answers through
  `callTool`'s redaction like every tool.
- **The floor.** A pack compiled with keys needs an rt that has
  `skills_resolve`. The MCP tools reference changes, so
  `plugins/mattstack/pack/requires.json` minEngine rises to this PR's
  plugin version, and compiled packs carry the same floor. An older app
  holds the new packs, as it does today.
- **Board skills** regenerate with `bun run skills:expand:board`, and
  `skills:check:board` and the `no-board-skills-drift` test cover them.
- **Existing builds keep working.** A pack compiled before this keeps its
  paths until it is recompiled; nothing reads old builds differently.
- Public repo: invented names only. No "engine" in person-read text.
  Plain copy for every refusal.

## Left to the builder

- The key naming scheme, within the rules above (names the target, unique
  per closure, stable).
- Where in `lib/skills/` the closure is computed, and how expand reuses it.
- The exact refusal wording, within the output layer's rules.
- Whether `covers` lists every id or only the ones a caller needs to tell
  its map applies.

## Done when

- `board:respond` on an acme MR follows every receive-review pointer,
  `gate-ctx.sh` included, from the pack skill's one `skills_resolve` call
  (the board's second, after its own).
- A vendored script run from a resolved path needs no permission prompt
  where today's path needs none.
- A `work` run makes one call, and every stage pointer resolves from it.
- No rt-written body carries `${CLAUDE_SKILL_DIR}` outside `allowed-tools`.
- `rt skills check` fails each case under Check, with a test for each.
- The rebuilt packs pass the line-by-line re-read the epic already
  scheduled for after this plan.
