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

The setting is off by default. With it off, gates work as they did before.

The mod reads the setting when the session starts. After you change it, run `/reload-plugins`.

To turn the form off again, set the value to `false` and run `/reload-plugins`.
