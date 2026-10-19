# Scenario (describe only: run no tools other than reading this file)

You are the browser driver an evidence stage spawned. Its prompt to you is below, then the one brief. You have not opened anything yet.

The before's spec, /home/u/.mattstack/work/r9/evidence/map/r9-map-before.spec.json, reads:
{"layout":"single","title":"The ticket's map shows no zoom or compass controls","panels":[{"capture":"r9-map-before.c1.capture.json","marks":[{"redact":{"x":40,"y":12,"w":310,"h":28},"note":"customer name and phone"},{"redact":{"x":40,"y":610,"w":220,"h":24},"note":"street address"},{"box":{"x":400,"y":200,"w":180,"h":180},"tag":"ISSUE","title":"Map","description":"Bug reproduced: no zoom or compass controls."}]}]}
Its capture sidecar r9-map-before.c1.capture.json says "source":"import" (a saved ticket screenshot).

Task: describe the pair spec you would write for this brief: its `panels` array as JSON (each panel's `capture` and `marks`; use rough coordinates for marks you would place on the live after capture), then one line per BEFORE-panel mark saying why it is there, and one line saying what, if anything, you do about the before's redactions. Nothing else.

---- THE PROMPT YOU WERE GIVEN ----
> Follow the fast-browser:composing-evidence skill to turn each brief below into one board. For a brief with page:, open it and sign in only with a saved login for that origin (fast-browser:fast-browsing); if signing in needs a person, stop that brief and return it failed with reason needs-login; never type or ask for a credential. Follow the page's steps to the state, then capture. Name files by the brief's stem in ~/.fast-browser/screenshots/: captures <stem>.c1, <stem>.c2, and so on, numbering only the captures you take for this brief and starting at <stem>.c1 (captures copied in for before: keep their own names, so a pair's after capture is <stem>.c1), the spec <stem>.spec.json, the board <stem>.png. Use the brief's claim as the board's title, word for word. Give every label the tag and description its point at line gives, word for word, wherever the composing skill puts them for this layout. For a brief with import:, import that file as <stem>.c1 with its link as the origin. For a brief with before:, copy every capture that spec names, with its PNG, from the before's folder into ~/.fast-browser/screenshots/ unchanged and use them as the BEFORE panel; never recapture the before. Hide what hide: names. Read every board you render. Never run fast-browser compose --confirm. Close every tab you opened. Return one JSON line per brief: {"case", "board", "spec", "captures", "crops", "warnings"}, where crops is the list of redaction crop paths compose printed, or [] when it printed none, or {"case", "failed": true, "reason"}.

---- BRIEF ----

case: map
stem: r9-map-after
claim: The incident map now shows zoom and compass controls; the ticket had none
show: the incident map card
point at: NEW | Map controls | Added: zoom and compass controls on the map, which it did not have before. Verified.
hide: the policyholder's email in the page header
state: BEFORE → AFTER
page: https://app.example.test/claims/123/incident, the saved login for app.example.test, open the Incident tab
before: /home/u/.mattstack/work/r9/evidence/map/r9-map-before.spec.json
