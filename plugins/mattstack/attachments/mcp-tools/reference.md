# mattstack MCP tools

Generated from `rt mcp tools --json`; do not edit by hand. Regenerate with:
`rt mcp tools --json | bun scripts/gen-mcp-tools.ts > attachments/mcp-tools/reference.md`

Every tool below is on the mattstack MCP server, which is allowed whole in every mattstack install. Before a skill tells an agent to run a shell command, check whether a tool here covers it.

Kept on Bash on purpose: `rt gate answer <id> --answers <json> --by shepherd`, `rt gate wait <id>`, `rt events wait`, `git commit`, `git add`, `git fetch`, `git merge-base`, `git rebase --continue` and `--skip`, and project tooling.

### gate_answer

<!-- mcp-lint: allow -->
Answer an open gate's questions as this pane. Answer values must be option VALUES verbatim; nuance goes in {value, note}, and replacement text for something the gate offered goes in {value, text}.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "answers": {
      "type": "object",
      "additionalProperties": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          {
            "type": "object",
            "properties": {
              "value": {
                "oneOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                ]
              },
              "note": {
                "type": "string"
              },
              "text": {
                "type": "string",
                "pattern": "\\S",
                "description": "Replacement for text the gate offered (an edited reply), used in its place. Comments go in note, never here."
              }
            },
            "required": [
              "value"
            ],
            "additionalProperties": false
          }
        ]
      }
    },
    "override": {
      "type": "boolean"
    }
  },
  "required": [
    "id",
    "answers"
  ],
  "additionalProperties": false
}
```

### gate_list

<!-- mcp-lint: allow -->
List gates in all statuses unless open is true, optionally filtered by subject prefix or kind and capped by limit. Pass the previous response's cursor to continue paging; an empty gates array means there is nothing more to page.

```json
{
  "type": "object",
  "properties": {
    "open": {
      "type": "boolean"
    },
    "subjectPrefix": {
      "type": "string"
    },
    "kind": {
      "type": "string"
    },
    "limit": {
      "type": "number"
    },
    "cursor": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

### gate_ask

<!-- mcp-lint: allow -->
Open a decision gate with the daemon-side ceremony: subject resolves from this session (explicit subject wins, else its running run, else its agent record's own subject), presentation is computed, and the operator is nudged. Always pass context, quoted from the material the reader decides on, and never trim or skip it for size: over the shared 8192-byte budget (top-level context plus every question's context), question contexts are dropped server-side first, then the top-level context if it is over on its own, and the drop is reported back as contextOmitted: true. A human-owned gate with no context is refused. The in-pane form caps every question at 4 options: keep navigation verbs (iterate, go back, hold) as their own next question and split a larger selection into <id>-1, <id>-2, ... questions whose answers read as one union; one over-cap question makes the whole gate present as wait, reported back as formCapExceeded with the remedy. Returns {id, presentation, subject, supersededId}; then act on the returned presentation. form: ask it in the pane with AskUserQuestion (the gate-fork hook allows it once this gate is open), then answer with the gate_answer tool ({id, answers}), which records the answer as this pane. wait: run `rt gate wait <id>` as background bash and end the turn; the wait itself is never a tool. Prefer {value, label} option objects; bare strings are accepted and stored normalized. Answers must be option VALUES verbatim.

```json
{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "multi": {
            "type": "boolean"
          },
          "options": {
            "type": "array",
            "items": {
              "oneOf": [
                {
                  "type": "string"
                },
                {
                  "type": "object",
                  "properties": {
                    "value": {
                      "type": "string"
                    },
                    "label": {
                      "type": "string"
                    },
                    "recommended": {
                      "type": "boolean",
                      "description": "Marks this option as the recommended choice; lifts into a '(Recommended)' label suffix."
                    },
                    "description": {
                      "type": "string",
                      "description": "One or two sentences on what choosing this option means; shown under the option's label on every surface, stored verbatim. At most 1024 bytes."
                    }
                  },
                  "required": [
                    "value",
                    "label"
                  ],
                  "additionalProperties": false
                }
              ]
            }
          },
          "context": {
            "type": "string",
            "description": "Material specific to this one question (what its choice turns on), shown with it; the top-level context stays the whole ask's. Shares the 8192-byte context budget with the top-level context."
          }
        },
        "required": [
          "id",
          "label",
          "multi",
          "options"
        ],
        "additionalProperties": false
      }
    },
    "context": {
      "type": "string"
    },
    "kind": {
      "type": "string"
    },
    "subject": {
      "type": "string"
    }
  },
  "required": [
    "questions"
  ],
  "additionalProperties": false
}
```

### chat_post

<!-- mcp-lint: allow -->
Post a message to an rt chat room as the signed-in identity. mentions are names or ids; a name reaches whoever holds it now. Requires a signed-in chat session; call chat_sign_in first.

```json
{
  "type": "object",
  "properties": {
    "room": {
      "type": "string"
    },
    "body": {
      "type": "string"
    },
    "mentions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "quiet": {
      "type": "boolean"
    }
  },
  "required": [
    "room",
    "body"
  ],
  "additionalProperties": false
}
```

### chat_dm

<!-- mcp-lint: allow -->
Send a direct message to another rt chat identity. to is a name or an id: a name reaches whoever holds it now, and the id from a delivery's reply hint reaches that exact sender even after the name has changed hands. Requires a signed-in chat session; call chat_sign_in first.

```json
{
  "type": "object",
  "properties": {
    "to": {
      "type": "string"
    },
    "body": {
      "type": "string"
    }
  },
  "required": [
    "to",
    "body"
  ],
  "additionalProperties": false
}
```

### chat_ack

<!-- mcp-lint: allow -->
Acknowledge a chat message by id as the signed-in handle. Requires a signed-in chat session; call chat_sign_in first.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "number"
    }
  },
  "required": [
    "id"
  ],
  "additionalProperties": false
}
```

### chat_claim

<!-- mcp-lint: allow -->
Claim a chat message by id so other agents skip answering it. Requires a signed-in chat session; call chat_sign_in first.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "number"
    }
  },
  "required": [
    "id"
  ],
  "additionalProperties": false
}
```

### chat_release

<!-- mcp-lint: allow -->
Release a previously claimed chat message by id. Requires a signed-in chat session; call chat_sign_in first.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "number"
    }
  },
  "required": [
    "id"
  ],
  "additionalProperties": false
}
```

### mr_reply_thread

<!-- mcp-lint: allow -->
GitLab only. Reply to an existing MR discussion thread. Returns discussionId, noteId (the posted reply) and the thread's resolved state. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "discussionId": {
      "type": "string"
    },
    "body": {
      "type": "string"
    }
  },
  "required": [
    "discussionId",
    "body"
  ],
  "additionalProperties": false
}
```

