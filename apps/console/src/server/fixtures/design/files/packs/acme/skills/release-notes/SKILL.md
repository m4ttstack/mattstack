---
name: "release-notes"
description: "Drafts release notes from the work merged since the last tag."
metadata:
  compiled: "mattstack:release-notes@0.28.10"
---

<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->

<!-- part: step source=mattstack:release-notes version=0.28.10 lines=5-30 -->

# Release notes

Draft the notes for the next release from the work merged since the last tag.

## Gather

1. Find the last tag with `git describe --tags --abbrev=0`.
2. List the merge requests merged since that tag.
3. Group them by the label each one carries.

## Write

Lead with what a user will notice. Put a breaking change first and say what
to do about it.

## House style

## Hand-off

Post the draft as a comment on the release merge request.

Wait for an approval before you tag.

Never name a ticket the public cannot open.
