# rt (repo tools)

Personal developer CLI built with Bun. Compiled to a standalone binary via `bun build --compile` and shipped inside the mattstack.app bundle, which installs it (there is no separate CLI tarball asset).

## Architecture docs live in Linear, not this repo

rt is one piece of a plan spanning five repos, so the governing design docs are
not in any single repo. Before proposing anything about rt's scope, board,
glance, gitq, or the acme skills, read `docs/architecture.md` for the links.

## Settings architecture

Every key any mattstack app reads lives in the suite settings stores behind
the resolver in `packages/rt-client`. Before adding a key, porting config, or
touching `~/.mattstack`, read `docs/settings-architecture.md` (scope model,
registry checklist, ownership latch, the call-time HOME and sops footguns).
The working rules for `getSetting`/`setSetting`, scope choice and latches are
the `rt-settings` skill (`skills/rt-settings/SKILL.md`); this file does not
repeat them.

Shared settings live in an org clone (`~/.mattstack/teams/<org>/`) as an
org store and one store per team folder. The resolver reads the org layer
and the active team's layer (`activeTeam()` in rt-client). A shared write is
refused unless this Mac's role owns the file
(`packages/rt-client/src/settings/org-roles.ts`, `lib/team/roles.ts`). Read
`docs/settings-architecture.md` and
`docs/superpowers/specs/2026-10-01-org-and-teams-design.md` for the layout,
selection and ownership rules.

The branch an org clone has checked out is the branch rt reads, syncs and
publishes on that Mac (`orgBranch` in `lib/team/org-branch.ts`), so an admin
can try a breaking change on a branch while every other member stays on main.
Never hard-code `main` for the org clone: publish, team sync, pack sync,
`rt team status` and the conversion script all follow the checkout. Two
exceptions: `rt team create` starts a new org on main, and `rt team invite`
refuses off main, because joiners clone main.

## Repo identity

Every per-repo store, daemon payload and REST path keys on a serialized repo
identity from rt-client, never a derived name, EXCEPT settings-store sections
(`repos.<identity>`), which key on the raw `host/path` form the resolver
expects. Before keying anything by repo, read `docs/repo-identity.md` and the
`rt-repo-identity` skill (`skills/rt-repo-identity/SKILL.md`), which carry
the two string forms, where each applies, and the identity-only verb guards.

## Monorepo layout

rt is the root package. `apps/*` (board, boxscore, chat, console, deck) and
the apps platform packages under `packages/*` keep their own contract in
`apps/AGENTS.md` (catalog rules, turbo, per-app scripts, UI authoring).
Turborepo (`turbo.json`, `scripts/turbo.sh`) runs
their gates and rt's static gates; `bun run check` is what `checks.yml`'s
`static` job runs. rt's unit suite is `bun run test` and never walks the apps'
vitest packages: the `test` script names rt's directories one by one, and
`scripts/ci/test-scope.ts` skips the macOS shards on a PR that touches only
apps trees or `plugins/` trees (each plugin has its own CI job, which
`scripts/__tests__/no-plugin-ci-jobs.test.ts` enforces). Deck serves the
apps from this checkout in dev mode
(`deck register --dir ~/Documents/GitHub/mattstack/apps/<name>`, or the
older `~/Documents/GitHub/repo-tools` folder on a machine that has not
moved it), and the release builds them at the tagged commit
(`scripts/build-apps.ts`, the `build-apps` job in `release.yml`); `rt-tray/deps.lock` lists them as
`source: "tree"` rows, which is deck's served-app catalog (the rows that
carry a `serve` port; `apps/deck/src/registry/bundle-catalog.ts`). gitq is
a tree row too, at `apps/gitq`, built the same way by `build-apps.ts` and
shipped as the plain `Contents/Helpers/gitq` CLI, but its row carries no
`serve`, so it is not in that catalog: deck never registers or serves it,
in dev mode or in the bundle, and gitq is a CLI tool only for now. gitq
releases on the same fast path as the others (`skills/rt-release/SKILL.md`) and also
publishes `@mattstack/gitq` to npm on its own schedule
(`apps/gitq/docs/releasing.md`), separate from the bundled CLI this repo
builds. `packages/glance` and `packages/glance-react` keep their own
contract in `packages/glance/AGENTS.md`.

## Worktree pool: the golden tree

Every repo with `onDeck > 0` has one `kind: "golden"` worktree under
`~/.mattstack/rt/golden/<segment>/`. New on-deck members are built by
`clonefile(2)`-ing its git-ignored artifacts and inheriting its
`readyStamp`; they never run `pnpm install` at birth. Before touching
`lib/worktree/hydrate.ts`, `lib/worktree/clonefile.ts`, or replenish, read
`docs/superpowers/specs/2026-09-21-golden-worktree-hydration-design.md`.

Three traps, each of which cost a real debugging round:

- **The golden and the pool root must share an APFS volume.** `clonefile(2)`
  fails `EXDEV` across volumes, and replenish answers that by silently
  cold-creating, so the symptom is slowness, not an error.
- **Nothing on the replenish path may create the pool root.** The volume
  probe stats the nearest EXISTING ancestor for exactly this reason: an
  existing pool root is what tells `isHeldByUnreadableMount`
  (`reconcile.ts`) that a vanished mount is live again, and that hold is
  all that stops a mount outage from pruning live claim state.
- **`pnpm install` on an already-current tree still reruns every lifecycle
  script** (~3 min on a large pnpm monorepo), so a hydrated member must inherit the
  golden's stamp rather than "verify" itself with an install.

## rt chat

Group chat and presence for the agents in the estate, over the daemon. Before
touching `commands/chat.ts`, `lib/state/chat-store.ts`, the `chat:*` daemon
handlers, or `skills/rt-chat/`, read in this order:

- `skills/rt-chat/SKILL.md`: the agent-facing rules (sign-in, arming the tail
  under `Monitor`, re-arm, posting from a heredoc, what to say in a pane).
- `docs/superpowers/specs/2026-08-23-rt-chat-design.md` and
  `2026-08-24-rt-chat-presence-design.md`: the schema (v3 rooms/messages,
  v4 presence/DMs), the wake protocol, the two heartbeats.
- `docs/superpowers/specs/2026-09-27-chat-identity-design.md`: the identity
  model (a hidden id behind every display name, minting, continuation, name
  resolution), which wins wherever an older chat spec treats the handle as
  the identity.
- `packages/rt-client/README.md` "Chat": the wrappers, relay and health probe
  the web viewer is built on.

The viewer lives at `apps/chat` (`apps/chat/ARCHITECTURE.md`).
`lib/chat-viewer-url.ts` builds the `/r/<room>#m-<id>` links the CLI
prints; that route shape is a contract with the viewer's route table.
The herdr plugin lives at `plugins/herdr-chat` (`plugins/herdr-chat/AGENTS.md`).

## Harness integrations (Codex and Claude Code)

Chat delivery, gate questions and workflow policy reach Codex and Claude Code
through shared services in `lib/agent-integrations/` (one adapter per harness
under `claude/` and `codex/`) and the Claude Code mod at
`plugins/mattstack-mods`. Before touching either, read
`docs/superpowers/specs/2026-10-04-harness-integrations-design.md` and
`docs/superpowers/specs/2026-10-07-harness-integrations-claude-mods-design.md`.

- **The machine setting `agent.integrations.enabled` gates all of it.** With
  it off, every verb, hook, envelope and delivery is byte-identical to rt
  without integrations; a change that moves anything on the off path is a
  bug. Setup installs `mattstack-mods` only while the switch is on
  (`modsPluginWanted` in `lib/setup/base-plugins.ts`).
- **The `session:*`, `policy:*`, `agent:policy-receipt`, `runs:owned`,
  `worktree:registered` and `worktree:entered` daemon verbs are not
  authenticated.** rt.sock trusts any local process, so one can register
  a session link before the session's real mod does, and a continuation
  carries the old session's readiness. The last three resolve their caller
  only from the live mod link, and `worktree:registered` is what lets the
  mod skip a permission prompt. That is the recorded posture, not an
  oversight; anything that grants authority on these verbs needs a design
  review. `board:stand-down` is one more: it reaches only a session whose
  live mod link carries the `board` block, takes no text, and only ends
  that session's turn.
- **Codex's policy hooks run the hidden `rt agent policy-hook`.** Its stdout,
  stderr and exit code are Codex's hook protocol: exit 2 with stderr is the
  refusal Codex shows the model, so nothing else may write to its stderr.
- **`plugins/mattstack/hooks/pipeline-gate-stop.sh` stays the unchanged Stop
  backstop.** Its rule is shared with `evaluateStop` in
  `lib/agent-integrations/policy.ts`, and the parity test in
  `lib/agent-integrations/__tests__/policy.test.ts` runs both on the same
  cases; change one only with the other.
- **Deliveries live in state.db's `agent_deliveries` table.** The room log
  stays the source of what is owed; the daemon's `harness-delivery-recovery`
  and `gate-question-recovery` units reconcile, at boot and when a harness
  reconnects, what a previous daemon or a lost connection left unresolved.
- **A herd job's worker holds it through herds.db's `herd_job_attempts`.**
  At most one attempt per job is active (a unique index enforces it); a
  reserved attempt holds nothing; an attempt activates only after its
  session's verified bind and, with the switch on, a current policy proof.
  Attempts are recorded whatever the switch; only the switch on makes them
  authorize. A job whose active attempt carries only a `legacySession`, or
  that no attempt ever took, keeps the pre-integration rule: the call names
  the job and comes from the session its row records.
