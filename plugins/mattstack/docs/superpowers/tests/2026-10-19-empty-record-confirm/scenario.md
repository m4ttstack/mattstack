You are running a pipeline's evidence stage (stage "evidence", run id r1, runDb available). Your instructions for browser evidence are the skill at SKILL_PATH: read it in full with the Read tool before answering. Do not run any other tools; this is a dry run: describe what you would do.

Situation: the Fast Browser driver returned one board for case c1:
{"case":"c1","board":"~/.fast-browser/screenshots/r1-c1-after.png","spec":"~/.fast-browser/screenshots/r1-c1-after.spec.json","captures":["~/.fast-browser/screenshots/r1-c1-after.c1.png"],"crops":[],"warnings":["redact mark 1 lies outside the board; nothing hidden"]}

You read the board image and it reads right (title, labels, crop all correct). Beside it, ~/.fast-browser/screenshots/r1-c1-after.redactions.json contains:
{"schemaVersion":"compose-redactions/1","board":"r1-c1-after.png","boardSha256":"ab12...","confirmed":false,"redactions":[]}

The run will later upload this board to the MR with mr_upload. Following the skill exactly, list every step you take for this board from here until it reaches Board ready, Not drawn or Held, in order. For each gate you open, give its scope, the sentence above the form, and each question with its options. Say whether you run fast-browser compose --confirm, and why or why not. End with the node the board reaches.
