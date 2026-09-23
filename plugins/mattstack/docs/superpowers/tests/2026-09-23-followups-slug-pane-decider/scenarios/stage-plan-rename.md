You are at the plan stage of a pipeline run on https://gitlab.example.com/acme/queue. There is no ticket; the task description standing in for one reads: "enqueue() accepts a negative delay and schedules the job in the past. It should refuse it." No domain policy is bound. You were run by hand from a terminal, you already started this stage (RT_RUN_DB is set; `rt runs stage-start --stage plan` ran), and you have not touched any code.

You printed this triage block:

> APPROACH: direct-tdd -- one guard clause in enqueue(), a behavior change
> FAILING TEST: queue/enqueue.test.ts "enqueue validates delay"
> EVIDENCE: none -- no policy bound

You ran `rt runs field set gate plan --stage plan`, said "Printed direct-tdd: one guard clause changes enqueue()'s behavior, so the test comes first.", and opened the plan gate:

rt gate ask --kind plan --context 'APPROACH: direct-tdd -- one guard clause in enqueue(), a behavior change / FAILING TEST: queue/enqueue.test.ts "enqueue validates delay" / EVIDENCE: none -- no policy bound' --questions '[
 {"id": "tier", "label": "Tier", "options": [{"value": "direct-tdd", "label": "direct-tdd (Recommended)", "recommended": true}, {"value": "trivial", "label": "trivial"}, {"value": "superpowers", "label": "superpowers"}]},
 {"id": "failing_test", "label": "FAILING TEST: queue/enqueue.test.ts \"enqueue validates delay\"", "options": [{"value": "keep", "label": "Keep it (Recommended)", "recommended": true}, {"value": "rename", "label": "Rename it", "description": "type the new line"}]},
 {"id": "next", "label": "Next", "options": [{"value": "proceed", "label": "Proceed (Recommended)", "recommended": true}, {"value": "iterate", "label": "Iterate here"}, {"value": "redirect", "label": "Go back"}, {"value": "hold", "label": "Hold"}]}
]'

It returned {"ok":true,"id":"gt-7q1","presentation":"form","subject":"run:r-52","supersededId":null}. You showed the in-pane form, and it came back:

- Tier: direct-tdd (Recommended).
- FAILING TEST: the pick stayed on "Keep it (Recommended)", and in the form's free-text field the human typed: queue/enqueue.test.ts "enqueue rejects a negative delay with a RangeError"
- Next: Proceed (Recommended).

Tools are unavailable in this test. Answer two things:

1. The exact FAILING TEST line the plan now carries: the test you will write first.
2. In order, every command you would run from now until this stage finishes: the `rt gate answer` with its full --answers JSON, and each `rt runs decision record` in full.
