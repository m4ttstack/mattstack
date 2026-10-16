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
over `lib/gates/`), the `mr_*` writes and `mr_map`, `rt_verb`, the herd worker tools
(`herd_gates`, `herd_ask`, `herd_answer`, `herd_report`) and five chat tools
(`chat_post`, `chat_dm`, `chat_ack`, `chat_claim`, `chat_release`), and
spreads in the rest: run tracking (`run-tools.ts`, in-process over
`runWriteVerb`, a caller's `runDb` confined to the runs root), GitLab reads
(`mr-read-tools.ts`, `forge-read-tools.ts`: every one asks GitLab through
the daemon on each call and none reads the open-MR cache, so an agent can
read any MR its token can; `mr_map` in `tools.ts` is the exception and
reads the daemon's synced MR list; `gitlab_get` is a GET-only passthrough whose
daemon guard in `lib/daemon/forge-reads.ts` refuses the paths that return
credentials (`REFUSED_SEGMENTS`, also with a format suffix, and a path
percent-encoded more than once) and the query keys that carry credentials
or impersonation, caps the body at 256 KiB counted in bytes, never follows a
redirect (the token header would travel with it), and redacts
every `token` / `*_token` value; those lists are widened, never narrowed,
without a design review), CI (`ci-tools.ts`: `ci_watch`, which reads GitLab
on every poll, and the `ci_lease_*` tools), the stack store read
(`stack-tool.ts`: `branch_stack` admits a tree only through
`tree-guard.ts`), git writes
(`git-tools.ts`), worktrees (`worktree-tools.ts`: provision, dispose,
stop-holders, and no general kill), the other herd tools
(`herd-tools.ts`), the other chat tools (`chat-tools.ts`) and `whoami`
(`whoami-tool.ts`, which reads only the server's env and this session's own
chat session file); every chat tool acts only as this session's own handle.
Every git tool goes through `tree-guard.ts`, which
admits only the root of a registered checkout or worktree: `git_push` pushes
one explicit refspec to the branch's same-named upstream, forces only with
`--force-with-lease --force-if-includes`, and refuses a detached HEAD, main,
master and the remote's default branch (and a remote whose default cannot be
read); `git_pull` is `--ff-only`; `branch_sync` runs `rt sync` only after a
preflight that refuses to reset over unpushed commits or force-push over
commits only origin has. `herd_spawn`, `herd_close`, `herd_follow_up`,
`herd_attend` and `herd_wrap_up` run only from the session the daemon records as the herd's
shepherd, never from a worker pane, and every caller-named path a herd tool
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
review the way GitLab's own submit does: pending comments, one publish with
the summary and a reviewed state, then the approval; it refuses when the
caller already has pending comments on the MR, because a publish would post
those too. `mr_merge` is on the server (GitLab still enforces approvals and
pipeline rules); the skill's ship gate is the human check. `mr_upload` is
the one tool that sends a local file off the machine, so its daemon guard
(`lib/daemon/upload-guard.ts`) refuses anything outside the target repo's
worktrees, the user's Claude Code temp root, rt's own evidence folder
(`~/.mattstack/evidence/`, `evidenceDir()` in `lib/rt-paths.ts`, for
screenshots you want to upload; admitted only as a real directory the
user owns, never a symlink), a pipeline run's own evidence folder
(`~/.mattstack/work/<run id>/evidence/`, for a run that exists) and
`rt.mcp.uploadRoots`, and anything whose bytes do not match its image or
video extension; widen the roots through that setting, never by loosening
the guard. Target resolution (`repoName` as identity, path or
label, or `mrUrl`) lives in `lib/mcp/mr-target.ts`; the daemon verbs still
take the serialized identity only.

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
is `rt gate` (`rt gate wait`, which blocks past any tool timeout, and the
shepherd's CLI-only `rt gate answer --by shepherd`) and `rt events wait`
under `Monitor`, covered by `Bash(rt gate *)` and `Bash(rt events wait *)`.
Everything else a skill runs routinely is a tool on the mattstack server.
Do not widen the list to make a skill work; add a tool or an agent-safe
verb.
