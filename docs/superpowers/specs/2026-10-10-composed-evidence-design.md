# Composed evidence: capture, compose, and the agent that drives them

Status: milestones 1, 2 and 3 are merged on fast-browser `main` (milestone 1
at `a2ba811`, PR #23; milestones 2 and 3 on 2026-10-13). The layout follow-up
comes next, and milestone 4 follows it. Sections 1 to 4 describe the design
and mark what each milestone added; section 5 describes the layout engine as
milestone 3 leaves it.

Spans three codebases: fast-browser (the compose command, the capture macro
and the skill), the Playwright fork (the capture tool, milestone 2), and the
mattstack plugin with the team packs that bind stage-evidence (milestone 4).

Builds on `2026-10-10-evidence-v2-design.md` (the evidence@2 record) and
`2026-10-10-evidence-skills-design.md` (every case annotated or waived). Those
specs decide what evidence a run must carry. This one decides what an
annotated image looks like and how an agent produces one.

## Problem

Annotated evidence was a full-viewport screenshot with marks the agent placed
by pixel:

- **Captures were never cropped.** The fact being proven is often a few
  percent of the image.
- **The agent did the layout arithmetic.** Padding, label anchors and counter
  centres were computed by hand from measured boxes. Real runs show the
  result: highlights on adjacent lines overlap, counters float away from
  their targets, chips land on content.
- **The renderer was a dumb SVG painter** (`rsvg-convert`). It draws whatever
  geometry it is given and has no notion of collision, margin, or text
  measurement.
- **Images were upscaled, not sharp.** `annotate` renders at `scale: 2` from a
  1x base, so text is soft. On a DPR 1 display, `browser_take_screenshot`
  with `scale: 'device'` is still 1x.
- **Captions never reached the image.** evidence@2 carries a `label` per case
  and a `caption` per annotated image, but nothing rendered them, so a reader
  saw a cryptic chip and had to read the MR text to know what it meant.
- **Pairs were not composed.** Most real evidence is a before/after or a
  light/dark pair, delivered as two unrelated full screenshots.

## What the spike proved

This was tried before the first version of the spec. Milestone 2 depends on
items 3 and 4.

1. **The target look.** Twelve real evidence cases were re-mocked in pen.dev.
   The direction Matt picked: a gradient stage, a crop snapped to the card
   that matters, and marks that *lift* the proving element out of the
   screenshot instead of drawing boxes on it.
2. **The browser is the renderer.** Every mock maps to HTML and CSS. A JSON
   spec rendered to a 2x PNG in 2.4 s through the fork's own
   `playwright-core` in a launched headless Chromium.
3. **`clip.scale: 2` re-rasterises, in headless Chromium.** At DPR 1,
   `Page.captureScreenshot` with `clip.scale: 2` was byte-identical to a
   native DPR 2 render and to a metrics override. That was measured in a
   launched headless Chromium, not through `chrome.debugger` in the user's
   tab; milestone 2 proves it there before anything depends on it.
4. **`newCDPSession` kills the extension relay.** It sends a browser-level
   attach that `chrome.debugger` will not service; the relay's `send` has no
   timeout, so the call hangs, and the extension's detach closes the relay.
   Element handles held across the relay stalled the same way. A capture that
   uses only `locator.count`, `locator.evaluate`, `page.evaluate` and
   `page.screenshot` ran in about 2 s.
5. **A Sonnet browser-driver can do it blind.** Given one page of
   instructions and a plain-words brief, a fresh Sonnet driver produces
   boards with no pixel placed by hand.

## Goals

- An agent names elements and writes words; it never computes a coordinate
  on a live capture. The one exception is an imported image (a screenshot
  from a ticket), where there is no page to measure and frame and boxes are
  placed by inspection under the rules in §6.
- Every annotated image is cropped to what it proves and readable without the
  MR text. The board renders at 2x. A live capture is 1x today and 2x from
  milestone 2; an imported image keeps the resolution it came with.
- Pairs (before/after, light/dark) and multi-screen flows can be one image.
  One image or two separate ones are equally valid, as long as the before and
  the after are both shown.
- Redaction is optional and declared per brief: most evidence comes from QA
  fixture data and needs none, but a before shot taken in production may.
  When a redaction is declared it must hold: on a live capture, a redaction
  whose target could not be measured blocks the image; on an imported image,
  the safeguards in §6 apply and Matt confirms each redaction before the
  board uploads; and no other layer can draw the hidden pixels.
- No browser call in the capture path can hang.

## Non-goals

- Video or GIF evidence (`capturing-flows` keeps its own path).
- Foreign images outside the evidence flow (an image someone hands an agent
  to mark up ad hoc) keep the existing `annotate` command. Ticket screenshots
  used as evidence go through compose as imported panels (§6).
- Changing the evidence@2 schema. Composed boards fill its existing
  `annotated` and `caption` fields.

## Architecture

```
pipeline agent ──brief──▶ browser-driver ──selectors──▶ capture ──sidecar──┐
   (knows the change)        (Sonnet)                                      │
                                 │                                         ▼
                                 └──────── spec.json ──────▶ fast-browser compose ──▶ board.png
                                                              (headless, 2x)           │
                                 ◀────────── reads the PNG, fixes, re-renders ─────────┘
```

| Part | Shipped | Added later |
|---|---|---|
| Capture | the `capture-evidence` macro, 1x, sealed by `compose --seal` | milestone 2: a tool in the fork, 2x, writes its own sidecar |
| Compose | `fast-browser compose`, one panel, `lift` and `redact` | milestone 3: the other marks, pair and steps layouts, imported panels |
| Driver instructions | the `composing-evidence` skill | each milestone updates the part it changes |
| Pipeline | nothing | milestone 4: the brief, bundles, records, the revise path |

### 1. Capture

Capture resolves named selectors on the live page, takes one screenshot of
the viewport, and measures every named element in the same page state. Its
result is a PNG plus a **sidecar** that compose reads.

**The sidecar** (`<out>.capture.json`, schema `capture-evidence/1`):

```json
{
  "schemaVersion": "capture-evidence/1",
  "source": "live",
  "image": "<out>.png",
  "frame": [x, y, w, h],
  "frameSnap": "card | selector | union",
  "boxes": { "<key>": [x, y, w, h] },
  "missed": [{ "key": "<key>", "reason": "<reason>" }],
  "dark": false,
  "scale": 1,
  "digest": "<sha-256>"
}
```

- `image` is a bare file name; compose looks for it beside the sidecar.
- `frame` and `boxes` are in CSS pixels of the viewport.
- `digest` is an unkeyed SHA-256 over the PNG bytes followed by
  `JSON.stringify({ frame, boxes })` when `scale` is 1, and by
  `JSON.stringify({ frame, boxes, scale })` for any other scale. A 1x
  sidecar therefore keeps the digest it has always had, and a sidecar with
  no `scale` reads as 1. Compose recomputes the digest and refuses a sidecar
  that does not match, which includes one whose `scale` was edited. It
  catches accidental edits and copy mistakes, which is the bar intended; it
  is not a defence against an agent that deliberately recomputes it.
- Files live in fast-browser's screenshots folder
  (`~/.fast-browser/screenshots/`), the containment rule `annotate` follows.

**Capture rules.** Both the shipped macro and the milestone 2 tool follow
them.

- A selector must match exactly one element. Zero matches is `missed` with
  `no-match`, several is `ambiguous` (with the count); nothing is guessed.
  After measuring, a zero-size box is `not-visible` and a box that leaves the
  viewport on any side is `out-of-view`.
- **Frame snap.** `frame: "auto"` walks up from the nearest common ancestor
  of the targets and takes the first one that paints an edge (a border, a
  shadow or a background), is at least 120 px wide, is at least as tall as
  the larger of 64 px and the targets' union plus 24 px, and is no wider than
  the viewport and no taller than 90 percent of it. That is `frameSnap:
  "card"`, padded 12 px. When no ancestor qualifies, the frame is the union
  of the targets padded 24 px, `frameSnap: "union"`. A selector overrides
  the search (`frameSnap: "selector"`, padded 12 px); it must match one
  element and contain every target. The frame is clipped to the viewport.
- When the targets' union is wider than the viewport or taller than 90
  percent of it, the call fails with `frameSnap: "too-large"` and captures
  nothing.
- The frame is scrolled to the centre of the viewport, then the screenshot is
  taken, then the boxes are measured, with nothing page-changing in between.
- `dark` is true when the first opaque background at or above the frame has
  a luminance below 110 of 255. It picks the wash and the lift border.
- A call fails with `failedStep` naming the stage: `args`, `resolve` (no
  selector matched one element), `frame`, or `measure` (every measured box
  was missed).

**Shipped: the macro.** `builtins/macros/capture-evidence.js`, installed to
`~/.fast-browser/macros/` by `fast-browser setup` and run through
`browser_run_code_unsafe` with `{ targets, frame, out, home }`. It uses only
`locator.count`, `locator.evaluate`, `locator.first().waitFor`,
`page.evaluate`, `page.screenshot` and `page.waitForTimeout`. It marks
elements with `data-ev-key` and `data-ev-frame` attributes while it works and
removes them at the start of every call and on every exit. It captures at 1x
and returns `{ schemaVersion, name, png, frame, frameSnap, boxes, missed,
dark, viewport, scale: 1 }`. The driver saves that return to a file,
unedited, and `fast-browser compose --seal <file>` writes the sidecar.

**Milestone 2: the tool.** Capture becomes a tool in the fork's server that
needs no code-execution approval, captures at 2x, writes the sidecar itself,
and cannot hang. The Milestones section holds its full scope.

### 2. Compose: `fast-browser compose <spec.json>`

A CLI command that turns a spec and its capture sidecars into one PNG.

- **The renderer.** Compose builds one HTML page and screenshots it in a
  pinned `chromium-headless-shell`, launched through the installed runtime's
  own `playwright-core` with `deviceScaleFactor: 2`. The user's Chrome is
  never used to draw: capture uses the user's Chrome (for their sessions),
  drawing uses this separate engine, which visits no website and needs no
  login because its only inputs are local files.
- **Where the renderer comes from.** `runtime-lock.json` pins a revision
  with a download URL and a SHA-256 for each of `mac-arm64` and `mac-x64`
  (`npm run pin-renderer` writes the entry). `fast-browser setup` downloads
  the zip, checks the checksum, and unpacks it under
  `~/.fast-browser/renderer/<revision>/<platform>/`. A failed download does
  not stop setup: setup finishes and reports a renderer warning. An install
  counts as ready only when its marker file and executable sit inside that
  folder (no symlink out of it) and the marker's checksum matches the lock.
- **Doctor.** The `compose-renderer` check passes when the renderer is
  installed and starts: it runs the executable with `--version` under a 15 s
  timeout. It fails with "run `fast-browser setup`" when the renderer is
  missing or does not start. When a setup rerun sees that check failing, it
  reinstalls the renderer from scratch, replacing what is there. A lock that
  pins no renderer, or a platform the lock has no entry for, passes with a
  note; on such a machine compose refuses with a message saying so.
- Fonts are bundled (Inter variable, OFL, `assets/fonts/`) and inlined; the
  capture PNG is inlined as a data URI. The page fetches nothing.
- **Output stays contained.** The spec names `out`, a `.png` file name inside
  fast-browser's screenshots folder. `out` may not name the spec or one of
  its captures. The board is written through a temporary file, so two
  renders of one `out` never leave a half-written image. Compose prints the
  path it wrote, the board's pixel size, and any warnings.
- **Redaction is applied once, to the source.** Before any layer is drawn,
  compose paints every declared redact box, grown 2 px on each side, onto
  the capture's pixels with a solid neutral fill (`#CBD5E1`). Every layer
  (the frame, every lift) draws from that redacted copy, and the layout
  reads those same pixels. No layer can draw the hidden pixels, whatever its
  geometry. The fill alone marks a redaction: there is no pill, no label and
  no blur.
- **Validation.** Compose refuses, listing every spec problem at once: a
  `state` or `tag` outside its list, a missing `title` or `out`, a layout or
  mark kind this version does not draw, a key that is not text, a key the
  capture did not measure, a redact key the capture reported as missed, and
  a capture whose `scale` is not 1 or 2 (milestone 1 accepted only 1). A sidecar that is unreadable, malformed
  or does not match its image stops compose before the spec is checked.
- **Warnings** name layout compromises. The shipped list: a frame edge cuts
  through content; a lift edge cuts through content; a lift was scaled down
  to fit the frame; a lift was clamped at the frame edge; a leader crosses
  another lift; a connector crosses another lift; a leader dot sits on page
  content. Milestone 3 adds: a crop edge cuts through content; two lifts
  overlap; a connector crosses another leader; a bracket edge cuts through
  content; a bracket sits on page content; an empty slot is too small for
  its text; a loupe was zoomed out to fit its target; the panels differ too
  much in shape to share a height well; a panel is drawn small.

### 3. The spec

Shipped:

```json
{
  "state": "AFTER",
  "title": "One sentence: what this board proves",
  "layout": "single",
  "out": "<board>.png",
  "panels": [
    {
      "capture": "<board>.c1.capture.json",
      "marks": [
        { "lift": "key | [keys]", "tag": "NEW", "title": "Short label", "note": "One line" },
        { "redact": "key | [keys]" }
      ]
    }
  ]
}
```

- `state` is one of `AFTER`, `BEFORE → AFTER`, `FLOW`, `FOUND`. `tag` is one
  of `NEW`, `CHANGED`, `REMOVED`, `ISSUE`, `PENDING`, `OK`.
- `layout` is `single` with exactly one panel. `capture` names a sidecar by
  file name, resolved beside the spec.
- A lift with a `title` gets a label and a leader; a lift with no title is
  raised and left unlabelled. `tag` and `note` are optional.
- **Words on a label are abilities, not requirements.** Compose and the
  `composing-evidence` skill are generic: a label's `title`, its description
  (the `note` field) and its `tag` each stay optional there, apart from the
  `title` a `bracket` or a `link` cannot be drawn without. The pipeline's
  verification evidence is one use of the tool and sets its own stricter
  rule (Milestone 4).
- Top-level keys compose does not know are ignored, so a spec can carry
  `revisions` (§6) today.

Milestone 3 adds the rest of the vocabulary:

```json
{
  "layout": "single | pair | steps",
  "panels": [
    {
      "label": "BEFORE",
      "capture": "<board>.c1.capture.json",
      "marks": [
        { "ghost": "key", "tag": "REMOVED", "title": "..." },
        { "empty": "key", "text": "Nothing rendered here" },
        { "bracket": ["key", "key"], "title": "...", "note": "..." },
        { "loupe": "key", "zoom": 4, "title": "...", "note": "..." },
        { "link": ["keyA", "keyB"], "title": "Same fact, two places" }
      ]
    }
  ]
}
```

An imported panel (milestone 3) names an imported capture's sidecar the same
way and adds its inspection geometry at panel level, in the image's real
pixels:

```json
{
  "label": "BEFORE",
  "capture": "<board>-before.c1.capture.json",
  "frame": [x, y, w, h],
  "boxes": { "<key>": [x, y, w, h] },
  "marks": [ { "empty": "map", "text": "Nothing rendered here" }, { "redact": "address" } ]
}
```

For an imported panel, compose resolves mark keys against these panel
`boxes`; for a live panel, against the sidecar's measured boxes. Panel
`frame` and `boxes` are refused on a live panel.

### 4. Primitives

| Primitive | What it draws | Milestone |
|---|---|---|
| Stage | Gradient backdrop, header with state pill and title | shipped |
| Frame | The capture cropped to its frame, rounded, shadowed | shipped |
| Wash | Light or dark veil over the frame, drawn when the panel has a lift | shipped |
| Lift | The element re-drawn from the capture as a raised card with a ring | shipped |
| Callout | Dot beside the lift, elbow leader, typeset label in the margin | shipped |
| Tag | Coloured pill on a label: NEW, CHANGED, REMOVED, ISSUE, PENDING, OK | shipped |
| Redact | Solid fill on the source pixels, nothing else | shipped |
| Ghost | Rose slot where a removed element was | 3 |
| Empty | Dashed slot with italic text where nothing rendered | 3 |
| Bracket | Span marker beside a group of rows, label beside it | 3 |
| Loupe | Ring on a tiny target, magnified circle in the margin | 3 |
| Link | One connector between two lifts, one label | 3 |
| Pair | Two panels side by side with BEFORE/AFTER or LIGHT/DARK heads | 3 |
| Steps | Numbered panels joined by arrow chips | 3 |

### 5. Layout rules (owned by compose, never by the agent)

These are the rules of the engine as milestone 3 leaves it. Compose works
from the capture's pixels, not from the page, so every rule below also holds
on an imported image. Distances are capture pixels unless they say board
pixels (the board as drawn, before the 2x render).

A line of pixels is **clean** when every pixel is within 24 of the line's
median colour per channel. A **rule** crossing the line (a card border or a
divider: at most 2 px thick, one colour for 24 px on both sides, or on one
side when the other runs off the image) does not count against it, up to two
per line. An edge **sits well** when its line is clean and lies in a band of
clean lines: 3 lines for a lift edge, 6 for a crop or frame edge. A lift
edge uses the short band because a word space in running text is only a few
pixels wide; a 1 or 2 px gap between letters never passes.

**The frame.**

- The capture's frame can end mid-word. An edge that does not sit well moves
  inward first, which shows nothing new, to the nearest band that leaves
  16 px to the marks. If none exists it moves outward to the nearest band
  within 96 px. If neither exists it stays, and compose warns that a frame
  edge cuts through content. A panel with no marks has no inward room. An
  edge on the image's own boundary has nowhere to move and is not reported
  as cut.
- An edge that runs through a redaction fill moves out to the fill's far
  side, so no fill is shown torn.
- **An imported panel's frame only shrinks.** It may be all that hides what
  lies beside it, so its edges move inward and never outward, a redaction's
  pad does not widen it, and an edge that cannot sit well stays where the
  spec put it, with the warning.

**What a panel shows.**

- **`single`:** the crop to its marks, or the frame whole when the crop
  does not apply.
- **`steps`:** each panel is cropped to its marks the same way, held to at
  least 320 by 200 px so a step keeps enough of its screen to be placed.
- **`pair`:** each panel shows its frame whole and is never cropped. The
  frame is the region the two panels compare.
- **The crop** is the marks plus a margin: 64 px each side and 48 px top and
  bottom, or 16 px on a top or bottom that only a bracket's rows bound. Each
  edge moves outward up to 80 px to a clean band, then on outward over clean
  lines until 12 clean lines lie inside it, stopping at the first line that
  is not clean or at the frame, so text never sits flush against a crop
  edge. The crop replaces the frame only when it covers under half of the
  frame's area; otherwise the frame is shown whole.
- **A crop edge that finds no clean band.** On a `single` board it goes to
  the frame's own edge on that side. On a `steps` board it stays at its
  margin and compose warns that a crop edge cuts through content, because on
  a dense page the frame's edge is no cleaner and the crop would swell to
  the whole page.
- **Trim.** A `pair` or `steps` panel that shows its frame whole loses the
  blank ground at the frame's edges: each edge moves inward over lines that
  are wholly ground, keeps 2 px outside the first line with anything on it,
  and never passes the marks. Two `pair` frames of one size take the smaller
  trim on each side, so both panels show the same rectangle.
- **Scale.** A `single` frame is scaled to about 560 board px wide, never
  below 0.55x or above 1.25x of the capture. The panels of a `pair` or
  `steps` board share one height, whatever their source sizes, so a large
  imported screenshot and a small live crop read as equals: the height that
  fits a 1120 board px width budget, at most 360 board px and at most 1.25x
  the shortest frame, and never under 96 board px. Compose warns when the 96 px floor
  applies (the panels differ too much in shape) and when any panel is drawn
  under 0.4x (a panel is drawn small; the driver frames tighter).

**Lifts.**

- A lift box that ends inside content grows outward, up to 96 px per side,
  until each edge sits well. An edge that finds no band within the limit
  goes back to where the agent's box put it, and compose warns that a lift
  edge cuts through content. A lift never grows into a redaction or a slot,
  nor into another lift unless the two boxes already overlapped as named.
- A lift is padded up to 4 px per side, over clean lines only, and only
  while the 3 lines beyond the padding are clean too. Ground therefore shows
  between the card and its neighbour, and the card never carries a sliver of
  the neighbouring word.
- A lift is drawn 6 percent larger than its source. A lift shorter than
  28 board px is enlarged until it is 28 px tall, up to 3x, and never past
  what the frame can hold.
- **Where the card sits.** An enlarged card may sit anywhere that still
  covers its element as drawn, so the element never shows twice. Compose
  takes the position that hides the least page content, counting what lies
  under the card and within its ring plus 3 px of it. A tie goes to the
  position nearest the centred one. A rule that runs the whole counted
  length (a card's border, a divider) is not content, so a border beside a
  lift never pushes the card off its element. The card keeps 2 board px from
  the frame's edge; one the frame cut short is reported as clamped.
- An enlarged lift gives way to its neighbours: it shrinks back toward
  6 percent, and no further, while it would cover another lift. Two lifts of
  separate content that still overlap at that size are drawn, and compose
  warns that two lifts overlap. A lift drawn under 6 percent to fit the
  frame is reported as scaled down.
- **Several keys in one lift.** Each key is grown on its own first. Boxes
  that then sit within 12 px of each other in one row or column, and whose
  bounding box is at most a quarter empty, form one lift. Keys that sit
  apart become one lift per group under one shared label. If two lifts of
  one mark would end within 8 board px of each other as drawn, they merge
  back into one lift, unless the merged box would cover another mark's
  element. A link's two lifts never merge.

**Labels and leaders.**

- Labels live outside the frame, never on the screenshot. The preferred side
  is the right, or below when the frame is wider than 2.2 times its height.
  A side is open to a point when the way out on it is clear of every other
  mark's target; a bracket does not block.
- Labels on one side stack in anchor order with a fixed gap; none overlap.
  Each leader turns at its own track in the margin, 8 board px from the
  next, so no two share an elbow, and labels stand past every track and
  lane.
- **Choosing the side.** Compose counts the samples along the leader's first
  segment that differ from the clean ground beside the lift; a sample on a
  redaction fill counts whatever its colour. The leader leaves its preferred
  side unless that side crosses 3 or more and another open side crosses at
  least 3 fewer. A ring or a bracket has no dot to slide, so its leader
  takes the open side that strikes the least, measured across the stroke's
  width plus 2 board px, against the page just beside the target.
- **The dot** sits outside the lift's ring, so it never covers what it
  points at. Along its side it takes the spot whose first segment strikes
  the least content, measured across the stroke plus 2 board px either
  side. Compose walks the side outward from the middle in half-pixel steps
  and stays 6 board px from the corners; a tie goes to the spot nearest the
  middle. A spot is allowed only when no page content and no redaction fill
  lies under the dot or within 6 board px of it, the way out clears every
  other mark's target, and 2 board px of ground separates it from any other
  dot. A spot is clear when it is allowed and its segment strikes fewer than
  3 samples.
- When the chosen side has no clear spot, the dot takes the first other open
  side that has one. With none on any open side it takes the least-struck
  spot on the chosen side, and compose warns that a leader dot sits on page
  content.
- A point with several lifts has one leader, from the lift nearest the
  label. Each other lift joins that leader's track with a connector from its
  own dot, by the side with a clear spot and then the route that strikes the
  least. A connector that must reach the leader's far side runs along a lane
  of its own outside the capture. Compose warns when a connector crosses
  another mark's leader.
- Dark frames get a dark wash and a dark lift ring.

**Slots, brackets and loupes.**

- An `empty` or `ghost` slot is drawn on its box as given. An `empty` slot
  holds its text when the text fits; otherwise the text becomes the slot's
  label, or is dropped with a warning when the mark already has a title.
- A bracket's rows grow like a lift box. The bracket stands 6 board px to
  the right of the rows and slides right in 2 px steps, up to 24 px, to
  ground clear of content and of lifts. Rows that reach the frame's edge put
  it in the margin. With no clear ground it stays at 6 px and compose warns
  that a bracket sits on page content. On a washed panel the rows are drawn
  unwashed.
- A loupe draws a ring 5 board px outside its target and a 110 px lens in
  the margin, at 4x unless the mark says otherwise. The target never fills
  more than 0.8 of the lens; compose zooms out to keep that and warns. The
  lens is drawn from the shown, redacted frame, so it cannot show what a
  crop left out or a redaction hides. Its leader routes like a lift's.

### 6. The agent workflow

The pipeline agent at the evidence stage knows the change; the browser-driver
knows the browser. They meet at an **evidence brief**: one entry per evidence@2
case, in plain words.

```
case: <evidence@2 case id>
claim: what this image proves
show: the region, named in words ("the settings card's header")
point at: each fact, with its tag and label text
hide: personal data on screen that is not being verified
state: AFTER | BEFORE → AFTER | FLOW | FOUND
before: bundle path of the before board (BEFORE → AFTER at ship only)
```

`point at` is the `evidence-attach` gate's `annotations` answer: the marks the
operator kept become the brief's entries. `hide` is empty unless the screen
shows real personal data (typically a before shot taken in production).

The driver turns the brief into selectors, capture calls and a spec, renders,
**reads the PNG**, and fixes what reads wrong, at most two re-renders per
board. It returns, per board, either `{ board, spec, captures }` (the board,
its spec, and every capture sidecar it used, which together are the bundle)
or `{ failed, reason }`. A failure feeds
evidence-record's existing `Drawn?` node and its two-failures-then-waiver rule
unchanged.

**Recording a board in evidence@2** (no schema change):

- A board fills `annotated` on **every image it shows**, with the same path,
  and the brief's `claim` as each image's `caption`. A before/after board
  therefore covers both the before and the after image of its case, and
  neither needs a waiver. evidence-record uploads and lists each distinct path
  once, even when several images share it, so stage-evidence's attach and
  ship both dedupe (part of milestone 4).
- Each image's `path` stays its own base capture PNG, as evidence@2 requires
  (see the bundle below).
- A single-image case works exactly as today: one image, one board.
- Two separate annotated images are equally valid; the pipeline agent chooses
  per case. What matters is that the before and the after are both shown.

**Before and after at different stages.** stage-evidence captures befores;
ship captures afters.

- At stage-evidence, every before gets its own standalone board, recorded on
  that before image as today. That satisfies the evidence@2 validator when
  stage-evidence writes the record, so no waiver gate opens.
- At ship, an after is composed either alone or, when the case wants one
  image, as a before/after pair built from the before's bundle (below) and the
  new after capture. A pair board then replaces the before's standalone board:
  ship sets the pair's path and caption on both the before and the after
  image. evidence-record's merge rule gains exactly this case: a ship-composed
  board that shows an existing image replaces that image's `annotated` and
  `caption`. Every other merge rule is unchanged.
- The brief for a BEFORE → AFTER case carries a `before:` field with the
  before board's bundle path, so ship's driver composes from the kept capture
  instead of recapturing a page that has since changed.

### The board bundle (and revising a board later)

Every board is saved as a bundle that any agent, in this session or a later
one, can re-render without a browser. In the run's evidence folder, sharing
one stem:

```
<run>-<case>-after.png                 the board
<run>-<case>-after.spec.json           the spec that drew it
<run>-<case>-after.c1.png              capture 1 (full-viewport, uncropped)
<run>-<case>-after.c1.capture.json     capture 1's measurements + digest
<run>-<case>-after.c2.png ...          further captures for pairs and steps
<run>-<case>-after.redact-<n>.png      imported panels only: redaction crops
<run>-<case>-after.redactions.json     imported panels only: the confirmation record
```

- Names start with the run id, so concurrent runs sharing fast-browser's
  screenshots folder never overwrite each other between compose and the
  stage's copy.
- Every path inside a bundle is relative: a sidecar names its PNG by
  file name, a spec names its sidecars by file name, and compose resolves
  them beside the file that names them. A copied bundle still renders, and
  the digest still covers the bytes.
- Each image's evidence@2 `path` is its uncropped capture PNG from the bundle
  (`c1.png` and so on), so the base stays the full screen and the board is the
  crop.
- Bundles sit flat in the run's evidence folder, so a pair spec can name the
  before bundle's capture files by file name even though they carry the
  before's stem.
- **Revising.** A revision is done when the human sees it on the MR:
  1. Find the spec beside the board; edit it (wording, tags, marks,
     redactions, one image or two). Recapture only when the change needs a
     different crop or new targets, which needs the page reachable again.
  2. Re-render with compose (output lands in fast-browser's folder) and copy
     the result over the bundle's board, keeping its path. If the board has
     redactions on an imported image, read every `<stem>.redact-<n>.png` crop
     first, exactly as the driver does, and get Matt's confirmation again:
     a re-render resets it (see the gate below).
  3. Re-upload with `mr_upload {runId}`; the path is unchanged, so the record
     check still passes.
  4. If the claim changed, update the images' `caption` in the record with
     `run_field_set`.
  5. Rebuild the MR's evidence section through evidence-record's description
     rule, so the new upload replaces the old one.
  6. Append `{ asked, changed }` to the spec's `revisions` list, so a later
     agent sees what the operator already asked for.
  During a run, stage-evidence and ship take revisions at their gates. After
  a run has shipped, the entry point is the standalone `ship` skill re-run on
  the same run: it already uploads and rebuilds the description from the
  record, and gains a "revise a board" path that runs the steps above.

**Befores that come from a ticket.** Often the before is a screenshot pasted
into the ticket, not something the run captured. It joins the bundle as an
**imported capture**: the image file plus a sidecar with `source: "import"`,
`origin` (the ticket link), its digest, and no measured boxes, because there
is no page to measure.

- In a board, an imported panel is cropped and framed like any other,
  except that compose never shows anything outside the frame the spec gives
  (§5), and it carries a small "From the ticket" label, so a reader knows
  the run did not take it.
- Marks on an imported image are optional. When added, they are placed by
  inspecting the image (fast-browser's existing rule for foreign images). An
  imported panel's geometry is inspection by definition, which the sidecar's
  `source: "import"` already records.
- Import converts the ticket image to PNG (JPEG, WebP and the first frame of
  a GIF), so the bundle and compose only ever handle PNG; the sidecar keeps
  the original format and the digest covers the converted bytes.
- Redaction works on imported images the same way and matters most there,
  since ticket screenshots are the likeliest to come from production. Because
  nothing is measured, three safeguards replace measurement:
  - Compose pads every redact box placed by inspection by 12 image pixels on
    each side, on top of the driver's own padding.
  - Compose writes a full-resolution crop of each redacted region of the
    rendered board beside it (`<stem>.redact-<n>.png`), and the driver must
    read each crop, not the whole board, before reporting the board done. A
    downscaled view of the whole board is how a readable sliver survives.
  - **Matt confirms each one before upload** (the gate below).
- **The redaction gate.** No board with a redaction on an imported panel
  uploads until Matt has confirmed every one of its redactions.
  - Compose writes `<stem>.redactions.json` beside such a board: one entry
    per redaction, holding its crop's file name, the crop's SHA-256, and
    `confirmed: false`. Every render writes it afresh, so a re-render always
    starts unconfirmed.
  - `fast-browser compose --confirm <spec.json>` marks the entries confirmed.
    It refuses when a crop is missing or its bytes no longer match the
    recorded SHA-256. The agent runs it only after Matt has said yes at the
    gate; like the capture digest, the record guards against a skipped step,
    not against an agent that sets out to cheat.
  - The stage shows Matt each crop at a gate, one question per board, and
    runs the confirm command on his yes. On a no, the driver widens the
    redaction, re-renders, and the gate asks again.
  - The upload path refuses a board whose record is missing, has an
    unconfirmed entry, or names a crop whose bytes changed. A board with no
    imported redaction has no record and uploads as before.
- **Where a ticket before enters the run.** stage-evidence imports it: when
  the ticket embeds the broken state as an image, stage-evidence downloads
  it, makes it an imported capture, and composes a standalone before board
  like any other before. This replaces today's "Record the ticket's location
  as the BEFORE" branch for tickets that embed an image. The
  `{"plan": "ticket", "url": ...}` value stays only for a ticket whose before
  is a link or text with no image to import.
- The imported image is the before image's evidence@2 `path`; the board that
  shows it covers it, so no waiver is needed.
- The record marks that image `source: "ticket"`, and `evidence_record`
  writes the `size` and `sha256` of its run-folder copy beside the mark
  (computed from the copied bytes, never taken from the caller; kept on a
  same-path re-record, recomputed on a recapture). `mr:upload` refuses the
  image at its own path, and any byte copy anywhere, by those recorded
  values, with or without a `runId`; with none it reads every run's record
  under the runs root. That scan reads only each run's `evidence` and
  `evidence-tickets` fields, matches a hashed shot by its recorded path
  string, size and sha256 without touching any file, and reuses a run's
  fields from daemon memory while its `state.db` and WAL stat unchanged, so
  a warm scan opens no run's db. So deleting the run-folder copy, or the run's whole
  work folder, no longer lets a leftover original go up: the earlier ENOENT
  limit is closed. What remains:
  - The memory lasts as long as the run's record. The daemon's run prune
    deletes a finished run's whole folder, `state.db` included,
    `rt.runsPruneDays` (default 30) after it ends, so by default an original
    left in a temp root uploads 30 days after its run ends.
  - A legacy ticket shot, recorded before this change with no hash, cannot
    be compared once its ticket file is gone. While it lasts, every upload's
    scan pays a realpath and a stat for it, and a read and hash when its
    size matches the upload's.
  - The record is trusted over the file: a well-formed but wrong `sha256`
    written straight through `run_field_set` lets the real original pass.
    That is a shift in what is trusted, not a new kind of bypass: the same
    writer could already drop `source` or the case.
- Coordinates are in the image's real pixels. The skill tells the driver to
  read the real size first and to scale anything read off a downscaled
  display; compose refuses a frame outside the image or a box outside the
  frame. Every key a mark uses, redactions included, is a box in the panel.
- When a live after is paired with a ticket before, the driver frames the
  after on the same region of the screen (an explicit frame selector when
  auto-snap overshoots), so the reader compares like with like.

**Which capture is each image's base `path`.** The driver's own capture
replaces the domain's separate "capture the before/after" screenshot; that
screenshot remains only as the gate's preview. For a single or pair board,
each image's `path` is its own capture. For a steps board recorded on one
image, the `path` is the final step's capture. A ticket before's `path` is
the imported file.

**No gate.** When no `evidence-attach` gate runs (no open MR yet, or the
domain does not attach at that stage), `point at` is the agent's own proposed
marks, evidence-record's existing rule. The redaction gate above is separate
and always runs.

**Model.** The driver runs on Sonnet: the stage delegates to
`fast-browser:browser-driver` with an explicit `model: sonnet`, because that
agent's own default is Haiku. Haiku is measured by the blind eval before
anything relies on it. The pipeline agent writes the brief at whatever model
runs the stage.

### 7. Skill changes

- **fast-browser, shipped:** the `composing-evidence` skill covers the
  capture macro, sealing, the shipped spec, selector guidance (role and
  scoped-text selectors, a unique container in place of `nth=`, a small icon
  targeted by its role and accessible name, `browser_find` before a full
  snapshot) and reading the PNG. `annotating-screenshots` stays for foreign
  images outside the evidence flow and points live evidence at the new
  skill. Milestone 2 rewrites the skill's capture and seal steps; milestone
  3 adds the new marks, layouts and imported panels.
- **mattstack `stage-evidence`, `stage-ship`, standalone `ship`, and
  `evidence-record` (milestone 4):** the annotate step becomes "write the
  brief, delegate to the driver, record the board". stage-evidence composes
  a standalone board per before and copies each bundle into the evidence
  folder; ship writes the after briefs and composes afters and pairs.
  evidence-record gains two rules: a ship-composed board replaces
  `annotated` and `caption` on every existing image it shows, and uploads
  dedupe by path. Every skill that records a board gains the revise path and
  the redaction gate from §6. stage-evidence's "ticket already shows the
  broken state" branch imports an embedded ticket image as the before (§6),
  and `{"plan": "ticket"}` narrows to tickets with no image. The waiver
  rules from the evidence skills spec are unchanged.
- **Team packs that bind stage-evidence (milestone 4):** a pack keeps only
  what mattstack cannot know, in a browser target section of its evidence
  fill (milestone 4, "Who owns what"). Its own capture, draw and check
  procedure is deleted.

## Testing as we build

Each layer can look right alone and still fail an agent. Every milestone ends
usable end to end, and four layers of tests run throughout.

fast-browser and the fork are public, so everything in their repos is
synthetic. Fixture pages and their captures are built from made-up HTML that
reproduces the hard patterns; no screenshot of a real product, no real URL,
no real case lives in a repo. The real-case eval below lives outside them.

1. **Compose fixtures (`npm run test:compose`).** Shipped in
   `tests/fixtures/evidence/`: `pages/` (synthetic HTML), `specs/` (one spec
   per board) and `goldens/` (one PNG per spec). For each spec the suite
   captures its page headless with the macro, seals, composes, and checks:
   - Layout invariants on the report compose returns
     (`tests/e2e/helpers/invariants.mjs`): no label overlaps the screenshot
     or another label, every label is inside the stage, every lift is inside
     the frame, lifts of separate content do not overlap, every dot clears
     every lift and touches its own, no leader or connector crosses another
     point's lift.
   - The redaction invariant: with a redact region declared, the board shows
     the fill and never the original pixels, including under a lift placed
     over the redacted row.
   - A golden PNG, with at most 0.2 percent of pixels differing.
     `UPDATE_GOLDENS=1` rewrites goldens; a visual change is a reviewed
     golden update.
   The suite fails, not skips, when no renderer is installed, unless
   `FAST_BROWSER_SKIP_COMPOSE_E2E=1` is set.
   Milestone 3 adds, each with its fixture and invariant first: a fixture
   per new primitive and layout; brackets beside their rows; the relocation
   test (a bundle copied to another folder renders the same board); the
   imported-panel fixtures (a "From the ticket" label, a mark placed by
   inspection, a redaction with its crops and record, and a pair whose
   imported and captured panels differ in size by 3x, asserting equal
   rendered heights); and the new refusals (inspection geometry on a live
   panel, a frame outside the image, a box outside the frame).
2. **Capture against fixture pages.** Shipped for the macro in
   `tests/e2e/capture-evidence.test.mjs`: frame snap (`card`, `union`,
   `too-large`), `missed` reasons, dark detection, a tiny badge, tags
   cleaned up after a failed call, and a frame selector that misses a
   target. Milestone 2 runs the same assertions against the tool and adds
   sharpness, checked against a reference, not by size: a 2x capture must
   match a native DPR 2 render of the same page within tolerance, so an
   upscaled 1x image fails. A separate live smoke against the real relay
   (the user's Chrome, through `chrome.debugger`) runs the same sharpness
   comparison with a hard per-call timeout, so a hang fails fast. Its
   reference is a metrics-override capture of the same tab, not a headless
   render, because headed and headless Chromium rasterise text differently.
3. **Blind agent eval (each milestone).** A brief against a real app, run by
   a fresh Sonnet driver with only the current skill text. The brief and its
   results live only on the operator's machine
   (`~/.fast-browser/composed-evidence-eval/`), never in a repo. The pass
   bar, confirmed by Matt:
   - every case in the brief produces a board;
   - at most 3 capture calls per case;
   - every declared redaction holds, on live captures and on imported ticket
     screenshots alike (a readable hidden field fails the run; undeclared
     data on QA fixtures is not a failure);
   - each board scores at least 4 of 5 against the pen mock for its
     primitive, judged by Matt or an Opus judge.
   Haiku runs once Sonnet passes. The milestone 2 and 3 evals are not marked
   down for a label with no tag or no description, as long as the ability
   exists in compose and is tested; writing both on every label is milestone
   4's rule for verification evidence.
4. **Matt's eyes (each milestone).** A contact sheet of every board,
   published for review. A milestone that changes output is not done until
   it has been looked at.

## Working rules from M1

These apply to milestones 2, 3 and 4 alike.

- **Blind eval early and often.** Run a blind eval of agent-made boards
  every few tasks, not only at the end. Fixtures passing says the engine
  holds its own rules; only a fresh agent on a real page shows whether the
  boards read.
- **Reviewers run `npm run test:compose` themselves.** An implementer's "all
  green" is not evidence for goldens.
- **Goldens are regenerated from the final committed code.** A golden
  committed from a working tree that differs from the commit is a failing
  test waiting for the next person.
- **UI is rendered and looked at.** Whoever changes what a board looks like
  opens the PNG and says plainly what reads wrong, before review.
- **Models.** Sonnet runs implementers and task reviews; Opus runs the final
  whole-branch review.
- **The repos are public.** fast-browser, the fork and mattstack carry no
  employer names, URLs, data, ticket ids or wording from the employer's
  business domain, in code, fixtures, goldens, commit messages or PR text.
  Fixtures use a neutral made-up domain (the shipped ones are a project
  tracker).
- **Squash before any push.** A branch is squashed to one commit before it
  is pushed anywhere, so nothing from mid-branch history reaches a public
  repo.

## Milestones

### Milestone 1: compose CLI with the core primitives (shipped)

fast-browser `main` at `a2ba811` (PR #23): `fast-browser compose` with stage,
frame, wash, lift, callout, tag and redact; the pinned renderer installed by
setup and checked by doctor; the `capture-evidence` macro and `--seal`; the
`composing-evidence` skill; fixtures, invariants and goldens. The blind eval
met the pass bar. Sections 1 to 4 describe it, and §5's single-panel rules
began there.

### Milestone 2: capture as a fork tool

Merged on fast-browser `main`, 2026-10-13.

**Scope.** Replace the macro with a capture tool in the fork's server, at
2x, that cannot hang.

- A tool, `browser_capture_evidence` (the name is the plan's to settle),
  beside `browser_take_screenshot`. Arguments:
  `{ "targets": { "<key>": "<selector>" }, "frame": "auto" | "<selector>", "out": "<name>" }`.
- It follows the capture rules in §1 exactly: the same frame snap, the same
  `missed` reasons, the same `failedStep` values, screenshot then measure.
- It writes the PNG and the sidecar itself, in the §1 shape, into
  fast-browser's screenshots folder, and returns the sidecar's fields plus
  the two paths. The digest is computed the way §1 states, `scale` included
  because the tool's is 2, so compose accepts the sidecar unchanged.
- **2x** through `clip.scale: 2` on the page's existing session; the
  sidecar says `scale: 2`. `frame` and `boxes` stay in CSS pixels. If
  `clip.scale: 2` turns out to upscale through `chrome.debugger`, the
  fallback is a temporary `Emulation.setDeviceMetricsOverride` on the page's
  existing session, restored in a `finally`.
- It never opens a new CDP session and never holds an element handle.
- **Every relay send carries a timeout**, so a refused command fails with an
  error instead of hanging the session.
- Because it is a tool rather than `browser_run_code_unsafe`, it needs no
  code-execution approval.
- **Compose accepts a 2x capture.** Compose refuses `scale` other than 1
  today, because boxes are CSS pixels and the layout works in capture
  pixels. Milestone 2 makes it accept 1 and 2 and refuse anything else. The
  digest covers a `scale` of 2 (§1), so a 2x sidecar edited to say 1, or the
  reverse, is refused before the layout reads it. Boxes and frame are
  multiplied by `scale` when the sidecar is loaded, and every source-pixel
  distance in §5 (bands, growth limits, margins, pads, the redaction's 2 px)
  is multiplied by it too, so a 2x capture lays out the same board as its 1x
  twin, sharper.
- Once the tool passes the blind eval, the macro stops being a built-in:
  its `--seal` step and its `MACROS.md` entry are removed and the skill's
  capture and seal steps are rewritten for the tool. The script itself moves
  to `tests/e2e/helpers/`, because the compose fixture suite captures its
  synthetic pages headless with it and has no relay to call the tool
  through.

**Repos.**

- The fork, `m4ttheweric/playwright`, branch `fast-browser-runtime`: the
  tool and the relay timeout.
- fast-browser: the 2x support in compose, the tests, the skill, and the
  runtime re-pin through `npm run pin-runtime`.
- A fork release and the re-pin each need Matt's approval before they
  happen. Publishing to the fork's public release is a stop: the job asks
  and waits.

**Files.**

- Fork: a new capture tool beside
  `packages/playwright-core/src/tools/backend/screenshot.ts`, registered
  where that tool is; the timeout in
  `packages/playwright-core/src/tools/mcp/cdpRelay.ts`.
- fast-browser, owned by this milestone: `lib/compose/capture.mjs`,
  `builtins/macros/capture-evidence.js`, `builtins/macro-hashes.json`,
  `skills/browser-macros/MACROS.md`, `tests/e2e/capture-evidence.test.mjs`,
  `runtime-lock.json` and the files `pin-runtime` rewrites with it.
- Shared with milestone 3, see "Files both milestones touch".

**Exit.**

- The fixture-page capture tests pass against the tool, including the 2x
  sharpness comparison.
- The live smoke passes through `chrome.debugger`, sharpness included.
- No capture path can hang: a refused relay command returns an error within
  its timeout, shown by a test.
- A 2x capture and its 1x twin compose to the same layout (same report
  geometry within rounding).
- `npm test`, `npm run test:integration` and `npm run test:compose` pass
  with the re-pinned runtime.
- The blind eval passes on the real tool, and Matt has looked at the sheet.

**Parked from milestone 1.**

- The card rule's 64 px height floor turns a compact real card into a
  `union` frame; re-check it when porting frame snap.
- A frame selector is checked to contain every target but not to fit the
  viewport.
- The renderer install: a test that a forced install really replaces what is
  there, a test that first install and upgrade do not force, and the
  remove-then-rename step that is not atomic.

### Milestone 3: the remaining primitives and imported panels

Merged on fast-browser `main`, 2026-10-13.

**Scope.** Everything compose does not draw yet.

- The marks `ghost`, `empty`, `bracket`, `loupe` and `link` (§3, §4), each
  with its layout rule (§5).
- The `pair` and `steps` layouts (§5): two panels for a pair, each with a
  label; two to four for steps; one shared height; a pair's frames shown
  whole and trimmed, a steps panel cropped to its marks.
- The lift, dot and crop rules of §5: the card placed where it hides the
  least, the dot on the least-struck spot of its side, a crop edge that
  keeps 12 px of clean lines inside it, and the warnings §2 lists.
- **Imported panels:** an import step that turns an image file into an
  imported capture (PNG conversion, a sidecar with `source: "import"`,
  `origin`, the original format, a digest, no measured boxes); panel-level
  `frame` and `boxes`; a frame that only shrinks (§5); the "From the ticket"
  label; the 12 px redaction pad; the full-resolution redaction crops. An
  import never replaces a live capture of the same name; it may replace an
  earlier import of that name.
- **The redaction gate's fast-browser half** (§6): compose writes
  `<stem>.redactions.json` for every board with a redaction on an imported
  panel, and `fast-browser compose --confirm <spec.json>` marks it
  confirmed, refusing a missing or changed crop. Milestone 4 owns asking
  Matt and refusing the upload.
- The relocation rule: a bundle copied to another folder renders the same
  board.
- The skill gains the new marks, the layouts, imported panels, reading the
  redaction crops, and the rule that an imported redaction is not done until
  Matt has confirmed it.
- Each primitive lands with its fixture and invariant first.

**Repos.** fast-browser only. No fork change, no runtime re-pin, no release.

**Files.** Owned by this milestone: `lib/compose/page-layout.js`,
`lib/compose/page-geometry.js`, `lib/compose/page.mjs`,
`lib/compose/spec.mjs`, `lib/compose/engine.mjs`, a new import module under
`lib/compose/`, `tests/e2e/compose-fixtures.test.mjs`,
`tests/e2e/compose-invariants.test.mjs`, `tests/e2e/helpers/invariants.mjs`,
and everything under `tests/fixtures/evidence/`. Shared with milestone 2,
see "Files both milestones touch".

**Exit.**

- Every primitive and layout in §4 has a fixture, holds its invariants and
  matches its golden.
- The imported-panel fixtures pass, including the 3x pair with equal
  rendered heights, the crops, and the record.
- `compose --confirm` refuses a missing crop and a changed crop, and a
  re-render resets a confirmed record; each shown by a test.
- A copied bundle renders the same board.
- `npm test`, `npm run test:integration` and `npm run test:compose` pass.
- The blind eval covers every primitive, including a ticket screenshot with
  a declared redaction that holds, and Matt has looked at the sheet.

**Left open.** The layout follow-up below takes the first three.

- A link's crop can cut off the heading or label that names one of its two
  places.
- The two frames of a pair can start a row apart when their selectors
  differ, and a loosely framed pair is drawn small; the small-panel warning
  is the only answer.
- A bracket over short rows that are full-width elements stands beside
  their boxes, far from their text.
- A row or column just outside an imported frame can show as a line one
  device pixel thick at the frame's right or bottom edge. It cannot carry a
  readable character.
- The routing function still mixes choosing sides with drawing; split it
  after milestone 2 threads its scale factor through the same file.
- The dot's 6 px corner inset has no test of its own.
- For milestone 4's handoff: a gated render that fails early removes the
  earlier board of that name, a confirmed one included; and a spec that
  loses its redaction, then fails to render, leaves the earlier gated board
  with no crops and no record.

### Files both milestones touch

Milestones 2 and 3 run in parallel on separate branches of fast-browser.
Each of these files has one owner; the other milestone makes only the change
named here and rebases onto the owner's version if it lands second.

| File | Owner | The other milestone's change |
|---|---|---|
| `lib/compose/page-layout.js`, `lib/compose/page-geometry.js` | 3 | 2 threads one `scale` factor through the source-pixel constants and nothing else |
| `lib/compose/capture.mjs` | 2 | 3 adds reading a `source: "import"` sidecar |
| `lib/commands/compose.mjs` | 3 | 2 replaces the `scale` refusal with support for 1 and 2, and removes the `--seal` branch |
| `lib/cli/parse-args.mjs`, `lib/cli/main.mjs` | 3 (adds `--confirm` and import) | 2 removes `--seal` |
| `skills/composing-evidence/SKILL.md` | 3 | 2 rewrites only "Capture", "Check the return" and "Seal" |
| `tests/e2e/compose-fixtures.test.mjs` | 3 | 2 changes only the line that loads the capture script, and how the return becomes a sidecar once `--seal` is gone |
| `tests/fixtures/evidence/goldens/` | 3 | 2 adds no golden and changes none; a 2x capture is checked by geometry, not by a new golden |
| `package.json` | neither | each adds only its own script lines |

`runtime-lock.json` belongs to milestone 2 alone; milestone 3 does not touch
the lock, the renderer or setup.

### Layout follow-up

Runs after milestones 2 and 3 are both on `main`. fast-browser only.

**Layout faults to fix.** Named on the two sign-off sheets and agreed by
Matt, in generic terms:

- Nothing is enlarged on a 2x capture: lifts come out the size of the page
  behind them, labels are larger than the evidence, and the dimmed page is
  still scaled up and soft.
- A lift takes a whole header or a full-width row where the fact is a few
  words of it.
- A lift overhangs the frame's edge, with its dot on the frame's border.
- A lift covers part of the line above or below it, or half of a
  neighbouring element, and its own rounded border is cut off at an edge.
- Stray divider hairlines ride along the top and bottom of a lifted card.
- A tick or icon that belongs to a lifted line stays outside the card,
  dimmed, or the lift's edge cuts through it.
- Two lifts on one board come out at very different sizes, so the lesser
  point is the louder one.
- Leaders do not match: on one board one drops below its panel and another
  runs right; labels of a pair or of steps sit on different sides; a leader
  or a connector runs most of the board's width or the long way round; a
  leader steps a few pixels just before its label or lens.
- A dot rests on the row beside its lift, or beside a redaction fill so that
  it reads as pointing at the fill.
- Two redaction fills merge into one heavy block, a fill sits flush against
  a slot's outline or under a lift where it reads as a shadow, and the same
  field is filled at different sizes on the two sides of a pair.
- A link's crop cuts off the name of one of its places.
- A bracket stands far from short rows that are full-width elements.
- The two frames of a pair start a row apart, and only one of the two
  panels is washed.
- Whole-page panels are drawn small, a pair or steps board comes out very
  wide and short, and steps panels of one board differ in scale.
- A crop leaves a heading flush against its edge, an empty band or a stray
  rule along one side, or a thin line of the neighbouring column; a steps
  crop edge cuts words in half.
- On a dark page the bracket and leaders are dim against the card.

**Merge work both lanes listed.**

- Scale is per panel, not per board: a board may mix a 1x and a 2x panel,
  with a mixed-scale test.
- A compose and a compose `--confirm` that overlap on one board name can
  leave an older confirmed record beside a newer board (found in review; the
  stale record already fails its hash check). Decide on a lock per board
  name.
- The blind eval left a street address visible on a board because the driver
  did not redact it. The composing skill must tell the driver to redact
  personal details that fall inside the frame (addresses, phone numbers,
  emails, names where they are not the point) even when the brief does not
  list them.
- The capture-pixel constants milestone 3 added (§5) and the invariants
  helper are multiplied by `scale`, so every rule holds on a 2x capture as
  on its 1x twin.
- An imported sidecar is read before the well-formed-boxes check, since it
  carries no measured boxes.

**Then** rerun the blind eval on the real app, a fresh Sonnet driver with
only the skill, at the bar in "Testing as we build".

**Exit.** Every board in that eval scores at least 4, the rest of the bar
holds, `npm test`, `npm run test:integration` and `npm run test:compose`
pass, and Matt has looked at the sheet.

### Milestone 4: pipeline wiring

The brief in stage-evidence and ship; board bundles copied into the run's
evidence folder; standalone before boards at stage-evidence; pair boards at
ship replacing them under evidence-record's new merge rule; uploads deduped
by path; the new flow in the plugin's skills; imported ticket befores; the
revise path in stage-evidence, ship, and standalone `ship` after a run has
shipped.

**The redaction gate's pipeline half** (§6): the stage shows Matt each
redaction crop of a board with an imported panel and runs
`fast-browser compose --confirm` on his yes; the upload path refuses a board
whose `<stem>.redactions.json` is missing, unconfirmed, or names a changed
crop. The revise path asks again after every re-render.

**Every label carries a tag and a description.** Compose and the composing
skill stay generic, so there a label's title, description (the `note`
field) and tag remain optional abilities (§3). Verification evidence is
stricter: the stage-evidence and ship briefs must always write both on every
label.

- A **tag**, so a reviewer sees the verdict at once.
- A **description** that asserts the outcome: what was added that was not
  there before, or which bug is fixed that was previously not working, and
  whether verification is complete.

On a `steps` board the tag and description sit on each step (the panel's
`tag` and `note`), and a mark inside a step may carry no text. On `single`
and `pair` boards they sit on each mark.

**Who owns what.** Browser evidence has three layers, and each owns only its
own part.

| Layer | Owns |
|---|---|
| Fast Browser (public, any agent) | capture, compose and the composing-evidence skill: framing, marks, redaction fills, layout |
| mattstack (evidence inside a run) | when to capture (befores at stage-evidence, afters at ship), the board brief and its tag and description rule, delegating to the driver, reading the board back, the redaction gate, revise, copying bundles into the evidence folder, recording, upload and dedupe, closing the run's tabs |
| Team pack (its app) | the browser target section of its evidence fill |

mattstack never teaches drawing: the driver follows Fast Browser's
composing-evidence skill. The mattstack layer is one shared text, written
once and included by stage-evidence, stage-ship and ship. It runs only when
the pack's fill picks a browser screenshot for a case. review and
self-review include it too, for one path only: a `repro`-depth review whose
evidence check is a screenshot composes a local board, cited by path and
never recorded or uploaded. A pack that never
takes browser screenshots does not change. Evidence that is not a browser
screenshot (backend data, script output) stays the pack's own method.

The **browser target section** holds four blocks and no procedure:

1. **Reach the view:** which dev servers must run and how to start them, how
   to sign in (a saved login, or ask the developer), how to build the URL,
   and how to put the record into the state the evidence needs.
2. **What proves a change:** per kind of change the team ships, which view
   and which elements show it, and any intake question asked before capture.
3. **Captions:** the domain's wording rules, such as using the page's own
   field names.
4. **Personal data:** which fields are always hidden, and which test data may
   show. The brief passes this list to the driver.

A team's own pipeline step cannot include the shared text (includes are
mattstack-only). If one ever needs it, the shared text is promoted to an
engine with its own slot; the four blocks stay what the pack fills.

**Rollout order.** Team packs go live as soon as they are committed, so the
pack edits follow the mattstack release: merge the mattstack PR, cut the
release, then edit the pack (Matt approves the edit; no mattstack ticket ids
or internal references on a pack), recompile, and run it. Until that edit,
a pack keeps working on its own text, since the shared text runs only
when a fill points at it.

**Tests for this part.** A RED and GREEN run for every changed skill. Every
pack compiles; an opted-in pack's compiled stage-evidence holds the shared
text and its four blocks; a pack with no browser evidence compiles unchanged
apart from shared text it never reaches. A fresh Sonnet driver following an opted-in
pack's compiled text against a fixture page produces a board with a tag and a
description on every label, and a steps board does the same once Fast
Browser ships the panel `tag` and `note`. One real run of an opted-in
pack's compiled stage-evidence on Matt's Chrome against a real case, asked first.

Exit: one real pipeline run produces composed evidence on an MR, including
one before/after board whose before came from the ticket and whose
redactions Matt confirmed at the gate; that run's boards carry a tag and a
description on every label; an upload of an unconfirmed board is refused;
and one board is then revised in a fresh session with no browser and the
revised board appears on the MR.

### Not planned

Parked in milestone 1 and dropped, each with its reason.

- Look-only notes on fixture boards (a long connector on the chip grid,
  merged rings on the tiny chips, the nested-cards look, the empty band
  above the start tab, a crop edge resting on a card border, a lift clipping
  a pill's rounded end, a dot warning on the split pill): none failed the
  pass bar. Milestone 3 fixes one only if its blind eval scores a board
  below the bar because of it.
- The redaction pill's measurement and position, and leader scoring that
  ignored the pill: the pill no longer exists.
- The dot's ground sampled as a square: the shipped check samples a disc.
- A duplicate overlap helper, an unused test import, and re-testing an edge
  after it reverts: already fixed in the shipped code.
- A friendlier message when the renderer's executable path is empty: an
  install that reads ready has its executable, and the engine refuses an
  empty path.
- A stronger test for the doctor check's output cap: the cap is one line and
  the existing test covers it not throwing.
- Formatting slips: no behaviour.

## Open questions

- **Haiku as the driver.** Decided by the blind eval, not in advance.
- **Fate of `annotate`.** It stays for foreign images outside the evidence
  flow. Whether its SVG renderer is replaced by the compose engine (one
  renderer for both) is not part of milestones 2 to 4.
- **Theme pairs.** Capturing light then dark means toggling the app's theme
  between calls; whether the capture tool owns that or the driver does is
  left open after milestone 3; the layout follow-up or milestone 4 settles it.
- **Platforms.** The renderer is pinned for macOS only (`mac-arm64`,
  `mac-x64`). Compose on another platform is not in any milestone.