- **Supervision reads one in-memory observation store**
  (`lib/agent-integrations/observation-store.ts`). A session's own push
  outranks a poll of the same generation until it is older than
  `STALE_OBSERVATION_MS`, except that a polled `blocked` pre-empts it (a
  prompt the mod cannot see). Pushed deaths are kept apart, keyed by binding
  key and generation, so a later generation's readings never erase them.
- **A run names its owner by `session-key`.** Ownership is owned, foreign,
  unowned or `unproven` (a `claude-session` the session store cannot tie to a
  binding); an ownership-sensitive write resolves only through an owned run
  and never picks the newest run in a directory (`lib/runs/resolve-db.ts`).
- **CI leases and worktree holders share one owner token,
  `binding:K[:attempt:X]`.** A resume keeps it and a replacement attempt
  gets a new one. A legacy `session:<id>` token counts as the caller's only
  through the session store's proof.
- **Worktree holders live in the `agent-worktrees` kv**, keyed to the
  tree's claim. A tree with no live holder keeps today's path (announce,
  `decideRemove`); a holder refuses only a different live owner.
- **rt's Codex policy hooks live in Codex's user layer**
  (`$CODEX_HOME/hooks.json` for the profile), never in a repo's `.codex`:
  rt leaves no footprint in any repo. A trusted repo's own `.codex` config
  can still turn every hook off, which is why each session's hook check
  stays mandatory. `THREAD_GONE`
  (`lib/agent-integrations/codex/sessions.ts`) is pinned to Codex 0.162's
  `-32600` wording and fails safe: an unmatched error leaves the thread
  attached.
- **`rt agent integrations` is agent-safe**, so the `rt_verb` tool runs it.
- **Which harnesses are on is the person's choice, kept per Mac.** The
  list `agent.integrations` and the default `agent.provider` that
  `rt setup harnesses <ids…> --default <id>` saves (the tray's picker runs
  it) are machine scope, and the `2026-10-09-record-enabled-integrations`
  migration records, at machine scope, the list a Mac already used from its
  own `agent.provider`. `writeIntegrationChoice`
  (`lib/agent-integrations/preferences.ts`) is the one write, and it refuses
  a user-scope list or default that a machine value would hide. `rt setup
  harnesses` is never agent-safe.
- **Every Codex hook approval ends at macOS's owner check.**
  `applyCodexPolicyInstall` calls `confirmOwner`
  (`lib/agent-integrations/codex/owner-auth.ts`), which runs the app's
  `Contents/Helpers/rt-owner-auth` (built into both flavors) and counts only
  exit 0 with `authenticated`. The terminal review and the tray's approval
  sheet (which runs `rt setup codex-policy --approve <id>`) both end there.
  The helper is found by the flavor rt was built as, never
  `MATTSTACK_FLAVOR` and never `mattstack.appPath`: a compiled rt uses its
  own bundle alone and runs the helper only after `codesign --verify
  --strict` passes a requirement anchored to Apple, the running app's own
  team and `com.mattstack.helper.rt-owner-auth`; a source run uses the dev
  app in `/Applications` or `~/Applications`. No helper, a failed check, or
  `NODE_ENV=test` refuses.
- **`lib/__tests__/no-agent-integration-boundary-leaks.test.ts` is a
  two-way ratchet.** Only the files it lists, each with a reason, import
  `lib/agent-integrations/{claude,codex}/` directly. A new import fails until
  it is listed (better: reach the harness through the registry), and a
  listed file that stops importing fails until its row goes.
- **Codex gets its own build of the app skills.** `scripts/build-apps.ts`
  stages an app's `skills-targets/codex` tree, `rt-tray/build.sh` lands it at
  `Contents/Helpers/skills-targets/codex/<app>`, and `skills.link` links a
  Codex host from there; `scripts/__tests__/no-codex-skills-bundle-drift.test.ts`
  pins the three together. `assertCodexClean` fails the build on a
  `${CLAUDE_*}` variable or a tool Codex lacks. An app in
  `CODEX_WITHHELD_APP_SKILLS` (`lib/skills/harness-target.ts`; gitq today)
  ships and links no Codex build, and a Codex action of it refuses, until its
  skills carry the questions fragment; `check-bundle.sh` fails a bundle that
  ships one.
- **Harness acceptance runs only in an environment it owns.**
  `scripts/acceptance/harnesses.ts --profile <claude-only|codex-only|mixed>`
  drives the environment the `RT_ACCEPTANCE_ENV` descriptor names, whose root
  must hold a `.rt-acceptance-owned` marker naming the same id; without one
  every scenario is recorded blocked, never passed. Results go to
  `docs/superpowers/evidence/harness-integrations-acceptance.json`, and
  `--verify` exits 0 only for a complete matrix that passed on one artifact
  at versions `scripts/acceptance/tested-versions.json` lists. Each pass
  says who stands behind it: `machine` when the runner observed it,
  `operator` for a capture made by hand, whose files, events and timing the
  runner checks but whose steps it cannot prove. The artifact's commit is the
  bundle's `MSSourceCommit` Info.plist stamp, which `build.sh` marks `-dirty`
  for a dirty tree.
- **Every release compiles and strictly checks the mattstack plugin's
  Codex build** (`scripts/release/marketplace.sh`), so a broken one stops
  the release, but publishes its `.codex-plugin` manifest, `targets/codex/`
  and the Codex catalog only with `RT_PUBLISH_CODEX_BUILD=1`, which stays off
  until a task installs the build on Codex and checks those shapes live.
- **The mods register blocks only inside `TESTED_CLAUDE_CODE`**
  (`lib/agent-integrations/claude/mod-links.ts`). Outside that range a mod
  registers with no blocks and the shell hooks keep the session. Widen the
  range only after a live check on the new Claude Code version.
- **Listing integrations never imports setup modules.** The "metadata loading
  does not import setup modules" test in
  `lib/daemon/__tests__/agent-integrations.test.ts` counts type-only imports
  too; put a shared type in a leaf module (`lib/daemon/pane-hints.ts` is one)
  rather than importing it from a handler.
- **A Codex session's init turn ("Reply READY") runs before its binding and
  before any policy check.** It carries no work and no gate; that gap is
  recorded and accepted.
- **A Herdr Codex session takes input only with live pane evidence.** A
  manually started thread gets its pane from herdr's Codex pane for that
  thread at sign-in; without one it signs in, says it cannot take messages,
  and every post to it reports `refused`.

## plugins/mattstack

The mattstack skills plugin lives at `plugins/mattstack` and keeps its own
Markdown and shell style, never rt's formatter. Its checks run in the
`plugin-mattstack` job (certify, `rt skills check --strict`, the mcp-tools
reference diff), which also fails a PR that changes the plugin without
bumping `.claude-plugin/plugin.json`'s version. After any MCP tool change,
regenerate the reference: `bun cli.ts mcp tools --json | bun
plugins/mattstack/scripts/gen-mcp-tools.ts >
plugins/mattstack/attachments/mcp-tools/reference.md`. An edit under
`plugins/mattstack/attachments/gate-protocol` needs `bun run
skills:expand:board`, which writes both the Claude copy `apps/board/skills`
and the Codex copy `apps/board/skills-targets/codex`, and both committed in
the same PR, or the always-run board skills guard fails.

## rt-ui

rt's prompts and step spinners render through a bundled Go helper
(`ui/`, binary `rt-ui`, `Contents/Helpers/rt-ui`) driven over NDJSON on
stdin/stdout with `/dev/tty` for the screen. Before touching `lib/ui/*`,
`ui/`, or the prompt facade, read
`docs/superpowers/specs/2026-08-29-rt-ui-bridge-design.md`: the protocol,
the exit-code contract, the never-spawn-without-a-TTY gate, and why the
source checkout outranks the installed bundle when resolving the binary.
`bun run ui:build` after any change under `ui/`; the shared fixtures in
`ui/fixtures/` are golden-tested from both languages.

Every picker is the one-shot `rt-ui pick` verb
(`ui/internal/views/picker/`), driven from TS through the wrappers in
`lib/pick-wrappers.ts` and `lib/ui/pick.ts`; it replaced fzf outright, so no
fzf spawn path remains. Before touching picker rendering read the design
boards in `docs/design/picker/` and the spec
`docs/superpowers/specs/2026-08-31-rt-picker-redesign-design.md`: the row and
segment wire protocol, the action registry that drives the keybar and menus, the
modal overlay stack, and the headless fzf matcher (`match.go`) that is the one
piece of fzf kept, as a ranking library, never a spawn.

`rt runner` is the first `session` view: `commands/runner.ts` gates, selects
the backend, and wires; `lib/runner/runner.ts` owns the entries and the
intent loop; and `ui/internal/views/board/` paints. Services run in a
detached tmux session by default (`lib/runner/tmux-engine.ts`); `--herdr`
opts into headless herdr panes instead (`lib/runner/engine.ts`'s
`HerdrEngine`, still the only herdr socket door), and focus (`f`) is the
only tmux-mode path that touches herdr, splitting a pane that attaches the
session. Read
`docs/superpowers/specs/2026-08-29-rt-runner-design.md` before touching any
of them: the board is ephemeral and pane-owned (quit closes the workspace),
the exit code of a pane command comes only from the `__rt_exit` sentinel,
and the add flow closes and reopens the session around the rt-ui picker.

### Shared rt-ui primitives -- lift, don't duplicate

