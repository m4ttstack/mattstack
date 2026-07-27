---
name: gitq:publish
description: >-
  Push a tracked gitq stack's unpublished branches and create or update its
  GitLab MR chain, writing the MR titles and descriptions itself. Launched by the
  gitq board as "/gitq:publish <repoPath> <stackName> --state <path>
  --status-bin <path>", or invoked by hand without those flags. Holds a
  human gate before anything leaves the machine.
---

# gitq publish runner

Push the stack's not-yet-published branches (gitq pushes with
force-with-lease) and open or retarget its MR chain on GitLab. gitq does the
pushing and MR plumbing; you write the MR prose and hold the gate.

What `gitq publish` does per branch, so your gate can say it accurately:

- **No MR yet**: the branch is pushed and a draft MR is opened against its
  parent, titled and described from your `--mr-meta`.
- **Already has an open MR**: the branch is **not** pushed. Its MR is
  retargeted if the stack moved it under a different parent, and its title
  and description are overwritten **only if your `--mr-meta` names that
  branch**. An MR that needs neither is left untouched and does not appear in
  the results.

| flag | meaning |
|------|---------|
| `<repoPath>` (positional) | absolute path of the repo checkout |
| `<stackName>` (positional) | the tracked stack to publish |
| `--state <path>` | lifecycle status file the board polls (optional) |
| `--status-bin <path>` | absolute path to the board's status-writer CLI (optional) |

**Status writes.** When `--state` and `--status-bin` were given, write status
only by running the injected bin:

```
bun run <status-bin> <state> <status> [detail]
```

with status one of `working | conflict | done | error` (the board writes
`starting` at spawn). When the flags are absent, skip every status write and
just talk to the human; everything else below is unchanged.

## Steps

1. **Mark working.** `bun run <status-bin> <state> working "publishing <stackName>"`
2. **Check the stack's shape.** `gitq -C <repoPath> diagnose --json` (no
   `--stack` flag; find your stack by `stackName` in the `stacks` array).
   - A paused cascade blocks publish outright (gitq refuses every mutating
     command mid-pause). Mark error with "cascade paused; finish or abort it
     first" and suggest gitq:sync.
   - Branches that are behind or conflicted do not block publish, but say so
     at the gate in step 4 so the human can choose to sync first.
3. **Write the MR metadata.** Get the branch chain from
   `gitq -C <repoPath> stacks --json`. For each branch being published, read
   its commits (`git -C <repoPath> log --oneline <parent>..<branch>`) and
   its diff, then write a title and description. Follow any MR-writing
   conventions the user's rules define; absent those, use the branch's main
   change as the title and a description of 1-2 sentences of framing plus
   action-first bullets. Only include a branch that already has an MR when
   you mean to overwrite that MR's title and description on GitLab: an entry
   replaces whatever is there, including edits made in the GitLab UI. Save
   the result as JSON to a temp file (`mktemp` suffixed `.json`) in gitq's
   mr-meta shape:

   ```json
   { "<branch>": { "title": "...", "description": "..." } }
   ```

4. **Gate.** Show the human: the branch chain in order, which branches get a
   new MR versus an update (and for an update, whether it is a retarget, a
   title/description rewrite, or both), and each title + description. Ask for
   approval before anything is pushed. The go/no-go is not yours to make. If
   the human never answers, leave the pane holding: no publish, no `done`
   write.
5. **Publish.** After approval:
   `gitq -C <repoPath> publish --stack <stackName> --mr-meta <tempPath> --json`
   - **exit 0**: every MR gitq acted on was created or updated; go to step 6.
     Each entry in `results` carries `action` (`created` or `updated`) and,
     for an update, `changes` (`target`, `metadata`, or both). A branch that
     needed nothing is absent from `results` entirely.
   - **exit 1** with a `gitq:` line on stderr: hard failure. The commonest is
     a missing GitLab token (gitq reads `GITLAB_TOKEN`, then the
     `gitlabToken` field of `~/.rt/secrets.json`; gitlab.com only). Mark
     error with the stderr text.
   - **exit 1** after normal JSON: some per-MR results have
     `success: false`. Mark error naming the failed branches, and report
     which MRs did go through.
6. **Mark done.**
   `bun run <status-bin> <state> done "<n> MRs created, <m> updated"`
   Then give the human the MR URLs from the publish JSON, in stack order.

## Rules

- Nothing is pushed and no MR is touched before the human approves at the
  gate. A clean diagnose never substitutes for the human's yes.
- Do not edit branches, rebase, or otherwise mutate git here. If the stack
  needs a rebase first, that is gitq:sync's job; say so and stop.
- Always end with a terminal `done` or `error` status write (when the status
  flags were given), except when parked at the gate waiting on a human who
  has not answered.
- If `gitq` is not on PATH, stop and tell the human to run `bun link` in the
  gitq checkout.
