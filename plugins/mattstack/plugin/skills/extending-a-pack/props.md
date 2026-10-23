# Props: where a fill binds

Each mattstack engine is a tree of blocks: an `index.block.md` root and
one `*.block.md` file per section. A block that takes a pack's text
declares a prop. A prop has a name, a merge, an optional contract and a
default:

- `merge: add`: every layer's value is inlined, the org base's first,
  then the team's.
- `merge: replace`: the last layer's value replaces the ones before it.
- `contract`: the fill's `metadata.provides` must equal it. A prop with no
  contract takes a fill with any `provides`.
- `default`: what compiles when nothing is bound. `""` inlines nothing.

## Bind a prop

`rt_verb {args: ["skills", "bind", "<verb>", "<block>", "<prop>", "<fill>", "--pack", "<pack>"]}`

- `<verb>`: a rostered door by its roster name with no prefix (`ship`), or
  a stage by the name the manifest keys it under (`mattstack:stage-ship`)
  or bare (`stage-ship`).
- `<block>`: the block id from the tables below
  (`stage-ship/domain-fast-checks`), or its path under the engine
  (`domain-fast-checks`). An engine's root block has the engine's name as
  its id (`shepherdr`).
- `<prop>`: the prop the block declares (`rules`, `criteria`, `forge`).
- `<fill>`: a fill folder (`widgets:lint-changed`), or one file of a fill
  (`widgets:ci-rules/flaky-jobs`): that fill's `SKILL.md` is frontmatter
  only, and `flaky-jobs.md` beside it holds the text with no frontmatter.

Flags: `--pipeline <name>` binds for one pipeline's stage copy only; its
value replaces every layer's top-level value for that prop in that
pipeline, the org base's included.
`--dry-run` prints the change and writes nothing.

To remove a pipeline's override, run the same call with no fill and
`--pipeline <name> --unset`: the prop goes back to the pack's top-level
value.

The bind writes one key per block into `pack/skills.jsonc`, the plugin
prefix and the block id, with one entry per prop:

```jsonc
"bindings": {
  "mattstack:stage-ship/domain-fast-checks": { "rules": "widgets:lint-changed" },
  "mattstack:ship/flow/domain-fast-checks": { "rules": "widgets:lint-changed" }
}
```

A `--pipeline` bind writes the same key under
`pipelines.<name>.bindings`.

To clear a prop, write `""` as its value in `pack/skills.jsonc` by hand
(`"rules": ""`); the bind takes no empty fill. `""` clears every value
before it (the org base's, and for a pipeline the pack's top-level one), so
the prop falls back to its default. Under `pipelines.<name>.bindings` it
clears the prop for that pipeline only.

## Which block

A rule for one step binds to that step's block and lands in that step's
section. A rule for the whole stage binds to its `domain-rules` block.
A door and its stage are two engines with their own blocks (`ship` and
`stage-ship`, `watch-ci` and `stage-watch-ci`): bind each, one call per
block. One fill may bind to any number of blocks.

| the ask is about | blocks |
| --- | --- |
| getting a worktree, ticket lookup, branch shape | `stage-provision`: `follow-domain-flow`, `provision-result`, `gate-provision`, `domain-rules` |
| what a plan must commit to, tiers, extra APPROACH lines, the evidence plan | `stage-plan`: `read-ticket`, `pick-tier`, `print-triage-block`, `gate-plan`, `run-field-set-evidence-plan`, `domain-rules` |
| checks for touched paths before implementation | `stage-gates`: `apply-triggered-gates`, `domain-rules` |
| what counts as evidence, before/after capture; browser screenshots through a `## Browser target` section (`browser-target.md`) | `stage-evidence`: the step blocks below, `domain-rules` |
| own-branch review homework | `stage-self-review`: `follow-domain-review`, `domain-rules` |
| MR preflight, fast checks, commit shape, description shape, labels | `stage-ship` and `ship`: the step blocks below, `domain-rules` |
| CI job names, retry rules, triage | `stage-watch-ci` and `watch-ci`: `classify-triage-report`, `domain-rules`, `forge` |
| what reviewers check | `review`, `self-review`, `receive-review`: `criteria` |
| how to answer review threads | `receive-review`: `reply-rules` |
| fan-out rules for parallel agents | `shepherdr`: the root's `rules`, or a step block below |

A browser target is four blocks of facts about the app (Reach the view,
What proves a change, Captions, Personal data) and no procedure:
`browser-target.md` beside this file has the blocks, their defaults and an
example, and a pack with no browser evidence adds nothing.

## Every prop

Every `rules` prop is `merge: add` with no contract and nothing by
default. The other props:

| block | prop | merge | contract | default |
| --- | --- | --- | --- | --- |
| `stage-watch-ci/forge`, `watch-ci/forge` | `forge` | replace | `ci-forge@1` | nothing |
| `work/sub-agent-tiering` | `tiering` | replace | `model-tiering@1` | nothing |
| `review/criteria`, `self-review/criteria`, `receive-review/criteria` | `criteria` | replace | `review-criteria@1` | nothing |
| `review/reviewer`, `self-review/reviewer`, `receive-review/reviewer` | `reviewer` | replace | `reviewer-dispatch@1` | nothing |
| `receive-review/reply-rules` | `reply-rules` | replace | `reply-rules@1` | nothing |
| `shepherdr` | `tiering` | replace | `model-tiering@1` | `mattstack:model-tiering` |
| `shepherdr` | `strategy` | replace | `execution-strategy@1` | `mattstack:execution-strategy` |
| `shepherdr` | `accounts` | replace | `account-pool@1` | `mattstack:cswap-accounts` |

