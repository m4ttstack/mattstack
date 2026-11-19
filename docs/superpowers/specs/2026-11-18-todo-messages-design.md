# Messages on a Human Todos item

## Intent

Let the person answer the agent about a to-do without leaving the pane: "that
setting isn't there", "use the staging account", or "done, here's what I
found". Today the only replies are Done, Skip and Run outcomes.

## Goals

- A chat-bubble button on every open to-do opens a one-line input under it.
- The person types, then either keeps the to-do open or marks it done as they send.
- The agent that added the to-do gets the text, the same way it gets Done and Skip today.

## Non-goals

- No conversation thread in the pane; sent messages are not listed under the item.
- No messages on finished items.

## Approaches

- **A. Two send buttons (picked).** Enter or Send keeps the to-do open; Send & mark done also ticks it; Cancel closes the row. Both outcomes are visible and Enter does the common thing.
- B. One Send with a "mark done" checkbox: fewer buttons, but the toggle is easy to miss.
- C. "Reply" and "Done with a note" buttons on every item: one more button on each to-do all the time.

## Design

- **Button:** an icon-only button, the Nerd Font chat bubble (codicon `comment`, U+EA6B; the kit's `ICON.chat` is the two-bubble `comment_discussion` used for "Chat about this"), joins each open item's button row after Done and Skip. Its pointer tooltip/aria label is "Message the agent".
- **Row:** pressing it expands an input row under the item, using the kit's `inputField` (the gate's "Type something." field), placeholder `Message the agent`. Under it: `Send`, `Send & mark done`, `Cancel`. One item at a time has the row open.
- **Keys:** with the row open, typed keys go to the field; Enter sends and keeps the item open; Esc or Cancel closes the row and drops the draft; ↓ from the field reaches the three buttons. A blank message cannot be sent; both Send buttons are disabled until the text is non-blank.
- **What the agent gets** (`report.ts`, same channel as Done/Skip):
  - Send: `#3 "Sign in to gcloud": the user says: <text>` and the item stays open.
  - Send & mark done: `#3 "Sign in to gcloud": the user marked it done and says: <text>` and the item is done.
- **Store:** the draft lives in the pane client's state only; nothing new is stored on the to-do.
- **Contract:** the tool description and the system prompt line that says "you receive a message when they finish, skip, stop or run it" add "or send you a message about it".

## Left to the builder

- Exact keyboard grid placement of the input row and its buttons within the existing stops.
- Width handling of the three buttons at narrow widths (they wrap like other button rows).
- Plain (non-kit) drawer: show the same flow with engine elements if cheap, else leave Message out there.

## Scope

Its own PR after #1172 merges.
