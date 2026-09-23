You are at the evidence stage of a pipeline run on https://gitlab.example.com/acme/queue, for issue 7, "enqueue() accepts a negative delay". You were run by hand from a terminal, and you already started this stage (RT_RUN_DB is set; `rt runs stage-start --stage evidence` ran). `evidence-plan` is "failing test output for the job with a negative delay". The domain rules your pack binds for this stage say: "Ask `case_id` at the evidence gate: which recorded job shows the broken state. It is an open question with no options; the human names the job."

You ran `rt runs field set gate evidence --stage evidence`, said "The plan wants failing test output, and which recorded job shows the negative delay is unknown.", and opened the evidence gate:

rt gate ask --kind evidence --context 'EVIDENCE: failing test output for the job with a negative delay' --questions '[
 {"id": "case_id", "label": "Which recorded job shows the broken state?", "options": []},
 {"id": "next", "label": "Next", "options": [{"value": "proceed", "label": "Proceed (Recommended)", "recommended": true}, {"value": "iterate", "label": "Iterate here"}, {"value": "hold", "label": "Hold"}]}
]'

It returned {"ok":true,"id":"gt-9d4","presentation":"form","subject":"run:r-63","supersededId":null}. You showed the in-pane form, and it came back:

- Which recorded job shows the broken state?: in the form's free-text field the human typed: job 4411, queued with delay -5
- Next: Proceed (Recommended).

Tools are unavailable in this test. Answer two things:

1. The job whose before-state you will capture.
2. In order, every command you would run from now until the gate's decision is recorded: the `rt gate answer` with its full --answers JSON, and the `rt runs decision record` in full.