### mr_update_note

<!-- mcp-lint: allow -->
GitLab only. Replace the body of an existing MR note or thread comment by its noteId (from mr_threads, mr_comment, mr_comment_inline or mr_reply_thread). GitLab only lets you edit notes you are allowed to edit, and its refusal comes back as its own text. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "noteId": {
      "type": "number"
    },
    "body": {
      "type": "string"
    }
  },
  "required": [
    "noteId",
    "body"
  ],
  "additionalProperties": false
}
```

### mr_comment_inline

<!-- mcp-lint: allow -->
GitLab only. Post a NEW positioned inline comment (DiffNote) on an MR diff line, with server-side verification: the daemon re-checks the created note's type and deletes-and-retries once when GitLab silently drops the position. The retry re-fetches diff_refs; it cannot repair a position GitLab rejects outright. line is the line number in the new version of the file; the daemon fills oldLine for an unchanged line and refuses a line outside the diff, so pass oldLine yourself only to comment on a removed line. Use mr_reply_thread to reply to an existing thread. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "body": {
      "type": "string"
    },
    "path": {
      "type": "string"
    },
    "line": {
      "type": "number"
    },
    "oldPath": {
      "type": "string"
    },
    "oldLine": {
      "type": "number"
    }
  },
  "required": [
    "body",
    "path",
    "line"
  ],
  "additionalProperties": false
}
```

### mr_comment

<!-- mcp-lint: allow -->
GitLab only. Post a NEW top-level note on an MR: a review's summary, or anything with no diff line to anchor to. resolvable (default true) opens a discussion a human can resolve; false posts a plain note, for a summary that carries nothing to resolve. Posts once and never retries. Returns noteId, discussionId (null for a plain note), resolvable as GitLab reports it, url (the note) and mrUrl. Use mr_comment_inline for a diff line and mr_reply_thread for an existing thread. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "body": {
      "type": "string"
    },
    "resolvable": {
      "type": "boolean"
    }
  },
  "required": [
    "body"
  ],
  "additionalProperties": false
}
```

### mr_review_submit

<!-- mcp-lint: allow -->
GitLab only. Post one whole review in one call, exactly as GitLab's "Submit your review" does: every entry in comments becomes an inline thread, every entry in replies lands in its existing thread (resolve: true resolves it; a reply with no body only resolves), summary posts as the review's summary note, and the caller is marked as having reviewed. outcome "approve" also approves. Nothing reaches the MR unless all of it can: published: false with reason "bad-anchors" lists the comments whose line is outside the diff (move those findings into summary and call again), and reason "pending-drafts" means the caller already has pending comments on the MR that a submit would publish (they submit or discard them in GitLab first). A review carries at most 100 comments and replies in total. published: true with approved: false means the review is up and only the approval was refused: never call this again for that review, use mr_approve. Returns counts, repliedTo, resolved, resolveErrors (the threads a resolve-only reply could not resolve), approved, approveError (when the approval was refused), reviewerState, summaryNoteId and mrUrl. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "outcome": {
      "type": "string",
      "enum": [
        "comment",
        "approve"
      ]
    },
    "summary": {
      "type": "string"
    },
    "comments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "body": {
            "type": "string"
          },
          "path": {
            "type": "string"
          },
          "line": {
            "type": "number"
          },
          "oldPath": {
            "type": "string"
          },
          "oldLine": {
            "type": "number"
          }
        },
        "required": [
          "body",
          "path",
          "line"
        ],
        "additionalProperties": false
      }
    },
    "replies": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "discussionId": {
            "type": "string"
          },
          "body": {
            "type": "string"
          },
          "resolve": {
            "type": "boolean"
          }
        },
        "required": [
          "discussionId",
          "resolve"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "outcome",
    "summary"
  ],
  "additionalProperties": false
}
```

### mr_create

<!-- mcp-lint: allow -->
GitLab only. Create a merge request from an already-pushed sourceBranch into targetBranch. Pass targetBranch explicitly (read the default branch from git); it is never guessed. draft defaults to true. Write the title, and optionally the description, yourself (e.g. from the branch's commits). labels apply at creation; squash sets the MR's squash-on-merge flag right after it. Creates once and never retries. Returns iid, url (null when GitLab created the MR but reading it back failed) and, when squash was passed, squashApplied; squashApplied false with squashError means the MR exists, so set squash with mr_update rather than creating again. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "mrUrl": {
      "type": "string",
      "description": "An MR URL in the target project; names the repo, its iid is not used."
    },
    "sourceBranch": {
      "type": "string"
    },
    "targetBranch": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "draft": {
      "type": "boolean"
    },
    "labels": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "squash": {
      "type": "boolean"
    }
  },
  "required": [
    "sourceBranch",
    "targetBranch",
    "title"
  ],
  "additionalProperties": false
}
```

### mr_update

<!-- mcp-lint: allow -->
GitLab only. Edit an open MR: title, description, addLabels, removeLabels (add and remove, never the whole set, so labels CI or teammates set survive) and squash (the MR's squash-on-merge flag). Pass at least one. A title change keeps the MR's draft state. Title and description are written first, then labels and squash in one call; a partial failure names what landed, and every field is idempotent, so retry with only the failed fields. Returns iid, url and applied (the fields that landed). Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "title": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "addLabels": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "removeLabels": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "squash": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

### mr_upload

<!-- mcp-lint: allow -->
GitLab only. Upload one local image or video (png, jpg, jpeg, gif, webp, mp4, mov, webm; at most 50 MB) to the target project and get back url and markdown; paste the markdown into an MR description or note (mr_create, mr_update, mr_comment). Works before an MR exists. path must be absolute and under an allowed root: a worktree of the target repo, this user's Claude Code temp root (the session scratchpad lives there), rt's evidence folder ~/.mattstack/evidence/ (for screenshots you want to upload), a pipeline run's own evidence folder (~/.mattstack/work/<run id>/evidence/, for a run that exists on this machine), or a directory in the rt.mcp.uploadRoots setting; anything else, a directory, a file with other hard links, or a file whose bytes do not match its extension is refused. Uploads once; a timed-out upload may have landed, but an unused upload is harmless, so retrying is safe. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "mrUrl": {
      "type": "string",
      "description": "An MR URL in the target project; names the repo, its iid is not used."
    },
    "path": {
      "type": "string",
      "description": "Absolute path of the file to upload."
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false
}
```

### mr_approve

<!-- mcp-lint: allow -->
GitLab only. Approve an MR as the token's user, or withdraw that approval with approved: false. Call it only once approving is decided (a review's Approve disposition, after its findings have posted). Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "approved": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

### mr_resolve_thread

