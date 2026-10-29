# Drawer reply for MR comments

## Intent

The board's threads drawer lists MR comments (the Overview-tab notes that
are not review threads) but offers no way to answer one. When the board says
"respond to <person>" because of such a comment, the author has to leave the
board for GitLab to clear it. The drawer should let the author reply to an
MR comment the same way it already replies to a review thread.

Found on !48423: Ed's approval note read as an unanswered comment and could
not be answered from the drawer. That miscount is fixed separately (a
reviewer's approval now answers their earlier comments, `95f85ad52`); this
change covers comments that really do want a reply.

## Goals

- Every MR comment from someone other than the author gets a reply action in
  the drawer, on a local board (the same condition the thread reply box
  uses today).
- The reply lands under that comment on GitLab, as GitLab's own Reply button
  does. It answers that one comment, not every earlier one.

## Non-goals

- No "no reply needed" or dismiss action. To clear a comment, post a reply.
  Nothing is hidden on the board while GitLab still shows it unanswered.
- No new top-level "comment on MR" composer.
- No resolve action on MR comments.

## Approaches

- **Reuse the thread reply path (picked).** `GeneralComment` carries the
  GitLab discussion id of the note's discussion; the comment view gets the
  thread reply button and `ReplyBox`; sending goes through the existing
  `/discussions/reply` endpoint and the daemon's `discussions:reply` verb,
  neither of which checks resolvability. No server, daemon or endpoint
  change.
- **A dedicated comment-reply endpoint.** Rejected: GitLab accepts a reply
  to an individual-note discussion through the same call, so a new route is
  more code for an identical request.

## Decided

- The reply lands under the comment (Matt).
- Reply only, no dismiss (Matt).
- Reuse the thread reply path (Matt).

## Left to the builder

- After a reply, GitLab may turn the comment into a resolvable thread, so it
  moves from "MR comments" into the threads list on the next summary. That
  is accepted, not worked around (my call).
- Whether the reply action shows on every non-author comment or only on
  comments still awaiting the author: default to every non-author comment,
  matching how threads show reply regardless of status (my call).
- Drafts, pending state, ⌘↵/Escape and error lines follow the thread reply
  box exactly; share the existing state in `CommentsDrawer` keyed by
  discussion id rather than adding a second set.
- A DOM test for the reply action on a comment, and a `discussions.ts` test
  that a general comment carries its discussion id.
