---
name: stage-provision
description: "Pipeline stage: establish where the unit of work happens -- workspace, branch, ticket. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*), Bash(rt worktree provision:*)
metadata:
  stage: "provision"
  stage-consumes: "ticket repo"
  stage-produces: "branch worktree"
  slots: "domain"
  slot-domain: "optional provision-domain@1 -- owns the domain's provisioning flow: developer config, environment detection, workspace and branch acquisition, ticket lookup or creation"
---

# stage: provision

## Run state

Contract v2 (authoritative text: `references/convention.md` in the
parameterized-skills skill). If `RT_RUN_DB`/`RT_PIPELINE_STATE` are unset you
are running standalone -- skip every call in this section silently.

- First action: `"$RT_PIPELINE_STATE" stage-start --stage provision`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage provision`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage provision`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage provision --reason
  "<what actually failed>"` before you report it.

Read the uow record at the path the orchestrator stated. If `mode` is
`worker`, you were dispatched into a prepared worktree: verify `git status`
runs cleanly in `$PWD`, write `worktree` ($PWD) and `branch` (current
branch) into the record, and finish -- no detection, no acquisition.

Otherwise resolve the domain slot:

```bash
"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"
```

Nonzero exit: print `errors` verbatim and stop. Bound: read the SKILL.md at
`resolved.domain.path` and follow it; it owns config, detection, and
acquisition end to end.

Unbound (generic fallback): run
`rt worktree provision --repo <repo> --ticket <ticket> --json`. Pass
`--title "<ticket title>"` whenever a ticket title is known -- without it
the branch gets no slug.

- `ok`: `EnterWorktree` to `data.path`; write `branch` and `worktree`
  (`data.path`) into the record. A cold create (`wasOnDeck:false`) can take
  minutes -- tell the user it's provisioning.
- error `branch-attached:<tree>`: surface "resume in `<tree>`?" to the user
  -- do not silently pick a side.
- `null` (daemon down) or an `unknown-repo` error: fall back to the old
  generic path -- confirm `repo` is a git checkout
  (`git -C <repo> rev-parse --git-dir`); derive a branch name from the
  ticket id and a short kebab slug of its title (or from the task
  description when there is no ticket); create it from the default branch
  (`git -C <repo> switch -c <branch>`); never commit to the default branch
  directly.

Finish by writing `branch` and `worktree` (absolute path; the checkout
itself when no separate worktree is used) into the record.

When this stage is what found or created the ticket -- not when one was
already known coming in -- also write `ticket` into the record and
`"$RT_PIPELINE_STATE" field set ticket <value> --stage provision`. This
field is deliberately absent from `stage-produces` above: that list is a
completeness gate ("this stage is not done until X exists"), and a
ticketless run through this stage is a normal, finished run -- so `ticket`
cannot be a required produce even though this is the one place its value
can become known.
