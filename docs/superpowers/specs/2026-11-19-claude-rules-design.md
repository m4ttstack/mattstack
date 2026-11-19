# Shared Claude Code rules

## Why

Matt's own Claude sessions follow about fifteen always-on rules that make
mattstack work well: reply through rt chat, `/reload-plugins` instead of a
restart, worktrees through EnterWorktree, decisions through wrap-up forms,
screenshots as image to-dos, and so on. They live in his `~/.claude/CLAUDE.md`
and `~/.claude/rules/`, so no teammate's agent gets them. A whole work
team now runs mattstack, and their agents miss behaviour the tools assume.

This change ships those rules with mattstack, so every member's sessions load
them with no hand editing, and lets an org's packs ship rules of their own.

## Goals

- Every mattstack Mac loads mattstack's shared rules in every Claude Code
  session, from any directory.
- An org base pack can ship rules every org member loads; a team pack can ship
  rules that load for that team's members only.
- Pack rules load only as published (the data branch), like the rest of a pack.
- mattstack's rules update when the plugin's marketplace refreshes; pack rules
  update on the next org pull. Nothing runs at session start.
- Everything mattstack owns lives under `~/.mattstack`; the only thing in
  `~/.claude` is one link.

## Non-goals

- No opt-in presets and no per-rule settings. A rule ships to everyone or is
  not shipped.
- No gating on installed tools: Fast Browser, human-todos, herdr and the
  superpowers fork are standard parts of a mattstack install.
- No edit to the member's `~/.claude/CLAUDE.md`.
- No path-scoped rules (`paths:` frontmatter) in v1. Every shipped rule is
  always on.

## Anti-goals

- Anything employer or team specific in the public mattstack
  plugin. That goes through the team pack layer only.
- Matt-specific wording ("Matt", "the operator", his repo paths, his
  accounts) in a shipped rule.
- Touching a member's own files in `~/.claude/rules/`.

## Constraints (verified)

Claude Code loads `~/.claude/rules/` by itself: every `.md` file, subfolders
included, with no CLAUDE.md line. Tested on 2026-11-19 with canary rules and a
headless `claude -p` session:

| In `~/.claude/rules/` | Loaded |
|---|---|
| plain file, real subfolder | yes |
| link to a folder or file under `~/.mattstack` | yes |
| a link inside that linked folder, to another folder under `~/.mattstack` | yes |
| link to a folder or file under `/private/tmp` | no |

So links resolve, nested links resolve, and a target outside the home folder
does not load (probably a home-only rule; unconfirmed, and not needed).

The mattstack plugin's installed copy sits in a versioned folder
(`~/.claude/plugins/cache/mattstack/mattstack/<version>/`) that changes every
update. The marketplace clone does not move:
`~/.claude/plugins/marketplaces/mattstack/plugins/mattstack/`, kept current by
Claude Code's marketplace refresh. `scripts/release/marketplace.sh` publishes
whole plugin folders, so a `plugins/mattstack/rules/` folder reaches that clone
with no script change.

Packs live in the org clone at `~/.mattstack/orgs/<org>/mattstack/`: team
packs at `teams/<team>/plugin/`, base packs at `org/packs/<base>/`. The clone's
working tree can be on a trial branch or carry unpublished edits, so pack
installs deliberately read the data branch (`generatedMarketplaceRef`, see
`lib/setup/generated-marketplace.ts` and `.claude/rules/settings.md`). rt has
one active team per org (`lib/team/active-team.ts`).

## Approaches

1. **Link mattstack's rules, copy published pack rules on pull (picked).**
   `~/.claude/rules/mattstack` links to `~/.mattstack/claude/rules/`, a real
   folder rt manages. Its `mattstack/` entry links into the marketplace clone;
   each pack's entry is a folder rt writes from the data branch after every org
   pull. Nothing runs per session, and pack rules obey the same published-only
   rule as pack skills.
2. **Links all the way down.** Pack entries link into the org clone's working
   tree. Rejected: an admin's trial branch or local unpublished edits would
   load straight into their sessions, breaking the data-branch rule packs
   follow.
3. **Copy mattstack's rules from a SessionStart hook.** Rejected: Matt found a
   copy at session start the wrong job for a session hook, and the marketplace
   clone makes it unnecessary.

