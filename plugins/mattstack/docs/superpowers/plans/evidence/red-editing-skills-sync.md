# RED/GREEN: editing-skills release tail is rt skills sync

Reference-skill retrieval fixture, run 2026-09-14, one sonnet subagent per arm.
Scenario, identical in both arms: "I just edited the `work` engine in
mattstack-skills. Get that change live in the compiled `acme` team pack and
in a fresh session. Give the ordered list of exact commands." Planning only, no
mutating commands. RED ran against the installed 0.17.4 skill; GREEN ran against
the edited working-tree file, with the cached skill explicitly forbidden.

`rt skills sync` shipped in rt#231 on 2026-09-10 and the skill was never updated,
so the whole deterministic release tail was still documented as hand-run.

## RED (0.17.4 text)

Nine commands across two repos, abridged to the shape:

> ```
> git add attachments/pipeline/work; git commit ...
> sh tests/certify.sh attachments/pipeline/work
> # edit plugin.json 0.17.4 -> 0.17.5; git add; git commit
> rt skills compile --pack mattstack; rt skills check --pack mattstack
> git add skills/; git commit; git push
> claude plugin update mattstack@mattstack
> # edit acme plugin.json 0.5.36 -> 0.5.37 BEFORE compiling
> rt skills compile --pack acme; rt skills check --pack acme
> git add -A; git commit; git push
> claude plugin update acme@beacon
> ```

Verdict: FAIL as intended. Three findings, not one:

1. `rt skills sync` never appears... the agent cannot invoke a verb the skill
   does not name.
2. **Neither checkout is pulled.** This is the exact failure the verb was built
   for: a checkout parked on a merged branch compiles a stale engine and nothing
   surfaces it.
3. The installed-cache dimension is never consulted, so a cache lagging its
   source stays invisible.

Correct in the baseline, and worth keeping correct: it derived
`acme@beacon` from `marketplace.json` rather than reusing the pack name.

## GREEN (edited text)

> ```
> sh tests/certify.sh attachments/pipeline/work
> # bump .claude-plugin/plugin.json 0.17.4 -> 0.17.5
> git add attachments/pipeline/work .claude-plugin/plugin.json
> git commit; git push origin main
> rt skills sync --pack mattstack
> rt skills sync --pack acme
> ```
> ...plus the cswap `CLAUDE_CONFIG_DIR=` repeat for any session sync warns
> about, the by-hand fallback if sync refuses with content drift, and a restart
> of every session sync reported `restartNeeded` for.

Verdict: PASS. Two syncs replace seven hand steps; the engine bump stays with
the author, which is the one thing sync never does; both refusal paths are
carried.

Remedy applied: the GREEN arm reported that release step 1 packed certify,
bump and commit into one bullet without ordering them (an ambiguity inherited
verbatim from the 0.17.4 text). Step 1 now states the order explicitly.

## Description micro-test

`bun run tests/desc-test.ts --reps 5 --model haiku` after widening the
description with `rt skills compile / check / sync` and `an installed cache is
lagging`: 11 scenarios x 5 reps, all PASS, including the added scenario
"rt skills check says my team pack's installed cache is lagging behind its
source version" -> `editing-skills`. No trigger regressed.

The first wording also carried `rt skills sync refused` and ran 11/11, but came
to 531 chars and failed certify's 500-char `fm-description` cap. Dropping that
phrase plus the redundant "built with `rt skills compile`" clause brought it
under the cap; the re-run above is the post-trim result.
