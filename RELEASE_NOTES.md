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

- packs convert by hand, the org base pack first: its fills bind old slot keys too, and until it converts every team compile is refused. Then each team pack, in its own repo, for example `acme/widgets`:
  - split the domain fill's `## At: <step>` sections into per-file values beside a frontmatter-only `SKILL.md`
  - a `## At:` section whose step has no prop folds into the stage's `domain-rules` block
  - rebind each file under its v2 key with `rt skills bind`, and delete the old slot keys from `pack/skills.jsonc`
  - run `rt skills compile`, then `rt skills check --strict`
- the extending-a-pack, creating-a-pack, editing-skills and process-digraphs skills teach the block model, and `props.md` lists every block and prop
- CI compiles every graph-bearing engine, runs check-dot on the compiled graphs, and checks the props signature against the last release tag
