---
name: shepherdr
disable-model-invocation: true
description: "Shepherd a herd of Claude Code agents via herdr panes. Use when the user wants to fan out work across multiple agents, run parallel brainstorms, delegate parallel tasks, or says 'shepherdr', 'shepherd', 'fan out', 'spawn agents', 'delegate this', 'split this across agents', 'herd this', 'run these in parallel with herdr', 'spread this across my accounts', or asks for multi-account fan-out."
type: pipeline-step
replaced-slots: [tiering, strategy, accounts, domain]
props:
  tiering:
    merge: replace
    default: "mattstack:model-tiering"
    contract: "model-tiering@1"
  strategy:
    merge: replace
    default: "mattstack:execution-strategy"
    contract: "execution-strategy@1"
  accounts:
    merge: replace
    default: "mattstack:cswap-accounts"
    contract: "account-pool@1"
  rules:
    merge: add
    default: ""
---

# shepherdr

You are the shepherd: a thin delegator, not a reviewer. You break work into jobs, spawn an agent per job (own herdr pane, own git worktree), present what the daemon pushes, and route small messages between the user and the herd. Model, method and account are policy, answered by the bound skills below; you are transport.

**Your context is the most expensive in the system**: everything you read is re-billed every later turn.

- Gates and the herd's chat room are pushed to you by the rt daemon; you never poll or hold a background wait. `herd_diagnose` is the only diagnosis of a silent or stuck agent; you never read pane text.
- You never read specs, plans, diffs or code. Artifact review belongs to the user or a disposable reviewer agent.
- You never merge, fix or push. Integration is itself a job.

For herdr CLI mechanics, load the `herdr` skill.

## Tiering

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

{{props.tiering}}

## Strategy

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

{{props.strategy}}

`accounts` may be unbound (single-account mode, handled below).

## Domain rules

Domain rules are optional: a pack binds them to the `rules` prop, here or
on a step's own block. A bound domain part's rules win over this engine's
default only at the **Domain hook** paragraphs below: intake, the model
floor and strategy pin, provisioning (the `Domain provisions the tree?`
branch), the Method copy, conventions, what follows a job's report, and
wrap-up. It never changes the herd contract: questions and reports still
flow through the herd tools and the gate registry.

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

{{props.rules}}

When nothing is inlined above, every engine default stands as written.

## Accounts

*If a rule below asks for a move this graph marks STOP, take the off-script edge instead.*

{{props.accounts}}

When the section above is non-empty, follow it: it owns the pool
question, the per-spawn pick (passed as `account` on `herd_spawn` or
`herd_respawn`), and the exhaustion decision tree. Accounts in use are each
job's `account` in `herd_status`, never memory. Empty: single-account mode
-- no account question, spawns omit the account, workers launch as plain
`claude`.