<!-- mcp-lint: allow -->
GitLab only. Resolve an MR discussion thread, or reopen it with resolved: false. Post any reply first with mr_reply_thread; resolving does not post. Returns {discussionId, resolved}. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "discussionId": {
      "type": "string"
    },
    "resolved": {
      "type": "boolean"
    }
  },
  "required": [
    "discussionId"
  ],
  "additionalProperties": false
}
```

### mr_ready

<!-- mcp-lint: allow -->
GitLab only. Mark a draft MR ready for review, or back to draft with ready: false. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "ready": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

### mr_retry

<!-- mcp-lint: allow -->
GitLab only. Retry one CI job (jobId) or a whole pipeline (pipelineId) on an MR; pass exactly one. The MR named by the target is the one whose state is refreshed afterward. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "jobId": {
      "type": "number"
    },
    "pipelineId": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

### mr_rebase

<!-- mcp-lint: allow -->
GitLab only. Ask GitLab to rebase the MR's source branch onto its target server-side (no checkout). GitLab accepts the request and rebases asynchronously, so re-read the MR before assuming the rebase finished or succeeded. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    }
  },
  "additionalProperties": false
}
```

### mr_merge

<!-- mcp-lint: allow -->
GitLab only. Merge the MR now (GitLab still enforces approvals and pipeline rules), optionally squashing and deleting the source branch; whenPipelineSucceeds: true instead enables auto-merge, which GitLab may fire at once when the pipeline has already passed. Auto-merge applies the project's own merge settings, so whenPipelineSucceeds cannot be combined with squash or removeSourceBranch. The MR is read back after the request, and the result is what was observed: merged: true when it merged; autoMerge: true (whenPipelineSucceeds only) when auto-merge is enabled; an error carrying GitLab's mergeError when one is set; otherwise {requested, verified: false, state} (state when known), meaning GitLab accepted the request but the outcome was not observed, so re-read with mr_view before assuming either way. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "squash": {
      "type": "boolean"
    },
    "removeSourceBranch": {
      "type": "boolean"
    },
    "whenPipelineSucceeds": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

### mr_map

<!-- mcp-lint: allow -->
Open MRs for a repo joined to the local worktrees holding their branches. Lists ALL open MRs for the repo (not only yours). repo is the repo's registered name: either its serialized identity (e.g. remote:gitlab.com%2Facme%2Facme-dev) or its short repo-label alias.

```json
{
  "type": "object",
  "properties": {
    "repo": {
      "type": "string"
    }
  },
  "required": [
    "repo"
  ],
  "additionalProperties": false
}
```

### herd_gates

<!-- mcp-lint: allow -->
List a herd's open gates, defaulting to HERD_ID or the sole active herd when herd is omitted.

