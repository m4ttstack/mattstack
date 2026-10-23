---
node: gate_push
kind: gate
---

# Gate push

Scope `push`. The sentence is the line from **Report the move**; nothing
else before the form. The questions, each its own question (never fold one list
into another: a question over 4 options sends the whole gate to the wait
queue):

- `push`: **Push with force-with-lease now** / **Leave it unpushed**
  (recommended when the branch has an open MR others may have pulled)
- `next`: **Proceed** / **Iterate here** / **Hold**

Selection `{"push":true|false,"next":"proceed|iterate|hold","note":"<their words or null>"}`.
Read `next` first: **Hold** ends the turn with nothing pushed; **Iterate
here** goes back to **Report the move** and ignores `push`; only
**Proceed** applies `push`.
Any `git_push` error other than "not registered with rt" is reported with
its text; the rebase stands unpushed.

{{include:spawned-no-run-guard}}

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "Push with force-with-lease now is the natural next action, so I'll mark it Recommended" | Only **Leave it unpushed** carries a recommended label, and only conditionally (an open MR others may have pulled). Keep that qualifier on that option; never move it to the push option. |
| "Restating the finding and explaining each option makes the ask clearer" | A gate's form is one sentence of context, then the bare option labels the gate text names, nothing more -- no restated heading, no per-option description, no conditional aside on when Hold applies. |
