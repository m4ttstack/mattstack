---
node: build_post_open
---

# Build the respond-post open

This gate offers exactly the replies the developer has not yet seen word
for word: every `gate-1: override` row, and every `gate-1: fix` row whose
Fixed reply was finalized. A `gate-1: reply` row is never offered: it
posts its row's reply, unresolved, once the post side runs. With nothing
offered there is no respond-post gate and no record; a caller that owns
the gates gets no open file, only that nothing is offered and which
replies posted.

<HARD-GATE>
Decision intake: when a combined `{plan, post}` already carries `post`,
ask nothing, but still build and store the open with the hand-back
`gate_open`, then record the `post`: `respond_post_execute` refuses every
pass without `extra.gate-source.respond-post` on the run.

**Build the open** in Build the open's scratch directory (a pane that made
none makes a new one the same way, never `mktemp -d`), as
`<dir>/respond-post.source.json`:

```json
{"context": {"gate-ctx": "post@1", "reviewer": "<as in Build the open>", "replies": 2,
             "fixes": [{"sha": "<short sha>"}]},
 "questions": [
   {"id": "thread-1", "label": "<file>:<line>", "multi": true,
    "context": {"gate-ctx": "reply@1", "thread": "<threadId>", "file": "<file>:<line>", "verb": "fix", "sha": "<short sha>", "text": "<the exact finalized reply>"},
    "options": [{"value": "post:<threadId>", "label": "post", "recommended": true, "description": "post this reply to the thread"},
                {"value": "resolve:<threadId>", "label": "resolve", "recommended": true, "description": "resolve the thread"}]},
   {"id": "thread-2", "...": "the next offered thread, its own id verbatim: a fix in this shape, or an override with verb reply, no sha, resolve not recommended"},
   {"id": "next", "label": "Next", "multi": false,
    "options": [{"value": "proceed", "label": "proceed", "recommended": true}, "iterate", "hold"]}
 ]}
```

ONE multi-select question per offered thread, in verdict-table order,
plus `next`. Its id is `thread-<n>` by 1-based position among the offered
threads, its label the thread's `file:line`, its options exactly
`post:<threadId>` and `resolve:<threadId>`, thread id VERBATIM, bare verb
as the label.
An Overview comment (a `resolvable: false` row) is labelled `Overview
comment`, its `reply@1` `file` is exactly `Overview comment`, and it
offers `post:<threadId>` alone: GitLab cannot resolve it, and that `file`
is the only one a post-alone `reply@1` question is accepted with.

| Field | Filled from |
|---|---|
| `post` option | `"recommended": true` on every thread, so nothing drops silently |
| `resolve` option | `"recommended": true` only on a fixed thread; an override stays open for the reviewer unless the developer ticks it |
| `reply@1` context | that one thread: `verb` `fix` with its commit's short `sha` for a fixed thread (a fix with no commit carries no `sha`), `verb` `reply` with no `sha` for an override; `text` the exact reply from its row, never shortened |
| gate `replies` | the offered-thread count |
| gate `fixes` | one entry per commit the fix loop made, the key omitted when there are none |

Post and resolve are independent picks: both, post only, resolve without
replying, or neither (an explicit empty array). Nothing here is trimmable:
`gate_open` fits the open.
</HARD-GATE>
