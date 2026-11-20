# Board: a prefix for code owner channel posts

## Intent

When an MR needs approval from other teams' code owners, the board posts the
same message to the team review channel and to every code owner channel.
Matt edits each code owner post afterwards to mark it as a code owner
review. A team-shared prefix in `board.slack` does that at post time.

## Goals

- A new `board.slack` field, `ownerPrefix`, set once per team.
- Prepended only to posts in code owner channels that are not the poster's
  own team; the team review channel post is unchanged.
- `{sections}` names the code owner sections the MR needs from that
  channel; the MR placeholders (`{title}`, `{ticket}`, `{url}` and the rest
  of `MrFacts`) work too.
- The post dialog shows each code owner channel's rendered prefix before
  posting.

## Non-goals

- Per-channel prefixes or per-channel message editing.
- Any change to the team review post, the copy button or bulk posts.

## Anti-goals

- An unset prefix changing today's posts in any way.

## Approaches

- **A. Added at post time, shown per channel (picked).** The message box
  stays one shared body; the server prepends each channel's rendered prefix
  when it posts; the dialog shows that prefix in muted text under the
  channel's checkbox. Edits to the body still get the prefix.
- B. One editable message per channel, pre-filled with prefix + body. Full
  control, but several boxes to edit, and a body edit no longer carries
  across channels.
- C. As A with no dialog change. Smallest, but the prefix is only visible
  after posting, which is the habit this replaces.

## Design

- **Setting** (`packages/rt-client/src/settings/`): `ownerPrefix:
  z.string().optional()` on `board.slack` with a title and description;
  the registry row's default gains `ownerPrefix: ""`; regenerate the
  schema lock. The console already edits `board.slack`.
- **Board config** (`apps/board/src/config.ts`): read `ownerPrefix` into
  the slack config the same way as the templates.
- **Rendering** (`apps/board/src/template.ts`): a helper that renders the
  prefix from the MR's facts plus `sections` (the channel's section labels,
  comma-joined, the same labels the dialog shows), and joins prefix and
  body with one space. An empty or whitespace-only rendered prefix leaves
  the body untouched.
- **Post** (`ownersPreviewOrPost` in `apps/board/src/server.ts`): each
  code owner channel post sends `prefix + " " + text`; the team request
  post sends `text` as today. The preview response gives each planned
  channel its rendered `prefix`.
- **Dialog** (`OwnersPostModal.tsx`): under each code owner channel row,
  the rendered prefix in muted text when it is non-empty.

## Builder's calls

- The field name `ownerPrefix`; the single-space join.
- Section label formatting reuses the dialog's `sectionLabel`.
- Tests: the render helper, the post route (prefix on owner channels only,
  none on the team post, none when unset), and a modal DOM test for the
  muted line. UI checked in Storybook or the fixture board, both schemes.
