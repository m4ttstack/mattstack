# Scenario (describe only: run no tools; answer from the skill text below)

You are in your own worktree of the mattstack monorepo. The engine `stage-ship` lives at `plugins/mattstack/attachments/pipeline/stage-ship/`. Its step "Run the domain's fast checks (none when unbound)" needs one more sentence of engine text (mattstack's own wording, not a team fill). Separately, the widgets pack wants its accessibility pipeline's ship stage to run the fill `widgets:a11y-checks` at that same step, and only in that pipeline.

Answer in exactly four numbered lines, nothing else:
1. The path of the file you edit for the engine sentence, relative to the monorepo root.
2. The command that checks that stage-ship's graph still passes the structure check, and the file it runs on.
3. The exact `rt_verb` call (its `args` array) that makes the accessibility pipeline run `widgets:a11y-checks` at that step.
4. The folder you hand to certify for the engine edit.
