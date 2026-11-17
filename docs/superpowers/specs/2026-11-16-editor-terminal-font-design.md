# Setup gives editor terminals a Nerd Font

## Why

rt's pickers, the mod forms (gate-form, human-todos) and Claude Code mods
draw Nerd Font icons. In an editor's integrated terminal (VS Code, Cursor,
Antigravity, where the Claude Code extension also runs the CLI) those icons
are empty boxes unless the terminal font has the glyphs. Today every member
fixes this by hand, and most never find out why the boxes appear.

## Goals

- After `rt setup` (and each launch's `rt setup update`), every installed
  editor's integrated terminal draws Nerd Font icons.
- A member's own terminal font keeps drawing their text: the Nerd Font is
  added as a fallback, never a replacement (Matt's call).
- A Mac with no Nerd Font gets one installed (Matt's call).

## Non-goals

- Ghostty, Terminal.app, iTerm, herdr: their own font settings are out of
  scope.
- Editors other than VS Code, Cursor and Antigravity (Insiders, VSCodium,
  Windsurf can join later through the same table).

## Anti-goals

- Changing how a member's terminal text looks.
- Re-adding the font after a member removed it.
- Losing comments or formatting in an editor's `settings.json`.

## The design

### The font

- Font: **JetBrainsMono NL Nerd Font**, family name `JetBrainsMonoNL Nerd
  Font`.
- Installed when missing by downloading the pinned Nerd Fonts release
  archive (`JetBrainsMono.tar.xz` from v3.5.1, 6 MB, sha256
  `04d5e8f903693f9dd13e16f867e994834e681eb3c72c0d337a770dcda09010cf`),
  unpacking it with the system `tar`, and copying only the 16
  `JetBrainsMonoNLNerdFont-*.ttf` files into `~/Library/Fonts`. The release's
  `JetBrainsMono.zip` holds the same files at 127 MB (Matt's call: the
  tar.xz). The download redirects from `github.com` to
  `release-assets.githubusercontent.com`. My call:
  setup deliberately installs nothing through Homebrew today
  (`lib/setup/tools-install.ts`), and a user font dir needs no admin.
- Detection: any `JetBrainsMonoNLNerdFont-*.ttf` in `~/Library/Fonts` or
  `/Library/Fonts`. Another Nerd Font alone does not count, since its family
  name can't be read reliably without parsing the font (my call).

### The editors

| Editor | App | User settings |
|---|---|---|
| VS Code | `Visual Studio Code.app` | `~/Library/Application Support/Code/User/settings.json` |
| Cursor | `Cursor.app` | `~/Library/Application Support/Cursor/User/settings.json` |
| Antigravity | `Antigravity.app` | `~/Library/Application Support/Antigravity/User/settings.json` |
| Antigravity IDE | `Antigravity IDE.app` | `~/Library/Application Support/Antigravity IDE/User/settings.json` |

Detected by each editor's own CLI (`TERMINAL_FONT_EDITORS` in
`lib/editors.ts`) over the setup `Probes`, so tests never read the real
`/Applications`. Antigravity IDE is in that list only, not `EDITOR_PATTERNS`,
so no extension install runs against it. An editor not installed is skipped;
one with no settings file yet gets a file holding just this key. A
`settings.json` linked to a missing file is unreadable and left alone.

For each editor, `terminal.integrated.fontFamily`:

- already names a Nerd Font (any `Nerd Font` or ` NF` family): leave it.
- unset, with `editor.fontFamily` naming a Nerd Font the terminal inherits:
  leave it.
- set to something else: append `, 'JetBrainsMonoNL Nerd Font'`.
- unset: set it to the editor's effective text font plus the fallback,
  i.e. `editor.fontFamily` when set, else the editor default
  `Menlo, Monaco, 'Courier New', monospace`, then `, 'JetBrainsMonoNL Nerd
  Font'`, so the terminal's look does not change.

An existing value is replaced through `jsonc-parser` `modify` +
`applyEdits` (already a dependency, used by
`packages/rt-client/src/settings/write.ts`). An absent key goes in by hand as
the first property, right after the root `{`, in the file's own line ending
and indent, since `modify`'s insert reformats its neighbours. Every other byte
survives, a leading BOM included; written atomically.

### Respecting an undo

setup-state records, per settings file, the value rt wrote. If a later run
finds the key no longer contains the Nerd Font and differs from what rt
wrote, the member changed it: rt leaves it alone and never re-adds it.

### Where it sits in setup

- One step, `editor.terminal-font` (a `StepDef` in `lib/setup/steps/`),
  registered in `STEPS`/`STEP_IDS`, `updateSafe: true` for the editor edit
  (idempotent, honours the undo, no prompts). The font download runs in the
  same step but only when the font is missing. A failed or offline download
  is a quiet `skipped` on `rt setup update`, `partial` on a full, `--from` or
  resumed run (so it never stops the run), and `failed` only on the row's own
  `--only` run. The next version's update run, a full apply, or the row's Add
  font tries again. The `--only` remedy names the connection only when the
  download itself failed.
- One row, `editor.terminal-font`, optional (never `required`, never
  blocks Install or Finish), grouped beside `tool.editor`, with no
  `ROW_TARGETS` entry (an `install` target would make the row required). `ready` when every installed editor's terminal font includes a
  Nerd Font, naming any editor rt left alone (unreadable settings, or a font
  the member changed); `missing` with a run action (`setup apply --only
  editor.terminal-font`) otherwise; `skipped` when no supported editor is
  installed. Copy in command-description style; snapshots updated.
- Child output and paths go through `ctx.log` / `ctx.redact`.

## Constraints

- Targeted tests only locally; setup copy snapshots
  (`commands/__tests__/setup-copy.test.ts`) updated deliberately.
- A new `Row` field would need `PlanModels.swift`; this design adds none.
- Tests run against `Probes` seams and temp dirs, never the real
  `~/Library`.

## Left to the builder

- Exact row title and detail copy (plain, `rt:ui-copy` style).
- Where the pinned zip URL, version and sha256 live (beside the vendor
  installer table).
- Whether the open editors need a nudge: VS Code applies
  `terminal.integrated.fontFamily` to new terminals live, so none is
  planned.
