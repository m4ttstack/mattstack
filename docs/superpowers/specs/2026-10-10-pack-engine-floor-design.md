# Pack engine floor: never install a pack the app can't run (RT-486)

## Problem

Two plugins reach a member's Mac independently of the app that runs them:

- **Team packs** arrive whenever the org clone pulls. `convergePackCache`
  (`lib/setup/pack-cache.ts`) runs `claude plugin update` for any pack whose
  served version changed, and setup's `plugins.install` step and
  `rt skills sync` install packs too.
- **The mattstack plugin** is published to the marketplace as the first step
  of `release.yml`, before the app is built, and `plugins.install` updates it
  at the next launch. A member can run a new plugin on an old app for days.

A pack or plugin whose skills call a tool, a tool argument or a daemon verb
that only a newer rt has (RT-483's `mr_upload` `runId`, for one) breaks every
run on a Mac that hasn't updated the app. Nothing checks for this; today a
person has to wait for everyone to update before publishing.

The common case must stay untouched: a team pack change that needs nothing
new from rt goes out and installs at once, with no app update.

## Design

### The engine a Mac can run

One function, `runnableEngine()`, answers which mattstack engine this Mac's
rt was built with:

- **Prod (compiled) rt:** a constant `MATTSTACK_ENGINE`, baked by
  `bun build --define` on the same line as `RT_VERSION` in `release.yml`,
  from the built tree's `plugins/mattstack/.claude-plugin/plugin.json`
  `version`, never from git.
- **Source rt** (Matt's dev app, a collaborator's dev app, `bun cli.ts`): the
  `version` in `<source root>/plugins/mattstack/.claude-plugin/plugin.json`,
  read at call time. A collaborator's clone at an older commit reads older,
  which is correct.

`rt --version --json` prints `{ "rt": <RT_VERSION>, "engine": <runnable
engine>, "flavor": <flavor> }`. Plain `rt --version` is unchanged, since its
first line is parsed by the release workflow and setup.

### The floor

`plugins/mattstack/pack/requires.json` holds the engine floor:

```json
{ "minEngine": "0.31.0" }
```

It reads "skills from this engine need an app whose engine is at least
0.31.0". It is raised only by an engine change whose skill text uses a tool,
a tool argument or a daemon verb that older apps lack. A routine engine
change leaves it alone. It starts at `0.31.0` (#791 and #794).

`rt skills compile` copies the floor of the engine it compiled against into
the team pack's own `pack/requires.json`, regenerated on every compile and
never hand-edited. A pack with no `pack/requires.json` has no floor, so every
pack compiled before this change installs as today. Packs that extend an org
base take the engine's floor; a base pack declares none.

The file lives under `pack/` so Claude Code never sees an unknown
`plugin.json` key.

### The gate

`fits(floor, engine)`: true when there is no floor, or when
`semver(engine) >= semver(floor)`. Every rt path that installs or updates a
team pack or the mattstack plugin asks it first:

| Path | What it reads the floor from |
|---|---|
| `convergePackCache` (daemon pull) | the served pack's `pack/requires.json` in the org clone |
| `plugins.install` (setup, `rt setup update`) | team packs: as above. mattstack: run `claude plugin marketplace update mattstack` (refreshes the listing, installs nothing), then read `pack/requires.json` from the refreshed marketplace copy |
| `rt skills sync` | the pack's `pack/requires.json` after compile |

When the floor doesn't fit:

- **Installed already:** skip the update. The installed version keeps running,
  which is safe because a compiled pack carries its engine text and nothing
  else it depends on changes. The result records the pack as `held` with its
  floor.
- **Not installed** (a new member, a fresh Mac): install nothing.

When the app updates, the next pull or launch finds the floor fits and
installs the held version with no other step.

### What a person sees

One needs-you setup row, `packs.held`, listing each held plugin:

> claimview 0.11.0 needs a newer mattstack app (engine 0.31.0 or later). Update the app when it's offered.

`rt setup update` notifies for it like any needs-you row. It is not
finish-gated or required: nothing a member does except updating the app
clears it, and the old pack keeps working meanwhile. The daemon logs each
hold once per pack version. A floor no release has shipped yet reads the
same: the app update simply isn't offered yet.

### Keeping the floor honest

Raising `minEngine` is the one hand-maintained step, so CI nudges it: the
`plugin-mattstack` job fails a PR that changes
`plugins/mattstack/attachments/mcp-tools/reference.md` (a tool or argument
added or changed) without changing `pack/requires.json`, unless the PR body
carries `engine-floor: unchanged` with a reason. The check sees MCP tools and
their arguments only; a dependency on new daemon behaviour behind an existing
tool (a stricter validator, a new verb reached through `rt_verb`) is the
author's call, and `mattstack:editing-skills` gains one line saying when to
raise the floor.

### Release

- `release.yml` bakes `MATTSTACK_ENGINE` beside `RT_VERSION`.
- After the build, it asserts `rt --version --json`'s `engine` equals the
  tagged tree's `plugin.json` version.
- The marketplace publish moves from the first step to after the GitHub
  release and appcast, so a failed run never publishes a plugin with no app.
- The publish refuses a mattstack plugin version below the one on the
  published marketplace (a patch cut from an older base).
- The `rt:release` preflight gains the matching checks (release owner).

## Out of scope

- A hand-run `claude plugin update`, or a member turning on Claude Code's
  marketplace auto-update (off by default for third-party marketplaces; rt
  never turns it on).
- Other plugins: chat, herdr-chat, fast-browser.
- Hand-added requirements in a team pack beyond the engine floor.
- A new mattstack plugin whose MCP server needs a newer bundled rt than the
  app has. The floor holds the plugin in that case only when its author
  raised `minEngine`.

## Testing

- `fits` and `runnableEngine` (baked constant, source tree, missing or bad
  `plugin.json`) as pure functions.
- `convergePackCache`: fits → updates; floor above → held, no `claude` call,
  result names the floor; not installed and floor above → nothing installed;
  no `pack/requires.json` → today's behaviour.
- `plugins.install`: a held team pack and a held mattstack plugin, each
  leaving the installed version alone and feeding the `packs.held` row.
- Compile writes `pack/requires.json` from the engine's floor and drops it
  when the engine has none.
- The release script refuses a lower plugin version; the CI floor check fails
  a reference change with no floor change and passes with the waiver line.