Also dropped: shipping rules in the app bundle (updates only with app releases,
sits outside home where links do not load, and the rules name plugin skills so
should version with the plugin), and SessionStart `additionalContext` (members
cannot see or read it as files).

## Design

### Layout on a member's Mac

```
<config dir>/rules/mattstack  ->  ~/.mattstack/claude/rules/
~/.mattstack/claude/rules/
    mattstack/          ->  <mattstack marketplace clone>/plugins/mattstack/rules/
    <org>-<base pack>/      (folder rt writes from the data branch)
    <org>-<team>/           (folder rt writes from the data branch)
```

`~/.mattstack/claude/rules/` is a real directory. rt owns every entry in it
and may add, rewrite or remove them. Pack entries carry the org prefix so two
orgs, or a team named `mattstack`, never collide. A pack entry exists only
when that pack has a `rules/` folder on the data branch.

### Where the rules are written

- **mattstack's rules:** `plugins/mattstack/rules/*.md` in this repo. Plain
  markdown, no frontmatter, one rule per file, written for any member (see
  the rule list below).
- **pack rules:** a `rules/` folder at the pack root, beside `pack/` and
  `attachments/`: `teams/<team>/plugin/rules/*.md` for a team pack,
  `org/packs/<base>/rules/*.md` for a base pack. Same format. Published like
  any other pack content.

### Which packs a member gets

Every base pack of each org the member is in, plus the active team's pack in
that org (`activeTeamFor`). Never other teams' folders, even though the clone
holds them.

### Writing a pack entry

Read the pack's `rules/` at the data branch ref (`git archive` or `git show`,
as `generated-marketplace.ts` reads `marketplace.json`), never the working
tree. Write into a temp folder under `~/.mattstack/claude/rules/` and rename it
over the entry, so a session starting mid-write sees the old set or the new,
never half. Copy only `.md` files.

### Finding the marketplace clone

Resolve the mattstack marketplace's `installLocation` from
`<claude config dir>/plugins/known_marketplaces.json` (the config dir honours
`CLAUDE_CONFIG_DIR`, as `lib/skills/packs.ts` does), by the marketplace name
setup registers. Never hard-code the path: the dev flavor or
`RT_MATTSTACK_MARKETPLACE` can point it elsewhere (on Matt's machine that may
be this checkout, which is useful). If the resolved location is outside the
home folder, or has no `plugins/mattstack/rules/`, leave the `mattstack/`
entry out and say why in the step's detail.

### The setup step

A new `StepDef`, `claude.rules`, beside `skills.link`
(`lib/setup/steps/skills.ts`), `updateSafe: true`, so it runs on Install and
on every `rt setup update` after an app update. It:

1. creates `~/.mattstack/claude/rules/` if missing;
2. points `mattstack/` at the resolved marketplace path;
3. writes each pack entry the member gets (above), and removes pack entries
   for packs the member no longer gets or that no longer publish `rules/`;
4. creates `<config dir>/rules/mattstack` as a link to the folder, in every
   Claude config dir rt manages (the `claudeConfigDirs` loop uninstall and
   `org-folder-marketplace` already use, which honours `CLAUDE_CONFIG_DIR`).

Idempotent: a correct link or unchanged pack entry is left alone. If
`<config dir>/rules/mattstack` already exists and is not rt's link (a real
folder or a link elsewhere), rt did not make it, so rt leaves it alone and
reports that in the detail. It never touches any other entry in a config
dir's `rules/`.

The reconcile is one function with three callers:

- the `claude.rules` setup step (Install and every update run);
- the daemon's org pull hooks (`composePullHooks` in
  `lib/daemon/pull-hooks.ts`), so a newly published rule, a join or a leave
  lands on the next pull;
- wherever the active team is set, so switching teams re-points the team
  entry without waiting for a pull (the active team is a user setting, which
  a pull never touches).

`rt uninstall` that removes mattstack removes each `<config dir>/rules/mattstack`
that is still rt's link.

### Version skew

The marketplace clone can refresh before the installed plugin updates, so a
rule may briefly mention a skill the installed plugin lacks. Accepted. Rules
name only long-lived skills and verbs, and a rule that depends on a new skill
lands one release after the skill.

