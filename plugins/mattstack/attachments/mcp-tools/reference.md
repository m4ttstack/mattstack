# mattstack MCP tools

Generated from `rt mcp tools --json`; do not edit by hand. Regenerate with:
`rt mcp tools --json | bun scripts/gen-mcp-tools.ts > attachments/mcp-tools/reference.md`

Every tool below is on the mattstack MCP server, which is allowed whole in every mattstack install. Before a skill tells an agent to run a shell command, check whether a tool here covers it.

Kept on Bash on purpose: `rt gate answer <id> --answers <json> --by shepherd`, `rt gate wait <id>`, `rt chat tail`, `rt events wait`, `git commit`, `git add`, `git fetch`, `git merge-base`, `git rebase --continue` and `--skip`, and project tooling.

### gate_answer

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

Open a decision gate with the daemon-side ceremony: subject resolves from this session (explicit subject wins, else its running run, else its agent record's own subject), presentation is computed, and the operator is nudged. Always pass context, quoted from the material the reader decides on, and never trim or skip it for size: over the shared 8192-byte budget (top-level context plus every question's context), question contexts are dropped server-side first, then the top-level context if it is over on its own, and the drop is reported back as contextOmitted: true. A human-owned gate with no context is refused. The in-pane form caps every question at 4 options: keep navigation verbs (iterate, go back, hold) as their own next question and split a larger selection into <id>-1, <id>-2, ... questions whose answers read as one union; one over-cap question makes the whole gate present as wait, reported back as formCapExceeded with the remedy. Returns {id, presentation, subject, supersededId}; then act on the returned presentation. form: ask it in the pane with AskUserQuestion (the gate-fork hook allows it once this gate is open), then answer with `rt gate answer <id> --answers <json> --by pane`. wait: run `rt gate wait <id>` as background bash and end the turn; the wait itself is never a tool. Prefer {value, label} option objects; bare strings are accepted and stored normalized. Answers must be option VALUES verbatim.

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

Post a message to an rt chat room as the signed-in handle. Requires a signed-in chat session; call chat_sign_in first.

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

Send a direct message to another rt chat handle. Requires a signed-in chat session; call chat_sign_in first.

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

### mr_comment_inline

GitLab only. Post a NEW positioned inline comment (DiffNote) on an MR diff line, with server-side verification: the daemon re-checks the created note's type and deletes-and-retries once when GitLab silently drops the position. The retry re-fetches diff_refs; it cannot repair a position GitLab rejects outright. Use mr_reply_thread to reply to an existing thread. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

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

### mr_create

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

GitLab only. Upload one local image or video (png, jpg, jpeg, gif, webp, mp4, mov, webm; at most 50 MB) to the target project and get back url and markdown; paste the markdown into an MR description or note (mr_create, mr_update, mr_comment). Works before an MR exists. path must be absolute and under an allowed root: a worktree of the target repo, this user's Claude Code temp root (the session scratchpad lives there), or a directory in the rt.mcp.uploadRoots setting; anything else, a directory, or a file whose bytes do not match its extension is refused. Uploads once; a timed-out upload may have landed, but an unused upload is harmless, so retrying is safe. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

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

Run one read-only rt verb and return its --json result. Only verbs marked agent-safe run; anything else is refused with the list of verbs that do. Pass args without the leading "rt" (e.g. ["worktree", "list"]) and cwd when the verb depends on the current repo, since this server's working directory is fixed at session start and does not follow cd or EnterWorktree.

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

GitLab only. One MR by iid from the daemon's open-MR cache; pass a small maxAgeMs (e.g. 5000) when the read must be live. The body carries scope and syncError when the daemon reports them. merged and closed results cover only recently closed MRs still held in the daemon's open-MR cache, not a project's full history. That cache may be limited to certain authors and a recent time window, so an MR outside it reads as not found. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

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
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

### mr_list

