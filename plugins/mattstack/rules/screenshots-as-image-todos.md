# Screenshots go to Human Todos, never `open`

An image read with the Read tool is in your context only; the user does not
see it.

To show the user a screenshot or other image, add one Human Todos item with
`mcp__human-todos__add`:

- `kind: "image"`
- a short title, for example "Look at the board header screenshots"
- `paths`: one absolute path per image

The pane lists the files, and its Open button shows them in the user's image
app. In your reply, say what to look at and that the to-do is in the pane.

- Never run `open` on an image, and never wrap `open` in a `run` to-do
  (the older human-todos fallback below is the one exception).
- One to-do per question, with every image for it in that item (both colour
  schemes together).
- A screenshot taken only to check your own work gets no to-do.
- pen.dev mocks get neither a screenshot nor a to-do: the user sees them
  live in pen.dev, so name the frames to look at.
- If the add tool's kind list has no `image` (an older human-todos), use
  `kind: "run"` with `script: "open '<path>' ..."` instead.
