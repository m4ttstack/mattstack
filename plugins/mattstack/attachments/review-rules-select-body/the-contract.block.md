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

**The selection** is the JSON the selector prints. This skill reads only
its `rules` list: each rule has an `id`, a `severity` (`blocking` or
`advisory`) and a `summary`.

**The verdict set** is one fenced block tagged with the `fence` value:

```json
{"verdicts": [{"rule": "<id>", "verdict": "pass", "evidence": [{"file": "a.ts", "line": 12, "side": "new"}], "note": "<why>"}]}
```

`verdict` is `pass`, `fail` or `not-applicable`; `side` is optional and is
`new` or `old`; other fields are allowed.

**The verdicts command** prints `{"problems": [...]}`. It exits 0 when
there are none and 1 when there are some; any other exit is a failure,
counted as one problem.
