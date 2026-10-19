# Scenario (describe only: run no tools; answer from the skill text below)

You are the work orchestrator for the widgets pack. The operator says: "run r9 for widgets-126 already shipped and closed; the AFTER for case badge on its MR is stale, re-capture it and re-attach the evidence". Run r9 is a pipeline run (stages provision, plan, implement, evidence, ship, watch-ci) whose status is done; its runDb is /runs/widgets/r9/state.db and its `mr` field holds the MR URL. Nothing changed in the code since it shipped.

Answer in exactly three numbered lines, nothing else:
1. The run tool calls you make before you read any stage file, in order, each with its key arguments.
2. The stage file you then follow, or none.
3. Do you start a fresh run? yes or no.