`ui/internal/views/picker/scroll.go`'s `Viewport`/`ThumbSpan`/`ThumbCell` are
the one scroll-offset/thumb implementation for every scrolling region in
rt-ui (the picker's own list, the diff pane, the Changes list, and all
three mission foldouts) -- vim-style scrolloff, a caller cap, a shared
`h*h/n` thumb formula, with the thumb's own styles passed in per caller.
`clip`/`clipOn` (`ui/internal/views/mission/topbar.go`) are the only text
clippers mission uses. A new scrolling region, thumb, or text-truncation
site imports and calls these; it does not hand-roll a second copy. When a
new cross-view need comes up (a bordered box, a keybar strip, a row's
rest/hover/cursor background), check picker/board/mission for an existing
implementation FIRST and lift the best one to a shared spot rather than
writing a third version -- this was a standing correction after mission's
own diff pane and Changes list had each grown a byte-for-byte duplicate of
the picker's viewport math independently.

### Mission adopts GitHub Desktop's staging model

`rt glitter`'s checkboxes (line, hunk, or whole file) are commit
INTENT, not index state -- toggling one never touches git. The real
index is rebuilt from scratch at commit time (reset to HEAD, then
restaged file by file from each one's own selection), so **anything
staged outside glitter -- a plain `git add`, another agent editing the
same repo concurrently -- is discarded at the next commit and replaced
with exactly what the checkboxes say.** This is GitHub Desktop's own
behavior, not a bug. Full design and the one selection-persistence
exception (a Partial selection downgrades to None, not All, once a
commit or discard shifts its file's diff shape) are in
`docs/design/mission/README.md`'s "Staging model" section.

## Output layer

Everything rt prints for a person goes through `lib/ui/out.ts`. Builders
(`out.line`, `out.callout`, `out.kv`, `out.table`, `out.tree`, `out.section`
and the rest) return data; `out.print` draws them through the one-shot
`rt-ui render` verb at a terminal and prints the same words plainly
(`lib/ui/out-plain.ts`) off a TTY, under `--json` or `RT_BATCH`, or when the
helper is missing or fails. Before adding or changing output, read
`docs/superpowers/specs/2026-09-30-rt-output-layer-design.md`: the block
vocabulary, the ten statuses, the color roles and the rules.

Five rules cost the most when broken:

- **Coral is for failures.** A state that is not yet done, turned off,
  stopped or refused by policy has its own status (`pending`, `off`,
  `refused`, `needs-you`). Never reach for `failed` to draw attention.
- **Never style a payload.** Text another program reads (the `rt cd` path,
  `git credential`, a key, a bare path) goes through `out.payload`, and a
  verb whose stdout is a payload calls `out.payloadOnStdout()` so its human
  text moves to stderr.
- **`--json` goes through `out.json` and is frozen.** Plain text off a TTY is
  not frozen: it carries the same wording as the styled output, so a skill
  must read `--json`, never scrape text.
- **No colors on the TS side.** `out.ts` holds no ANSI and no glyph styling;
  the theme lives in `ui/internal/theme` and nowhere else.
- **Body text takes the terminal's own foreground.** Only accents (glyphs,
  callout labels, keys, hints, rails) use theme colors, so output reads on a
  light terminal as well as a dark one. Static output takes its accents from
  `theme.StaticDark` on a dark background and `theme.StaticLight` otherwise;
  `ui/internal/background` picks from the `rt.ui.background` setting
  (`auto`, `dark`, `light`), then on `auto` `COLORFGBG`, Ghostty's configured
  background (only when `TERM_PROGRAM` is unset, `ghostty`, `herdr` or
  `tmux`, since Ghostty's environment leaks into editors and multiplexers
  started from it) and last the terminal's OSC 11 answer, and an unknown
  background gets the light set. Setting `dark` or `light` skips the
  terminal query. A new accent needs a tone in both sets that passes both
  sets' contrast tests. Never give body text a fixed color.

Plain output collapses newlines and tabs in single-line fields (titles,
hints, cells, labels) to a space and indents paragraph lines two spaces, so
untrusted text cannot forge a status row. A `copy` block prints at column 0
with no rail, at a terminal and off one, so a drag-select pastes it clean;
that is also why it must never carry untrusted multi-line text. Step
sub-lines sit under their running step: they clear when the step ends with
`done` and stay beneath it when it fails.

A callout row that is only a command prints whole. A row whose one command
is its last segment (`["Commit them, or set them aside with ", out.cmd("rt git
stash push")]`) prints its sentence on the label row and the command on the
row under it, so end the sentence where the command starts; any other row
wraps at its spaces and never splits a command. A command too wide for the
label column moves to the bar column, then to column 0 with no bar, and only
one wider than the pane runs past it. Off a terminal the row stays one line. Consecutive `kv` blocks in one `out.print` share a key column, so
print a group of them in one call.

`out.print` writes plain text to stdout under `--json` too, so a verb whose
`--json` branch can still print a note (a repo whose identity cannot derive,
a lock file that is missing) calls `out.payloadOnStdout()` as soon as it
knows `--json` was passed; otherwise the note lands inside the envelope a
program is parsing. A verb that prints a payload (`rt settings get`'s value,
a bare path) calls it unconditionally. The `--json` byte-identity tests
(`commands/__tests__/settings-json-frozen.test.ts` is the model) assert an
empty stderr as well as the frozen stdout.

A setup run (`rt setup apply`, `rt setup update`, `rt uninstall`) reaches a
person through `createStepEmitter` in `lib/setup/emit.ts`: one rt-ui step per
`step` event, titled from the `plan` event (never the id), streamed `log`
lines as sub-lines that also go to the CLI log through `logCliEvent` at
`debug`, a `fix` callout for a remedy, and a `summary` at the end; a verb
awaits `flush()` before it exits. The NDJSON stream and the plan are the app's
contract and go through each verb's `json` seam (`out.json`): their shape
(keys, structure, types, exit codes, every value a program reads) never
changes without a contract change, while a `Row.detail`, a
`StepOutcome.detail` or `remedy` and a `UserActionableError` message are copy
the tray displays and never parses. `commands/__tests__/setup-copy.test.ts`
pins both views as snapshots, so a wording change is a deliberate
`bun test --update-snapshots`, and a machine view change is a failing test.
Write that copy in the command-description style, and never put a plain-words
key into an envelope: plainer words for a person ride the error's `why` and
`next` or `exitWithUserError`'s `human` argument.

Failures have one shape. A command that cannot continue throws
`UserActionableError` (`lib/errors.ts`) with what happened in a short plain
sentence, an optional `why`, the command to run as `next`, and any raw
child output as `log`; the dispatch seam in `cli.ts` draws it as a `failure`
block on stderr and exits 2, and `exitUserError` does the same for a verb
that handles its own `--json` (the envelope stays on stdout, byte for byte).
Anything else that reaches the seam prints one line, "rt hit an unexpected
error", with the message as the hint and the stack in the CLI log; the stack
also prints off a TTY or under `RT_LOG_LEVEL=debug`. Do not catch an error
only to print it: throw the typed one, or let it reach the seam. The first
converted failure is the team secrets file a Mac's age key cannot open
(`teamSecretsUnreadable` in `lib/secrets/team-store.ts`); its sops output
goes to the log, never the screen.

`lib/__tests__/no-raw-output.test.ts` fails a PR that adds `console.log`,
`console.error`, `console.warn` or `console.info`, any use of
`process.stdout` or `process.stderr` beyond reading `isTTY`, `columns`,
`rows` or `fd` and attaching listeners, a raw escape or a color import, in
`cli.ts` or under `commands/` or `lib/` outside `lib/ui/`. There is no
allowlist: every print goes through the layer. A file that must touch a
stream directly (a logger, an escape parser) is listed in
`lib/__tests__/raw-output-exemptions.json` with its reason and its exact
count of raw lines; the guard fails if the count moves either way.

`out.note(...blocks)` prints for a person on stderr whatever the verb: use it
for a notice that fires before the verb is known or under any verb, since
stdout may be a payload or a `--json` envelope. It does not follow
`payloadOnStdout`. Code under `lib/` never calls `console.warn`: it calls
`warn(module, message, { context, show })` from `lib/ui/warn.ts`. The message
always reaches a log (the CLI log in the CLI; a plain `rt:` stderr line in the
daemon, whose stderr is already captured), and a person sees a line only when
`show` says what they should read, once per process. A test of such a line
reads stderr through `captureOut()` or sets a fake with `setWarningLog`, and
calls `__test__.reset()` from `lib/ui/warn.ts` before and after; a
`console.warn` spy sees nothing.

The dispatcher draws the breadcrumb before the handler runs, through
`out.note`, on stderr, when a person is reading stderr (a terminal, no
`--json`, no `RT_BATCH`) and the leaf is neither `fullscreen` nor `hidden`.
It is its own render call (one helper launch per command), so it is first on
screen whatever the command paints first, and one blank line follows it
(`out.blank()`, the one block that prints an empty row on purpose; never an
empty table).

A spinner that should leave nothing behind is `withTransientStep(label, task)`
from `lib/ui/transient-step.ts`: the Go step draws it and a `done` event
carrying `clear: true` erases it when the task settles. The flag rides `done`
so a helper that predates it ends the step with a plain row, on the neutral
dot when the task threw (`status: "failed"` rides along); a source checkout
runs the installed helper when `ui/dist/rt-ui` is missing or stale, so run
`bun run ui:build` after pulling. It loads `lib/ui/spawn.ts` on first use, so
a file the daemon also loads may import it; keep it that way.

A usage error is `out.fail(usageFailure(title, usage, why))` from
`lib/ui/usage.ts`: the title asks for what is missing in plain words and the
usage line is the `next` command, never part of the sentence. The `--json`
error string stays as it was.

Off a terminal, a failure that opens the output prints its title with no
`[failed]` tag, because the app shows the first bytes of stderr to a person as
they are. A test of a human failure asserts the title at the start of stderr.
A failure printed after another block, a title that starts with `[` (leading
spaces aside), and a `line` with status `failed` keep the tag.

Both renderers drop bidi controls and zero-width characters from every field
(`ui/fixtures/clean-cases.json` is the shared test). Wrapped text breaks at
spaces, so a flag or a branch name that fits its row is never split at a
hyphen; a word wider than its row breaks after its last `/` that fits (then
`\`, `-`, `_`, `.`, `:`), and only a word with none is cut between
characters. A `line` hint with a word too wide for its column takes the row
under its title, whole. `verbatim` wraps the same way;
`textwrap.Spans` keeps its hyphen breaks for the mission diff, and prose goes
through `textwrap.SpansWith` with `WordsOnly`. The diff takes pale tints only
when the background resolves light (the same resolver as the accents); a dark
or unknown background keeps the dark tints.

A verb that prints a report builds it in a pure function that returns blocks
(`checkBlocks`, `syncBlocks`, `linkBlocks` in `commands/skills*.ts`) and prints
it with one `out.print`; the tests pin that function through `renderPlain`,
so no test needs a console spy. A pack author's compile diagnostics (the
`lib/skills` errors that name a file, a slot and a line) keep their exact
words, because they also sit inside `--json` values: a `SkillsUsageError`'s
`message` never changes for the sake of the screen, and wording meant for a
person goes in its `shown` failure. Any other sentence a person reads takes
plain copy even when an envelope carries it, with the envelope's keys and
machine-read values kept. A refusal by policy is `out.note` with a
`refused` line, never `out.fail`.

The git verbs fail through `commands/git/shared.ts`: `failPlain(json, title,
message)` keeps git's own message as the `--json` error and prints it under a
plain title for a person, `failUsage` does the same for a usage string, and
both exit 1. A refusal by policy (the ownership guard, an undo rt will not
do, the uncommitted-changes guard, a stack member under `rt sync`) is never
a failure: `refuseWith` prints a `refused` note on stderr and keeps the
`--json` error and exit code, and `refusalNote` returns the note's blocks.
`drawFailure(failure, refused)` draws that refused note only when `refused`
is true, else a coral failure. The API under `rt sync` (`rebaseOnto`,
`resetToOrigin`, `syncBranch`) never prints a failure: a result that ends
badly carries `failure` beside `error`, plus `refused: true` when it is a
refusal, and the caller draws it with `drawFailure`, so `sync` and
`git rebase` show one block for one cause on stderr, and `sync all` writes
each branch's ending to stderr under its heading, with one blank row between
branches. Their progress lines go to stdout through `out.print` and stop
under `quiet`, all but one: the fetch step `rebaseOnto` and `resetToOrigin`
run without `skipFetch` still draws under `quiet` (on stderr under a payload
verb, so `rt git rebase --json` shows it). `syncBranch` fetches once itself,
gated, and passes `skipFetch`, so a quiet sync prints no progress at all.

`rt sync --json` and `rt git rebase --json` call `out.payloadOnStdout()`
first, so stdout is the conflict bundle or the stack refusal and nothing
else; a step's plain line and every note go to stderr. A failed
`rt sync --json` writes one failure, last on stderr, in at most three lines
(`compactFailure` in `commands/sync.ts`), because `branch_sync` builds its
error from the last three stderr lines (`detail` in `lib/mcp/git-tools.ts`).
A new sync failure with `details` needs no care; a new line printed to stderr
after the failure breaks the tool's error.

`lib/ui/steps.ts` prints nothing by hand: off a terminal a step's ending is
`out.print(out.line("done" or "failed", ...))`, and a helper that dies costs
one warning through `out.note` and a line in the CLI log. A step run with
`failSilently` prints nothing off a terminal either; at a terminal it ends
with `clear({ thrown: true })`, so its row is erased and the caller draws the
failure. The runner has no `log()`; a line between steps is an `out.print` at the call site.

A `print` seam on a command's deps (`TeamDeps`, `RegisterDeps`,
`ReidentifyDeps`) carries the `--json` envelope line and nothing else; its
default is `out.payload`, so a test of a human branch reads `captureOut()`
and a test of the envelope reads the seam. A sentence that rides in an
envelope and is what a person reads (an error's message, a join's
`message`, a manual step) follows the copy rules like any other: the
envelope's shape is what is frozen, not its words, so reword it and keep
every key, code and status. A command goes in the
error's `next` option, which the envelope never carries; a result string
that is the only carrier of its remedy keeps the command as its last words.

A warn sink under `lib/` that a caller can replace (`lib/team`'s three)
takes `(message, shown?)`: the message is the log text and `shown` is the
plain copy a person reads. Code that catches a `UserActionableError` and
turns it into such a warning passes `err.next` as the copy's `next`.

`rt chat` is read by agents as often as by a person, so its stdout off a
terminal is frozen. Every verb writes the text it always wrote through
`out.payload` (`say` in `commands/chat.ts`) and its `--json` through
`out.json`, and `commands/__tests__/fixtures/chat-bytes.json` pins the bytes;
never regenerate that fixture to make a change pass. Chat's `--json`
envelopes carry the daemon's words and are not reworded, unlike the
envelope sentences above. Only `rooms`, `read`,
`who`, `buddies`, `sign-in` and `--help` draw blocks, and only when
`out.isHuman()` says a person is at the terminal (`show`). Chat failures are
ordinary `failure` blocks on stderr; where chat declines on purpose (a long
one-line message, a second identity in one session) it is a `refused` note
(`refuse`), with the same exit code.

A verb that streams a child's output (`rt sdm connect`, `rt sdm login`) runs
the child under `withProgress` in `commands/sdm.ts`: at a terminal the lines
are a step's sub-lines, every line goes to the CLI log at `debug`, the step
is erased when the task settles, and a failure prints the last five lines
under its `failure` block. Every line passes through `redact` first, which
replaces the one-time token in a StrongDM auth url, so neither the log nor
an excerpt keeps it. No prompt and no child that owns the terminal may run
inside it. Under `--json` nothing is drawn and child output stays off
stderr. A sentence inside an sdm envelope that a person also reads (a
connect's `hint`, a health `message`) never quotes a command: the command
rides apart, in the failed result's `next`, and the CLI shows it as the
`next:` line.

A release row's `detail` is copy a person reads, but the data in it (a
version, a sha, a tool's output) stays as it is.

A run a person watches step by step (`home init` and its refresh steps)
opens one rt-ui step per stage through `openStep` and ends each in its own
line, with the stage's progress as sub-lines; off a terminal each ending
prints as one plain line. Every sub-line also goes to the CLI log, and always
through `withoutUrls`, since a clone url can carry a token. A program that
reads such a run's text (the setup app's `home.init` step) keys on constants
both sides import (`INIT_STEP_FAILED`, `INIT_OUTPUT_CAPTION`), never on a
copy of the words.

`lib/prompt-secret.ts` re-exports `lib/ui/prompt-secret.ts`: the no-echo
prompt holds the terminal in raw mode and lives with the other prompts.

The agent-only verbs the spec leaves unconverted (`gate`, `events`, `ci`,
`mcp`, `runs find` and the run-tracking writes, `worktree claude-hook`)
still write through the layer, with no change of bytes: stdout through
`out.json`, `out.jsonFlushed` or `out.payload`, stderr through
`out.diagnostic`, which is the stderr twin of `out.payload` and is for
agent-facing verbs only (these, and the herd, pane and agent verbs).
`commands/__tests__/fixtures/agent-verbs-bytes.json` pins them; never
regenerate it to make a change pass. A file that must
touch a stream directly (the loggers, an escape parser) goes on
`lib/__tests__/raw-output-exemptions.json` with its reason and its exact
count of raw lines, and the guard fails if that count moves.

`rt daemon` draws a stopped or uninstalled daemon as `off` and a slow one as
`pending`; only `crash-looping` and `boot-failed` are failures. Its waits on
the tray run under `withTransientStep` and print one result line after.
The log viewer's seams take blocks (`print`, `fail`), so the tray, which
shows the first stderr line when `rt daemon logs --no-open` exits early,
reads a failure title.

`rt herd`, `rt pane` and `rt agent` follow chat's rule: off a terminal
every verb writes the bytes it always wrote (`say` and `out.json` on
stdout, `out.diagnostic` on stderr), pinned by
`commands/__tests__/fixtures/herd-pane-agent-bytes.json`; only `herd
list`, `herd status`, `herd gates`, `pane list` and `agent list` draw
blocks, and only when a person is at the terminal.

The service verbs (`services`, `apps`, `flavor takeover`, `bg`, `cron`,
`reconciler`, `endpoint`) draw everything a person reads with blocks and
keep their `--json` envelopes unchanged. `services`, `apps` and
`flavor takeover` keep an envelope seam that writes through `out.payload`;
`bg`, `cron`, `reconciler` and `endpoint` write theirs through `out.json`.
Human failures go to stderr; the envelopes the tray reads did not change.
`rt intercept run`'s passthrough notes are plain sentences; only its debug
traces keep the `rt-intercept:` prefix, because `commands/intercept.ts`
routes them to the log by that prefix.

A command a person can run to fix something names its subject in a form the verb resolves: `rt repos locate --repo` takes a repo's `host/path` label, so printed commands use that (`repoLabelFull`), never the stored identity.

A list that belongs to a failure (the files a rebase stopped on, the lines
a child printed) is a `verbatim` block with a caption passed after the
failure (`out.fail(f, ...after)`), never the failure's `details`, which
is a one-line pointer. Something rt leaves alone because it did not create
it is worded the same everywhere: rt did not make it, so rt left it alone.

A daemon handler that declines by policy returns `failure: { code, message }` beside its `error` (`CommandResult`), and the CLI maps known codes to `refused` notes; the `error` string itself never changes, since hooks and the daemon's own retries match on it.

Warnings under `lib/state/` go through `warn`: logged always, shown only
where 5a's warnings table or the phase 6 scoping rows say so, and once per
process. The daemon sets no warning log, so it still files the plain
`rt: <message>` line from its stderr capture.

A table rt-ui cannot fit without cutting a leading column stacks instead: each row's first cell on its own line, the other cells under it, every cell led by its column header. A value longer than the pane wraps, an unbroken one cut between characters. On a pane 26 columns or wider no cell value is clipped; narrower than that, each stacked line is clipped to the pane. Trees still clip a leading column to keep their branches aligned.

A failure's multiline `why` keeps each reason on its own callout row. A `verbatim` block captioned `why` draws those reasons with the same thick callout bar; other verbatim captions keep the thin rail.

`rt cd` and `rt nav` print a path for the shell wrapper. They call
`out.holdStdout()` while their pickers run, which sends any stray write and
all human text to stderr, then release it and write the path with
`out.payload`. A child they start gets the terminal on stdout through
stderr's descriptor (`stdio: ["inherit", 2, "inherit"]`), never the
wrapper's pipe. Neither erases rows on exit.

## The TypeScript CLI is UI-free

The rt TS CLI (`commands/`, `lib/`, `cli.ts`, `scripts/`) is pure Bun/TypeScript
orchestration and MUST NOT contain UI-rendering code: no UI frameworks (ink,
`@inkjs/*`, react, react-dom, preact, vue, solid, svelte), no JSX, no `.tsx`
files. All UI is rendered by the Go `rt-ui` helper (prompts, steps, board,
pickers); the TS layer only drives it over stdio and process spawn. `packages/` (for example `packages/settings-kit`, a react UI
kit for the web console) is a separate concern and is exempt from this rule.

Enforced by `lib/__tests__/no-ui-in-cli.test.ts`.

## Command descriptions are plain language

A node's `description` in `lib/command-tree-def.ts` is what a user reads in
the picker, `--help` and the reference pages. Write it as a short, plain
sentence about what the command does for them: "Jump to a repo or worktree",
"See what's running on your ports and kill it", "Undo the last commit, keep
its changes".

Leave out what belongs in `args` hints or the reference page: flags
(`--json`, `--force-with-lease`), picker behavior ("no target + TTY →
picker"), implementation ("daemon-powered", "from git-core"), parenthetical
lists of subcommands, and internal names (registry, index, on-deck pool). A
verb that is only for the apps, skills or daemon goes in the
`rt.picker.hidden` default rather than getting a description that warns
people off it. After editing descriptions, run `bun run docs:gen`.

The same style governs every message a command prints: say what happened for
the person in a short plain sentence, speak to "you" and "this", leave out
flags, store names, file paths and step ids, and put the command to run in a
`next` callout rather than mid-sentence. Name only verbs that exist.

## Release & distribution

Before touching the release workflow, the app bundle, signing, Sparkle, the
marketplace, or the VM clean room, read `docs/release-and-distribution.md`.
It carries the release flow, the bundle/signing rules, and the traps only
real runs surfaced (translocation, VM Gatekeeper policy, headless CLT).

The GitHub repo is `m4ttstack/mattstack`. The old repo name `m4ttstack/rt`
is never recreated after the rename: every app installed before it fetches
its Sparkle feed through GitHub's redirect from the old name, and a new repo
under that name would capture those requests.

## Logging architecture

Logging is structural, not per-feature. Outcomes are logged at central seams; feature code only logs domain events. When adding a feature, you almost never need to add logging. Check this list before writing any.

**The seams (do not log outcomes yourself):**

- **CLI commands**. `dispatch()` in `lib/command-tree.ts` logs every command's outcome, and `installCliLogging()` (wired in `cli.ts`) covers every `process.exit()` path and persists crash stacks. A new command gets usage + error + crash logging with zero code.
- **Daemon commands**. Every IPC/REST command funnels through `handleCommand` in `lib/daemon.ts`, which logs ok/rejected/threw with duration. A new handler in `lib/daemon/handlers/` inherits this; do not log request/response or wrap handlers in logging try/catches.
- **Daemon crashes**. `installCrashHandlers` + `redirectNativeStderr` (`lib/daemon-logger.ts`) capture uncaught exceptions, rejections, JS stderr, and native bun panics.
- **Tray**. `TrayLog` (`rt-tray/Sources/TrayLog.swift`) is the only logging API (never bare `NSLog`); spawn subprocesses via `TrayLog.runLogged`/`spawnLoggedDetached`; `TrayServer.sendResponse` logs all non-2xx replies.

**The file convention:** every surface appends JSON lines to `~/.mattstack/rt/logs/<surface>.YYYY-MM-DD[.N].log` (daemon, cli, tray today). `rt daemon logs` auto-discovers surfaces by that pattern. A new surface that follows it appears in the viewer with no registration.

**What feature code SHOULD log:** domain events only, things invisible at the seams (a sync fast-forwarded, a watcher rewired). Daemon modules use `(await getDaemonLogger()).childLogger("<module>")`; handlers use `ctx.log`. Noisy periodic events go at `debug` (default level is `info`; `RT_LOG_LEVEL=debug` to see them).

**The catch policy:** never swallow errors in a seam. Below a logged seam, an empty catch is acceptable only for genuinely expected conditions (socket already closed, file already gone). Anything else logs at `warn` with `{ err }`.

## Gates and the `rt_verb` MCP tool

Agents reach rt from Claude Code two ways: Bash, and the mattstack plugin's
MCP server, whose `rt_verb` tool runs a curated subset of the command tree.
A verb is exposed there only when its node in `lib/command-tree-def.ts` sets
`agentSafe: true`; `listAgentSafe` in `lib/command-tree-resolve.ts` is the
one place that computes the set, and `lib/mcp/rt-verb.ts` refuses everything
else, refuses control characters in args, and caps a run at
`RT_VERB_TIMEOUT_MS`. Mark a verb agent-safe when a skill runs it as part of
its normal flow and it is an rt call, a forge call or a git write the
classifier blocks; the skill's own gates stay the human check. A leaf whose
run outlasts `RT_VERB_TIMEOUT_MS` sets `agentTimeoutMs` on its node. Only a
leaf that declares `--json` qualifies (`lib/__tests__/agent-safe.test.ts`),
and a leaf that writes or reads a caller-named path lists that flag in
`agentTempRootFlags` or `agentReadRootFlags` so `rt_verb` confines it first;
`agentDeniedFlags` and `agentNoCwd` refuse the flags and cwd that would let a
caller-written file drive a pack write. The tool is the long-term
replacement for Bash allow rules, so a careless flag here is a permission
grant on every estate machine.

Every other tool on the server is the rest of that grant.
`mcp__plugin_mattstack_mattstack` is in `BASE_PERMISSIONS`, so every tool on
the server runs on every estate machine with no permission check, and a new
tool is a write any agent can make unasked, including one reading untrusted
text (an MR under review). `mcpTools()` in `lib/mcp/tools.ts` is the roster
(`rt mcp tools --json` prints it). `tools.ts` itself holds the gate tools,
the `mr_*` writes and `mr_map`, `rt_verb`, the herd worker tools
(`herd_gates`, `herd_ask`, `herd_answer`, `herd_report`) and five chat tools
(`chat_post`, `chat_dm`, `chat_ack`, `chat_claim`, `chat_release`), and
spreads in the rest: run tracking (`run-tools.ts`, in-process over
`runWriteVerb`, a caller's `runDb` confined to the runs root), GitLab reads
(`mr-read-tools.ts`, `forge-read-tools.ts`: every one asks GitLab through
the daemon on each call and none reads the open-MR cache, so an agent can
read any MR its token can; `mr_map` in `tools.ts` is the exception and
reads the daemon's synced MR list; `gitlab_get` is a GET-only passthrough whose
daemon guard in `lib/daemon/forge-reads.ts` refuses the paths that return
credentials (`REFUSED_SEGMENTS`, also with a format suffix, and a path
percent-encoded more than once) and the query keys that carry credentials
or impersonation, caps the body at 256 KiB counted in bytes, never follows a
redirect (the token header would travel with it), and redacts
every `token` / `*_token` value; those lists are widened, never narrowed,
without a design review), CI (`ci-tools.ts`: `ci_watch`, which reads GitLab
on every poll, and the `ci_lease_*` tools), the stack store read
(`stack-tool.ts`: `branch_stack` admits a tree only through
`tree-guard.ts`), git writes
(`git-tools.ts`), worktrees (`worktree-tools.ts`: provision, dispose,
stop-holders, and no general kill), the other herd tools
(`herd-tools.ts`), the other chat tools (`chat-tools.ts`) and `whoami`
(`whoami-tool.ts`, which reads only the server's env and this session's own
chat session file); every chat tool acts only as this session's own handle.
Every git tool goes through `tree-guard.ts`, which
admits only the root of a registered checkout or worktree: `git_push` pushes
one explicit refspec to the branch's same-named upstream, forces only with
`--force-with-lease --force-if-includes`, and refuses a detached HEAD, main,
master and the remote's default branch (and a remote whose default cannot be
read); `git_pull` is `--ff-only`; `branch_sync` runs `rt sync` only after a
preflight that refuses to reset over unpushed commits or force-push over
commits only origin has. `herd_spawn`, `herd_close`, `herd_follow_up`,
`herd_attend` and `herd_wrap_up` run only from the session the daemon records as the herd's
shepherd, never from a worker pane, and every caller-named path a herd tool
or `rt_verb` takes (a brief, a template, an out file) is confined by
`temp-root-guard.ts` to the Claude Code temp root or an installed plugin or
pack root. Every result, success or error, passes through `callTool` in
`lib/mcp/redact.ts` (called by `commands/mcp.ts` for each tools/call), which
strips credentials from URLs, query params, token shapes and auth headers; a
new tool inherits it and must never answer around it.

The `mr_*` tools cover what board panes and pipeline verbs write (notes,
whole submitted reviews, approvals, resolves, note edits, draft state,
retries, rebase, create, update, upload, merge). `mr_review_submit` posts a
review the way GitLab's own submit does: pending comments, one publish with
the summary and a reviewed state, then the approval; it refuses when the
caller already has pending comments on the MR, because a publish would post
those too. `mr_merge` is on the server (GitLab still enforces approvals and
pipeline rules); the skill's ship gate is the human check. `mr_upload` is
the one tool that sends a local file off the machine, so its daemon guard
(`lib/daemon/upload-guard.ts`) refuses anything outside the target repo's
worktrees, the user's Claude Code temp root, rt's own evidence folder
(`~/.mattstack/evidence/`, `evidenceDir()` in `lib/rt-paths.ts`, for
screenshots you want to upload; admitted only as a real directory the
user owns, never a symlink), a pipeline run's own evidence folder
(`~/.mattstack/work/<run id>/evidence/`, for a run that exists) and
`rt.mcp.uploadRoots`, and anything whose bytes do not match its image or
video extension; widen the roots through that setting, never by loosening
the guard. Target resolution (`repoName` as identity, path or
label, or `mrUrl`) lives in `lib/mcp/mr-target.ts`; the daemon verbs still
take the serialized identity only.

Decision gates (`rt gate ask`, `rt gate wait`, the board's stage sheet) are
the only way an unattended pane asks a human anything. The
`AskUserQuestion` hook in `.claude/` panes defers to `rt gate fork-check`
(rt#391): it allows the launch subject's gate, a worktree run gate, or a live
form gate this pane asked under its own session, and never counts
pane-attention gates. Before changing gate ownership, the hook, or the
fork-check rules, read the gate-seam spec named in `docs/architecture.md` and
the `rt-chat` and gate skills under `skills/`.

## Switchboard and `rt team join`

Join refuses an invite whose `username` is not the signed-in forge login,
checks that the cloned roster lists that username, records `forgeUsername`
on this Mac, and sets `mattstack.activeTeam` to the invite's first team.
`rt team invite` pushes the roster entry before it makes the invite.

The switchboard URL is a built-in constant, `SWITCHBOARD_URL` in
`packages/rt-client/src/switchboard.ts`, read only through `switchboardUrl()`.
No setting holds it and no setup row asks for it; the hidden
`RT_SWITCHBOARD_URL` override (https, or http to loopback, never written or
shown) exists for local relay work and tests. A board token is only ever sent
to `switchboardUrl()`. `rt team invite` mints the invitee's board token there
when this Mac holds the switchboard admin token and seals only the token into
the invite; `rt team join` stores it under the rt secrets scope, writes no URL
setting, and refuses a pointer from an older rt whose URL is not
`switchboardUrl()`. `rt team peer` connects the own board of a Mac holding
the switchboard admin token, in practice the org admin's (`lib/team/peer.ts`): with the admin token readable it registers the
board under the username this Mac recorded for the org, the handle join
registers (else `board.defaultMember`, else the org forge's login), stores the
token in that same `switchboardToken` secret, and leaves a board whose token
already works alone; `rt team create` runs it and degrades to a warning. `rt team members remove` deletes the member's
board registration and `rt team status --json` reports `peered` per member.
The board's own roster only shows a read-only peered badge; it no longer
invites, removes or joins.
The `account.board-peering` row applies on a Mac in a team (created or
joined) that runs a board (the team's `board.projects`, or the board's
legacy `config.json`, tracks projects). It never shows on a Just Me Mac,
nor on a creator's Mac that lacks the switchboard admin token (in rt's
secrets, the environment or the board's `.env`) and joined no other team,
since nothing there can peer it. It reads `needs-you` when neither the
board's `.env` nor rt's `switchboardToken` holds a token (with the
re-invite remedy, or, on any Mac holding the admin token, the
`rt team peer` steps, which `verify`'s note names too), `error` with a re-check when
`<url>/healthz` (no auth header; `/health` is not a route) does not answer
200, `ready` otherwise. It is never required or finish-gated (only the org admin
can fix it), but `verify` reports it, so `rt setup update` notifies. The
stored copies older rt wrote (`board.switchboardUrl`,
`rt.integrations.switchboardUrl`, the board's `config.json` `switchboard.url`)
are retired keys deleted by the `2026-10-02-retire-switchboard-url`
migration, and `lib/__tests__/no-switchboard-url-setting.test.ts` fails any
code that names one. Change invite, join, peer and the row together or not
at all; `lib/team/invite.ts`, `lib/team/join.ts`, `lib/team/peer.ts`,
`lib/team/board-token.ts` and `lib/setup/validators/accounts.ts` are the
seams, and RT-260 is the incident
that made this a rule.

## Writing-style presets

Every review or reply an agent drafts composes in one writing style, resolved
by `resolveWritingStyle` in `lib/skills/writing-style.ts`: the
`skills.writingStyle` setting (user scope beats team), else the
`writing-style:` line in `~/.mattstack/user/skills/preferences.md`, else
`mattstack:writing-style-conversational`. `rt skills writing-style show`
prints the resolved skill and its source with the one wording the setup row
also uses (`WRITING_STYLE_SOURCE_LABEL`), so never restate it elsewhere.
`use` refuses a skill id that is not installed and `new` copies a preset into
the user's own skill, normalising CRLF and renaming the frontmatter so the
copy is a skill of its own. The presets themselves ship in the mattstack
plugin under `plugins/mattstack`; a preset id must exist there before
`use` will accept it, and the `skills.writing-style` setup row is
finish-gated and not waivable, so a machine with no resolvable style cannot
Finish.

## Setup checklist rows: required vs finish-gated

A row's `required` blocks Install; `finishGated` blocks the wizard's Finish
and never Install (`finalizePlan` and `finishBlockers` in
`lib/setup/contract.ts`). A finish-gated row must carry `waivable` on every
emit (an app reading a row without it treats the row as waivable) and only
ids in `WAIVABLE_ROW_IDS` may be waived by `rt setup waive`; `waived` is what
the app's Un-skip keys on, never the note's wording. A required row with a
fault must offer an action that can clear it: an actionless required row is
an Install nobody can reach (RT-260). A connect action may prefill a field
through `ConnectField.value`; the tray renders it as the field's initial
text. It may also carry `create`, a link the sheet opens in the browser
without closing: for the forges that is the new-token page with rt's scopes
pre-checked, and `lib/setup/token-create.ts` is the one list those scopes,
the field hint and the post-paste check all read, so a scope rt newly needs
is added there and nowhere else. Add a row by following an existing validator in `lib/setup/validators/`
and its `steps-*.test.ts` twin; the tray's `PlanModels.swift` decodes the
same contract, so a new field needs the Swift side too.

## Setup after an update

`rt setup update` is what the app runs at every launch once its services
settle (`AppDelegate.settleAgentsAfterLaunch`); rt decides whether anything
happens (`lib/setup/update.ts`: setup not finished, already stamped for
this version, or run), and only one run at a time holds
`~/.mattstack/rt/setup-update.lock` (`lib/setup/update-lock.ts`); a second
one reports `skipped: "running"`. A run is pending migrations, then
`org.pull` and `team.identity`, then the other `StepDef`s with
`updateSafe: true`, then `verify`, through `runUpdateWith` in
`lib/setup/apply.ts`. No failed outcome stops it, and a migration that
throws is one more failed item; only a step that throws a plain error
ends the run, as a bug (exit 1, no stamp). Otherwise the version is
stamped in `~/.mattstack/rt/setup-state.json` whatever the outcome. Two
other verbs feed that stamp: a full `rt setup apply` that ends ok stamps it
too, unless a migration is still pending, and `rt setup finish` starts an
update run of its own, since the launch-time one skipped the Mac while setup
was open. `rt uninstall` that ends ok and keeps `~/.mattstack` takes Finish
and the update stamp off the record, so a reinstalled app opens setup again. Mark a
step update-safe only when it is idempotent, never calls `ctx.need`, and
never overwrites a value the user chose; under `ctx.update` it also leaves
alone what the member undid since rt put it there (a disabled or removed
plugin, an editor setup-state has no record of).
`lib/setup/__tests__/update-safe.test.ts` pins the set. A harness's own
steps (`INTEGRATION_STEP_IDS` in `lib/setup/contract.ts`, today `codex.mcp`
and `codex.policy`) sit outside `STEP_IDS`: a run that does not install for
that harness neither lists nor accepts them. Both are update-safe through
ownership: they rewrite only entries rt recorded adding and the member kept,
never add back what the member removed, and a rewritten Codex hook waits on
review again rather than being trusted. Add a one-time fix as a `MigrationDef` in
`lib/setup/migrations/index.ts` with a dated id that is never renamed; it
runs once per machine and is recorded when `done` or `skipped`. The tray
only spawns the verb and routes the `setup_update` notification click to the
Setup status window; put no decision in Swift.

## Baseline Claude permissions are provisional, and never git

`lib/setup/base-permissions.ts` is the allow list Install unions into every
Claude config dir, and `lib/setup/claude-permissions.ts` seeds
`permissions.defaultMode: "auto"` when a config dir has none (Enterprise and
Console-key sessions start in manual mode otherwise). Two rules: an allow
rule resolves BEFORE the auto-mode classifier, so a `Bash(git push *)`-shaped
entry would wave through a forced push and `Bash(git rebase *)` a `--exec` of
any command; the read-only git forms need no rule in any mode and the
classifier approves routine commits and pushes, so no `Bash(git ...)` entry
belongs in the list (a test pins this). And what skills still run in a shell
is `rt gate` (`rt gate wait`, which blocks past any tool timeout, and the
shepherd's CLI-only `rt gate answer --by shepherd`) and `rt events wait`
under `Monitor`, covered by `Bash(rt gate *)` and `Bash(rt events wait *)`.
Everything else a skill runs routinely is a tool on the mattstack server.
Do not widen the list to make a skill work; add a tool or an agent-safe
verb.

## The relocation prompt parser reads a real capture, not a hand-drawn one

`lib/daemon/trust-dialog.ts` parses Claude Code's EnterWorktree
"permission-root relocation" prompt (RT-200, RT-257), the only relocation
dialog Claude Code paints (ExitWorktree paints none on 2.1.283). Three seams
drive it, all behind the machine setting `panes.relocationAutoAccept`
(default on) and all accepting only a path in rt's worktree registry: the
herd watchdog for herd worker panes, the reconciler for other unattended
panes, and `lib/daemon/relocation-announce.ts` for attended herdr panes. The
last two stand down on a herd pane and share `createPaneDriveGuard`, so no
two seams press keys on one pane at once. An attended pane is driven only
after a `pane:announce-relocation` naming its session, sent by the mattstack
plugin's `PreToolUse` hook on EnterWorktree (through the hidden
`rt worktree announce-relocation`) or by the WorktreeCreate hook once it
provisions a tree, and only inside the watcher's 8-second window and for the
announced path.

A bound session whose mattstack-mods `relocation` block is live answers a
path-mode prompt itself: its `tool.check` rule allows a path
`worktree:registered` confirms. The announce watcher stands down for that
session; the watchdog and the reconciler stand down only while a
`worktree:registered` answer for it is under 20 s old, so a lost call
leaves them pressing. The window after a create-hook (name-mode) announce
keeps today's handling (`lib/agent-integrations/claude/relocation.ts`).

Claude Code 2.1.281 draws the dialog under a full-width rule with a
" Tool use" heading, an "   Entering worktree(<path>)" echo and a
" │ permission-root relocation to ..." gutter line; the parser matches those
markers by column, never rejoins a path the terminal split across rows, and
refuses a dialog whose rule is narrower than any other line (a fake painted by
a command). Every fixture in `lib/daemon/__tests__/trust-dialog.test.ts` that
claims to be the real dialog is pasted from a gate's captured screen; when a
Claude Code update changes the drawing, capture the new screen from a stalled
pane, add it as a fixture, and only then touch the regexes. A parser that
"fails closed" here reads as a pane that never starts, so RT-263 tracks the
residue and every change needs the Bash-spoof, MCP-spoof and painted-dialog
fixtures still passing.

The folder-trust dialog (`readTrustPrompt` in `lib/daemon/trust-dialog.ts`, driven by
`lib/daemon/trust-accept.ts`) has one rule no switch changes: a dialog
saying the repo pre-approves tool permissions is never answered. It comes
back `pre-approved`, the walk sends no key and reports `needs-person`, and
the person decides, since accepting would grant those permissions on their
behalf. The 2.1.283+ layout is driven only when every paragraph and option
on it is one the parser knows; anything else is left to the person, so a
reworded warning can never read as its absence. The older layout is read
from its header down, so scrollback above it is not its text.

## State backup

Encrypted, compressed, off-machine backup of mattstack app state. Before
touching `lib/state/backup-*.ts`, `commands/state-backup-*.ts`, the daemon's
`state-backup` sweep, or anything under `~/.mattstack/user/state-backups/`,
read `docs/superpowers/specs/2026-09-13-state-backup-design.md`; it is the
reference for the pipeline, manifest, restore and prune. Three traps the spec
explains and the code enforces:

- Intermediates never touch the home repo working tree; only the final
  `.age` blob lands under `state-backups/<app>/`.
- The age private key is never written to disk; `readAgeKey` and
  `ensureAgeKey` require an `AgeKeySeam` from `createRealAgeKeySeam()`.
- `age`, `zstd` and `git-lfs` resolve via an explicit `{ PATH: process.env.PATH }`
  because the daemon's launchd PATH is minimal (RT-131 tracks bundling them).

## Operating on this machine

This repo's tooling runs as live services on the developer's own machine. Six
rules, each written after it cost real damage:

- **A built binary is only ever run under an isolated HOME** (`env -i HOME=<temp> …`),
  every invocation, not just tests. The daemon shim and the compiled `rt` both
  read `~/.mattstack` and will act on it: a single unisolated run started a real
  daemon that spent minutes creating worktrees and running installs.
- **Never rebuild, re-sign, or reinstall an app bundle macOS has blessed**
  (`/Applications/mattstack.app`, `rt-tray/mattstack-dev.app`). Build into a
  scratch directory instead. Re-signing invalidates Login Items and TCC grants,
  and the failure is silent.
- **Check `git branch --show-current` before syncing the main checkout.** It is
  shared with other sessions and is what the dev app's `rt` wrapper executes;
  it is not always on `main`. That second half makes it operational, not
  hygiene: **the branch that checkout sits on is the dev daemon's deployed
  code.** A daemon that has been up for hours is running whatever was checked
  out when it started (another lane's branch, quite possibly), so a merge
  changes nothing in service until the checkout syncs AND the daemon restarts.
- **Diagnose live services without starting competing instances.** An extra
  daemon squats `rt.sock` and produces exactly the symptom (starts, binds
  nothing, logs nothing) that then gets misdiagnosed as a permissions problem.
- **Re-read a ticket immediately before acting on it.** Tickets here are
  written by other live sessions while you work, so the copy you read at the
  start of a task is a snapshot, not the current state. A prune ran against a
  ticket that had, in the meantime, grown a section explaining that the very
  row being removed was being kept deliberately. The eviction orphaned a
  daemon registry and silently stopped worktree reconciliation. The same
  applies to any shared artifact a peer session can edit underneath you.

A claimed recovery path (self-heal, fallback, retry) is load-bearing: trace the
code that performs it before documenting it, or the docs will tell users to run
something that does nothing.

## Getting a change into the running dev app

The dev app (`/Applications/mattstack-dev.app`) takes code from three places.

- **Served apps (board, console, chat, boxscore) and deck run from
  source** in the shared `~/Documents/GitHub/mattstack` checkout (or the older
  `~/Documents/GitHub/repo-tools` folder on a machine that has not moved it). To deploy:
  merge, check `git branch --show-current` is `main`, pull, then
  `deck restart <app>` (or the deck row's deploy button for deck itself);
  `rt release update-machine` also re-registers and restarts them, as its
  `checkout-sync` (labelled "shared checkout sync") and served-suite legs
  (`REGISTERED_APPS` in `lib/release/update-machine.ts` is exactly this
  list plus deck). Deck runs through the dev shim (`rt-tray/Sources-deck-shim`),
  which falls back to `Contents/Helpers/deck-pinned` when source cannot
  run; `api.json`'s `runMode` says which is serving. A pin older than
  `runMode` (deck 1.0.6 today) reads as `standalone`; the last
  `deck-dev-shim:` line in `~/.mattstack/deck/logs/deck.err.log` says
  whether the shim fell back. gitq is not in that re-register list: it
  ships only as the `Contents/Helpers/gitq` CLI, built by
  `scripts/build-apps.ts` from `apps/gitq/mattstack.deck.json`'s
  `bundle.build` recipe. Deck neither registers nor serves gitq, so a
  merge and pull change nothing running; the CLI only picks up the change
  at the next release.
- **Manifest keys in `mattstack.deck.json` are read only at register or
  adopt.** After a manifest change, run `deck register --dir <absolute path>`.
- **Tray and shim changes need a dev app rebuild**: in a scratch tree at the
  target commit, `scripts/fetch-deps.sh arm64`, then `bun install
  --frozen-lockfile` (`build-apps` runs turbo over `packages/*` and needs
  `node_modules` in the scratch tree), then `bun scripts/build-apps.ts`,
  then `rt-tray/build.sh dev`, never in the shared checkout's `rt-tray/`.
  Then replace
  `/Applications/mattstack-dev.app` by moving the old one aside, the way the
  dev-bundle leg of the `rt:release` skill does. A collaborator's dev app
  comes from the release (`rt dev setup`, `rt dev update`); the `dev-publish`
  leg of `rt release update-machine` attaches it on the maintainer's Mac.

## Footguns

### `bun run test` is one of three suites, and CI runs all three on main

The `test` script in `package.json` is the one source of truth for which
directories this suite covers. CI also runs `test:e2e`
(`e2e/tests/`, needs `--preload ./e2e/setup.ts`) and `test:pty` (`e2e/pty/`,
the termwright gate that drives the compiled binary in a real pty, 120s
timeout). `test:all` runs all three. A green local `bun run test` says nothing
about either of the others, and the difference is invisible in the output.

CI runs the unit suite as three macOS shards (`bun test --shard=i/3
--timings=test-timings.json`, balanced by the committed timings file,
which the Timings workflow regenerates) and runs the non-Mac gates on
ubuntu. `scripts/ci/test-scope.ts` decides a PR's scope from its diff: only
docs, Swift files or `plugins/` trees (each plugin has its own CI job)
that no unit test reads skips the shards; a
TypeScript-only diff runs `--changed=HEAD^1` plus every `no-*.test.ts`
guard in the unit directories; any other change runs the full suite (a
non-TypeScript file outside that skip set, a fixture, the preload or its
imports, anything under `scripts/ci/`). Any other test that spawns
`cli.ts` or reads source as text is not selected by `--changed`, so it
must be named `no-*` to run on a PR at all; an un-prefixed one only runs
on main, so a TypeScript-only PR can go green and break main there. When
the shards' printed wall times drift more than a minute apart, refresh
the timings file by running the Timings workflow
(`gh workflow run timings.yml`) and committing its artifact;
`bun run test:timings` on a laptop produces a laptop-balanced file,
which is not the same thing.

It matters most for anything asserted verbatim end to end (the chat delivery
frame, a CLI's `--json` envelope, a usage string) and for anything glitter or
rt-ui paints: those have exact-string or screen assertions no unit suite
covers. Run `bun run test:all`, or at least the one e2e or pty file covering
the surface, before calling a change verified. The pty gate skips in CI unless
the diff touches a path in `.github/workflows/e2e.yml`'s filter; a change to
socket setup, `test-setup.ts` or `e2e/socket-path.ts` must be in that filter or
the gate never runs (macOS caps a unix socket path at 104 bytes, and the gate
is what catches a path that grew past it).

The apps' packages under `packages/*` and `apps/*` are vitest or their own
bun suites and are never in the unit dirs; run them with `bun run
<app>:test` or `bun run check`.

### Run `bun test` from the repo root

bun reads `bunfig.toml` only from the cwd, never a parent, so a run started
anywhere else (a subdirectory, `packages/rt-client`, an absolute test path
from another directory) skips `test-setup.ts` and keeps the real HOME. Two
more ways a run reaches the real home with the preload loaded: a test that
leaves HOME unset, since paths then fall back to bun's `os.homedir()`, which
is frozen at the HOME the process started with; and a child started by
`Bun.spawn`/`Bun.spawnSync` without `env`, which gets that startup
environment, real HOME included (pass `childEnv()` from `lib/subprocess.ts`).
`setSetting`/`unsetSetting`, `rt team create`/`join` and the home-repo init
seam refuse a test-run write into the account's real `~/.mattstack` settings
stores (`packages/rt-client/src/test-isolation.ts`); nothing guards the rest
of `~/.mattstack` (state db, logs, runtime files) the same way.

### Module registry

When adding a new command module referenced by `cli.ts` (any file with a `module:` entry in the command tree), you **must** also register it in `lib/module-registry.ts`. `bun build --compile` cannot resolve dynamic `import()` with runtime-constructed paths, so the compiled binary relies entirely on this registry to discover and bundle every command module. Running from source (`bun run cli.ts`) works fine without the registry entry because the dynamic import fallback succeeds, so you won't catch this locally -- it only breaks in the distributed binary.

Every registry value is a thunk (`() => import("../commands/x.ts")` with the path spelled out literally), not an eagerly-evaluated namespace import. That's what keeps `rt --version` and every other dispatch from paying for the whole command surface: the bundler still statically discovers all 30 modules, but none of them evaluate until a command actually dispatches to it. Adding a static (non-thunked) `import` of a command module to `lib/module-registry.ts`, or a static value import of `lib/rt-render.ts`/`ink` to `lib/command-tree.ts`, is a startup regression. `scripts/bench-startup.ts` gates this in the release workflow (`.github/workflows/release.yml`), and `lib/__tests__/no-eager-tui.test.ts` gates the command-tree and command-module cases directly.

### `SCHEMA_VERSION` is claimed across sessions, not chosen per branch

Several agents work this repo at once, and `runMigrations` only replays when
`user_version < SCHEMA_VERSION`. So the first branch whose daemon opens
`~/.mattstack/rt/state.db` stamps the new number, and every *other* branch's
schema for that same number then silently never applies. Its tables are
simply absent on that machine, with no error anywhere. This has already
happened once: two lanes both wrote a v4, one lane's daemon migrated the
real db minutes before the other merged, and the second lane's tables
never appeared.

Announce the version you are taking to the other sessions before you merge,
and renumber if you are second. To repair a db stamped by a schema that is
not the one on disk: stop the daemon, `PRAGMA user_version = <the previous
version>`, start it, and diff `sqlite_master` before and after to confirm
the other lane's tables survived (the replay is IF NOT EXISTS, so it is
data-preserving).

**Nothing but `IF NOT EXISTS` statements may appear in a `V*_SCHEMA` block.**
The runner execs `V1 + … + Vn` as one statement on *every* bump, so an
`ALTER TABLE … ADD COLUMN` that succeeded once throws `duplicate column
name` on the next bump, rolls the migration back, and makes every later
`openStateDb` call throw. Add a column by creating the table with it
(`IF NOT EXISTS`), or guard the add behind a `PRAGMA table_info` check.

### `rt-client`, `settings-kit` and `tui-kit` are private workspace packages

`packages/rt-client`, `packages/settings-kit` and `packages/tui-kit` publish
nowhere; every consumer inside this monorepo (rt itself, board, console,
chat, boxscore, deck, gitq) links the workspace package directly, and the
root `postinstall` builds all three `dist/` directories. There is no npm
version to announce or renumber for any of the three.

`packages/glance` links the same way in-repo (rt-client, the VS Code
extension and root typecheck all resolve its `workspace:*` dist), but it is
not private: it publishes to npm on its own schedule via `bun publish`
(`packages/glance/docs/releasing.md`), never through the shared
`scripts/set-platform-version.ts` bump.

### `packages/rt-client/dist/` goes stale without warning

`dist/` is gitignored. Inside this monorepo, consumers link the workspace
package, and `dist/` is what their `import` condition resolves; the root
`postinstall` and turbo's `^build` rebuild it. So any change or merge that
touches rt-client's source leaves every in-workspace consumer, gitq
included, resolving the previous build until the next install or turbo run.
The source is right, the shipped artifact is not, and nothing about the
working tree looks wrong. Run `bun run build` in `packages/rt-client` after
touching it, and after any merge that does.

`packages/rt-client/test/dist-freshness.test.ts` is the guard and names the fix in its failure message. Treat that failure as a real instruction, not as a flaky artifact test. It caught this three separate times in one day across three sessions.

`packages/glance/dist/` is the same trap: root typecheck, rt-client's build
and the VS Code extension all resolve it through `workspace:*`, while bun
itself reads `src/` directly. Run `bun run build` in `packages/glance` after
touching its source, and after any merge that does.

### Bytecode compile (`--bytecode`) silently falls back on failure

`bun build --compile --bytecode` does not reliably fail loudly when bytecode generation fails. Ink's dependency graph (via `yoga-layout`) and top-level await in `cli.ts` both currently break bytecode generation, but when the *post-bundle* bytecode step itself fails (as opposed to a bundling/parse error), bun still writes out a working binary, just without bytecode, and only a few hundred KB smaller than the non-bytecode build, so the artifact looks like a success. Never conclude `--bytecode` worked because a binary appeared and ran; check the build's stderr for `Failed to generate bytecode` (or read the exit code) before trusting the artifact. A hard parse-time failure (e.g. the top-level `await` in `cli.ts`) does exit non-zero with no binary produced, so that failure mode is safe -- it's specifically the later stage that goes silent.

### A required-positional leaf must declare `omitBehavior`

rt's convention is that omitting the next subcommand OR a required arg shows a
picker, never a bare error. Branch-node subcommand pickers are structural (the
dispatcher). The leaf *argument* picker lives in each handler, so it is enforced
by a declaration: every visible leaf with a required positional (flagless,
non-`optional`, text/select arg) must set `omitBehavior` on its node in
`lib/command-tree-def.ts` (`"picker" | "list" | "prompt" | { exempt: "why" }`).
`bun run picker:check` (`scripts/lib/picker-conformance.ts`) and
`lib/__tests__/picker-conformance.test.ts` fail otherwise; the check gates
`.github/workflows/checks.yml` and the preflight node of the `rt:release` skill
(`skills/rt-release/SKILL.md`). Adding a command that just errors on a missing
positional breaks CI, not review.

The picker itself is the other half: rt is driven non-interactively by agents and
scripts as much as by humans, so **every leaf picker must gate `process.stdin.isTTY
&& !json && !process.env.RT_BATCH`** and leave the non-TTY / `--json` path exactly
as it was (same usage message, same exit code, same JSON). An empty candidate set
falls through to that existing error, never an empty picker. Tag `{ exempt }` only
when the value genuinely cannot be enumerated (free-text topic/glob/name/new path)
or the verb is agent-facing by contract.