```json
{
  "type": "object",
  "properties": {
    "herd": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### herd_ask

<!-- mcp-lint: allow -->
Open a gate asking the herd operator one or more questions, using this worker pane's herd, job, and session identity. Each option's label is at most 60 characters: give options as {value, label, description}, with the full wording in value.

```json
{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "multi": {
            "type": "boolean"
          },
          "options": {
            "type": "array",
            "items": {
              "oneOf": [
                {
                  "type": "string"
                },
                {
                  "type": "object",
                  "properties": {
                    "value": {
                      "type": "string"
                    },
                    "label": {
                      "type": "string"
                    },
                    "recommended": {
                      "type": "boolean",
                      "description": "Marks this option as the recommended choice; lifts into a '(Recommended)' label suffix."
                    },
                    "description": {
                      "type": "string",
                      "description": "One or two sentences on what choosing this option means; shown under the option's label on every surface, stored verbatim. At most 1024 bytes."
                    }
                  },
                  "required": [
                    "value",
                    "label"
                  ],
                  "additionalProperties": false
                }
              ]
            }
          },
          "context": {
            "type": "string",
            "description": "Material specific to this one question (what its choice turns on), shown with it; the top-level context stays the whole ask's. Shares the 8192-byte context budget with the top-level context."
          }
        },
        "required": [
          "id",
          "label",
          "multi",
          "options"
        ],
        "additionalProperties": false
      }
    },
    "context": {
      "type": "string"
    }
  },
  "required": [
    "questions"
  ],
  "additionalProperties": false
}
```

### herd_answer

<!-- mcp-lint: allow -->
Read the answer to a gate previously opened with herd_ask.

```json
{
  "type": "object",
  "properties": {
    "gate": {
      "type": "string"
    }
  },
  "required": [
    "gate"
  ],
  "additionalProperties": false
}
```

### herd_report

<!-- mcp-lint: allow -->
Post a status report message to this worker's herd room, using HERD_ID and HERD_JOB from the environment.

```json
{
  "type": "object",
  "properties": {
    "body": {
      "type": "string"
    }
  },
  "required": [
    "body"
  ],
  "additionalProperties": false
}
```

### rt_verb

<!-- mcp-lint: allow -->
Run one agent-safe rt verb and return its --json result. Agent-safe verbs are the ones skills run in their normal flow, and not all are read-only: skills sync pulls, commits and pushes the pack checkout and runs claude plugin update; skills compile, surface set and apply, and bind write pack files; herd brief writes its --out file. Anything else is refused with the list of verbs that are agent-safe. Pass args without the leading "rt" (e.g. ["worktree", "list"]) and cwd when the verb depends on the current repo, since this server's working directory is fixed at session start and does not follow cd or EnterWorktree.

```json
{
  "type": "object",
  "properties": {
    "args": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1
    },
    "cwd": {
      "type": "string",
      "description": "Absolute directory to run in; defaults to the server's own."
    }
  },
  "required": [
    "args"
  ],
  "additionalProperties": false
}
```

### run_start

<!-- mcp-lint: allow -->
Start a pipeline run and get back its runDb. flags is the compiled run-start flag string verbatim (the {{run-start.flags}} text: --repo, --work-type, --pipeline and friends); skillDir is the loaded skill's own directory (its pack root is derived from it). Pass the returned runDb to every other run_* tool.

```json
{
  "type": "object",
  "properties": {
    "flags": {
      "type": "string"
    },
    "skillDir": {
      "type": "string",
      "description": "Absolute path of the loaded skill's directory (CLAUDE_SKILL_DIR)."
    },
    "ticket": {
      "type": "string"
    },
    "spawnedBy": {
      "type": "string"
    }
  },
  "required": [
    "flags",
    "skillDir"
  ],
  "additionalProperties": false
}
```

### run_stage

<!-- mcp-lint: allow -->
Record a stage transition on a run: start, done, fail (with reason and detailPath) or redirect (with to and reason).

```json
{
  "type": "object",
  "properties": {
    "runDb": {
      "type": "string",
      "description": "The runDb run_start returned. Always pass it; omitted, cwd is required and the run is this session's run, else the newest running one whose worktree holds cwd."
    },
    "cwd": {
      "type": "string",
      "description": "Absolute worktree path, used only when runDb is omitted."
    },
    "action": {
      "type": "string",
      "enum": [
        "start",
        "done",
        "fail",
        "redirect"
      ]
    },
    "stage": {
      "type": "string"
    },
    "reason": {
      "type": "string"
    },
    "detailPath": {
      "type": "string"
    },
    "to": {
      "type": "string"
    }
  },
  "required": [
    "action",
    "stage"
  ],
  "additionalProperties": false
}
```

### run_field_set

<!-- mcp-lint: allow -->
Write one run field (key, value) as produced by a stage.

```json
{
  "type": "object",
  "properties": {
    "runDb": {
      "type": "string",
      "description": "The runDb run_start returned. Always pass it; omitted, cwd is required and the run is this session's run, else the newest running one whose worktree holds cwd."
    },
    "cwd": {
      "type": "string",
      "description": "Absolute worktree path, used only when runDb is omitted."
    },
    "key": {
      "type": "string"
    },
    "value": {
      "type": "string"
    },
    "stage": {
      "type": "string"
    }
  },
  "required": [
    "key",
    "value",
    "stage"
  ],
  "additionalProperties": false
}
```

### run_field_get

<!-- mcp-lint: allow -->
Read one run field; errors when the key is not set.

```json
{
  "type": "object",
  "properties": {
    "runDb": {
      "type": "string",
      "description": "The runDb run_start returned. Always pass it; omitted, cwd is required and the run is this session's run, else the newest running one whose worktree holds cwd."
    },
    "cwd": {
      "type": "string",
      "description": "Absolute worktree path, used only when runDb is omitted."
    },
    "key": {
      "type": "string"
    }
  },
  "required": [
    "key"
  ],
  "additionalProperties": false
}
```

### run_decision

<!-- mcp-lint: allow -->
Record a decision on the run; selection is a JSON object and is serialized by the tool.

```json
{
  "type": "object",
  "properties": {
    "runDb": {
      "type": "string",
      "description": "The runDb run_start returned. Always pass it; omitted, cwd is required and the run is this session's run, else the newest running one whose worktree holds cwd."
    },
    "cwd": {
      "type": "string",
      "description": "Absolute worktree path, used only when runDb is omitted."
    },
    "contract": {
      "type": "string"
    },
    "scope": {
      "type": "string"
    },
    "selection": {
      "type": "object"
    },
    "decidedBy": {
      "type": "string"
    }
  },
  "required": [
    "contract",
    "scope",
    "selection",
    "decidedBy"
  ],
  "additionalProperties": false
}
```

### run_status

<!-- mcp-lint: allow -->
Set the run's terminal status: done, failed or abandoned.

```json
{
  "type": "object",
  "properties": {
    "runDb": {
      "type": "string",
      "description": "The runDb run_start returned. Always pass it; omitted, cwd is required and the run is this session's run, else the newest running one whose worktree holds cwd."
    },
    "cwd": {
      "type": "string",
      "description": "Absolute worktree path, used only when runDb is omitted."
    },
    "status": {
      "type": "string",
      "enum": [
        "done",
        "failed",
        "abandoned"
      ]
    }
  },
  "required": [
    "status"
  ],
  "additionalProperties": false
}
```

### run_snapshot

<!-- mcp-lint: allow -->
The run's stages, fields and decisions.

```json
{
  "type": "object",
  "properties": {
    "runDb": {
      "type": "string",
      "description": "The runDb run_start returned. Always pass it; omitted, cwd is required and the run is this session's run, else the newest running one whose worktree holds cwd."
    },
    "cwd": {
      "type": "string",
      "description": "Absolute worktree path, used only when runDb is omitted."
    }
  },
  "additionalProperties": false
}
```

### run_list

<!-- mcp-lint: allow -->
List runs the daemon knows, newest first, optionally narrowed to one repo directory name.

```json
{
  "type": "object",
  "properties": {
    "repo": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### mr_view

<!-- mcp-lint: allow -->
GitLab only. One MR by iid, in full: opened, merged or closed. Read from GitLab on every call: any MR the token can see, whoever wrote it. A GitLab refusal comes back as GitLab's own text. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "maxAgeMs": {
      "type": "number",
      "description": "Accepted and ignored; every read is live."
    }
  },
  "additionalProperties": false
}
```

### mr_list

<!-- mcp-lint: allow -->
GitLab only. A summary of each matching MR of the target project (iid, title, state, draft, sourceBranch, targetBranch, author username, webUrl, detailedMergeStatus), most recently updated first. Filters: author (a username, or "me"), sourceBranch, targetBranch, state (default opened, which includes drafts), search (title and description, so a ticket id finds its MR). Returns {mrs, truncated}: at most limit rows (default 50, maximum 200), truncated true when GitLab had more. With targetBranch the body also carries targetBranch and full (true when nothing was cut); use that to prove a branch has no stacked children. Use mr_view for one MR in full. Read from GitLab on every call: any MR the token can see, whoever wrote it. A GitLab refusal comes back as GitLab's own text. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "mrUrl": {
      "type": "string",
      "description": "An MR URL in the target project; names the repo, its iid is not used."
    },
    "author": {
      "type": "string",
      "description": "A GitLab username, or \"me\" for the signed-in user."
    },
    "sourceBranch": {
      "type": "string"
    },
    "targetBranch": {
      "type": "string"
    },
    "state": {
      "type": "string",
      "enum": [
        "opened",
        "merged",
        "closed",
        "all"
      ]
    },
    "search": {
      "type": "string",
      "description": "Text matched against title and description."
    },
    "limit": {
      "type": "number"
    },
    "maxAgeMs": {
      "type": "number",
      "description": "Accepted and ignored; every read is live."
    }
  },
  "additionalProperties": false
}
```

### mr_for_branch

<!-- mcp-lint: allow -->
GitLab only. The open MR (or null) for each named source branch, by any author. A null means GitLab has no open MR with that source branch. Read from GitLab on every call: any MR the token can see, whoever wrote it. A GitLab refusal comes back as GitLab's own text. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "mrUrl": {
      "type": "string",
      "description": "An MR URL in the target project; names the repo, its iid is not used."
    },
    "branches": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1
    }
  },
  "required": [
    "branches"
  ],
  "additionalProperties": false
}
```

### mr_threads

<!-- mcp-lint: allow -->
GitLab only. The MR's discussion threads, fetched from GitLab on every call. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "refresh": {
      "type": "boolean",
      "description": "Accepted and ignored; every read is live."
    }
  },
  "additionalProperties": false
}
```

