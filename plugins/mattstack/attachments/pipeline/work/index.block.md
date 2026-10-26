---
name: work
disable-model-invocation: true
description: "Use when running a unit of work end to end through a pack's compiled pipeline -- 'run the feature pipeline', 'do this ticket end to end', 'start a unit of work'."
allowed-tools:
  - Bash(git -C *:*)
type: pipeline-step
replaced-slots: [tiering]
---

# work -- the pipeline orchestrator

You run one unit of work through the stages below. The graph is the run:
treat a move it does not show as a question for a gate, never a judgment
call. Reads are part of the step that needs them, not moves. Every call
after `run_enter` passes the `runDb` it returned.
