# Name the model and effort on every spawn

Before any Agent spawn, apply `mattstack:model-tiering` and name both the
model and the effort.

To switch the model of another Claude pane you drive, send it `/model`
with the alias `mattstack:model-tiering` picks, through the
`rt:herdr-inject` skill: `rt pane send <pane> --text "/model opus"`.