### mr_pipeline

<!-- mcp-lint: allow -->
GitLab only. The MR's head pipeline, carrying sha, ref and mergeRequestEventType ("merged_result", "detached", "merge_train" or null; for merged-results pipelines sha is the merge commit, not the source branch head), and, with jobId, that job's detail: a bridge job's downstream pipeline, or for any other job {type: "trace", traceVia: "mr_job_trace"}, since its log is read with mr_job_trace. For pipelines on a branch with no MR, or an MR's earlier pipelines, use pipeline_list. jobId is the numeric part of a job id like gitlab:job:123. Take it from this MR's pipeline: the daemon does not check that the job belongs to this MR, so jobId may name any job in the MR's project. Read from GitLab on every call: any MR the token can see, whoever wrote it. A GitLab refusal comes back as GitLab's own text. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "maxAgeMs": {
      "type": "number",
      "description": "Accepted and ignored; every read is live."
    },
    "jobId": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

### mr_job_trace

<!-- mcp-lint: allow -->
GitLab only. Part of one CI job's plain-text trace, ANSI escapes stripped, capped at 64 KiB. One mode per call: tailLines (the last N lines; the default, N=200), headLines (the first N), fromLine with lineCount (a range, 1-based, lineCount default 200), or grep with contextLines (lines containing the text, case-insensitive plain text, each prefixed with its line number, groups separated by --; contextLines default 2). Returns trace, truncated (true when the trace holds more than was returned, and always true for grep results, which never claim to be the whole trace) and totalLines, so a range can be chosen from a tail. jobId is the numeric part of a job id like gitlab:job:123. Take it from this MR's pipeline: the daemon does not check that the job belongs to this MR, so jobId may name any job in the MR's project. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "jobId": {
      "type": "number"
    },
    "tailLines": {
      "type": "number"
    },
    "headLines": {
      "type": "number"
    },
    "fromLine": {
      "type": "number"
    },
    "lineCount": {
      "type": "number"
    },
    "grep": {
      "type": "string"
    },
    "contextLines": {
      "type": "number"
    }
  },
  "required": [
    "jobId"
  ],
  "additionalProperties": false
}
```

### project_labels

<!-- mcp-lint: allow -->
GitLab only. The project's labels (name, description, color); search narrows by name. Use it to check a label's exact spelling before applying it. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "mrUrl": {
      "type": "string",
      "description": "An MR URL in the target project; names the repo, its iid is not used."
    },
    "search": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### pipeline_list

<!-- mcp-lint: allow -->
GitLab only. Pipelines newest first, each with id, status, ref, sha, source, webUrl and createdAt: for a branch (ref), a commit (sha), or an MR (iid, which lists that MR's own pipelines; iid cannot be combined with ref or sha). Works for a branch with no MR. limit defaults to 20, maximum 100. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "mrUrl": {
      "type": "string",
      "description": "An MR URL in the target project; names the repo, its iid is not used."
    },
    "ref": {
      "type": "string"
    },
    "sha": {
      "type": "string"
    },
    "iid": {
      "type": "number"
    },
    "limit": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

### gitlab_get

<!-- mcp-lint: allow -->
GitLab only. One read-only GET against GitLab's REST API, for a fact no other tool returns (an MR's commits or changes, a job's artifacts listing, an issue, a merged MR search). path is relative to the API root and :id stands for the target project, e.g. projects/:id/merge_requests/12/commits; pass query values in query, never in path. Returns {status, body, truncated, nextPage, totalPages}: body is parsed JSON, cut to text at 256 KiB (truncated: true), so page with page and perPage (maximum 100). GitLab decides access and its refusal comes back as its own text. Paths that can return credentials (variables, triggers, deploy_tokens, access_tokens, runners, hooks, secure_files, integrations, services, pipeline_schedules, terraform, application) and the query keys sudo, private_token, access_token, job_token and bearer_token are refused, any token value in a returned body is redacted, and a redirect is never followed (a 3xx answer is refused, naming only the host it points to). Prefer the purpose-built tool when one covers the read. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "mrUrl": {
      "type": "string",
      "description": "An MR URL in the target project; names the repo, its iid is not used."
    },
    "path": {
      "type": "string",
      "description": "API path relative to the API root; :id is the target project."
    },
    "query": {
      "type": "object",
      "description": "Query parameters as string, number or boolean values."
    },
    "page": {
      "type": "number"
    },
    "perPage": {
      "type": "number"
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false
}
```

### branch_stack

<!-- mcp-lint: allow -->
Whether the tree's checked-out branch is a member of a tracked stack. Returns {branch, member, stackStore}; a member also carries stack (its name), parent, root and children. stackStore is "unavailable" when the stack store could not be read, in which case member: false is not proof. Reads no forge. tree is the absolute path of a registered checkout or worktree root.

```json
{
  "type": "object",
  "properties": {
    "tree": {
      "type": "string",
      "description": "Absolute path of a registered checkout or worktree root."
    }
  },
  "required": [
    "tree"
  ],
  "additionalProperties": false
}
```

### git_push

<!-- mcp-lint: allow -->
Push the tree's current branch as exactly one ref (HEAD to refs/heads/<branch>; no tags, no submodules) to the same-named branch on its upstream's remote, or to origin/<branch> with setUpstream: true, which also makes that the upstream. Force is only ever --force-with-lease --force-if-includes. Refuses a detached HEAD; main, master and origin's default branch, and any push when origin's default cannot be read; a branch with no upstream unless setUpstream: true; an upstream with a different branch name, or one that is its own remote's default branch, or whose remote's default branch cannot be read (setUpstream: true pushes as origin/<branch> instead).

```json
{
  "type": "object",
  "properties": {
    "tree": {
      "type": "string",
      "description": "Absolute path of a checkout or worktree of a repo registered with rt."
    },
    "forceWithLease": {
      "type": "boolean"
    },
    "setUpstream": {
      "type": "boolean"
    }
  },
  "required": [
    "tree"
  ],
  "additionalProperties": false
}
```

### git_pull

<!-- mcp-lint: allow -->
Fast-forward the tree's current branch from its upstream (--ff-only). A diverged branch is an error, never a merge or rebase.

```json
{
  "type": "object",
  "properties": {
    "tree": {
      "type": "string",
      "description": "Absolute path of a checkout or worktree of a repo registered with rt."
    }
  },
  "required": [
    "tree"
  ],
  "additionalProperties": false
}
```

### git_rebase

<!-- mcp-lint: allow -->
Rebase the tree's current branch onto a named branch or ref; a remote-tracking ref (origin/<branch>) is fetched first. On a conflict it returns status conflict with the conflicted files and leaves the tree mid-rebase for you to resolve (then finish with git rebase --continue in Bash), or pass abort: true to abort one in progress.

