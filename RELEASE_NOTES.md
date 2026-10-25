A skills release. Every mattstack engine and include is now a tree of blocks, so a pack binds its rules to the exact step they belong to. A pack that bound an old slot must be converted by hand before it compiles on this release.

### Skill packs

- engines and includes are `*.block.md` trees: one file per section, and a block that takes a pack's text declares a prop
- a pack binds a prop with `rt skills bind <verb> <block> <prop> <fill>`, so a rule for one step lands in that step's section and a rule for the whole stage binds to its `domain-rules` block
- the pack manifest is at version 2, keyed by block and prop; mattstack's own defaults sit on the props
- a fill can be one file of a fill folder (`widgets:ci-rules/flaky-jobs`), whose `SKILL.md` is frontmatter only
- `rt skills blocks` prints a verb's block tree; `--json` adds each layer's text
- `rt skills compile` refuses a binding to an old slot, names the layer that bound it and lists the engine's props, for example:

```
1 verb did not compile
  <manifest>/skills.jsonc:8:25: "mattstack:ship" no longer has slot "domain", bound by this pack; its props are: ship/flow/domain-steps-before-gate.rules (add), ship/flow/gate-ship.rules (add), ship/flow/commit-named-files.rules (add), ship/flow/domain-fast-checks.rules (add), ship/flow/fix-test-first.rules (add), ship/flow/domain-rebases-unfinished.rules (add), ship/flow/resolve-conflict-files.rules (add), ship/flow/mr-create.rules (add), ship/flow/capture-after-case.rules (add), ship/flow/attach-evidence.rules (add), ship/flow/write-title-description.rules (add), ship/flow/domain-runs-ci.rules (add), ship/flow/run-watch-ci.rules (add), ship/domain-rules.rules (add)
```

- packs convert by hand, the org base pack first: its fills bind old slot keys too, and until it converts every team compile is refused. In an org with other members, your org admin moves every pack on a trial branch (see "Moving an org to block packs" below), and no converted pack is synced to the data branch before the org is on layout 5; a Just Me org, or a pack outside an org, converts in place:
  - split the domain fill's `## At: <step>` sections into per-file values beside a frontmatter-only `SKILL.md`
  - a `## At:` section whose step has no prop folds into the stage's `domain-rules` block
  - rebind each file under its v2 key with `rt skills bind`, and delete the old slot keys from `pack/skills.jsonc`
  - run `rt skills compile`, then `rt skills check --strict`
- a pack compiled on this release needs the mattstack app from this release or later, because compile writes that floor (0.32.28) into the pack's `pack/requires.json`; an older app holds the pack until it updates
- a hand-typed path to another skill's file now fails compile and check with `hand-typed-path`, and the error names the placeholder to use; this covers block skills, includes, prop values, copied base attachments, team sections and params
- `{{pack.path:widgets/rules.md}}` renders to a copy in each built skill's own `references/` folder
- `{{pack.path:{{team.<key>}}/<file>}}` takes a team value as its folder
- team sections and params may carry `{{pack.path:...}}` and `{{verb.path:...}}`
- hand-written plugin skills get a `broken-skill-path` check: a path that points at no file fails `rt skills check`
- the extending-a-pack, creating-a-pack, editing-skills and process-digraphs skills teach the block model, and `props.md` lists every block and prop
- CI compiles every graph-bearing engine, runs check-dot on the compiled graphs, and checks the props signature against the last release tag
- Compiled skills point at their own files by `@key`; one `skills_resolve` call per started skill finds them wherever the skill was opened from. A plugin version bump now needs a recompile, and a `${CLAUDE_SKILL_DIR}` link in a copied hand-written skill that no longer reaches a file now fails `rt skills check` instead of only warning.

### Macs already set up

- update the app before your org moves its packs to block packs; an older app keeps working on the old packs and holds its org pull until it updates
- until your org admin moves your team's pack, `rt skills check` and `rt skills sync` on it report old slot bindings; your team's verbs keep working
- if you hand-wrote `~/.mattstack/user/skills/overrides.jsonc`, setup's **Skill overrides** row lists each old key and what replaces it; edit the file, then run `rt skills materialize`
- a pack you made yourself needs its bindings moved to block form; `rt skills check` lists each old binding, and this table gives each one's new key:

| Old key and slot | New key and prop | Contract |
|---|---|---|
| `mattstack:work` tiering | `mattstack:work/sub-agent-tiering` tiering | model-tiering@1 |
| `mattstack:watch-ci`, `mattstack:stage-watch-ci` forge | `<engine>/forge` forge | ci-forge@1 |
| `mattstack:review`, `mattstack:self-review`, `mattstack:receive-review` criteria | `<engine>/criteria` criteria | review-criteria@1 |
| the same three engines, reviewer | `<engine>/reviewer` reviewer | reviewer-dispatch@1 |
| `mattstack:receive-review` reply-rules | `mattstack:receive-review/reply-rules` reply-rules | reply-rules@1 |
| `mattstack:shepherdr` tiering, strategy, accounts | unchanged: the root block still declares them | same |
| any engine's `domain` | a person decides: `<engine>/domain-rules` rules, or a step's own `rules` prop; `rules` adds to lower layers where `domain` replaced them | none |

- `mattstack:shepherdr` has no `domain-rules` block, so its `domain` moves to `mattstack:shepherdr` `rules`, a prop on its root block

### Moving an org to block packs

An org whose packs are all in block form moves to org layout 5. An org admin does it in this order:

1. turn team sync off on your Mac: `rt settings set rt.teamSnapshot '{"enabled": false}' --scope machine`, then `rt daemon restart`
2. switch your clone to a trial branch: `rt team branch use <name>`
3. convert every pack (the org's base packs and each team's pack) on that branch, then publish it: `rt team publish`
4. mark the org: run `bun scripts/move-to-block-packs.ts <clone-dir> --admin <you>` once to see the plan, then again with `--write`, and review the commit with `git -C <clone-dir> show`
5. publish again: `rt team publish`, then turn team sync back on: `rt settings unset rt.teamSnapshot --scope machine`, then `rt daemon restart`
6. after the release, merge the trial branch into the data branch on your forge, then switch back with `rt team branch use <data branch>`; members on the new app follow on their next pull
7. run `rt team pull`, then the script once more without `--write`, to confirm every pack is still in block form after the merge

- without `--write` the script prints the plan and writes nothing; on an org already on layout 5 it checks the packs and says so
- it refuses, writing nothing, while any pack still has an old slot key (it names the pack and the key), while the clone has uncommitted changes or unpublished commits, or while team sync is on; each refusal says why it stopped, and most name a command to run next
- an org still on layout 3 moves to layout 4 first, with `scripts/move-to-data-branch.ts`
