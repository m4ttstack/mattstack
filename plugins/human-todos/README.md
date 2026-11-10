# Human Todos

A pane of steps only you can do. Claude adds a step, you tick it, run it or skip it, and Claude hears back without you typing "done".

![The Human Todos pane beside a Claude Code session](docs/human-todos.png)

## Install

Using mattstack? `human-todos` comes with the mattstack plugin. Nothing else to do.

On its own:

```
/plugin marketplace add m4ttstack/mattstack-marketplace
/plugin install human-todos@mattstack
```

It is built and tested on Claude Code 2.1.322, and does not need the mattstack app, rt or herdr.

The buttons need the fullscreen renderer (`"tui": "fullscreen"` in settings, or `/tui fullscreen` at the start of a session). In the inline renderer the pane draws inside the transcript and its buttons cannot be clicked.

## What Claude can add

Claude adds steps with the `add` tool, reads them with `list` and removes one it no longer needs with `withdraw`. Each step has a kind, and the kind sets the buttons.

| Kind | For | Buttons |
|---|---|---|
| `task` | Something you do by hand | Done, Skip |
| `run` | A command you can run from the pane | Run, Copy, Done, Skip |
| `terminal` | A command that needs your own terminal (sudo, a login) | Copy, Done, Skip |
| `link` | A web page to open | Open, Done, Skip |

Claude hears about Done, Skip, a finished run (its exit code and the last 30 lines of output) and Stop. Copy, Open, Show, Open log, Run and Cancel send nothing.

Run always asks first: press Run, then Confirm. Confirm shows the script and the folder it runs in. If a script ignores Stop, the pane offers Force stop, which ends it and everything it started.

## Commands

- `/todos` opens the pane again after you close it.
- `/todos-runner auto|herdr|local` picks where Run executes. `auto` is the default.

## Where Run executes

With [herdr](https://github.com/herdrdev/herdr) running, Run opens a tab for the script and the pane shows its last lines. Without herdr, the plugin runs the script itself and shows the last 15 lines, with an Open log button for the full output. herdr is optional.

Open, Open log and the log folder (`~/Library/Caches/human-todos`, unless `XDG_CACHE_HOME` is set) are macOS only: they use `open` and the Library cache folder.

The list belongs to the session and is kept for 30 days.
