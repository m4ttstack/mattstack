# Gate Form

Gate Form draws mattstack pipeline gates as a form in the pane. You pick answers there instead of typing them.

## Install

Using mattstack? `gate-form` comes with the mattstack plugin. Nothing else to do.

On its own:

```
/plugin marketplace add m4ttstack/mattstack-marketplace
/plugin install gate-form@mattstack
```

## Turn it on

The form takes over gates only after you run this:

```
rt settings set rt.gates.kitForm true --scope machine
```

The setting is off by default. With it off, gates work as they did before. Gate Form still shows the questions other plugins ask it to (see below).

With it on, Claude also gets an `ask` tool (`mcp__gate-form__ask`) that opens questions in the same form.

The mod reads the setting when the session starts. After you change it, run `/reload-plugins`.

To turn the form off again, set the value to `false` and run `/reload-plugins`.

## Asking from another plugin

A plugin that depends on `gate-form` can ask a one-pick question in the same form, with the setting on or off:

```ts
const { id } = await $.gateForm.ask({ title, label, options, timeoutMs })
let outcome = await $.gateForm.wait({ id })
while ('pending' in outcome) outcome = await $.gateForm.wait({ id })
```

For a yes/no style question, pass `kind: 'confirm'` with 2 or 3 options and no `label`. The options show as numbered rows under the title and `context`, with the keys on the first, so put the action that finishes first. A click, Enter on the keyed row, or a row's number is the answer.

```ts
await $.gateForm.ask({ title, context, kind: 'confirm', options: [primary, other], timeoutMs })
```

`wait` answers within about 5 seconds. It returns the picked `value`, `timedOut` once `timeoutMs` has passed, or `closed`. One question shows at a time: a second ask waits until the first is answered.
