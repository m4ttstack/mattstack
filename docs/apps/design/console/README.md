# Console settings rows, direction B4 approved 2026-10-01

The settings row and its explain view, redrawn after the row's three
trailing controls (summary toggle, `⋯`, `›`) and the busy explain modal
proved confusing in use. Approved by Matt on 2026-10-01 ("build B4, keep
the scope names"). Spec:
`docs/superpowers/specs/2026-10-01-console-settings-row-design.md`.

## What lives here

| file | what it is |
| --- | --- |
| `settings.pen` | the design source, a pen.dev document. Open it in Pen; the MCP reads and edits it. Never edit the renders by hand. |
| `renders/*.light.png` | 2x exports of the approved boards |

Approved boards:

- `B · Expand in place (approved row)`: rows at rest and under the pointer,
  one open with the Value tab
- `B4 · Tabs back, calmer (approved 2026-10-01)`: the open row, both tabs
- `R · Run detail keeps a thin modal`: the one place the panel still sits in
  a modal

Kept for the record: `A · One row, one door (rejected)`, `B2 · Open row,
Where it's set (too busy)`, `B3 · One line says where it's set (rejected)`,
and `M1` / `M2`, the detail modal that B replaced. Every name, path and
machine on the canvas is invented.