GitLab only. A summary of each MR of the target project (iid, title, state, draft, sourceBranch, targetBranch, author username, webUrl, pipelineStatus, detailedMergeStatus), filtered exactly on GitLab's state (default opened, which includes draft MRs; draft: true marks them). Use mr_view for one MR in full. The body carries syncedAt (0 when the cache has never synced for this repo; retry with a small maxAgeMs) and, when the daemon reports them, scope and syncError. merged and closed results cover only recently closed MRs still held in the daemon's open-MR cache, not a project's full history. That cache may be limited to certain authors and a recent time window, so an MR outside it reads as not found. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

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
    "state": {
      "type": "string",
      "enum": [
        "opened",
        "merged",
        "closed",
        "all"
      ]
    },
    "maxAgeMs": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

### mr_for_branch

GitLab only. The MR (or null) for each named source branch. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

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

GitLab only. The MR's discussion threads; refresh: true fetches from GitLab first. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

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
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

### mr_pipeline

GitLab only. The MR's head pipeline (live by default, maxAgeMs 5000) and, with jobId, that job's detail: a bridge job's downstream pipeline, or for any other job {type: "trace", traceVia: "mr_job_trace"}, since its log is read with mr_job_trace. pipeline.jobs may be empty for a cache entry written at list weight; pass jobId for one job's detail. jobId is the numeric part of a job id like gitlab:job:123. Take it from this MR's pipeline: the daemon does not check that the job belongs to this MR, so jobId may name any job in the MR's project. merged and closed results cover only recently closed MRs still held in the daemon's open-MR cache, not a project's full history. That cache may be limited to certain authors and a recent time window, so an MR outside it reads as not found. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

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
      "type": "number"
    },
    "jobId": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

### mr_job_trace

GitLab only. The tail of one CI job's plain-text trace: the last tailLines lines (default 200) with ANSI escape sequences stripped, then capped at 64 KiB from the end. Returns trace, truncated (true when either cap cut anything) and totalLines. jobId is the numeric part of a job id like gitlab:job:123. Take it from this MR's pipeline: the daemon does not check that the job belongs to this MR, so jobId may name any job in the MR's project. Name the target with repoName (the repo's serialized identity, e.g. remote:gitlab.com%2Facme%2Facme-dev, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo) or with mrUrl (the MR's https URL, which also supplies iid; its project must be registered with rt). Given both, they must agree.

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
    }
  },
  "required": [
    "jobId"
  ],
  "additionalProperties": false
}
```

### git_push

Push the tree's current branch to its same-named upstream, or as origin/<branch> with setUpstream: true (which replaces any existing upstream). Force is only ever --force-with-lease --force-if-includes. Refuses a detached HEAD, the repo's default branch, main and master, and an upstream that is the default branch or has a different branch name unless setUpstream is passed.

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

Bring the tree's branch current in one call, the rt sync flow: fetch; if the branch diverged from origin only because GitLab rebased it (every local commit has a patch-equivalent on origin), reset to origin; rebase onto the default branch; push with --force-with-lease. Refuses when a local commit has no equivalent on origin (unpushed work) or when origin has commits the push would drop (a branch only behind origin: run git_pull first), naming the commits. A rebase conflict returns status conflict with rt sync's bundle and leaves the rebase paused.

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

### herd_status

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

List the chat rooms this session's handle belongs to, with unread counts.

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### chat_who

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

List every chat handle on this machine with its presence status (live, idle, away, offline).

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### chat_join

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

Clear this session's chat away message.

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### chat_sign_in

Sign this session in to rt chat (presence, a handle, and the repo room derived from cwd unless room or noRoom says otherwise). cwd is the checkout this session works in; the server's own directory is fixed at session start. as picks this session's base handle and may not be the human's handle. After a /clear this tool refuses; run `rt chat sign-in` in Bash instead.

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

Sign this session out of rt chat: drop its presence and delete its session file. Room memberships are kept.

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

### chat_archive

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