A `shepherdr` door compiles with nothing bound; bind one of its three
replace props only to swap in the pack's own fill.

The `rules` blocks, with the section each one is:

### stage-provision

| block | section |
| --- | --- |
| `stage-provision/follow-domain-flow` | Follow the domain's provision flow |
| `stage-provision/provision-result` | worktree_provision result? |
| `stage-provision/gate-provision` | Gate `provision` |
| `stage-provision/domain-rules` | Domain rules |

### stage-plan

| block | section |
| --- | --- |
| `stage-plan/read-ticket` | Read the ticket |
| `stage-plan/pick-tier` | Pick the tier |
| `stage-plan/print-triage-block` | Print the triage block |
| `stage-plan/gate-plan` | Gate plan (table below) |
| `stage-plan/run-field-set-evidence-plan` | run_field_set {key: evidence-plan, ...} |
| `stage-plan/domain-rules` | Domain rules |

### stage-gates

| block | section |
| --- | --- |
| `stage-gates/apply-triggered-gates` | Apply every triggered pre-implementation gate |
| `stage-gates/domain-rules` | Domain rules |

### stage-evidence

| block | section |
| --- | --- |
| `stage-evidence/domain-steps-before-gate` | Run the domain steps before the gate (none when unbound) |
| `stage-evidence/save-ticket-image` | Save the ticket image as the BEFORE |
| `stage-evidence/record-ticket-before` | Record the ticket's location as the BEFORE |
| `stage-evidence/capture-before-case` | Capture the BEFORE for the next case |
| `stage-evidence/pick-next-source` | Pick the next source or view |
| `stage-evidence/attach-evidence` | Attach the evidence (evidence-record) |
| `stage-evidence/gate-evidence` | Gate `evidence` (before any capture) |
| `stage-evidence/gate-evidence-attach` | Gate `evidence-attach` (the domain attaches here and the lookup found an open MR or PR) |
| `stage-evidence/domain-rules` | Domain rules |

### stage-self-review

| block | section |
| --- | --- |
| `stage-self-review/follow-domain-review` | Follow the domain review |
| `stage-self-review/domain-rules` | Domain rules |

### stage-ship

| block | section |
| --- | --- |
| `stage-ship/domain-steps-before-gate` | Run the domain steps before the gate (none when unbound) |
| `stage-ship/gate-ship` | Gate ship (table below) |
| `stage-ship/commit-named-files` | Commit named files, ticket-prefixed subject |
| `stage-ship/domain-fast-checks` | Run the domain's fast checks (none when unbound) |
| `stage-ship/fix-test-first` | Fix test-first, commit, rerun |
| `stage-ship/domain-rebases-unfinished` | Domain rebases, and no rebase finished this pass? |
| `stage-ship/resolve-conflict-files` | Resolve the files, then git rebase --continue on Bash |
| `stage-ship/mr-create` | mr_create {...} |
| `stage-ship/capture-after-case` | Capture the AFTER for the next case the domain names |
| `stage-ship/attach-evidence` | Attach the evidence (evidence-record) |
| `stage-ship/write-title-description` | Write the title and description |
| `stage-ship/domain-rules` | Domain rules |

### ship

| block | section |
| --- | --- |
| `ship/flow/domain-steps-before-gate` | Run the domain steps before the gate (none when unbound) |
| `ship/flow/gate-ship` | ship gate ship |
| `ship/flow/commit-named-files` | Commit named files (ship) |
| `ship/flow/domain-fast-checks` | Run the domain's fast checks (none when unbound) |
| `ship/flow/fix-test-first` | Fix test-first, commit, rerun (ship) |
| `ship/flow/domain-rebases-unfinished` | Domain rebases, and no rebase finished this pass (ship)? |
| `ship/flow/resolve-conflict-files` | Resolve the files, then git rebase --continue on Bash (ship) |
| `ship/flow/mr-create` | mr_create {...} |
| `ship/flow/capture-after-case` | Capture the AFTER for the next case the domain names (ship) |
| `ship/flow/attach-evidence` | Attach the evidence (evidence-record) |
| `ship/flow/write-title-description` | Write the title and description (ship) |
| `ship/flow/domain-runs-ci` | Domain runs CI after the MR (ship)? |
| `ship/flow/run-watch-ci` | Run watch-ci inheriting this run |
| `ship/domain-rules` | Domain rules |

### stage-watch-ci

| block | section |
| --- | --- |
| `stage-watch-ci/classify-triage-report` | Classify the triage report |
| `stage-watch-ci/domain-rules` | Domain rules |

### watch-ci

| block | section |
| --- | --- |
| `watch-ci/flow/classify-triage-report` | Classify the triage report (watch-ci) |
| `watch-ci/domain-rules` | Domain rules |

### shepherdr

| block | section |
| --- | --- |
| `shepherdr` | Domain rules, in the root block |
| `shepherdr/start-and-spawn/specify-jobs` | Specify the jobs |
| `shepherdr/start-and-spawn/ask-strategy-model` | Ask the strategy and model per job |
| `shepherdr/start-and-spawn/collect-repo-conventions` | Collect the repo conventions |
| `shepherdr/what-the-start-graph-cannot-show` | What the start graph cannot show |
| `shepherdr/what-the-lanes-graph-cannot-show` | What the lanes graph cannot show |

`rt skills blocks --skill <verb> --pack <pack>` (Bash, one-time) prints a
verb's live block tree; with `--json` it adds each block's props and each
layer's text. Use it when this file and the pack disagree.