### Rules that ship (mattstack)

Each is rewritten for any member: "the user", not "Matt"; no personal paths.
File names are the builder's call; contents come from Matt's current files
and CLAUDE.md sections named here.

| Rule | Source |
|---|---|
| Reply to agents through rt chat, never SendMessage, when signed in | `prefer-rt-chat.md`, CLAUDE.md "Agent to Agent" |
| `/reload-plugins` after a plugin update, never restart; queue it with herdr-inject in a pane | CLAUDE.md "Picking up plugin and skill changes" |
| Worktrees: EnterWorktree in rt-managed repos, never hand-rolled; never a sibling of the main checkout; path mode for an existing tree; cross repos with `/cd` via herdr-inject | CLAUDE.md "Worktrees" |
| End a turn with open decisions with `mattstack:wrap-up`; in brainstorming, one form question per turn | CLAUDE.md "Wrap Up Skill" |
| Mattstack apps in a browser: `.mattstack` URLs open the Swift app, use localhost URLs from `deck list` | CLAUDE.md "Mattstack Apps In The Browser" |
| Scope searches to the repo; never from `/` or `~`; tell subagents the same | CLAUDE.md "Searches" |
| Name model and effort on every spawn (model-tiering); `/model` syntax for driving another pane | CLAUDE.md "Models" |
| Editing skills: `writing-skills` always; mattstack skills also `editing-skills` | CLAUDE.md "Editing Skills", `skill-writing.md` |
| UI work is not done until rendered in Fast Browser, both schemes, wrong-looking things named | CLAUDE.md "UI validation is mandatory" |
| Fast Browser routing: the `fast-browser:browser-driver` agent, Haiku then Sonnet, never Chrome without asking | `fast-browser-routing.md` |
| `browser_run_code_unsafe` is privileged and state-changing | `fast-browser-verification-consent.md` |
| Screenshots for the user go to Human Todos as image to-dos, never `open` | `screenshots-as-image-todos.md` |
| Compact with herdr-inject before running a superpowers plan | CLAUDE.md "Superpowers" |
| Comments only state a constraint the code cannot show | `clean-code-comments.md` |
| Never hand your own review to a subagent on a weaker model; a review-only task uses no subagent | CLAUDE.md "Reviews" |
| Don't update failing tests while iterating on an area such as UI | CLAUDE.md "When to skip updating failing tests" |

Stays personal (never shipped): naming the parties, Matt's repo path, npm
one-time passwords, the test-repo credentials file, account selection,
employer visibility, MR writing style, incremental commits, the mattstack
repo test note.

Pack candidates (written by each org, not by this change): an org's
account default (its base pack, e.g. `acme-base`), Linear ticket style and the CodeRabbit flow
(a base pack in the mattstack org).

## Testing

- Unit tests for the reconcile: fresh Mac, already correct, stale pack entry,
  team switch, a pack whose `rules/` exists only in the working tree (must not
  load), marketplace missing or outside home, a `rules/mattstack` rt did not
  make, two config dirs, uninstall. Follow `skills.link`'s tests.
- `lib/setup/__tests__/update-safe.test.ts` gains the new step.
- A check that `plugins/mattstack/rules/` holds only `.md` files with no
  personal names; `scripts/repo-purity.sh` already
  covers employer terms.
- Manual: on a scratch HOME, run the step, then a headless `claude -p` asking
  for a canary phrase from a shipped rule and a team rule.

## Left to the builder

- File names and exact wording of each rule, within the table above.
- Where the reconcile function lives and its name.
- The setup row's copy and whether the step shows in the tray (follow
  `skills.link`).
- How the pack checks (`rt skills check`) treat a new `rules/` folder in a
  team or base pack, so an org can publish one.
- Which call site owns "the active team changed" (find where
  `mattstack.activeTeam` is written).

## Calls made without Matt (check these)

- Only the active team's pack, plus every base pack, counts per org.
- The link goes into every Claude config dir rt manages, not only `~/.claude`.
- Pack entries are named `<org>-<pack>`.
- Pack entries are swapped in whole via temp folder and rename.

## After it ships (Matt)

Remove the shipped rules from your own `~/.claude/rules/` and `CLAUDE.md`, or
they load twice.