```json
{
  "type": "object",
  "properties": {
    "tree": {
      "type": "string",
      "description": "Absolute path of a checkout or worktree of a repo registered with rt."
    },
    "onto": {
      "type": "string"
    },
    "abort": {
      "type": "boolean"
    }
  },
  "required": [
    "tree"
  ],
  "additionalProperties": false
}
```

### branch_sync

<!-- mcp-lint: allow -->
Bring the tree's branch current in one call through rt sync: fetch origin; if the branch diverged from origin only because GitLab rebased it (every local commit has a patch-equivalent on origin), reset to origin; rebase onto the default branch; push with --force-with-lease when anything changed. A branch only ahead of origin is not refused, but like any branch it is pushed only when the reset or rebase actually changed it; a branch already at the default branch's tip is left alone, so use git_push to publish new commits. Refuses up front, naming the commits where there are any: a diverged branch whose local commits have no equivalent on origin (the reset would lose them); a branch only behind origin (run git_pull first); origin commits a kept local rewrite would force-push over; a rebase already in progress; a detached HEAD; main, master or the default branch; a branch name rt sync cannot pass safely or that is ambiguous with a tag or other ref; a local ref shadowing origin/<branch> or origin/<default>; a push destination redirected by git config; a gitq stack member, or a branch whose stack membership cannot be verified. A rebase conflict returns status conflict with rt sync's bundle and leaves the rebase paused.

```json
{
  "type": "object",
  "properties": {
    "tree": {
      "type": "string",
      "description": "Absolute path of a checkout or worktree of a repo registered with rt."
    }
  },
  "required": [
    "tree"
  ],
  "additionalProperties": false
}
```

### worktree_provision

<!-- mcp-lint: allow -->
Claim a worktree for a ticket or branch (from the on-deck pool, or freshly created) and get back its path; then enter it with EnterWorktree in path mode. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "ticket": {
      "type": "string"
    },
    "ticketTitle": {
      "type": "string"
    },
    "branch": {
      "type": "string"
    },
    "disposal": {
      "type": "string",
      "enum": [
        "merge",
        "job"
      ]
    },
    "owner": {
      "type": "string"
    }
  },
  "required": [
    "repoName"
  ],
  "additionalProperties": false
}
```

### worktree_dispose

<!-- mcp-lint: allow -->
Dispose a worktree by its tree name; it goes to the restorable trash. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "tree": {
      "type": "string",
      "description": "The tree name as worktree list prints it."
    }
  },
  "required": [
    "repoName",
    "tree"
  ],
  "additionalProperties": false
}
```

### worktree_stop_holders

<!-- mcp-lint: allow -->
End the processes rt ties to a worktree (dev servers, watchers), and only those. There is no general kill tool. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "tree": {
      "type": "string"
    }
  },
  "required": [
    "repoName",
    "tree"
  ],
  "additionalProperties": false
}
```

### herd_start

<!-- mcp-lint: allow -->
Start a herd (room, workspace, gate subscription) for this shepherd session. repo is the repo's identity, checkout path or label.

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "repo": {
      "type": "string"
    },
    "hidden": {
      "type": "boolean"
    }
  },
  "required": [
    "name",
    "repo"
  ],
  "additionalProperties": false
}
```

### herd_spawn

