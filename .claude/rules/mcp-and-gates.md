---
paths:
  - "lib/mcp/**"
  - "commands/mcp.ts"
  - "commands/gate.ts"
  - "lib/setup/base-permissions.ts"
  - "lib/setup/claude-permissions.ts"
  - "lib/daemon/forge-reads.ts"
  - "lib/daemon/upload-guard.ts"
  - "scripts/hooks/gate-fork.sh"
---

# MCP tools and gates

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
(`rt mcp tools --json` prints it). `tools.ts` itself holds `gate_ask`,
`gate_answer` and `gate_list` (`gate-tools.ts` is the home of the gate
tool handlers and defines `gate_open`, `gate_record` and `gate_reconcile`
over `lib/gates/`), the `mr_*` writes, `rt_verb`, the herd worker tools
(`herd_gates`, `herd_ask`, `herd_answer`, `herd_report`) and five chat tools
(`chat_post`, `chat_dm`, `chat_ack`, `chat_claim`, `chat_release`), and
spreads in the rest: the composites (`mr-composite-tools.ts`:
`mr_map`, `mr_posted_since`, `mr_resolve_branch`, `respond_post_execute`;
all four work on both forges, and `mr_posted_since` and
`respond_post_execute` read the token's own login on GitHub through the
daemon verb `forge:self`, which returns that login and nothing else, so
the `forge:get` read guard stays as it is; GitLab still reads
`forge:get "user"`), run tracking (`run-tools.ts`,
in-process over `runWriteVerb`, a caller's `runDb` confined to the runs
root), forge reads (`mr-read-tools.ts`, `forge-read-tools.ts`: every one
asks the repo's own forge through the daemon on each call and none reads
the open-MR cache, so an agent can read any MR its token can; all of
them work on GitHub too, `mr_threads` and `pipeline_jobs` included; `mr_map` also lists
the MRs live and reads the daemon's synced MR list only for each row's
`ciStatus`; `gitlab_get` is a GET-only passthrough, guarded as below), CI
(`ci-tools.ts`: `ci_watch`, which reads the forge on every poll, and the
`ci_lease_*` tools), the stack store read
(`stack-tool.ts`: `branch_stack` admits a tree only through
`tree-guard.ts`), git writes
(`git-tools.ts`), worktrees (`worktree-tools.ts`: provision, dispose,
stop-holders, and no general kill), the other herd tools
(`herd-tools.ts`), the other chat tools (`chat-tools.ts`) and `whoami`
(`whoami-tool.ts`, which reads only the server's env, this session's own
chat session file and, through `pane:self`, the pane this session runs in
now); every chat tool acts only as this session's own handle.
`gitlab_get`'s daemon guard in `lib/daemon/forge-reads.ts` caps the body
at 256 KiB counted in bytes, never follows a redirect (the token header
would travel with it), refuses a path percent-encoded more than once, and
redacts every `token` / `*_token` value. On GitLab it refuses the paths
that return credentials (`REFUSED_SEGMENTS`, also with a format suffix)
and the query keys that carry credentials or impersonation. On GitHub the
path must sit under the repo (`:repo/...`), and a word in
`GITHUB_REFUSED_SEGMENTS` is refused in any path segment, or as a
segment's dot-suffixed prefix, even inside a file path such as
`contents/src/hooks/x.ts`; `git/blobs` is refused for size, and the query
keys in `GITHUB_REFUSED_QUERY_KEYS` are refused too. The GitHub list also
covers secret scanning alerts and security advisories. A word in
`GITHUB_REFUSED_ROUTES` (`copilot`, whose cloud agent MCP configuration can
hold tokens) is refused only as the segment right after
`repos/<owner>/<repo>`, split after decoding, so `copilot` in a branch, a
file path or the repo's own name is not refused. A GitHub path with an
empty segment anywhere but a single trailing slash (`//`, raw or decoded
from `%2F`) is refused, since GitHub may collapse it and join a slash entry
such as `actions/oidc` that the check saw apart; that also pins which
segment the route rule reads. Those lists are
widened, never narrowed, without a design review.
`skills_resolve` (`skills-resolve-tool.ts`) runs `rt skills resolve`'s code
in process: it checks the id against `ID_RE` first, reads only under
`~/.claude/plugins/cache` and `~/.claude/skills`, and writes nothing. It
returns paths spelled through a skill link, never the link's target, and
refuses a `compiled.json` whose folder or key leaves the plugin's version
folder, or leaves its own skill link (the OS applies a `..` after following
the link, so nothing may climb back out through it).
Every git tool goes through `tree-guard.ts`, which
admits only the root of a registered checkout or worktree: `git_push` pushes
one explicit refspec to the branch's same-named upstream (the checked sha when
a check ran, since git's `-u` records nothing for a sha source and rt writes
the upstream itself), forces only with
`--force-with-lease --force-if-includes`, and refuses a detached HEAD, main,
master and the remote's default branch (and a remote whose default cannot be
read); with `rt.check` set, `git_push` and `rt_verb check` run tree code with no
prompt, which is why that setting is user or machine scope only;
`git_pull` is `--ff-only`; `branch_sync` runs `rt sync` only after a
preflight that refuses to reset over unpushed commits or force-push over
commits only origin has. `herd_spawn`, `herd_respawn`, `herd_gate_answer`,
`herd_gate_park`, `herd_diagnose`, `herd_nudge`, `herd_lanes`, `herd_close`,
`herd_follow_up`, `herd_attend` and `herd_wrap_up` run only from the session
the daemon records as the herd's shepherd, never from a worker pane, and every caller-named path a herd tool
or `rt_verb` takes (a brief, a template, an out file) is confined by
`temp-root-guard.ts` to the Claude Code temp root or an installed plugin or
pack root (the read-root check admits `.md`, and `.json` for `gate_open`
and `gate_record`). Every result, success or error, passes through `callTool` in
`lib/mcp/redact.ts` (called by `commands/mcp.ts` for each tools/call), which
strips credentials from URLs, query params, token shapes and auth headers; a
new tool inherits it and must never answer around it.

