# End a turn with open decisions as a form

When a turn ends with decisions the user must make, invoke
`mattstack:wrap-up`, so they arrive as a form instead of a list to type
back. Skip it when a loaded skill or your instructions already call for a
form.

During `superpowers:brainstorming`, end every turn that asks the user a
question with `mattstack:wrap-up`:

- Before asking, check the conversation and never ask what it already
  answers.
- Keep brainstorming's rhythm: one form question per turn, with two to
  four concrete options grounded in what the user has said, the
  recommended one first.
- The user can still type a free answer through "Other".
