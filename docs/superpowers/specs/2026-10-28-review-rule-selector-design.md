# Review rule selector: design

Status: approved for planning, 2026-10-28.

## Why

A pack can bind review criteria, but criteria are prose every reviewer reads
whatever the diff touches. Some teams keep their review rules as structured
files that a command can select for a given diff (only the rules whose scope
and conditions match, with the lines that triggered them) and can later check
a reviewer's answers against. The shared review engines gain an optional slot
for such a command, so a pack can hand the reviewer only the rules that apply,
get a verdict for each, and turn every failed rule into a finding.

The engines stay tool-neutral: they know only the command lines a fill
resolves to and the JSON shapes below, never which tool sits behind them.

## The slot

A new prop `rule-selector` with contract `rule-selector@1`, `merge: replace`,
`default: ""`, declared in its own block in each of `review`, `self-review`
and `receive-review`. Unbound (the default), every step below is skipped and
the engines behave exactly as today.

### rule-selector@1

A fill's text, followed at run time, resolves to one of:

- the single line `selector: none`; or
- three lines:
  - `selector: <command line>` holding the placeholder `{format}`;
  - `verdicts: <command line>` holding `{selection}` and `{verdicts}`;
  - `fence: <info string>`: the tag of the fenced code block the reviewer
    returns its verdict set in.

The fill may read settings or the environment to decide (a team switch that
turns rules off resolves to `selector: none`), so the resolution happens on
every run, not at compile time.

**The selector.** Run twice, `{format}` replaced by `json` and then `text`,
each time with the change's unified diff on stdin; stdout is captured. The
JSON is the selection; the engine reads only `rules[]`, each with `id`,
`severity` (`blocking` or `advisory`) and `summary`. The text is Markdown for
the reviewer and goes into the dispatch as is; it asks for the verdict set.
A selector that exits non-zero, prints JSON the engine cannot read, or a fill
that resolves to neither shape is a setup observation, quoted as such, and the
review goes on without rules. It never blocks a review.

**The verdict set** the reviewer returns, one fenced block tagged with the
`fence` value: `{ "verdicts": [{ "rule", "verdict": "pass" | "fail" |
"not-applicable", "evidence": [{ "file", "line", "side"?: "new" | "old" }],
"note" }] }`, other fields allowed.

**The verdicts command** prints `{ "problems": [...] }` and exits 0 when there
are none, 1 when there are some; any other exit is a failure, treated as one
problem.

## The steps

### review and self-review

1. **Select, before dispatch.** Resolve the fill; with a selector, run it
   (json, then text). The JSON goes to `selection.json` in the review scratch
   dir (made here, and reused by every later step that writes there), the text
   goes into the dispatch payload, and the reviewer's shape asks it to end its
   reply with the verdict set in the `fence` block.
2. **Check verdicts, after the reviewer returns.** Extract the fenced block to
   `verdict-set.json` (a missing or unparseable block is one problem) and run
   the verdicts command. Problems go to one verdict-only repair: a fresh
   reviewer gets the selection text, the first verdict set and findings, and
   the problems, and returns a corrected verdict set only. The first review's
   findings stay; only the verdict set is replaced. The repair is charged to
   the budget `verdict-rounds:<depth>`. Problems left after it are listed in
   the draft's notes, the run goes on, and rules with no valid verdict are
   reported as unanswered.
3. **Fails become findings.** Each `fail` becomes a finding titled with the
   rule id and its summary, anchored at its first `new`-side evidence (an
   `old`-side location goes in the body): a `blocking` rule's fail is
   Important, an `advisory` rule's is Minor. Critical stays the reviewer's own
   judgment. A fail the reviewer also reported as a finding at the same
   location is merged into one. In review this runs after "Assemble the review
   draft" and before "Verify each blocking finding", so the verify and demote
   steps apply unchanged; in self-review it runs before "Assemble the
   self-review draft".
4. **Save the verdict set** as `review-verdicts.json` in the review scratch
   dir always, and next to the report json when a report path was handed in.

### receive-review

Only step 1, before the adjudicator is dispatched, with the diff of the
branch against its target; the selection text goes to the adjudicator as
reference for judging threads, with no verdict request.

## Decisions

- The `fence` line is part of the contract so the engine never hard-codes a
  tool's block name.
- `verdict-rounds:<depth>` uses limit 2 with the engines' existing
  charge-then-check pattern (charge on the problem event, repair while not
  spent), which yields exactly one repair, as `verify-rounds:<depth>` limit 2
  yields one re-dispatch.
- The selector reads only the diff; it needs no checkout, so it runs on every
  path into the reviewer dispatch, including the paths where provisioning the
  head checkout failed.
- No new MCP tool or app capability: the engine floor (`minEngine`) stays.

## Non-goals

- Fan-out to one reviewer per rule.
- Changing what the generic review judges; rule verdicts come in addition.
- Shipping any selector. A pack's fill supplies the command.
