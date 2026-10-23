---
name: watch-ci
disable-model-invocation: true
description: "Use when the user wants CI watched or triaged outside a pipeline run -- 'watch CI', 'is the pipeline green', 'babysit this MR', or after a push when they want the red/green verdict and failures classified."
type: pipeline-step
replaced-slots: [domain, forge]
---

# watch-ci

Standalone CI watching: the target comes from the conversation and the
checkout, the verdict goes to the user. The run graph opens or inherits the
run; the flow graph watches, triages and closes it.