The `mr_*` tools cover what board panes and pipeline verbs write (notes,
whole submitted reviews, approvals, resolves, note edits, draft state,
retries, rebase, create, update, upload, merge). `mr_review_submit` posts a
review: on GitLab the way its own submit does (pending comments, one publish
with the summary and a reviewed state, then the approval), on GitHub in one
request. `outcome` is `comment`, `approve` or `request_changes`, which never
approves: on GitHub a changes-requested review, on GitLab the reviewer shows
as having requested changes. With `expectedHeadSha` the daemon reads the MR
head before posting, and a moved head posts nothing and answers
`published: false` with reason `head-moved`. It refuses when the caller
already has pending comments on the MR, because a publish would post those
too. `mr_approve`, `mr_ready`, `mr_retry`, `mr_create`, `mr_update`,
`mr_merge`, `mr_rebase` and the thread, comment and review tools (`mr_reply_thread`,
`mr_resolve_thread`, `mr_update_note`, `mr_comment`, `mr_comment_inline`,
`mr_review_submit`) work on both forges; `mr_rebase` with `wait` reads the PR back through `mr:get`
until its head moves, since GitHub reports no rebase in progress. The
upload tool is GitLab only. `mr_merge` is on the server for both forges
(the forge still enforces approvals and pipeline rules); on GitHub it goes
through the daemon too (`mr:merge-queue-status`, `mr:enqueue`, `mr:action`,
and `mr:get` to read the merge back), so only the daemon holds the token, and the tool keeps the merge queue wait
on its own side, one `mr:merge-queue-status` read per poll. The skill's ship gate is the
human check. `mr_upload` and `evidence_attach` are
the tools that send a local file off the machine (on GitHub `mr_upload`
refuses and names `evidence_attach`, which sends a PR's evidence images
through the daemon's `mr:describe-with-attachments`: the same guard and
record checks as `mr:upload`, then gh with the token only in its
environment), so the daemon guard
(`lib/daemon/upload-guard.ts`) refuses anything outside the target repo's
worktrees, the user's Claude Code temp root, rt's own evidence folder
(`~/.mattstack/evidence/`, `evidenceDir()` in `lib/rt-paths.ts`, for
screenshots you want to upload; admitted only as a real directory the
user owns, never a symlink), a pipeline run's own evidence folder
(`~/.mattstack/work/<run id>/evidence/`, for a run that exists) and
`rt.mcp.uploadRoots`, and anything whose bytes do not match its image or
video extension; widen the roots through that setting, never by loosening
the guard; the setting warns on an entry that is `/`, the home folder or an
ancestor of it. Target resolution (`repoName` as identity, path or
label, or `mrUrl`) lives in `lib/mcp/mr-target.ts`; for a tool that
resolves its target through `resolveMrTarget` or `resolveRepoTarget` there, a
GitHub PR URL names a target only when the tool passes `github: true`, and
only a tool whose daemon verbs all answer on GitHub may (`evidence_attach`
passes `github: true` too). The daemon verbs still take the serialized
identity only.

Decision gates (`rt gate ask`, `rt gate wait`, the board's stage sheet) are
the only way an unattended pane asks a human anything. The
`AskUserQuestion` hook in `.claude/` panes defers to `rt gate fork-check`
(rt#391): it allows the launch subject's gate, a worktree run gate, or a live
form gate this pane asked under its own session, and never counts
pane-attention gates. Before changing gate ownership, the hook, or the
fork-check rules, read the gate-seam spec named in `docs/architecture.md` and
the `rt-chat` skill under `skills/` and the gate protocol under
`plugins/mattstack/attachments/gate-protocol/`.

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
is `rt gate wait`, which blocks past any tool timeout, and `rt events wait`
under `Monitor`, covered by `Bash(rt gate *)` and `Bash(rt events wait *)`.
The shepherdr skill answers and parks gates through `herd_gate_answer` and
`herd_gate_park`; `rt gate answer --by shepherd` is left for a person.
Everything else a skill runs routinely is a tool on the mattstack server.
Do not widen the list to make a skill work; add a tool or an agent-safe
verb.
