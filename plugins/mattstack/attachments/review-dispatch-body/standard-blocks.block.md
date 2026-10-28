---
order: 3
---

# Standard blocks

Append to every dispatched prompt, in this order, after its filled template:

1. Setup observations: `## Already checked before dispatch (fold in; do not
   redo)`, followed by the caller's observations, or `none`.
2. The caller's addendum block, verbatim when provided, except that each
   `@key` in it goes as the absolute path `skills_resolve` returned for it.
3. The rule selection, only when the caller hands one: `## Rules this
   change triggers`, the selection text verbatim, then, when the caller
   asks for one, the verdict request: end the reply with the verdict set
   in one fenced block tagged with the `fence` value. With no selection
   text this block is left out.
4. No fabrication: do not invent requirements, files, or findings; if the
   diff, the requirements, or a referenced file cannot be read, say so for
   that item and stop rather than guessing.

Observations travel exactly once: block 1 carries them unless the caller's
addendum claims them through a `{SETUP_OBSERVATIONS}` placeholder, in which
case fill that placeholder and skip block 1. A `{SETUP_OBSERVATIONS}`
placeholder with nothing to carry is filled `none`.
