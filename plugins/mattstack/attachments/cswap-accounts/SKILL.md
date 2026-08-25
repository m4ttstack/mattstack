---
name: cswap-accounts
description: "cswap provider for the account-pool@1 contract: given a herd's model mix and the accounts already assigned this run, names where to launch the next worker. Reached through a wrapper's accounts slot; not for direct invocation."
disable-model-invocation: true
metadata:
  provides: "account-pool@1"
---

# cswap account pool

Given the herd's model mix and the accounts already assigned this run,
name where to launch the next worker, or report that no pool account
qualifies. **Spawn-time only:** an Agent-tool subagent runs in-process on
the caller's credentials and exposes no account dimension, so this
contract can only be honored where workers launch as their own sessions.

Paths below are relative to this skill's directory; the compiler inlines
this fill under `shepherdr`'s `## Accounts` section at compile time.

## The pool question

If `cswap` is installed and `cswap list --json` shows two or more
accounts, ask ONE structured question (AskUserQuestion, single choice)
before spawning anything: how should this herd use accounts?

1. Smart distribute across all accounts (recommended)
2. Smart distribute across a subset -- follow-up multi-select of accounts
3. Single account -- follow-up single-select

Build each account's option description from headroom mode, passing the
herd's chosen models:

```bash
${CLAUDE_SKILL_DIR}/scripts/pick-account.py --headroom --pool 1,2,3 --model fable,sonnet
```

It prints one line per account (email, per-model scoped pcts with
EXHAUSTED callouts, 5h/7d, binding for that model mix). Use those lines
verbatim -- a scoped pool can be exhausted while overall headroom looks
fine, and the user must see that before choosing.

The selection is the session pool: record it, and never spawn or respawn
outside it without explicit approval. No cswap or a single account: skip
all of this; workers launch on the default `claude` command.

## Per-spawn pick

Before each spawn in a smart-distribute herd:

```bash
ACCT=$(${CLAUDE_SKILL_DIR}/scripts/pick-account.py --pool 2,3 --model <model> --assigned <accounts-already-assigned>)
```

`--assigned` lists the account of every worker already launched this run,
one entry per worker. The picker excludes accounts near their limits and
answers with the healthiest account for that worker's model; a nonzero
exit means no pool account qualifies -- surface that to the user as a
structured question, never spawn anyway.

The launch command this provider hands to transport:
`cswap run <account> --` (model and effort arguments are appended to it).

## Exhaustion mid-run

In smart-distribute mode with a qualifying account left in the pool,
respawn automatically; the wrapper owns the respawn mechanics. In
single-account mode, or with the pool exhausted, ask instead: 1. wait for
reset (show the countdown from `cswap list --json`), 2. switch to an
out-of-pool account, 3. abandon.

## Quirk

cswap sessions share settings and skills but not plugin caches, so
missing-plugin symptoms in worker panes are expected -- do not chase them.
