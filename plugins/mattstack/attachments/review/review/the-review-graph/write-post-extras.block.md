---
node: write_post_extras
---

# Write review-post.extras.json

Use the review scratch dir `select_rules` made, when it made one; otherwise
make one new directory in this session's scratchpad (the Claude Code temp
root, where `gate_open` reads and writes), never `mktemp -d`, and write its
path out literally from then on. Write `<dir>/review-post.extras.json`:

```json
{"target": "!87", "reviewer": "<the reviewer the caller names>", "round": 2,
 "editable": true,
 "questions": [
   {"id": "outcome", "label": "Verdict on !87: <readiness clause>", "multi": false,
    "options": [{"value": "comment", "label": "comment (recommended)", "description": "<what picking it does for this review>"},
                {"value": "approve", "label": "approve", "description": "<what picking it does for this review>"}]},
   {"id": "next", "label": "Next", "multi": false,
    "options": [{"value": "proceed", "label": "proceed (recommended)"}, "iterate", "hold"]}
 ]}
```

| Field | Filled from |
|---|---|
| `target` | `!<iid>` or `#<number>`, as the forge writes it |
| `reviewer`, `round` | only when the caller supplies them (a re-review's caller supplies `round`); else omit the key |
| `editable` | `true` when the report json carries a `comment` on every finding and `summary.comments` with exactly one line per `outcome` option value (this verb's own drafts); else omit the key. It tells the board this poster posts the edited text, else the draft, word for word |
| `outcome` label | `Verdict on <target>: ` plus a clause composed from the json's `summary`, never a field verbatim: readiness `yes` reads "ready to merge"; `with-fixes` or `no` reads "not ready" or "ready once <the gist of the reasoning>" |
| `outcome` options | `comment` and `approve`, each described by what picking it does; `request_changes` only when this verb runs the gate on GitHub (rt's GitLab tools have none). The recommendation goes FIRST, its label ending ` (recommended)`: `approve` when readiness is `yes`, else `comment`. The question's id is always `outcome`, and its option values are exactly the keys of the json's `summary.comments` |
| `next` | only when this verb runs the gate; a caller that owns the gates navigates itself |

Direct, the object is `gate_open`'s inline `extras`, the report json (or
its copy) the `findingsPath`; on the hand-back path the file goes to
`review-source.sh`. Both build one open whose question ids key the
answers: `thread-<n>` (options `post:<discussionId>`,
`resolve:<discussionId>`), `findings-<n>` (finding ids), `skipped-<n>`
(`restore:<id>`), `outcome`, `next`. A pre-v2 report json opens as
prose, which is not an error. Never hand-edit it or shorten a body to fit.
