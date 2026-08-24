# hooks

Two delivery mechanisms live here, and they are not interchangeable.

**`hooks.json` is plugin-delivered.** Claude Code reads it from the plugin root
whenever the mattstack plugin is enabled, so installing the plugin is the whole
install: nothing is symlinked and `~/.claude/settings.json` is never touched.
`${CLAUDE_PLUGIN_ROOT}` resolves to the versioned plugin cache, so anything it
names must be a path inside this repo.

| hook | event | what it does |
|---|---|---|
| `plugin/skills/getting-current-time/inject-time.sh` | `UserPromptSubmit` + `PostToolUse` | stamps context with local time, zone, and UTC; the `PostToolUse` pass is throttled to once per 5 minutes so long turns re-stamp without spamming |

**The scripts in this directory are hand-installed** by symlink into
`~/.claude/hooks/`. herdr installs its own managed hook there and tells you to
add custom ones beside it rather than editing it, so that is what these are.

| hook | event | what it does |
|---|---|---|
| `herdr-doorbell.sh` | `PreToolUse` on `AskUserQuestion` | rings the herdr bell whenever a session in a pane blocks on you |

## install (hand-installed hooks only)

```bash
ln -sfn "$PWD/hooks/herdr-doorbell.sh" ~/.claude/hooks/herdr-doorbell.sh
```

and in `~/.claude/settings.json`, alongside any existing `PreToolUse` entries:

```json
{ "matcher": "AskUserQuestion",
  "hooks": [{ "type": "command", "command": "/Users/matt/.claude/hooks/herdr-doorbell.sh" }] }
```

Tests are offline and stub `herdr` on `PATH`:

```bash
hooks/tests/test-herdr-doorbell.sh
```

## why the doorbell is a hook and not a rule

`mattstack:shepherdr` already tells the shepherd to ring before putting a
question in front of Matt. On 2026-08-08 a shepherd running a twelve-agent
herd on `mattari` made **37 `AskUserQuestion` calls and rang the bell 4
times** — the first four, then never again for the remaining 33.

One of the unrung ones asked at 20:47:03 CDT and was answered at 22:39:21, a
block of 1h52m. Four agents finished their spec revisions at 20:45–20:49 and
sat idle the whole time. Matt found it by looking at panes.

The interesting part is what was *not* wrong. The completion watchers were
armed at 20:40:47–20:43:47 and every one of them fired correctly at
20:45:44–20:49:29 on fresh `state_change_seq` values (2101, 2106, 2108, 2110,
2111, 2112). The notifications arrived. The shepherd simply could not act on
them, because it was itself blocked on a modal question that had never rung.

MAT-227 was filed against the watchers and diagnosed them as dying instantly
on a stale status. They did not: that reading came from comparing an arm time
in UTC against a fire time in local CDT, which collapses a four-minute gap
into an apparent zero. A five-rep live probe on a real agent later confirmed
the watchers behave correctly on the prescribed path, because
`relay-answer.sh` blocks on its own `--until working` gate before returning.

So the rule existed, and compliance decayed inside one session. A hook cannot
decay: the bell is a precondition of the tool call rather than a step someone
has to remember on ask number 34.

## two deliberate choices

**Not gated on pane focus.** herdr's `focused` is pane-level within the UI, so
it stays true while Matt is in another application entirely — which is exactly
the two-hour case. Gating on it would have suppressed the one bell that
mattered. Over-ringing costs a notification; under-ringing cost two hours.

**Never fails the tool call.** Every path exits 0 and nothing is written to
stdout, since `PreToolUse` stdout is fed back to the model. A hook that breaks
`AskUserQuestion` would be far worse than a missed bell.