<!-- mcp-lint: allow -->
Spawn a worker pane for a job (provisions its worktree, launches claude with the brief). brief is an absolute path to a .md brief file (herd_brief's out) inside the Claude Code temp root or an installed plugin or pack root; its contents become the worker's prompt and must not start with "-"; omitted, the job's stored brief is reused. account, model and effort are plain tokens. Only the herd's shepherd session may call it. Takes minutes.

```json
{
  "type": "object",
  "properties": {
    "herd": {
      "type": "string",
      "description": "Herd id; defaults to HERD_ID, else the sole active herd."
    },
    "job": {
      "type": "string"
    },
    "brief": {
      "type": "string",
      "description": "Absolute path to the brief file; its contents are sent, not the path."
    },
    "model": {
      "type": "string"
    },
    "effort": {
      "type": "string"
    },
    "account": {
      "type": "string"
    },
    "disposable": {
      "type": "boolean"
    }
  },
  "required": [
    "job"
  ],
  "additionalProperties": false
}
```

### herd_brief

<!-- mcp-lint: allow -->
Assemble a job brief from the shepherd skill's job template plus a strategy body or method file; fill repeats per template slot as "slot=value". Writes to out when given, else returns the brief. out must be an absolute path inside the Claude Code temp root; template, strategies and methodFile must be absolute paths inside the Claude Code temp root or an installed plugin or pack root.

```json
{
  "type": "object",
  "properties": {
    "job": {
      "type": "string"
    },
    "template": {
      "type": "string"
    },
    "strategy": {
      "type": "string"
    },
    "strategies": {
      "type": "string"
    },
    "methodFile": {
      "type": "string"
    },
    "fill": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "out": {
      "type": "string"
    }
  },
  "required": [
    "job",
    "template"
  ],
  "additionalProperties": false
}
```

### herd_close

<!-- mcp-lint: allow -->
Close one job's pane. Only the herd's shepherd session may call it.

```json
{
  "type": "object",
  "properties": {
    "herd": {
      "type": "string",
      "description": "Herd id; defaults to HERD_ID, else the sole active herd."
    },
    "job": {
      "type": "string"
    }
  },
  "required": [
    "job"
  ],
  "additionalProperties": false
}
```

### herd_follow_up

<!-- mcp-lint: allow -->
Reopen a done job for a follow-up round in its same pane: it goes back to active, which stops the watchdog's done-not-closed nag until the job's next report. Only the herd's shepherd session may call it.

```json
{
  "type": "object",
  "properties": {
    "herd": {
      "type": "string",
      "description": "Herd id; defaults to HERD_ID, else the sole active herd."
    },
    "job": {
      "type": "string"
    }
  },
  "required": [
    "job"
  ],
  "additionalProperties": false
}
```

### herd_status

<!-- mcp-lint: allow -->
One herd: jobs, panes, gates, subscription, unread.

```json
{
  "type": "object",
  "properties": {
    "herd": {
      "type": "string",
      "description": "Herd id; defaults to HERD_ID, else the sole active herd."
    }
  },
  "additionalProperties": false
}
```

### herd_list

<!-- mcp-lint: allow -->
Active herds (all: true includes finished ones).

```json
{
  "type": "object",
  "properties": {
    "all": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

### herd_attend

<!-- mcp-lint: allow -->
Open a job's pane in a tab of this shepherd's workspace. Only the herd's shepherd session may call it.

```json
{
  "type": "object",
  "properties": {
    "herd": {
      "type": "string",
      "description": "Herd id; defaults to HERD_ID, else the sole active herd."
    },
    "job": {
      "type": "string"
    }
  },
  "required": [
    "job"
  ],
  "additionalProperties": false
}
```

### herd_wrap_up

<!-- mcp-lint: allow -->
Close panes, dispose the named worktrees, delete job dirs and archive the room in one pass, driven by the wrap-up form's answers. herd is required; only the herd's shepherd session may call it.

```json
{
  "type": "object",
  "properties": {
    "herd": {
      "type": "string",
      "description": "Herd id."
    },
    "closePanes": {
      "type": "boolean"
    },
    "dispose": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "deleteJobDirs": {
      "type": "boolean"
    },
    "archiveRoom": {
      "type": "boolean"
    }
  },
  "required": [
    "herd"
  ],
  "additionalProperties": false
}
```

### herd_resume

<!-- mcp-lint: allow -->
Re-attach this session to a herd: re-subscribes to its gates and returns the open ones plus status. Any session but a worker pane may take a herd over this way.

```json
{
  "type": "object",
  "properties": {
    "herd": {
      "type": "string"
    }
  },
  "required": [
    "herd"
  ],
  "additionalProperties": false
}
```

### herd_milestone

<!-- mcp-lint: allow -->
Worker side: announce an artifact (a spec, a plan, a PR) to the shepherd and open the milestone gate, using HERD_ID, HERD_JOB and this pane's session.

```json
{
  "type": "object",
  "properties": {
    "artifact": {
      "type": "string"
    },
    "summary": {
      "type": "string"
    }
  },
  "required": [
    "artifact"
  ],
  "additionalProperties": false
}
```

### chat_read

<!-- mcp-lint: allow -->
Read unread chat messages as this session's handle (every room, or one), advancing this handle's read cursor. since (30s, 5m, 500ms, bare seconds) peeks without advancing; last returns a room's newest N regardless of the cursor, then marks it read.

```json
{
  "type": "object",
  "properties": {
    "room": {
      "type": "string",
      "description": "Room name (lowercase letters, digits, . _ -)."
    },
    "limit": {
      "type": "number"
    },
    "since": {
      "type": "string"
    },
    "last": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

### chat_mark

<!-- mcp-lint: allow -->
Mark chat messages read for this session's handle: every open room, one room, or one room up to a message id (upto).

```json
{
  "type": "object",
  "properties": {
    "room": {
      "type": "string",
      "description": "Room name (lowercase letters, digits, . _ -)."
    },
    "upto": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

### chat_rooms

<!-- mcp-lint: allow -->
List the chat rooms this session's handle belongs to, with unread counts.

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### chat_who

<!-- mcp-lint: allow -->
List a chat room's members with their presence status.

```json
{
  "type": "object",
  "properties": {
    "room": {
      "type": "string",
      "description": "Room name (lowercase letters, digits, . _ -)."
    }
  },
  "required": [
    "room"
  ],
  "additionalProperties": false
}
```

### chat_buddies

<!-- mcp-lint: allow -->
List every chat handle on this machine with its presence status (live, idle, away, offline).

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### chat_join

<!-- mcp-lint: allow -->
Join a chat room as this session's handle. wakeOn (mention, all, none) sets when a message is delivered; cwd is the checkout this session works in (the server's own directory is fixed at session start).

```json
{
  "type": "object",
  "properties": {
    "room": {
      "type": "string",
      "description": "Room name (lowercase letters, digits, . _ -)."
    },
    "wakeOn": {
      "type": "string",
      "enum": [
        "mention",
        "all",
        "none"
      ]
    },
    "cwd": {
      "type": "string"
    }
  },
  "required": [
    "room"
  ],
  "additionalProperties": false
}
```

### chat_leave

<!-- mcp-lint: allow -->
Leave a chat room as this session's handle.

```json
{
  "type": "object",
  "properties": {
    "room": {
      "type": "string",
      "description": "Room name (lowercase letters, digits, . _ -)."
    }
  },
  "required": [
    "room"
  ],
  "additionalProperties": false
}
```

### chat_away

<!-- mcp-lint: allow -->
Set an away message on this session's chat presence without signing out; chat_back clears it.

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string"
    }
  },
  "required": [
    "text"
  ],
  "additionalProperties": false
}
```

### chat_back

<!-- mcp-lint: allow -->
Clear this session's chat away message.

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### chat_sign_in

<!-- mcp-lint: allow -->
Sign this session in to rt chat (presence, an identity, and the repo room derived from cwd unless room or noRoom says otherwise). cwd is the checkout this session works in; the server's own directory is fixed at session start. as picks the display name for a fresh identity and never continues an existing one: it may not be the human's handle, a name another session holds or held, or a name with room memberships. After a /clear this tool refuses; run `rt chat sign-in` in Bash instead.

```json
{
  "type": "object",
  "properties": {
    "cwd": {
      "type": "string"
    },
    "as": {
      "type": "string"
    },
    "room": {
      "type": "string"
    },
    "noRoom": {
      "type": "boolean"
    },
    "status": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### chat_sign_out

<!-- mcp-lint: allow -->
Sign this session out of rt chat: drop its presence and delete its session file. Room memberships are kept.

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### chat_archive

<!-- mcp-lint: allow -->
Archive a chat room this session's handle belongs to (hidden from every member's room list until someone posts into it), or reopen it with reopen: true.

```json
{
  "type": "object",
  "properties": {
    "room": {
      "type": "string",
      "description": "Room name (lowercase letters, digits, . _ -)."
    },
    "reopen": {
      "type": "boolean"
    }
  },
  "required": [
    "room"
  ],
  "additionalProperties": false
}
```

### chat_invite

<!-- mcp-lint: allow -->
Invite another herdr pane into a chat room: types /chat:join <room> (with an optional one-line note from this session's handle) into that pane. pane is a herdr pane id or ref; note is at most 300 characters; newlines become spaces and other control characters are refused.

```json
{
  "type": "object",
  "properties": {
    "pane": {
      "type": "string"
    },
    "room": {
      "type": "string",
      "description": "Room name (lowercase letters, digits, . _ -)."
    },
    "note": {
      "type": "string"
    }
  },
  "required": [
    "pane",
    "room"
  ],
  "additionalProperties": false
}
```

### whoami

<!-- mcp-lint: allow -->
Report this session's identity as the other tools see it: its Claude Code session id, herdr pane, the chat identity every chat_* tool acts as, as its name (what others see and type) and its handle (the id the tools send; null, with a sign-in hint, when this session has no chat session file), and the herd id, job and room when this is a herd worker. Reads only this server's environment and the session file, so it shows what the tools would act as, not live presence.

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### ci_lease_claim

<!-- mcp-lint: allow -->
Claim this MR's CI attendant lease for this session. Returns {claimed: true, lease, previousOwner?} or {claimed: false, holder}. Re-claiming a lease this session holds refreshes it. holder is the role (watch-ci default, or doctor); ttlSeconds 60 to 900, default 600. One CI attendant per MR: a fresh lease held by another owner refuses the claim (reported, not an error); a lease goes stale ttlSeconds after its last heartbeat and can then be taken over. The owner is always this session; there is no owner input.

```json
{
  "type": "object",
  "properties": {
    "mrUrl": {
      "type": "string",
      "description": "The MR or PR https URL (.../-/merge_requests/<iid> or .../pull/<n>)."
    },
    "holder": {
      "type": "string",
      "enum": [
        "watch-ci",
        "doctor"
      ]
    },
    "branch": {
      "type": "string",
      "description": "The MR's source branch; pass it so the board's stack preflight sees this attendant."
    },
    "ttlSeconds": {
      "type": "number"
    }
  },
  "required": [
    "mrUrl"
  ],
  "additionalProperties": false
}
```

### ci_lease_heartbeat

<!-- mcp-lint: allow -->
Refresh this session's CI attendant lease on the MR. Returns {ok: true, lease}, or {ok: false, reason: "lost", holder} when another owner holds it now, or {ok: false, reason: "none"}. ci_watch heartbeats on every poll, so call this only between watches (during a long fix). One CI attendant per MR: a fresh lease held by another owner refuses the claim (reported, not an error); a lease goes stale ttlSeconds after its last heartbeat and can then be taken over. The owner is always this session; there is no owner input.

```json
{
  "type": "object",
  "properties": {
    "mrUrl": {
      "type": "string",
      "description": "The MR or PR https URL (.../-/merge_requests/<iid> or .../pull/<n>)."
    }
  },
  "required": [
    "mrUrl"
  ],
  "additionalProperties": false
}
```

### ci_lease_release

<!-- mcp-lint: allow -->
Release this session's CI attendant lease on the MR. Returns {released: true}, or {released: false, reason} when the lease is absent or another owner's. One CI attendant per MR: a fresh lease held by another owner refuses the claim (reported, not an error); a lease goes stale ttlSeconds after its last heartbeat and can then be taken over. The owner is always this session; there is no owner input.

```json
{
  "type": "object",
  "properties": {
    "mrUrl": {
      "type": "string",
      "description": "The MR or PR https URL (.../-/merge_requests/<iid> or .../pull/<n>)."
    }
  },
  "required": [
    "mrUrl"
  ],
  "additionalProperties": false
}
```

### ci_lease_read

<!-- mcp-lint: allow -->
Read the MR's CI attendant lease: {lease: <fresh lease or null>, stale: <a stale lease on disk or null>, mine: <true when the fresh lease is this session's>}. A lease with no owner field was written by the pack script and reads as owner legacy:<holder>. A stale lease of this session's own is revived by calling ci_lease_heartbeat, which checks ownership only, not freshness. One CI attendant per MR: a fresh lease held by another owner refuses the claim (reported, not an error); a lease goes stale ttlSeconds after its last heartbeat and can then be taken over. The owner is always this session; there is no owner input.

```json
{
  "type": "object",
  "properties": {
    "mrUrl": {
      "type": "string",
      "description": "The MR or PR https URL (.../-/merge_requests/<iid> or .../pull/<n>)."
    }
  },
  "required": [
    "mrUrl"
  ],
  "additionalProperties": false
}
```

### ci_watch

<!-- mcp-lint: allow -->
GitLab only. Watch the MR's pipeline for the pushed commit sha until it settles or maxWaitSeconds (default 300, cap 1800) passes, polling every intervalSeconds (default 30, 10 to 120, and never more than half the lease's ttlSeconds). Only a pipeline for sha counts: a branch pipeline by its sha, a merged-results or merge-train pipeline by its merge commit's parents, or (fast-forward trains) by being new since the push; pass priorPipelineId (the head pipeline id read before pushing) so that proof never stalls; a result that proved it without one carries priorPipelineId to pass on the next call. Every poll heartbeats this session's CI lease and returns state lease_lost the moment another owner holds the MR; with underBoardLease (a doctor the board launched) it only reads the lease and needs a fresh board doctor lease. Returns state (success, success_with_warnings, failed, canceled, skipped, manual when settled; failed also as soon as a blocking job fails while the pipeline still runs; running or waiting means call again; superseded, lease_lost or aborted end the watch), the pipeline with sha and ref, failedJobs listing every failed job, with a trace tail on the first five blocking ones (jobs in same-project downstream pipelines included; read any other job's log with mr_job_trace), blockingFailures, lease, budget and next. budget is {minutes, elapsedMinutes, spent}, measured from the watched pipeline's createdAt against the ci.watch.budgetMinutes setting (default 75), or null while no pipeline for sha exists; a pipeline still running once spent is true returns running at once, so stop watching it. Chat messages reach you only between calls, so a long maxWaitSeconds delays them. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

```json
{
  "type": "object",
  "properties": {
    "repoName": {
      "type": "string",
      "description": "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo."
    },
    "iid": {
      "type": "number",
      "description": "The MR's iid; omit when mrUrl is given, which supplies it."
    },
    "mrUrl": {
      "type": "string",
      "description": "The MR's https URL; supplies both the repo and iid."
    },
    "sha": {
      "type": "string",
      "description": "The pushed commit, 7 to 40 hex characters."
    },
    "maxWaitSeconds": {
      "type": "number"
    },
    "intervalSeconds": {
      "type": "number"
    },
    "budgetMinutes": {
      "type": "number",
      "description": "Overrides the ci.watch.budgetMinutes setting for this call, 1 to 10080: pass the budget.minutes an extendMinutes call returned."
    },
    "extendMinutes": {
      "type": "number",
      "description": "1 to 1440: opens a fresh window this many minutes past the pipeline's current age (never shorter than the budget), fixed at the call's first match. Pass it after a granted extension until a result carries a non-null budget; later calls pass that budget.minutes as budgetMinutes."
    },
    "freshWindow": {
      "type": "boolean",
      "description": "true opens a fresh window of the ci.watch.budgetMinutes setting past the pipeline's current age, as extendMinutes does; pass it after a job retry (budgetMinutes is ignored), never with extendMinutes."
    },
    "priorPipelineId": {
      "type": "number",
      "description": "The MR's head pipeline id read before the push: the numeric part of a gitlab:pipeline:N id, as mr_pipeline returns it."
    },
    "underBoardLease": {
      "type": "boolean"
    }
  },
  "required": [
    "sha"
  ],
  "additionalProperties": false
}
```
