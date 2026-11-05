# Surface tab: reference skills and a clearer layout

## Why

The Surface tab mixes three questions: what a skill does, how it is built and
where it came from. That hides a real gap: a reference skill from an org base
pack, such as `feature-flags`, cannot be turned on, cannot be opened from
Console, and may have nothing pointing agents at it.

Matt wants to read these skills from Console, switch them on per team, and
disable model invocation on them like any other public skill.

## Goals

- Open a base skill's source from its row.
- Switch a base reference skill on or off per team.
- Disable model invocation on a base reference skill that is on.
- Group the tab by what a skill does, with where it came from as a tag.

## Non-goals

- Giving a base pack a page of its own in Console.
- Changing how fills are bound or inlined.
- Changing what any pack has public today.

## Anti-goals

- Fills that gain a switch and do nothing useful.
- A second copy of a skill's content that can drift.
- Breaking anything that reads a base skill at `attachments/<name>`.

## Concepts

| Kind | What it is | Switch |
|---|---|---|
| Command | A compiled verb | Yes |
| Reference skill | A standalone skill with no `provides`, from the team or a base pack | Yes |
| Pipeline stage | A step a pipeline runs | No |
| Fill | Has `provides`, plugged into a block | No, unless already public |

## Approaches

Behind the switch for a base reference skill:

1. **Small generated skill (picked).** Compile writes `skills/<name>/SKILL.md`
   with the base skill's name and description and a line that sends the agent
   to the `attachments/<name>` copy. One copy of the content and no reader
   changes. Using it costs one extra file read.
2. Full second copy in `skills/`. Faster for the agent, but two copies per
   team share one id, so resolve and check need work.
3. Hand-written wrapper under a new name. No rt change, but the switch stays
   locked and every team repeats the work per skill.

Moving the copy to `skills/` was dropped: the board only finds its fills at
`attachments/<name>`.

Layout:

1. **Only what a switch can change (picked).** Commands and Reference skills
   list. One line counts the stages and fills built into other skills and links
   to Overview. A stale stage or fill still shows under Needs attention.
2. Two bands, with stages and fills folded below. Dropped after using it: those
   rows had nothing to do.
3. Flat groups by role. Smallest change, same problem.
4. Keep the parent group, split in two. Reference skills stay in two places.

## Decided by Matt

- Team's `pack/surface.jsonc` decides, so one team's choice leaves other teams
  alone.
- The generated skill, as above.
- The tab lists only what a switch can change. It drops the `compiled` and
  `standard` badges and keeps `source newer`.
- An open-in-editor link on base rows, pointing at the base pack's source file
  rather than the team's generated copy.
- Disable model invocation works on a base reference skill that is on.

## My calls

- Only base skills with no `provides` can be switched on. A base fill stays
  refused by `rt skills surface set`.
- A fill or stage that is already public, such as `model-tiering` in the
  mattstack pack, lists with what agents see, so it can be turned off.
- A `from-base` tag replaces the parent group. Its text is the base pack's name.
- Filter chips: All, On, Off, From `<base>`, Needs attention. They count what
  is on disk, never what is staged. Public and Internal become On and Off.
- Commands shows the count that are on. Reference skills reads "Read when
  needed".
- The Off key reads "Only reached if another skill points here", since a
  reference skill with no pointer is not reached at all.

## What changes

- **Compile:** for each public base reference skill, write the generated skill
  with a compiled header. Going off removes it. `rt skills check` treats it as
  compiled output.
- **Surface rows:** a generated skill still reports its base, and a public base
  skill reads `public`. Rows gain whether the skill can be switched and the
  base source path.
- **`rt skills surface set`:** refuse base fills, allow base reference skills.
  Reword the refusal to match.
- **Disable model invocation:** eligibility and refusal stop rejecting a public
  base reference skill. Test that the setting lands on the installed generated
  skill.
- **Console:** groups, tags, chips, the built-in line and the open link. Only
  a row with a switch is staged, and only it takes the hover style.

## Mock

`docs/apps/design/console/console.pen`, frames "Surface two bands", from before
the bottom band was dropped. Skill names there are generic stand-ins.

## Left to the builder

- How the generated skill names its target: `${CLAUDE_SKILL_DIR}` relative or a
  key, whichever matches what compiled skills do today.
- Where a generated skill's base provenance is recorded.
- Grouped base units (`attachments/<group>/<name>`).
- Whether a stale `compiled.json` id needs handling on version bumps.

## Also on this branch

More room between a row and its model invocation note.
