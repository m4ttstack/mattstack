# RED/GREEN: rt MR tools in the review and pipeline verbs (RT-315)

rt now ships MCP tools for every GitLab MR write a board pane or pipeline
verb makes (`mr_comment`, `mr_comment_inline`, `mr_reply_thread`,
`mr_resolve_thread`, `mr_approve`, `mr_ready`, `mr_retry`, `mr_rebase`,
`mr_create`). MCP calls to the mattstack server skip the auto-mode
classifier; improvised `glab` write shell does not. These runs check which
mechanism each verb's text leads a fresh agent to.

## Method

Each run is a fresh Sonnet subagent given a snapshot of the skill text, a
description of what its pane's harness shows, and a concrete GitLab
scenario on `acme/acme-dev` !42. It plans every call without executing
anything. RED reads the unchanged text, GREEN the edited text; everything
else is identical between the two.

The harness description went through three versions:

1. **Full catalog**: every `mr_*` tool with its description, plus a note
   that Bash forge writes go to the classifier and MCP calls do not.
2. **Deferred names + note**: tool names only (as Claude Code shows plugin
   MCP tools before a ToolSearch), still with the classifier note.
3. **Neutral**: deferred names only, no permission commentary. This matches
   a real pane.

Versions 1 and 2 primed the agents toward the tools (the ship run wrote
"ship.md's literal text says `glab mr update <iid> --ready`, but this
pane's catalog exposes a dedicated tool"), which hid the failure. Version 3
is the baseline; GREEN uses it too.

Confounder check: none of the always-loaded instruction files these
subagents inherit (global CLAUDE.md, rules, memory index) mention `glab`,
and every `glab` choice below quotes the skill line it followed.

## RED (unchanged text)

| Scenario | Catalog | Plan | Verdict |
|---|---|---|---|
| review, F1 anchored + F2 unanchored, Approve | full x2 | tools for inline/summary/approve; one run posts the summary `resolvable: false` despite F2; one runs `glab mr view` for the close URL, the other takes it from context | FAIL (resolvable unguided; close gate forces a shell read) |
| review, same | deferred+note x2 | tools for posting; both run `glab mr view ... -F json` for the close URL (the HARD-GATE says "read from the forge CLI"); `resolvable` left to the default without reasoning | FAIL (close gate) |
| review, same | neutral x1 | tools for posting; `resolvable` omitted; close URL reused from context | FAIL (resolvable unguided) |
| receive-review, post+resolve on two threads | full x2, deferred+note x2, neutral x1 | `mr_reply_thread` then `mr_resolve_thread` per thread, all five runs | PASS (no failure to fix) |
| ship generic path, GitLab origin, then mark ready | full x1 | `mr_create`, `mr_ready`, overriding the skill text | primed PASS |
| ship, same | deferred+note x1, neutral x1 | `glab mr create --fill --draft`, `glab mr update 57 --ready`, quoting the generic path | FAIL |
| watch-ci forge-bound, INFRA job 812, then mark ready | full x1 | report's retry command (allow-listed `*/scripts/ci-forge.sh`); `mr_ready` | primed PASS |
| watch-ci, same | deferred+note x1, neutral x1 | report's retry command; `glab mr update 42 --ready` | FAIL (mark-ready) |
| stage-watch-ci forge-bound, retry + ci gate Retry + mark ready | full x1, deferred+note x1, neutral x1 | report's retry command every time; `glab mr update 42 --ready` every time | FAIL (mark-ready) |
| watch-ci, neither domain nor forge bound, INFRA job 812 | neutral x1 | `glab ci retry 812 --branch feat/cart-clamp` (the agent notes it is outside `allowed-tools`) | FAIL (unbound retry) |

What RED showed, and what each edit targets:

- The forge-bound retry is already clean: the triage report's retry line
  is `<forge adapter>/scripts/ci-forge.sh retry-job <id>`, and both
  watch-ci verbs allow `Bash(*/scripts/ci-forge.sh:*)` in frontmatter, so
  it never reaches the classifier. That retry text stays as it is.
- The unbound retry, mark ready, and MR create are `glab` writes the skill
  text names outright. Those lines now name `mr_retry`, `mr_ready` and
  `mr_create`.
- review never guided the summary's `resolvable`, and its close gate sent
  agents to a `glab mr view` read even with `mrUrl` in hand. The Posting
  mechanics paragraph now states the resolvable rule and that `mr_comment`
  returns `mrUrl`; the close gate accepts a posting tool's `mrUrl`.
- receive-review never failed. Its "forge CLI and the adapter" sentence
  now names the two tools for GitLab; its GREEN run is a no-regression
  check.

## GREEN (edited text, neutral catalog)

| Scenario | Plan | Verdict |
|---|---|---|
| review, F1 anchored + F2 unanchored, Approve | `mr_comment_inline` (F1), `mr_comment` with `resolvable: true` "because the issue list carries a selected finding with no `file` anchor", `mr_approve` last; close link from `mr_comment`'s `mrUrl` | PASS |
| review, F1 + F3 both anchored, Comment | two `mr_comment_inline`, `mr_comment` with `resolvable: false` "because the issue list carries no unanchored selected finding", no approve; close link from `mrUrl` | PASS |
| receive-review, post+resolve on two threads | `mr_reply_thread` then `mr_resolve_thread` per thread | PASS (no regression) |
| ship generic path, then mark ready | `mr_create` (`draft: true`, target `main` from `symbolic-ref`), then `mr_ready` | PASS |
| watch-ci forge-bound, INFRA job 812, then mark ready | report's retry command (allow-listed), then `mr_ready` | PASS |
| stage-watch-ci forge-bound, then mark ready | report's retry command, then `mr_ready`; notes `mr_retry` belongs to the unbound path | PASS |
| watch-ci, neither bound, INFRA job 812 | `mr_retry` with `jobId: 812` | PASS |

7/7, no `glab` write anywhere.

## Against a project CLAUDE.md that says "always glab"

Some panes start inside a folder whose CLAUDE.md says to use `glab` for
all GitLab operations and never an MCP server "when `glab` can do the
job". Two GREEN scenarios re-ran with that rule loaded as project
instructions:

| Scenario | Plan | Verdict |
|---|---|---|
| review, F1 + F2, Approve | the skill's tools, reasoning that `glab` cannot do a verified positioned inline comment, so the rule's "when glab can do the job" does not apply | PASS, on a narrow reading |
| ship, then mark ready | `glab mr create ... --draft --no-editor`, `glab mr update 57 --ready`: "project instructions are loaded as overriding instructions... `glab` can do both" | FAIL |

A project instruction outranks a skill, so no skill wording closes this.
The fix is the rule itself: MR writes through rt's MR tools, `glab` for
reads and merge. With the rule rewritten that way, both scenarios re-ran:

| Scenario | Plan | Verdict |
|---|---|---|
| review, F1 + F2, Approve | `mr_comment_inline`, `mr_comment` (`resolvable: true`), `mr_approve`; "no real conflict: the rule and the skill converge on the same tools" | PASS |
| ship, then mark ready | `mr_create` (`draft: true`), `mr_ready`; "both documents land on the same mechanism" | PASS |

Caveat: subagents inherit the session's git status, including recent
commit subjects. Every RED and main GREEN run started before this
branch's commits existed; these two re-runs started after commits whose
subjects say "through rt MR tools", so they may be slightly primed. The
rewritten rule names the tools outright, which is what both runs cited.
