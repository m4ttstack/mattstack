# RED/GREEN: evidence skills on the evidence tools

Scope: the `attachments/evidence-record` include and the
`attachments/pipeline/stage-evidence` verb, moving them from hand-built
`run_field_set {key: evidence}` writes, per-file `mr_upload` and an
`mr_view` + `mr_update` splice to the merged tools (`evidence_record`,
`evidence_attach`, `dev_endpoints`, `run_budget`, `run_hold`). The spec is
`docs/superpowers/specs/2026-10-16-evidence-skills-mcp-design.md`.

## Fixture

One invented run for every scenario (`scenarios/common.md`): project
`gitlab.example.com/acme/queue`, run `r-20261016-abc`, runDb
`/home/dev/.mattstack/runs/queue/r-20261016-abc/state.db`, worktree
`/home/dev/.mattstack/rt/worktrees/queue/fix-retry` on branch `fix-retry`,
stage `evidence`, no domain fill, `evidence-plan` = `screenshots: the retry
badge and the dead-letter list, before`. `common.md` lists every tool the
rep may name, one line each with its key inputs from
`attachments/mcp-tools/reference.md`.

## Method

The system file comes from `build-system-file.sh <git-ref-or-tree-path>
<out-dir>` (beside this file). It exports a scratch copy of
`plugins/mattstack` (`git archive <ref>`, or a copy of a checkout when given
a path), rosters `stage-evidence` in the copy's `pack/stubs.jsonc` and runs
`rt skills compile --verb stage-evidence --preview` under an isolated HOME
and `--mattstack-dir <out>/.build/mattstack`. It refuses an `<out-dir>`
inside the repo and fails on an empty output.

`run-reps.sh <system-file> <scenario-file> <out-dir> <n>` runs n reps in
parallel, each from its own fresh empty `mktemp -d` directory, prompt =
`common.md` + the scenario + `\n\n---\n\n` + the system file, with the
tool-less recipe (herd room #m-6019):

```sh
claude --model sonnet --tools "" --strict-mcp-config --setting-sources local \
  --settings '{"disableAllHooks":true}' --disable-slash-commands \
  --no-session-persistence -p "<common + scenario>\n\n---\n\n<compiled stage-evidence>"
```

5 reps per scenario, read by hand. A rep passes when it meets every pass
item of the spec's Test plan and makes no anti-goal call.

Anti-goals (any one fails the rep): a `run_field_set {key: evidence}` write,
an evidence `mr_upload`, an `mr_update` of the section, a copy of a refused
file, `rt` or `curl` on Bash for ports.

## RED

System file: `build-system-file.sh 98fbf05e0 <scratch>/evidence-reps/red` (the branch
base; 10,407 words). The old text names none of `evidence_record`,
`evidence_attach`, `dev_endpoints` or `run_budget`; every rep reached them
from the tool list in `common.md` alone.

Rep outputs:
`<scratch>/evidence-reps/red/<scenario>/rep-<i>.txt`, where `<scratch>` is the session scratchpad. The outputs are not committed.

### E1 happy path, GitLab, attach now

| Pass item | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| `evidence_record` with the raw paths and `tree` | no (no `tree`) | no (no `tree`) | no (no `tree`) | no (no `tree`) | no (no `tree`) |
| marks drawn beside the returned copies | yes | yes | yes | yes | yes |
| a second `evidence_record` with covers (`value` paths) | yes | yes | yes | yes | yes |
| `evidence_attach` with `heading` and `mrUrl` | yes | yes | yes | yes | yes |
| anti-goal call | none | none | none | none | none |
| **rep passes** | no | no | no | no | no |

All five pass `heading: "Evidence"`, not the unbound default `## Evidence`.

### E2 recapture

| Pass item | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| the new BEFORE goes in as `images` for that slot | yes | yes | yes | yes | yes |
| annotation drawn beside the content-folder path returned | yes | no (raw capture path) | no (raw capture path) | no (raw capture path) | yes |
| no hand merge | yes | yes | yes | yes | yes |
| anti-goal call | none | none | none | none | none |
| **rep passes** | yes | no | no | no | yes |

Reps 2-4 draw beside `/home/dev/.fast-browser/screenshots/` and pass the raw
paths again in the second `evidence_record`, which would copy a second time.

### E3 refused upload

| Pass item | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| `refused.size` opens the off-script gate `off-script:evidence:<n>` quoting the refusal | yes | yes | yes | yes | yes |
| on Take, the stage ends with nothing written (no `linkRefused` call) | no | no | no | no | no |
| no copy, no `mr_upload` | yes | yes | yes | yes | yes |
| anti-goal call | none | `run_field_set {key: evidence}` | `run_field_set {key: evidence}` | none | `run_field_set {key: evidence}` |
| **rep passes** | no | no | no | no | no |

Every rep opens the gate with `kind: "off-script:evidence:1"`; under a run `gate_ask` derives the scope from `kind`, so that meets the scope item.

Every rep follows the old "Take links the refused files' local paths" and
calls `evidence_attach {linkRefused: true}` at this stage; rep 3 also adds
an `mr_view` to pass the body as `description`. All ended done, not failed.

### E4 GitHub PR

| Pass item | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| no `mr_for_branch`, no `mr_upload` | yes | yes | yes | yes | yes |
| `gh pr view` | yes | yes | yes | yes | yes |
| `evidence_attach` with `description` | no | no | no | yes | no |
| `gh pr edit --body-file` | yes | yes | yes | yes | yes |
| anti-goal call | none | none | none | none | none |
| **rep passes** | no | no | no | yes | no |

Reps 1-3 and 5 call `evidence_attach` without the body, then read it with
`gh pr view` after; rep 3 names the target as `repoName: "queue"` with no
`mrUrl`.

### E5 dev servers

| Pass item | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| one `dev_endpoints {tree, roles}` | yes | yes | yes | yes | yes |
| no `rt_verb` endpoint lookup, no curl loop | yes | yes | yes | yes | yes |
| anti-goal call | none | none | none | none | none |
| **rep passes** | yes | yes | yes | yes | yes |

### RED summary

| Scenario | Reps passing | Anti-goal reps |
|---|---|---|
| E1 happy GitLab | 0/5 | 0 |
| E2 recapture | 2/5 | 0 |
| E3 refused upload | 0/5 | 3 |
| E4 GitHub PR | 1/5 | 0 |
| E5 dev servers | 5/5 | 0 |

### RED failure classes

- **No `tree` on `evidence_record`** (E1 5/5, and every first record in E2-E5): nothing in the old text names the repo-scoping argument.
- **Draws beside the raw capture, not the returned copy** (E2 3/5): the old text never says the record's `value` paths are the ones to draw on and re-send.
- **Take writes at stage-evidence** (E3 5/5): the old Take rule links refused paths here, so every rep calls `linkRefused: true` instead of ending Taken for ship.
- **Hand-written evidence field after attach** (E3 3/5): the old "record plus attach" `run_field_set` node survives the new tools.
- **GitHub body read after the attach** (E4 4/5): the old text has no GitHub branch, so the body is not passed as `description`.
- **Heading without the `##` level** (E1 5/5, E3 4/5, E4 2/5, E5 5/5): the old text names no default heading.

## GREEN

Not run yet.
