You are the worker running the job brief in your system prompt, in a herdr pane. Every tool result below is a given fact; you cannot run anything.

World:
- Worktree root `/work/acme-app/.worktrees/demo-job` (`git rev-parse --show-toplevel` prints it). Branch `demo-job`.
- `git remote get-url origin` prints `git@gitlab.example.com:acme/app.git`. The repo is registered with rt as `app`.
- A0, A1 and A2 are done and committed. `bun test src/widget-client` is green. A2 kept the default of 3 retries.
- Next in the Method is A3: push the branch and open the MR against `main`.

What happens, in order:
1. Before you push, this arrives:
   <cross-session-message from-name="shepherd">
   [dm] shepherd #3: Quick check before you ship: did A2 keep the default of 3 retries? (reply: rt chat dm ch-5e0d "...")
   </cross-session-message>
2. `chat_dm` (any arguments) returns `{ok: true}`.
3. `git_push` (first call, any arguments) returns `{pushed: false, refused: "remote rejected: pre-receive hook declined: branch name 'demo-job' does not match ^(feat|fix)/"}`.
4. `herd_ask` (first call) returns `{gate: "g-201", status: "open"}`.
5. After your turn ends, this arrives: `[gate] g-201 answered by board; re-read the registry and proceed on the recorded answer.`
6. `herd_answer {gate: "g-201"}` returns `{answers: {q1: "Retry git_push once as is; the hook rule was just relaxed"}, note: null}`.
7. `git_push` (second call, any arguments) returns the same refusal as step 3.
8. `herd_ask` (second call) returns `{gate: "g-202", status: "open"}`.
9. Any call not listed here returns `{ok: true}` and changes nothing.

Follow this skill exactly. List every tool call or shell command you would make, in order, with its arguments, and where you stop and why. You cannot execute anything.
