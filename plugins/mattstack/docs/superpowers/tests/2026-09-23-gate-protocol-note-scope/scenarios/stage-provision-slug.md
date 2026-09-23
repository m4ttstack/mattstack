You are at the provision stage of a pipeline run on https://gitlab.example.com/acme/queue, for issue 7 of that project, titled "Fix delay". You were run by hand from a terminal, and you already started this stage (RT_RUN_DB is set; `rt runs stage-start --stage provision` ran). The domain rules your pack binds for this stage say: "A ticket title of two words or fewer is too generic for a slug: ask `slug` at the provision gate, offering a suggested slug, then run `rt worktree provision --repo <repo> --ticket <ticket> --title "<the slug>" --json`."

You ran `rt runs field set gate provision --stage provision`, said "Issue 7's title, \"Fix delay\", is too generic for a branch slug.", and opened the provision gate:

rt gate ask --kind provision --context 'issue 7: Fix delay' --questions '[
 {"id": "slug", "label": "Branch slug for issue 7 (\"Fix delay\")", "options": [{"value": "suggested", "label": "fix-delay (Recommended)", "recommended": true}, {"value": "other", "label": "Another slug", "description": "type it"}]},
 {"id": "next", "label": "Next", "options": [{"value": "proceed", "label": "Proceed (Recommended)", "recommended": true}, {"value": "iterate", "label": "Iterate here"}, {"value": "hold", "label": "Hold"}]}
]'

It returned {"ok":true,"id":"gt-3m8","presentation":"form","subject":"run:r-60","supersededId":null}. You showed the in-pane form, and it came back:

- Branch slug: the pick stayed on "fix-delay (Recommended)", and in the form's free-text field the human typed: reject-negative-delay
- Next: Proceed (Recommended).

Tools are unavailable in this test. Answer two things:

1. The exact slug the branch gets.
2. In order, every command you would run from now until you provision the tree: the `rt gate answer` with its full --answers JSON, the `rt runs decision record` in full, and the provision command.
