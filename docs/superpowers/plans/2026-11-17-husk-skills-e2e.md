# Husk skills: end-to-end proof (Task 11)

Run on 2026-11-17 from worktree `legolas`, branch `rt-586-husk-skills` at
`08fd07fb1`, mattstack plugin 0.32.76 from this worktree, Claude Code 2.1.326.
Every result below passed except one probe, which the model missed on a
line that the transcript shows it was given (see "Step 2: review").

## Isolation

- Scratch home `S` = `<scratchpad>/e2e/home`. rt under test ran only as
  `S/bin/rt`: `exec env -u RT_APP_SOCKET HOME=S bun <worktree>/cli.ts "$@"`.
  The daemon was never started. Nothing under the real `~/.mattstack` or
  `~/.claude/plugins` was written: the real `~/.mattstack/rt/rendered` does not
  exist, and no scratch plugin is in the real install registry or cache.
- The real org clone was only cloned (`git clone --branch mattstack`) and read
  with `git archive`.
- Claude sessions kept the real HOME for auth. They got the scratch rt
  through PATH and the scratch packs through `--plugin-dir`, with
  `--settings '{"enabledPlugins":{"mattstack@mattstack":false,"claimview@assured":false}}'`.
  Each run's init event listed the plugins: the worktree's mattstack and
  `claimview-husk` loaded, the installed mattstack and claimview did not, and
  `plugin:mattstack:mattstack` (the scratch `rt mcp serve`) connected.
- For the enterprise pane, the real `rt agent start` was only the launcher.
  The product under test was still the scratch rt (see Step 3).

## Step 1: compile a husk pack (scratch org clone)

Layout: `S/.mattstack/orgs/assured`, cloned on the `mattstack` data branch,
with `S/.mattstack/rt/teams/assured.json` carrying `forgeUsername`, which the
compile's write-permission check needs.

1. Rename commit: the claimview pack became plugin `claimview-husk`. Every
   `claimview:` ref in the pack and in a scratch copy of its materialized
   bindings file became `claimview-husk:`, because bindings name fills by
   plugin name and a plugin.json rename alone fails with `no plugin root
   registered for "claimview"`. Compiled without husks
   (`HOME=S bun cli.ts skills compile --pack-dir <pack> --manifest <scratch bindings> --mattstack-dir <worktree>`),
   then committed.
2. Opt-in commit: added `"husks": true` to `pack/skills.jsonc`, compiled the
   same way (about 0.5 s), then committed.

`git show --stat` of the opt-in commit: 506 files, +65 / -123,199.

