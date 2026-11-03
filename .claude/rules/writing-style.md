---
paths:
  - "lib/skills/writing-style.ts"
  - "commands/skills-writing-style.ts"
  - "lib/setup/validators/writing-style.ts"
  - "lib/setup/steps/settings.ts"
---

# Writing-style presets

Every review or reply an agent drafts composes in one writing style, resolved
by `resolveWritingStyle` in `lib/skills/writing-style.ts`: the
`skills.writingStyle` setting (user scope beats team), else its registry
default, `mattstack:writing-style-conversational`. A Mac where no store sets
the key reads as not chosen yet (`source: "fallback"`), which the
`skills.writing-style` row reports in the tray's Settings, General.
`rt skills writing-style show`
prints the resolved skill and its source with the one wording the setup row
also uses (`WRITING_STYLE_SOURCE_LABEL`), so never restate it elsewhere.
`use` refuses a skill id that is not installed and `new` copies a preset into
the user's own skill, normalising CRLF and renaming the frontmatter so the
copy is a skill of its own. The presets themselves ship in the mattstack
plugin under `plugins/mattstack`; a preset id must exist there before
`use` will accept it. A new Mac gets sparse in its setup run: when no store sets
the key, `settings.seed` writes `mattstack:writing-style-sparse` at user
scope. It never writes one on an update run or on a finished Mac, so the
registry default stays as it is for anyone who never chose. The
`skills.writing-style` row never blocks Finish.
