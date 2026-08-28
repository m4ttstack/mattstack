# cloud lanes: a shepherdr lane in a mattcloud sandbox

Cloud lanes keep the FILE contract -- a pod has no herd DB and no skill
scripts: job.md in, question.md/report.md out, answers back in. The pod's
watcher and rt replace panes and herdr. The Mac is window and identity
only. Load this file only when a job is going to a
sandbox; pane lanes never need it.

Cloud lanes fit execution/research jobs on sandbox-enabled repos (an
overlay exists under `~/.mattstack/rt/repos/<repoId>/` with a sandbox.jsonc). Design
jobs with artifact gates stay in panes.

Cloud jobs never get a herd DB `jobs` row, so `herd-read.py log` omits
them entirely; the shepherd's wrap-up table adds cloud lanes from its own
sandbox status tracking instead.

## spawn

Model and account questions run exactly as for pane lanes (models first,
then accounts via the pick-account.py script of the skill bound to the
accounts slot). The picked account number N maps to
the token secret key `acct-N.token` (minted by `cswap run N -- setup-token`
in a real terminal, saved under `~/.mattstack/rt/secrets/agent-tokens/`, shipped by
`rt cloud secrets sync-agent`). Then, from a checkout of the target repo:

    rt sandbox create --ticket <TICKET> --job /path/to/brief.md \
      --account acct-N.token \
      --agent-env ANTHROPIC_MODEL=<model-id>

(or `--branch <name>` instead of `--ticket`.) The command prints the
sandbox id; record it in the status table. The daemon's sandbox-sync
begins notifying automatically once the anchor exists.

Brief deltas vs a pane lane (everything else travels verbatim):

- Replace "commit incrementally; never push" with: "commit incrementally
  and push checkpoints with
  `git push origin HEAD:refs/sandboxes/$SANDBOX_ID/<branch>` -- only
  sandbox refs are accepted; `$SANDBOX_ID` is in your environment."
- The job dir line: the in-pod job dir is `/workspace/.mc/job/`; the brief
  is delivered there as job.md by the seed. Question/report files go there,
  never in the repo.
- No trust dialog, no kickoff prompt: headless Claude receives job.md as
  its first turn. The brief must stand entirely alone.
- Replace the brief's 'Asking the user a question' and 'Publishing a
  report' sections with the file contract below.

## question/report files (cloud contract)

Write `question.md` in your job directory (the absolute path from your
kickoff -- NOT inside the repo) exactly in this format, then stop and wait.
The answer arrives as your next message.

    # QUESTION
    needs: answer
    ## Context
    <what you're doing and what led here; enough that the user can answer
    from this file alone without opening your pane>
    ## Question
    <one sentence>
    ## Options
    1. <option> -- <one-line tradeoff> (recommended)
    2. <option> -- <one-line tradeoff>
    3. <option>

Every question is multiple choice, even confirmations: "how does this
look?" becomes 1. Approve, proceed (recommended) / 2. Approve with
changes (describe) / 3. Walk me through <section> first. Mark your
recommendation. If the question truly cannot be carried by a file
(the user must see the screen), set `needs: pane`. Delete question.md
after you receive the answer.

When the job is complete, write report.md to the in-pod job dir per the
brief's Method contract, then stop.

## watch

The rt daemon notifies on question/report/blocked/process-dead. To poll
explicitly (the herd-monitor analog; print only what's new):

    rt sandbox events <id> --since <last-seen-seq>

Track the highest seq processed per lane. The event-to-action table maps
onto the pane table:

| event | meaning | act |
|---|---|---|
| question | question.md written | relay via AskUserQuestion, answer below |
| report | report.md written | completion checks |
| blocked | blocked.md written | read it, decide |
| process-dead / state error | died without a report (incl. 3 failed turns) | diagnose: `rt sandbox logs <id> agent` |
| captured lane.json | supervisor heartbeat | status table; `working|idle|blocked|done`, `longTurn` = deep but alive |

## relay and steer

    rt sandbox answer <id> answer.md      # or pipe on stdin
    rt sandbox steer <id> steer.md        # injected at the next turn boundary

A steer outranks a queued answer at the turn boundary. Delivery is
confirmed by a captured lane.json event whose steerAck sha256 matches the
steer content; if no ack lands within two turns, re-steer (the mailbox is
last-write-wins).

## completion

Objective checks fetch from the receiver, not a worktree:

    GIT_SSH_COMMAND="ssh -i ~/.ssh/mattcloud-mirror" \
      git fetch ssh://git@localhost:2222/repos/<repoId>.git refs/sandboxes/<id>/<branch>
    git log --oneline FETCH_HEAD
    git diff --stat <base>..FETCH_HEAD

`rt sandbox ship <id>` performs fetch + review + confirm + push-as-operator
in one gated verb. Park a lane with `rt sandbox suspend <id>`; resume never
auto-continues a turn -- poke it with steer/answer after
`rt sandbox resume <id>` (same session continues; check lane.json
sessionId).

## rate-limit respawn analog

A lane whose account exhausts mid-job: pick a new account
(the accounts skill's pick-account.py --assigned as usual), `rt sandbox destroy <id>`, and
re-create on the same branch with the new `--account` key. The branch
state lives on the receiver; the new brief says "continue from the pushed
checkpoint ref refs/sandboxes/<old-id>/<branch>".

## attended lanes

An attended lane is the herdr-native class: herdr server + sshd run in the
pod, Claude pre-launched in a pane, the operator attaches as thin client. Spawn:

    rt sandbox create --ticket <TICKET> --attended --tui-account acct-N

(`--attended` excludes `--account`; the tui account must have been synced
via the TUI credential path first.) the operator attaches from the Mac with
`rt sandbox attach <id>` (add `--exec` to jump straight into
`herdr --remote mc-<shortid>`).

Etiquette: attended panes are HUMAN territory. The shepherd never drives
them -- no `herdr agent prompt` into an attended pane, no reading its
transcript to "check progress". The job-dir contract does not apply unless
a brief was explicitly seeded at create time; an attended lane with no
brief is the operator's session, full stop.

## red flags

- About to kubectl exec/logs into a sandbox "to see how it's going"? Stop:
  events and lane.json are the window. The logs verb is for diagnosing a
  dead lane, not watching a live one.
- Spawning a browser-needing job into a `profile: "research"` repo? The
  research profile has no chrome sidecar; the brief must not ask for
  browser work.
- More than one full-profile sandbox, or full + several research lanes?
  Check the Civo disk quota ceiling first (PVCs: full 29Gi, research 10Gi).
- The operator shell needs `MC_API_TOKEN` exported for mutating verbs when
  the controller has the bearer enabled; a 401 means the env is missing,
  not that the controller is broken.
