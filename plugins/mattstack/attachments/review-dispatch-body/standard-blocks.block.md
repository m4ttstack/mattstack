---
order: 3
---

# Standard blocks

Append to every dispatched prompt, in this order, after its filled template:

1. Setup observations: `## Already checked before dispatch (fold in; do not
   redo)`, followed by the caller's observations, or `none`.
2. The diff file, only when the caller hands one: `## The diff to review`,
   the file's absolute path, and this sentence: "Review this file: it holds
   every change, including ones past HEAD that the commit range above does
   not cover. Where the two differ, the file wins." With no diff file this
   block is left out.
3. The caller's addendum block, verbatim when provided, except that each
   `@key` in it goes as the absolute path `skills_resolve` returned for it.
4. The rule selection, only when the caller hands one: `## Rules this
   change triggers`, the selection text verbatim, then, when the caller
   asks for one, the verdict request. The request says: end the reply with
   the verdict set in one fenced block tagged with the `fence` value, in
   the shape `{"verdicts": [{"rule", "verdict": "pass" | "fail" |
   "not-applicable", "evidence": [{"file", "line", "side"?: "new" |
   "old"}], "note"}]}`, with one verdict for every rule id in the
   selection (the `id` of each entry in `selection.json`'s `rules[]`).
   With no selection text this block is left out.
5. No fabrication: do not invent requirements, files, or findings; if the
   diff, the requirements, or a referenced file cannot be read, say so for
   that item and stop rather than guessing.

Observations travel exactly once: block 1 carries them unless the caller's
addendum claims them through a `{SETUP_OBSERVATIONS}` placeholder, in which
case fill that placeholder and skip block 1. A `{SETUP_OBSERVATIONS}`
placeholder with nothing to carry is filled `none`.
