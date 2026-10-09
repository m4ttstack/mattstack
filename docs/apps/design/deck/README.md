# Deck facelift, approved 2026-10-08

The main page's table and update strip, the per-app settings modal that
replaces the drawer, and the tooltip every tui-kit app shares. Approved by
Matt on 2026-10-08. The `.pen` file and the renders here are the reference
for implementation; the spec is
`docs/superpowers/specs/2026-10-08-deck-facelift-design.md`.

Commit SHAs, pids and email addresses on the canvas are invented. Ports and
app names are the real mattstack set.

## What lives here

| file | what it is |
| --- | --- |
| `deck.pen` | the design source, a pen.dev document. Open it in Pen; the MCP reads and edits it. Never edit the renders by hand. |
| `renders/*.{dark,light}.png` | 1x exports of the final boards |

Colours are pen variables named after tui-kit's role tokens
(`packages/tui-kit/src/generated/theme.css`), with values read from that
file per scheme, per `docs/apps/ui-authoring.md`. Badge tints follow the kit
Badge recipe (tone at 12% fill, 40% border). Weights are 400, 500, 700.

## Boards

- `FINAL · Main page`: option B's table (version column, quiet icon
  actions) with option A's update strip and its Redeploy all.
- `FINAL · App settings modal`: one page per app. Left column is what runs
  (code, port, recent errors); right column is who reaches it (this Mac,
  the tunnel, Railway) and who gets in (password, Google sign-in).
- `M2 · Other states each block carries`: override active, Railway on,
  password set, errors present, a user app's App block, sync issue and
  down status.
- `FINAL · Tooltips`: every tooltip's copy, drawn in the board app's tooltip
  recipe that moves into tui-kit.
- `A`, `B`, `C`, `M1`, `D1`, `D2`: the options considered; kept for history.

## Pending board fixes

- Each row's chevron becomes a settings (gear) icon button that shows on
  row hover or focus; clicking the row itself does nothing. The FINAL
  boards still draw the chevron.
- `renders/02-app-settings-modal.dark.png` predates swapping the page behind
  the modal to the final main page; the `.pen` board is current.
