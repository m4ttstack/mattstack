# Personal "only when I type it" skills

## Why

Members complain that Claude picks up pack skills too often. The only control
today is the Config tab's switch (`SurfaceTab`), which is team-wide: it changes
the pack, needs a compile, and reaches everyone. Members disagree about which
skills should fire on their own, and one person's preference should not need a
pack compile for the whole team.

## What it does

A member marks a skill "only when I type it". On their machine, Claude no longer
sees or runs that skill on its own, and typing `/<pack>:<skill>` still runs it.
Nobody else is affected and nothing compiles.

## Goals

- A per-row personal switch on the Config tab, plus an rt verb that does the same.
- Applies at once on this machine. New sessions pick it up; a running session
  picks it up after `/reload-plugins`.
- Survives plugin updates without the member doing anything.

## Non-goals

- A team default a pack owner sets. Decided: personal only.
- Syncing a member's choices across their machines.
- Personal control over a skill the team switch has off. It is already out of
  agents' list.

## Anti-goals

- Touching the pack, its source, its compile output or its version.
- A toggle that dirties the org clone or shows up in Changes, Discard or Apply.

## Constraints

Checked against the Claude Code docs (`code.claude.com/docs/en/skills.md`) and by
running sessions on 2026-11-02:

- `disable-model-invocation: true` on a plugin skill does what we want. In a
  scratch-plugin test the skill was gone from Claude's list, a request matching
  its description did not trigger it, and typing the command ran it.
- `skillOverrides` is the built-in equivalent, but the docs exclude plugin skills
  from it.
- The docs say Claude Code blocks a Skill tool call to such a skill. So a skill
  that hands off to a direct-only skill through the Skill tool fails for that
  member. The switch's help text says so.
- Plain requests such as "work ABC-123" stop triggering the skill. That is the
  point of the switch, and its help text says so.
- Claude Code's update replaces the installed copy, which removes the edit.

## Approaches

1. **Edit the installed copy (picked).** rt adds the frontmatter line to
   `SKILL.md` in the installed plugin copy and reapplies it after updates. It is
   the only approach that removes the skill from Claude's list. It costs a
   reapply step, and a gap after an update rt did not run.
2. **Deny rule in Claude settings.** rt writes `Skill(<pack>:<name>)` to
   `permissions.deny`. It never touches the plugin and survives updates. In
   testing, Claude's call was blocked and the typed command appeared to load, but
   the description stays listed, so Claude can still reach for the skill and burn
   a turn. Typed behaviour under a deny is not documented. Rejected: it stops the
   run but not the discovery, and the complaint is about discovery.
3. **Pack-level frontmatter through compile.** Team-wide, which is the problem
   being solved. Ruled out.

## Decided with Matt

- Personal only, with no team default.
- Edit the installed copy.
- The control lives per row on the Config tab, on rows whose team switch is on,
  and the legend gains a line explaining it. It sits beside the existing switch,
  applies immediately and never joins the staged Discard/Apply set.
- An rt verb exists alongside the UI.

## My calls (Matt to check)

- **Storage:** a `user`-scope settings key holding the member's choices per
  `<plugin>@<marketplace>`, read and written through the settings resolver. The
  choices are the source of truth and the installed copy is derived from them.
- **Reapply points:** after a toggle, at the end of `rt skills sync`, and in
  setup's `plugins.install` step after it updates plugins.
- **Closing the gap after an update rt did not run:** a mattstack `SessionStart`
  hook reapplies quietly. Skills may already be loaded by then, so the fix can
  land from the next session. Build verifies when it takes effect.
- **If the hook misses:** a one-session lag is acceptable. If a hook-applied edit
  does not reach even the next session, build stops and brings it to Matt rather
  than falling back to the deny rule. The hook does nothing when `rt` is not on
  PATH, and needs no daemon.
- **Which plugin a row belongs to:** one pack is one plugin. The row's name is
  found in the installed copy the way `enumerateRegistered` finds it in the pack,
  through the manifest's `skills` roots, so non-default roots such as
  `./plugin/skills` work.
- **Which copies:** the newest version folder of that plugin in each config dir
  whose `plugins` is its own folder, the same dirs `rt skills sync` warns about.
  Older version folders are left alone. rt refuses to write through a path that
  resolves outside `plugins/cache`, so it can never edit a source checkout.
- **Turning it off:** removes only the line rt added. A skill whose source sets
  `disable-model-invocation: true` shows the control locked on with a reason, and
  rt never removes that line. A source value of `false` is replaced while the
  switch is on and restored when it goes off.
- **Team switch goes off:** the personal choice is kept but has no effect, and the
  control hides. It returns if the team switch comes back on. Rows reached only
  through another skill never show the control.
- **Unknown names:** a stored skill the pack no longer has is ignored without
  error, so a rename leaves a harmless leftover.
- **Not installed here:** the choice is stored anyway and applied when the plugin
  is installed.
- **The verb:** takes `--pack` and several names per call, like
  `rt skills surface set`.
- **Mock first:** the row control is drawn in `docs/apps/design/console/console.pen`
  and approved before it is built, and its copy goes through `rt:ui-copy`.

## Acceptance

- Toggling on in Console removes the skill from Claude's list in a new session, a
  matching plain request does not trigger it, and typing the command runs it.
- Toggling off restores all three, and the installed `SKILL.md` matches the
  plugin's original again.
- After `rt skills sync` and after `rt setup`, with a real version change, the
  choice still holds.
- After a hand-run `claude plugin update`, the choice is back no later than the
  next session.
- The org clone stays clean, `rt skills check` reports no drift, and Changes and
  the Apply bar do not move.
- Another member's machine is unaffected.
- The row is checked in Fast Browser in both schemes.

## Left to the builder

- The setting's key name and the rt verb's name and shape.
- How rt recognises the line it added.
- The console server route, and its error handling when the installed copy is
  missing or unwritable.

## Naming

The feature is named by the frontmatter property it sets, `disable-model-invocation`. The verb is `rt skills disable-model-invocation list|set|reapply` and the setting is `rt.skills.disableModelInvocation`. The frontmatter marks are `# rt: personal` and `# rt: personal (was false)`. Where this spec says "direct-only", read "disable-model-invocation".

A skill other skills invoke by name must keep working, so `mattstack:model-tiering`, `mattstack:writing-style-conversational` and any skill whose frontmatter has `metadata.provides` cannot be disabled. Its surface row carries no field, `set` refuses it with a reason and writes nothing, and reconcile skips it even if the setting names it.
