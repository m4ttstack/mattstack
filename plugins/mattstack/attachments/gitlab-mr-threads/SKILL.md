---
name: gitlab-mr-threads
description: >-
  Use when leaving comments on a GitLab MR via glab -- a
  positioned inline comment on a diff line, a reply to an existing discussion
  thread, or when a positioned comment silently landed as a general note
  instead of a DiffNote.
---

# MR diff comments and thread replies (glab)

## Positioned inline comments

Bracketed form fields (`position[new_path]`) do NOT nest -- GitLab silently
drops them and the comment lands as a general note. Post a JSON body instead:

    glab api --method POST --input - -H "Content-Type: application/json" \
      projects/:fullpath/merge_requests/<iid>/discussions

with body:

    {"body": "...", "position": {"position_type": "text",
     "base_sha": ..., "start_sha": ..., "head_sha": ...,
     "new_path": "...", "new_line": ...}}

The shas come from the MR's `diff_refs` (`glab mr view <iid> -F json`).

**Verify every response:** the returned note `type` must be `DiffNote`.
`null` means it landed as a general comment -- delete and re-post.

## Thread replies

POST `projects/:fullpath/merge_requests/<iid>/discussions/<discussion_id>/notes`
using the FULL 40-char discussion id from the API, never a truncated one.
A reply is never a top-level note (`glab mr note`).

## Quick reference

| Goal | Route |
|------|-------|
| Inline comment on a diff line | POST `discussions` with JSON `position` from `diff_refs` |
| Reply to a thread | POST `discussions/<full-40-char-id>/notes` |
| Response note `type` is null | Landed as general note -- delete, re-post with JSON position |
