# Superpowers Fork Rollout Design

## Intent

Matt's superpowers fork (m4ttstack/superpowers, tag `v7.0.2-groups.1`) makes
long plans run faster: task groups, one-group-ahead overlap, resumed
reviewers, light reviews, targeted tests, and a new **Native with reviews**
execution mode. Today only Matt's machine has it, through a hand-made local
marketplace. Every mattstack user should get it when they install or update
mattstack, and Native with reviews should be their default execution mode.

The fork's own design and evidence live in that repo:
`docs/superpowers/specs/2026-11-17-sdd-task-groups-design.md` and
`tests/claude-code/scenarios/faster-execution/RESULTS.md`.

## Goals

- `rt setup` on a fresh Mac installs the fork, not stock superpowers.
- `rt setup` on an existing Mac swaps stock superpowers for the fork, with no
  hand steps.
- Plans default to Native with reviews for mattstack users, with a setting to
  change it.
- The fork reaches users through the normal mattstack release path, pinned to
  a commit like fast-browser.
- An upstream PR to obra/superpowers is open, so the fork can retire if it
  merges.

## Non-goals

- Changing the fork's skill text. This design ships what is already tagged.
- Codex, Cursor or other harness installs of superpowers.
- Thinner plans or parallel worktrees (later passes on the fork).

## Anti-goals

- Two enabled plugins named `superpowers` on one machine. Both publish the
  same `superpowers:*` skill names, and which copy serves a skill is
  undefined; Matt hit this on 2026-11-17 and had to disable the stock copy.
- A team's `claude.plugins` list quietly re-adding stock superpowers after
  setup removed it.
- Following the fork's branch implicitly. Every pin bump is a reviewed rt
  commit, as for fast-browser.

## Constraints

- Plugin id stays `superpowers` so every `superpowers:<skill>` reference in
  the mattstack pack and compiled team packs keeps resolving.
- `plugins.install` adds marketplaces and plugins only; it never edits
  `~/.claude/settings.json` (`lib/setup/steps/plugins.ts` header). Disabling
  a plugin goes through the `claude plugin disable` CLI, which that step and
  `migrations/team-packs-from-git.ts` already use.
- Settings keys follow the rt:settings skill and `.claude/rules/settings.md`;
  migrations follow `.claude/rules/setup.md`.