| Change | Files |
|---|---|
| `pack/skills.jsonc` (the opt-in line) | 1 |
| `pack/compiled.lock.json`, `pack/requires.json` | 2 |
| Husk `SKILL.md` (15 under `attachments/`, 6 under `skills/`) | 21 |
| Generated files deleted (compiled bodies' references, parts, `compiled.json`, base-attachment copies) | 482 |

`pipelines.json` did not change, and no authored source was touched.
Committed pack before: 592 files, 8,142,881 bytes. After: 110 files, 1,047,690
bytes.

## Fake install and render timings

`S/.claude/plugins/cache/scratch-mkt/claimview-husk/<ver>/` holds a copy of the
pack, and `S/.claude/plugins/cache/mattstack/mattstack/0.32.76/` a copy of the
worktree plugin. `S/.claude/plugins/installed_plugins.json` names both.

`PATH=S/bin:$PATH rt skills render claimview-husk:ship --dir <cache>/0.11.65/attachments/ship --json`
returned an ok envelope with pack 0.11.65, mattstack 0.32.76, a tree under
`S/.mattstack/rt/rendered/assured/claimview-husk/0.11.65/0.32.76`, and a body of
165,252 chars.

| Render | Wall time |
|---|---|
| Cold, the whole claimview pack (first render on this home) | 1.41 s |
| Warm, same unit | 0.19 s, 0.15 s |
| Warm, `stage-evidence` / `review` | 0.22 s / 0.18 s |
| Cold, each later published version (0.11.66 / .67 / .68) | 0.95 s / 0.83 s / 0.71 s |

Fidelity: of the 501 rendered `skills/` and `attachments/` files, 481 match the
real clone's committed claimview tree (renamed) byte for byte, `ship`'s
`SKILL.md` among them. The other 20 differ only because the pack name is spelled
out in text (`claimview` became `claimview-husk`), or because this worktree's
mattstack engine (0.32.76) is newer than the one the committed tree was built
with.

## Step 2: personal account (default account, `claude -p --model sonnet`)

Before each run I picked probe lines from the rendered body at about 20, 45,
70 and 97 percent: prose lines of at least 8 words that occur once in the
body. The prompt gave only each line's opening words and asked for the whole
line word for word. It also asked for the load's result line and the first tool
call the skill names. A probe passes when its full line appears verbatim in the
final answer.

| Run | Load path | Load result | Probes (position, chars) | First action |
|---|---|---|---|---|
| `claimview-husk:ship` | Read husk by path, then `load_skill` | 165,252 chars in 2 parts, pack 0.11.65, mattstack 0.32.76 | 20.3% (70) pass; 45.0% (100) pass; 70.0% (69) pass; 97.1% (72) pass | `skills_resolve {id: claimview-husk:ship, dir: <husk dir>}`: matches committed body |
| `claimview-husk:stage-evidence` | Read husk by path, then `load_skill` | 151,136 chars in 2 parts | 20.0% (75) pass; 49.0% (71) pass; 70.0% (71) pass; 97.0% (74) pass | `skills_resolve`, then `run_field_get {key: evidence-plan}`: matches |
| `claimview-husk:review` | Skill tool, then `load_skill` | 201,792 chars in 3 parts | 20.0% (73) **miss**; 45.1% (69) pass; 70.6% (73) pass; 97.1% (64) pass | `skills_resolve`, then `run_enter` with the pack's review flags: matches |

The first action is the same as in the committed (non-husk) bodies. Each
opens with the identical `@key` resolve instruction, followed by the same
first graph step.

Run costs: $0.49, $0.41 and $0.48. Session ids: `4e31f392`, `54674c1e`,
`68c469f0`.

### Step 2: review

The 20% probe miss is on the model, not the delivery. In the session
transcript, the tool call's attached context holds three pieces of 98,971,
98,908 and 2,259 chars. The first piece starts at byte 0 of the body and
contains the probe line. The model answered that it could not find the line.

A second finding from this run: Claude Code saved the third piece (the last
3.8 KB of the body) to a file and attached a `<persisted-output>` pointer in
its place. The husk already tells the agent to Read any part saved to a file
first. This run's prompt forbade further tool calls, so the agent did not
read it. All three pieces were attached and nothing was lost, but a body
over about 198K chars needs that one extra Read.

## Step 3: enterprise account through a herdr pane

Launch, from `~/Documents/GitHub/repo-tools`:

```
rt agent start --account matthew.goodwin@assured.claims --model sonnet --label husk-e2e-ent \
  --prompt-file <file that points at the ship prompt> \
  --extra-args "--plugin-dir <worktree>/plugins/mattstack --plugin-dir <S cache>/claimview-husk/0.11.65 --settings <s.json>"
```

`rt agent start` has no flag for environment variables, so PATH rode in the
settings file (`s.json`: the same `enabledPlugins` plus
`"env": {"PATH": "S/bin:..."}`). Two launch problems came up first, each
leaving an empty tab that I closed:

- Inline settings JSON in `--extra-args` made the pane command a 1,852-byte
  line.
- With a settings file, the line was 1,061 bytes when started from the
  worktree.

Both failed with herdr's `pane_send_failed`: `input contains a <n>-byte line but
the terminal is in canonical mode with a 1024-byte limit`. A shorter settings
path, plus starting from a repo with a shorter path, fixed it.

The pane asked to trust `--add-dir`. `Down`, then `Enter`, cleared it.

Result (session `c729541c`, "Sonnet 5.5 · Claude Enterprise"):

- `load_skill` returned `Loaded claimview-husk:ship (pack 0.11.65, mattstack 0.32.76): 165252 characters in 2 parts`.
  Real rt cannot render a scratch dir, so a body at all proves the PATH from
  the settings file reached the mod's `rt`.
- Probes: 20.3%, 45.0%, 70.0% and 97.1% pass (scored from the transcript).
- First action: `skills_resolve` with the husk dir, then `run_enter`. This
  matches the committed body.
- No "skipped" notice for the mattstack mod. The only skipped notice was
  human-todos' `prompt.compose` hook, which `cc-plugin-sec-default` ran past.

The tab was closed after the result was read.

## Step 4: a subagent loads a husk by path

One Sonnet run (session `df5930ce`, $0.44) spawned one subagent, handed it only
the husk's file path, and told it to load the skill. The subagent read the
husk, then called `load_skill {skill: claimview-husk:stage-evidence, dir: <the husk's folder>}`.
That returned 151,136 chars in 2 parts (pack 0.11.65, mattstack 0.32.76). Both
probes it was asked for (20.0% and 70.0%) passed. So the `<this skill's
directory>` placeholder works for an agent that reads the husk by path.

## Added checks

- `load_skill` registration: `mcp__mattstack__load_skill` was in the init tool
  list of all five sessions. The `session.start` `{ cwd: /^/ }` matcher
  registers it.
- `@key` resolution: `skills_resolve {id: claimview-husk:ship, dir: <husk dir>}`
  over the scratch `rt mcp serve` (JSON-RPC, scratch cwd) returned 58 keys.
  All 58 files exist, and every one resolves into
  `S/.mattstack/rt/rendered/assured/claimview-husk/0.11.65/0.32.76/`.
- `run_enter` from a husk verb: `run_enter {flags: <ship's compiled run flags>, skillDir: <husk dir>, stage: ship, fresh: true}`
  returned `{ok: true, mode: "started", at: {stage: "ship", attempt: 1, status: "running"}, stages: ["ship"]}`.
  Its run db is under `S/.mattstack/runs/`.
- Three publishes: I bumped the scratch pack to 0.11.66, 0.11.67 and 0.11.68.
  Each was compiled, committed, installed as a new cache folder (keeping the
  0.11.65 folder) and rendered once. After that, `rt skills render
  claimview-husk:ship --dir <cache>/0.11.65/attachments/ship` (the call
  `load_skill` makes) served pack 0.11.65 in 0.40 s. Its body was
  byte-identical to the first render, with no `staleBecause`. The 0.11.65
  tree survived pruning beside the three newer ones because the plugin cache
  still holds that version.

## Concerns

- A body past about 198K chars gets its tail saved to a file, which costs the
  agent one Read (see "Step 2: review"). The husk's instruction covers it.
  Claimview's `review` (202K) is the only unit near that size today.
- `rt agent start` cannot pass environment variables. PATH reached the session
  only through `--settings` with an `env` block in a file, and long
  `--extra-args` hit herdr's 1,024-byte line limit.
