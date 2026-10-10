# Harness integrations: audit rows A01 to A28, evidence and gaps

**Date:** 2026-10-09. **Branch:** `harness-integrations`. **Status:** no
distributed-profile run has happened yet, so no row is closed.

This maps each row of the [dependency audit](../spikes/2026-10-04-codex-dependency-audit.md),
numbered as in the [design's coverage register](../specs/2026-10-04-harness-integrations-design.md#audit-coverage-register),
to the acceptance scenarios that are its evidence and to the gaps known
today. The scenarios, and which profiles must pass each one, are defined in
`scripts/acceptance/scenarios.ts`; their results live in
[harness-integrations-acceptance.json](harness-integrations-acceptance.json),
where every required scenario is recorded `blocked` with the reason
"not run yet: S9b". A row closes only when every scenario listed for it has
passed in every profile it applies to, on one artifact, with a native version
from `scripts/acceptance/tested-versions.json`.
`bun scripts/acceptance/harnesses.ts --verify --evidence <this folder>/harness-integrations-acceptance.json`
is the check, and it exits 0 for nothing less.

Until scripted capture helpers exist (ruling P18), a pass whose record says
`attestedBy: "operator"` is operator-attested, not machine-proven: the runner
checks its files, native event log, identity and timing, but cannot know the
step ran as described. Only the artifact and native version probes,
`release-artifact` and `codex-only-no-claude` are `attestedBy: "machine"`.

Earlier evidence (source tests, the live-18 and live-19 runs, task reports)
is cited where it narrows a gap. None of it counts as a pass here: the design
requires the distributed workflow matrix.

## Map

| Row | Area | Scenarios that are its evidence | Status | Known gaps |
| --- | --- | --- | --- | --- |
| A01 | Agent abstraction | `default-cli-adoption`, `launch-headless`, `launch-herdr` | Blocked (S9b) | None beyond the run. |
| A02 | Launch permissions and context | `launch-headless`, `launch-herdr` | Blocked (S9b) | Simultaneous-worker isolation only shown in source tests. |
| A03 | Shepherd ownership | `shepherd-workers`, `mixed-shepherd-claude`, `mixed-shepherd-codex` | Blocked (S9b) | A Codex shepherd has never run live; live-19 ran Claude workers only. |
| A04 | Herd spawn and persistence | `shepherd-workers`, `mixed-shepherd-claude`, `mixed-shepherd-codex` | Blocked (S9b) | Mixed herds never run live. live-19 O8: a job stays `spawning` until its first worker verb. |
| A05 | Watchdog and death | `shepherd-workers`, `state-idle`, `state-working`, `state-disconnected`, `state-confirmed-dead` | Blocked (S9b) | live-19: H3 fallback partial, precedence not observable. |
| A06 | Background and recovery | `native-restart-pending-question`, `state-idle`, `state-working`, `state-question-blocked`, `state-background` | Blocked (S9b) | H6.6 foreign-tree attention inconclusive (herdr does not detect a versioned Claude binary, O4). An unrecognised modal layout reads as no dialog (HF2 follow-up). |
| A07 | Session identity | `launch-headless`, `launch-herdr`, `state-disconnected`, `state-resumed` | Blocked (S9b) | A hand-launched Claude never binds (legacy rule, live-18 O1). |
| A08 | Chat continuity | `chat`, `state-resumed` | Blocked (S9b) | Codex compaction, fork and clear never run live. |
| A09 | Delivery | `all-clients-disconnect`, `native-restart-queued-input`, `consumption-client-id`, `chat`, both mixed shepherds | Blocked (S9b) | Native deduplication is not proven by logical ids; the runner refuses that as evidence. |
| A10 | Pane APIs | `launch-herdr`, `chat-app` | Blocked (S9b) | None beyond the run. |
| A11 | Gate presentation | `question-controller-reconnect`, `question-answer-race`, `all-clients-disconnect`, `rt-restart-after-answer`, `native-restart-pending-question`, `gates-external-answer`, `state-question-blocked` | Blocked (S9b) | Codex offers no async question form; recorded as a native form, never as a pass. Required gates must pass through forms or gate open/wait. |
| A12 | Gate enforcement | `hook-trust-fresh`, `hook-trust-changed`, `hook-script-tampered`, `hook-timeout`, `gates-external-answer` | Blocked (S9b) | Codex hook approval needs the Touch ID helper, which needs a rebuilt app (S8c). Same-user edits of `~/.codex` stay a residual risk. |
| A13 | Pipeline attribution | `pipeline` | Blocked (S9b) | None beyond the run. |
| A14 | Continuation policy | hook scenarios above, `hook-repeated-stop`, `pipeline` | Blocked (S9b) | Whether Codex plan-mode clarify opens a gate is unverified (S11). |
| A15 | CI leases | `ci-lease` | Blocked (S9b) | None beyond the run. |
| A16 | File confinement | `skills-mcp` | Blocked (S9b) | None beyond the run. |
| A17 | Skill compilation | `release-artifact`, `skills-mcp` | Blocked (S9b) | Decision (ruling P17): every release compiles and strictly checks the Codex build of `mattstack`, but the `.codex-plugin` manifest, `targets/codex/` and the `.agents/plugins/marketplace.json` catalog are published only with `RT_PUBLISH_CODEX_BUILD=1`, off by default. Turning it on waits for a task that installs the build on Codex and checks those shapes live; they are read from rt's own reader today. The pack's hand-written `plugin/skills` are not in the Codex build. Team packs install their Claude build on Codex (S12). |
| A18 | Skill maintenance | `skills-maintenance` | Blocked (S9b) | Plain compile, check and expand, and `rt team` listing, still read Claude's plugin list (S12). `skills audit` uses a locked `codex exec`, not a launch (ruling P14). |
| A19 | Skill behaviour and delegation | `skills-mcp`, `shepherd-workers` | Blocked (S9b) | Still Claude-only: the shepherdr engine, wrap-up form, watch-ci sleeps, execution strategy (S11). |
| A20 | Installation | `install`, `codex-only-no-claude` | Blocked (S9b) | A Codex-only clean install has never run. The VM driver now takes `HARNESS_PROFILE`; the switch must be turned on before setup. |
| A21 | Permissions and external tools | `hook-trust-fresh`, `hook-trust-changed`, `install`, `skills-mcp` | Blocked (S9b) | Linear MCP is written only into Claude's configuration; `assert-team.sh` now fails a Codex profile that expects it. |
| A22 | Update, restore, uninstall | `update`, `restore`, `uninstall` | Blocked (S9b) | No full restore has run on a Codex-only Mac (S10). |
| A23 | Board | `board-actions` | Blocked (S9b) | Board keeps its own copy of the harness helpers rt-client now exports (S7). |
| A24 | Chat app and Herdr chat | `chat`, `chat-app` | Blocked (S9b) | None beyond the run. |
| A25 | gitq | `gitq-actions` | Blocked | gitq's skills still name `AskUserQuestion` and carry no questions fragment, so they are withheld from Codex (no bundle build, no setup link, a Codex action refuses) until they are ported. |
| A26 | Console, tray, onboarding | `default-cli-adoption`, `install` | Blocked (S9b) | Dev-app UI checks in both schemes are owed (S8, S8b, S8c). The solo card copy names Claude Code. |
| A27 | Worktrees | `worktrees` | Blocked (S9b) | live-19 O9: the reconciler adopts unregistered worktrees, which registered/auto-accept then admit (Matt asked for a write-up). O5 and O2 from live-18 stand. |
| A28 | Release and clean room | `release-artifact`, `codex-only-no-claude` | Blocked (S9b) | Deck's and rt's own skills have no Codex build and are not shipped for Codex. The release workflow is not gated on this matrix. |

## Remaining native references

Re-run on this branch over every tracked text file, matching harness names,
their session and config variables and native tool names. A count is files,
not occurrences; a keyword hit is not a dependency.

| Class | Files | What it is |
| --- | ---: | --- |
| Integration code | 33 | `lib/agent-integrations/claude/` and `codex/`: the adapters themselves. |
| Composition and native entry points | 17 | Listed in `lib/__tests__/no-agent-integration-boundary-leaks.test.ts` as `composition` (the registry, install, skills host and worktree composition, daemon start-up) or `native-entry` (hook programs, mod transport verbs, harness-specific setup rows). Intentional. |
| Compatibility migration | 24 | The guard's `legacy` rows: generic consumers that still import a native module directly (chat sign-in, gate push and form detection, the pre-integration argv builder, skills paths read past the adapter). Each must move behind the registry before its row is removed. |
| Other rt core | 142 | Files under `commands/`, `lib/` and `scripts/` that name a harness without importing its module: setup copy and rows, settings keys, launch defaults, CLI help, and the acceptance runner. Not individually classified; the guard covers imports only. |
| Apps and packages | 67 | Board 23, chat 15, console 13, rt-client 10, gitq 4, settings-kit 1, boxscore 1. Mostly harness options and labels read from `agent:integrations`; none imports a native module (the guard checks). |
| Intentional native features | 21 | `plugins/mattstack-mods`, the chat plugin's hooks, the pipeline Stop backstop. |
| Tray, onboarding and VM | 29 | Swift setup screens and copy, and the VM drivers. |
| Skills | 12 | Generated and authored skills naming a harness tool or variable. |
| Tests | 323 | Fixtures and assertions. |
| Docs | 462 | Specs, plans, spikes, the docs site. |

The 142 "other rt core" files are the unclassified remainder this re-run
leaves: classifying them one by one is S9b's audit closure, together with
removing the transitional direct paths once their migrated callers pass.
