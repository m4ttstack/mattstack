---
node: revise_from_board
---

# Revise one finding from the board

The revision is the human's decision: apply it as given. No reviewer
dispatch, no verify pass, no depth block, and no re-judging of this
finding or any other; `summary` (readiness, reasoning, `comments`),
`threads`, `skipped`, `strengths`, `depth`, `checks` and `notes` stay as
written.

- **Dropped** (`revised` is `null`): remove the finding from the json's
  `findings` and its entry from the report markdown's Issues.
- **Revised:** replace the json entry with `revised` as given, at the same
  position and keeping its `id`, and rewrite the markdown entry to match
  it, in the bucket its `tier` names, with `file:line`, what is wrong, why
  it matters and the fix.
- **New anchor:** when `revised` carries `file` and `line` and that
  `file:line` differs from `original`'s, check it against the MR's diff:
  the diff this review read (`git diff origin/<targetBranch>...origin/mr-<iid>`,
  or `gh pr diff <ref>` on GitHub; read the branches and iid again with
  `mr_view`, and fetch again, when they are not in hand). The line must
  sit on the new side of one of its hunks. When it does not, drop `line`
  and keep `file`, so the finding posts in the summary: a finding anchors
  inline only with both `file` and `line` (the board's `hasDiffLine`).
  Say so in the hand-back.
- **Rebuild:** recount the severity line from the revised findings, then
  build the open as the first open was built: `review-source.sh` on the
  report json and the `<dir>/review-post.extras.json` already written,
  then `gate_open` with `handBack`, which fits it (`gate-ctx.sh fit`'s
  shape, the `review@1` counts recomputed from the json). The graph's
  edge into `review-source.sh` keeps every refusal edge of the first open.
- **Hand back** as at the first open (`Hand back the severity line and
  the open's paths`): the new open file's path, `gate-ctx.sh`, any
  `droppedContexts`, the same head sha, and the moved anchor when there
  was one. Then wait again.

This is the one rewrite of a json a gate was built from: the revision
closed that gate, and the rebuilt open is a new gate.
