---
order: 1
---

# The contract

The pack's fill is the text between the italic line at the top of Rule
selector and this section; an unbound slot leaves it empty. Read it on
every run, since it may consult settings or the environment: its answer is
never carried over from an earlier run. A fill resolves to one of two
shapes.

- The single line `selector: none`.
- Three lines:
  - `selector: <command line>`, holding the placeholder `{format}`.
  - `verdicts: <command line>`, holding the placeholders `{selection}` and
    `{verdicts}`.
  - `fence: <info string>`, the tag of the fenced code block the reviewer
    returns its verdict set in.

  An optional fourth line, `check: <command template>`, holds the
  placeholder `{base}`. The implement stage runs it in the worktree with
  nothing on stdin, `{base}` replaced by the branch point, and reads its
  stdout as the rules that apply and the lines worth a look; exit 0 means
  it ran, and any other exit is one observation that never blocks. The
  review verbs never run it: a fill with a `check:` line is still the
  three-line shape here. The line is additive, so the contract stays
  `rule-selector@1`, and a fill without it behaves as before.

**The selection** is the JSON the selector prints. This skill reads two
of its lists, and each entry of either has an `id`, a `severity`
(`blocking` or `advisory`) and a `summary`.

- `rules`: the rules the change triggered. Each one needs a verdict.
- `alsoInScope`: rules that cover a changed file but that nothing in the
  change triggered. A verdict for one is allowed and never required. A
  selection without this key lists none.

**The verdict set** is one fenced block tagged with the `fence` value:

```json
{"verdicts": [{"rule": "<id>", "verdict": "pass", "evidence": [{"file": "a.ts", "line": 12, "side": "new"}], "note": "<why>"}]}
```

`verdict` is `pass`, `fail` or `not-applicable`; `side` is optional and is
`new` or `old`; other fields are allowed.

**The verdicts command** prints `{"problems": [...]}`. It exits 0 when
there are none and 1 when there are some; any other exit is a failure,
counted as one problem.