- No mattstack ticket ids in the fork repo or the upstream PR (the fork is
  public; obra's repo is third-party).

## Approaches

| Approach | Trade-off | Picked |
|---|---|---|
| List the fork in the mattstack marketplace, switch rt's baseline, migrate existing Macs; open the upstream PR too | Reaches every install now; rt owns a fork it must rebase per upstream release | **Yes** (Matt) |
| Marketplace only, no upstream PR | Same reach; the fork never retires | No |
| Upstream PR only | Nothing to maintain; no control over timing or acceptance | No |
| Org settings only (`claude.marketplaces` + `claude.plugins`) | Reaches Matt's org only, and the baseline still installs stock superpowers beside it | No |

Default mode: Matt chose **default to Native with reviews** over keeping the
three-option question.

## Decided design

### 1. The fork's branches (m4ttstack/superpowers)

- A `mattstack` branch carries what rt ships: today `sdd-task-groups` at
  `v7.0.2-groups.1`. It becomes the fork's default branch.
- Each upstream superpowers release: rebase `mattstack` onto the new upstream
  tag, re-run the fork's fast checks and scenario suite, tag
  `v<upstream>-groups.<n>`, then bump rt's pin (section 2).
- The upstream PR goes from a separate branch off upstream `main` with the
  feature commits only: no version bump, no fork-only README or marketplace
  text.

### 2. The mattstack marketplace entry

`marketplace/marketplace.json` gains:

```json
{
  "name": "superpowers",
  "source": { "source": "url", "url": "https://github.com/m4ttstack/superpowers.git", "ref": "mattstack", "sha": "<tag commit>" },
  "description": "<one line>"
}
```

`scripts/release/marketplace.sh --refresh` already re-resolves `ref` pins;
`marketplace/README.md`'s plugin table and the rt-release skill's
external-plugin section name superpowers beside fast-browser.

### 3. rt's baseline and the stock copies

In `lib/setup/base-plugins.ts`:

- `BASE_PLUGINS` lists `superpowers@mattstack` instead of
  `superpowers@claude-plugins-official`.
- The stock ids `superpowers@claude-plugins-official` and
  `superpowers@superpowers-marketplace` become **superseded**: no longer
  alternates that satisfy the baseline (`BASE_PLUGIN_ALTERNATES` today makes
  an installed stock copy count as the baseline; that inverts).
- The superseded list is explicit (those two ids), never a name match, for
  the same reason `BASE_PLUGIN_ALTERNATES` refuses lookalikes (my call).
- `plugins.install` installs `superpowers@mattstack` like any baseline
  plugin. It does not disable anything itself.
- **The swap happens once per Mac (Matt's call).** A setup migration runs
  `claude plugin disable <id>` for each superseded id that is enabled, at
  user scope in every Claude config dir rt manages, and records the ids it
  disabled in setup state. It never uninstalls them. If the user re-enables
  a stock copy later, rt leaves it alone.
- Scope limit (my call): a stock copy enabled at project, local or managed
  scope is out of reach, since rt never edits settings files; the validator
  names that case instead.
- A superseded id in `claude.plugins` (any scope) is skipped with one
  setup-log line naming the replacement, so no team list re-adds it.
- The `tool.plugins` validator counts `superpowers@mattstack` as the
  baseline. Any other enabled `superpowers@*` (superseded or not) is a
  **warning**, not a failure: "two superpowers plugins are enabled; the
  `superpowers:*` skills may come from either", naming both ids and the
  `claude plugin disable` command.
- `rt uninstall` re-enables the ids the migration recorded, after removing
  `superpowers@mattstack`, so an uninstalled Mac is left with the
  superpowers it had (my call). The setup-state field follows
  `.claude/rules/state.md`.

### 4. Default execution mode

- New setting `superpowers.execution`, scopes user and team, values
  `native-with-reviews` (default), `subagent-driven`, `native`, `ask`.
- A mattstack plugin SessionStart hook (same shape as
  `hooks/agent-effort-note.sh`) reads it with `rt settings get` and injects
  one line of context: for a value other than `ask`, "When a superpowers
  plan is ready to execute, use <mode> without asking which execution
  approach; use subagent-driven instead when the user asks for it or the plan
  is long enough to compact mid-run." `ask` injects nothing.
- The hook injects only when `superpowers@mattstack` is installed and
  enabled (my call): stock superpowers has no Native with reviews, so the
  line would send agents to a mode that does not exist. If the fork is on
  and the setting read fails, it injects the `native-with-reviews` line.
- Matt's personal `~/.claude/rules/subagent-execution-default.md` becomes
  redundant once this ships; removing it is a hand-off step, not rt's job.

### 5. Docs

- docs.mattstack.dev: the skills page says mattstack installs its superpowers
  fork and why, and documents `superpowers.execution`.
- `marketplace/README.md` plugin list.

## Ordering

The marketplace entry's `ref` must resolve before `marketplace.sh --refresh`
runs, and every Mac adds the marketplace from the published repo. So:

1. **Before the rt PR merges** (prerequisite, needs Matt's go): push the
   `mattstack` branch to m4ttstack/superpowers and make it the default
   branch.
2. The rt release publishes the marketplace entry and the baseline switch
   together; the marketplace publish step runs before any Mac's setup reads
   it.

## Hand-off (not tasks; each needs Matt's go)

1. (Ordering step 1 above.)
2. Open the upstream PR to obra/superpowers from the clean branch.
3. After the rt release ships: on Matt's Mac, remove the `superpowers-pinned`
   local marketplace and `superpowers@superpowers-pinned`, run `rt setup`,
   and delete `~/.claude/rules/subagent-execution-default.md`.

## Left to the builder

- The superseded-list and validator code shape.
- Exact hook wording and how it calls `rt settings get` within its timeout.
- Tests per `.claude/rules/ci-and-tests.md`; the setup and plugin suites
  already have fixtures that list `superpowers@claude-plugins-official`
  (`lib/setup/__tests__/fixtures/plugin-list.json`,
  `rt-tray/vm/fixtures/team-kitchen-sink`) and need updating.
- Whether `OFFICIAL_MARKETPLACE_SOURCE` stays in `computeMarketplaces` once
  nothing in the baseline needs it (my call: keep it; team lists may rely on
  it).
