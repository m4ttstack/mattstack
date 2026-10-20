# RED/GREEN: the review verb drafts its comments and posts them verbatim

Scope: `attachments/review/review/SKILL.md`, `attachments/review-posting/SKILL.md`
and `attachments/review-core-body-tail/SKILL.md`. The spec is
`docs/superpowers/specs/2026-10-20-review-gate-drafted-comments-design.md`
at the repo root.

## Method

System files come from `../2026-10-16-review-skills/build-system-files.sh
<tree> <out-dir>`, which compiles `review` and `self-review` from a scratch
copy of the plugin under an isolated HOME. RED compiles the branch before
the skill edits (`cddf890a9`), GREEN the edited tree. `run-reps.sh` here is
that lane's describe-only recipe (Sonnet, no tools, no MCP, no hooks), run
over `scenarios/`. The fixture is the 12-finding
`attachments/review/review/tests/fixtures/findings-v3-drafts.json` (`d7`
has no `file`). Payloads were scored by exact string match on every body
and the summary, then read by hand.

| Scenario | What it checks |
|---|---|
| G1 | GitLab, direct run, board answers: `texts.d1` edit, `outcome.text` summary edit, `d11` unticked |
| G2 | GitHub, direct run, board answers: `texts.d7` edit on the folded finding, no summary edit, `d6` unticked |
| G3 | GitLab, the board's fresh posting pane hands `{findings, outcome, texts, summaryText}` with `--report` |
| D1 | Write the report: json carries `comment` and `summary.comment`, demoted comment says unverified, extras carry `editable: true` |
| S1 | Self-review asked for a report file: its json carries no `comment` |

## RED (3 reps each)

| Scenario | Result |
|---|---|
| G1 | 0/3. Every rep posted the `d1` edit but rewrote the other nine bodies as "tier: title / To fix: ..." and wrapped the summary in a "Not tied to a line:" issue list plus an Assessment. One rep: "I don't use the json's per-finding `comment` fields or `summary.comment`. They aren't part of the findings contract, and `summary.comment` says 'twelve notes' when eleven are selected." |
| G2 | 0/3. One rep kept the comment texts but rewrote the summary ("twelve" to "eleven", an added Assessment, a bold tier and title header per finding); two rewrote every body. |
| G3 | 0/3. Bodies verbatim in two reps, but each summary gained a lead-in ("One note has no single line to hang on, so it lives here:") and a bullet; one rep rewrote the bodies with bold headers. |
| D1 | 0/3. No `comment` fields, no `summary.comment`, no `editable`. |
| S1 | 3/3 carry no `comment` (the baseline already holds). |

## GREEN

Round 1 (5 reps each): G1 5/5, G2 5/5, D1 5/5, S1 5/5, G3 4/5. The G3 miss
said "d1 and d7 take the human's `texts`" and then folded `d7`'s draft into
the summary instead of its edit. Revision: Compose now says a folded
finding's text is chosen exactly as a comment's, its `texts` entry first.

Round 2 (5 reps each, G1 to G3): G1 5/5, G2 5/5, G3 5/5. In every rep the
submit carried the `d1` edit, every other draft word for word, and a
summary equal to the summary line, a blank line, then the folded `d7` text
(edit or draft), with nothing else. On GitHub the body was that summary,
then each anchored finding as `file:line` on its own line and its draft
word for word. `mr_posted_since` items quoted the first line of the
edited body. No rep ran a shell command a tool covers.
