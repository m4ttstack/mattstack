// packages/mod-kit/src/draw/cells.ts
var segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
var PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
var EMOJI = /\p{Emoji_Presentation}|\u20E3/u;
var EMOJI_BASE_WITH_VS16 = /^(?![A-Za-z])\p{Emoji}\uFE0F/u;
var ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]/u;
var WIDE_RANGES = [
  [4352, 4447],
  [9001, 9002],
  [11904, 12350],
  [12353, 13311],
  [13312, 19903],
  [19968, 40959],
  [40960, 42191],
  [43360, 43391],
  [44032, 55203],
  [63744, 64255],
  [65072, 65135],
  [65280, 65376],
  [65504, 65510],
  [131072, 262141]
];
function graphemeWidth(grapheme) {
  if (EMOJI.test(grapheme) || EMOJI_BASE_WITH_VS16.test(grapheme))
    return 2;
  const first = grapheme.codePointAt(0) ?? 0;
  if (ZERO_WIDTH.test(grapheme))
    return 0;
  return WIDE_RANGES.some(([lo, hi]) => first >= lo && first <= hi) ? 2 : 1;
}
var graphemes = (text) => Array.from(segmenter.segment(text), (part) => part.segment);
function cellWidth(text) {
  if (PRINTABLE_ASCII.test(text))
    return text.length;
  return graphemes(text).reduce((n, grapheme) => n + graphemeWidth(grapheme), 0);
}
function cutCells(text, cells) {
  if (PRINTABLE_ASCII.test(text))
    return text.slice(0, Math.max(0, cells));
  let used = 0;
  let out = "";
  for (const grapheme of graphemes(text)) {
    used += graphemeWidth(grapheme);
    if (used > cells)
      break;
    out += grapheme;
  }
  return out;
}
function tailCells(text, cells) {
  if (PRINTABLE_ASCII.test(text))
    return cells <= 0 ? "" : text.slice(-cells);
  let used = 0;
  let out = "";
  for (const grapheme of graphemes(text).reverse()) {
    used += graphemeWidth(grapheme);
    if (used > cells)
      break;
    out = grapheme + out;
  }
  return out;
}
function chunkCells(text, cells) {
  const out = [];
  let piece = "";
  let used = 0;
  for (const grapheme of graphemes(text)) {
    const w = graphemeWidth(grapheme);
    if (used + w > cells && piece !== "") {
      out.push(piece);
      piece = "";
      used = 0;
    }
    piece += grapheme;
    used += w;
  }
  out.push(piece);
  return out;
}
function padCells(text, cells) {
  return text + " ".repeat(Math.max(0, cells - cellWidth(text)));
}
function firstGrapheme(text) {
  return segmenter.segment(text)[Symbol.iterator]().next().value?.segment ?? "";
}

// packages/mod-kit/src/draw/text.ts
function sp(t, style = {}) {
  return { t, ...style };
}
function withAction(lines, action) {
  for (const line of lines)
    line.action = action;
  return lines;
}
function widthOf(spans) {
  return spans.reduce((n, span) => n + cellWidth(span.t), 0);
}
function spanAt(line, x) {
  let from = 0;
  for (const span of line) {
    const to = from + cellWidth(span.t);
    if (span.action !== undefined && x >= from && x < to)
      return span;
    from = to;
  }
  return;
}
function hitAt(line, x) {
  if (!line)
    return;
  return spanAt(line, x)?.action ?? line.action;
}
var actionKey = (action) => JSON.stringify(action);
function spanHoverKey(span, row) {
  return span.action === undefined ? undefined : `${row}:${actionKey(span.action)}`;
}
function lineHoverKey(line) {
  return line.action === undefined ? undefined : actionKey(line.action);
}
function hoverKeyAt(lines, row, x) {
  const line = lines[row];
  if (!line)
    return;
  const span = spanAt(line, x);
  return span ? spanHoverKey(span, row) : lineHoverKey(line);
}
function wrap(text, width) {
  const out = [];
  for (const raw of text.split(`
`)) {
    let row = "";
    for (const word of raw.split(" ")) {
      const next = row === "" ? word : `${row} ${word}`;
      if (cellWidth(next) > width && row !== "") {
        out.push(row);
        row = word;
      } else
        row = next;
      if (cellWidth(row) > width) {
        const pieces = chunkCells(row, width);
        out.push(...pieces.slice(0, -1));
        row = pieces.at(-1) ?? "";
      }
    }
    out.push(row);
  }
  return out;
}
function hang(first, rest, text, width, style = {}) {
  const room = Math.max(10, width - widthOf(first));
  return wrap(text, room).map((row, n) => [...n === 0 ? first : rest, sp(row, style)]);
}
// packages/mod-kit/src/draw/theme.ts
var SYMBOL = {
  start: "┌",
  bar: "│",
  end: "└",
  active: "◆",
  submit: "◇",
  cancel: "■",
  warn: "▲",
  radioOn: "●",
  radioOff: "○",
  boxActive: "◻",
  boxOn: "◼",
  boxOff: "◻",
  selectEdge: "▎"
};
var ICON = {
  layers: "",
  done: "",
  todo: "",
  missing: "",
  back: "",
  next: "",
  collapse: "",
  chat: "",
  single: "\uDB81\uDC3E",
  multi: "\uDB80\uDD38",
  text: "\uDB81\uDE0E",
  review: "",
  edit: "",
  info: ""
};
var BRAND = { pink: "#FF6B9D", pinkDeep: "#e9578b", plum: "#161224", glyph: ICON.layers };
var FILL = {
  primary: { bg: "#2f9e5b", color: "black" },
  secondary: { bg: "#2b4a6b", color: "white" },
  neutral: { bg: "#4a4a4a", color: "white" },
  caution: { bg: "#b8902e", color: "black" },
  chip: { bg: "#3a3a3a", color: "white" },
  current: { bg: "#3aa8b8", color: "black" },
  disabled: { bg: "#262626", color: "#5c5c5c" },
  field: { bg: "#2c2c2c", color: "white" },
  brand: { bg: BRAND.pink, color: BRAND.plum }
};
var SCROLL = { track: "#383838", thumb: "#707070" };
var PLACEHOLDER = { color: "#7a7a7a" };
var HOVER_FILL = {
  [BRAND.pink]: "#ff94b9",
  [BRAND.pinkDeep]: "#f57ba6",
  [FILL.primary.bg]: "#45c275",
  [FILL.secondary.bg]: "#3b6896",
  [FILL.neutral.bg]: "#666666",
  [FILL.caution.bg]: "#d6aa45",
  [FILL.chip.bg]: "#555555",
  [FILL.current.bg]: "#5fcfdc"
};
var PRESS_FILL = {
  [BRAND.pink]: "#ea5d8c",
  [BRAND.pinkDeep]: "#d84a7d",
  [FILL.primary.bg]: "#288a4f",
  [FILL.secondary.bg]: "#26425f",
  [FILL.neutral.bg]: "#424242",
  [FILL.caution.bg]: "#a58127",
  [FILL.chip.bg]: "#333333",
  [FILL.current.bg]: "#3394a2"
};
var QUIET = { label: "#e0e0e0", rest: "#363636", hover: "#4a4a4a", press: "#404040", muted: "#999999" };
function hoverOf(span) {
  if (span.quiet)
    return { ...span, bg: QUIET.hover, color: "white" };
  if (span.chip)
    return { ...span, bg: span.chip };
  return span.bg ? { ...span, bg: HOVER_FILL[span.bg] ?? span.bg } : { ...span, bg: "#404040", dim: false };
}
function pressOf(span) {
  if (span.quiet)
    return { ...span, bg: QUIET.press, color: "white" };
  if (span.chip)
    return { ...span, bg: PRESS_FILL[span.chip] ?? span.chip };
  return span.bg ? { ...span, bg: PRESS_FILL[span.bg] ?? span.bg } : { ...span, bg: "#353535", dim: false };
}
function hovered(span) {
  const out = hoverOf(span);
  return span.mark ? { ...out, color: span.mark } : out;
}
function pressed(span) {
  const out = pressOf(span);
  return span.mark ? { ...out, color: span.mark } : out;
}
function keySelected(span) {
  if (!span.t.startsWith(" "))
    return [span];
  const edge = span.bg === BRAND.pink || span.bg === BRAND.pinkDeep ? "white" : BRAND.pink;
  return [
    { ...span, t: SYMBOL.selectEdge, color: edge, mark: edge, bold: false, dim: false },
    { ...span, t: span.t.slice(1) }
  ];
}
var ACCENT = { color: "cyan" };
var GRAY = { color: "gray" };
var DONE = { color: "green" };
var WARN = { color: "yellow" };
var DIM = { dim: true };
var rail = (style) => [sp(SYMBOL.bar, style), sp("  ")];
var MUTED = { cyan: "#62a4b0", green: "#72b072", yellow: "#baa75c", red: "#c46e6e", gray: "#6e6e6e", [BRAND.pink]: "#b05680" };
var MUTED_FILL = { [BRAND.pink]: { bg: "#9e5270", color: "#1f1a2b" }, [BRAND.pinkDeep]: { bg: "#884465", color: "#1f1a2b" }, [FILL.secondary.bg]: { bg: "#334659", color: "#b8b8b8" }, [FILL.disabled.bg]: FILL.disabled, [FILL.field.bg]: { bg: "#323232", color: "#b8b8b8" }, [SCROLL.track]: { bg: "#353535" }, [SCROLL.thumb]: { bg: "#646464" } };
function muted(span) {
  if (span.mark)
    return { ...span, color: MUTED[span.mark] ?? span.mark, dim: false };
  if (span.quiet)
    return { ...span, color: QUIET.muted, dim: false };
  if (span.bg)
    return { ...span, ...MUTED_FILL[span.bg] ?? { bg: "#4a4a4a", color: "#b8b8b8" }, dim: false };
  if (span.color)
    return { ...span, color: MUTED[span.color] ?? span.color, dim: false };
  return { ...span, color: span.dim ? "#808080" : "#b8b8b8", dim: false };
}
// packages/mod-kit/src/widgets/brand-bar.ts
var fit = (text, room) => padCells(cellWidth(text) <= room ? text : `${cutCells(text, Math.max(0, room - 1))}…`, room);
function brandBar(label, width, hide) {
  const look = { bg: BRAND.pink, color: BRAND.plum, bold: true };
  const text = `  ${BRAND.glyph}  ${label}`;
  if (hide === undefined)
    return [sp(fit(text, width), look)];
  const button = ` Hide ${ICON.collapse} `;
  return [sp(fit(text, width - cellWidth(button) - 1), look), sp(button, { ...look, chip: BRAND.pinkDeep, action: hide }), sp(" ", look)];
}
// packages/mod-kit/src/widgets/buttons.ts
var TONE_FILL = { primary: FILL.primary, secondary: FILL.secondary, neutral: FILL.neutral, caution: FILL.caution, brand: FILL.brand, quiet: { color: QUIET.label, bg: QUIET.rest, quiet: true } };
var ROOMY = { indent: 3, pad: 2, gap: 2 };
var COMPACT = { indent: 1, pad: 1, gap: 1 };
function buttonSpan(button, pad = ROOMY.pad) {
  const fill = button.disabled ? FILL.disabled : TONE_FILL[button.tone ?? "secondary"];
  const edge = " ".repeat(pad);
  return sp(`${edge}${button.label}${edge}`, { ...fill, bold: !button.disabled && button.tone !== "quiet", ...!button.disabled && { action: button.action } });
}
var widthWith = (left, right, { indent, pad, gap }) => indent + left.reduce((n, button) => n + cellWidth(button.label) + 2 * pad + gap, 0) + (right ? gap + cellWidth(right.label) + 2 * pad : 0);
var cut = (label, room) => cellWidth(label) <= room ? label : `${cutCells(label, Math.max(0, room - 1))}…`;
function buttonRow(left, right, width, indent) {
  const roomy = { ...ROOMY, indent: indent ?? ROOMY.indent };
  const space = widthWith(left, right, roomy) <= width ? roomy : { ...COMPACT, indent: indent ?? COMPACT.indent };
  const line = [sp(" ".repeat(space.indent))];
  for (const button of left)
    line.push(buttonSpan(button, space.pad), sp(" ".repeat(space.gap)));
  if (!right)
    return line;
  const room = width - widthOf(line) - space.gap - 2 * space.pad;
  const end = buttonSpan({ ...right, label: cut(right.label, Math.max(1, room)) }, space.pad);
  line.push(sp(" ".repeat(Math.max(space.gap, width - widthOf(line) - cellWidth(end.t)))), end);
  return line;
}
// packages/mod-kit/src/widgets/menu.ts
var MORE_ACTIONS = "More actions ▾";
var CONNECTOR = 2;
var GROUP_INDENT = 2;
var cut2 = (text, room) => cellWidth(text) <= room ? text : `${cutCells(text, Math.max(0, room - 1))}…`;
var closed = (state) => ({ open: false, selected: state.selected });
function groupedFlags(rows) {
  let inGroup = false;
  return rows.map((row) => {
    if (row.isHeading) {
      inGroup = true;
      return false;
    }
    return inGroup;
  });
}
function nextPickable(rows, from, step) {
  for (let n = 1;n <= rows.length; n += 1) {
    const at = ((from + step * n) % rows.length + rows.length) % rows.length;
    if (!rows[at].isHeading)
      return at;
  }
  return from;
}
var firstPickable = (rows) => Math.max(0, rows.findIndex((row) => !row.isHeading));
function menu(spec) {
  const act = spec.actionFor ?? ((hit) => hit);
  const indent = spec.indent ?? 0;
  const button = buttonSpan({ label: spec.label, action: act({ type: "toggle" }), tone: "quiet" });
  const head = [sp(" ".repeat(indent)), ...spec.isSelected ? keySelected(button) : [button]];
  if (!spec.open || spec.rows.length === 0)
    return [head];
  const width = spec.width ?? Number.POSITIVE_INFINITY;
  const grouped = groupedFlags(spec.rows);
  const widest = Math.max(...spec.rows.map((row, i) => cellWidth(row.label) + (grouped[i] ? GROUP_INDENT : 0)));
  const at = Math.max(0, Math.min(indent, width - CONNECTOR - widest));
  const room = Math.max(1, width - at - CONNECTOR);
  const lead = sp(" ".repeat(at));
  const rowLine = (row, i) => {
    const connector = sp(i === spec.rows.length - 1 ? "└ " : "├ ", GRAY);
    if (row.isHeading)
      return [lead, connector, sp(cut2(row.label, room), DIM)];
    const pad = grouped[i] ? sp(" ".repeat(GROUP_INDENT)) : undefined;
    const look = i === spec.selected ? { ...ACCENT, bold: true } : {};
    const label = sp(cut2(row.label, room - (pad ? GROUP_INDENT : 0)), { ...look, action: act({ type: "row", at: i }) });
    return [lead, connector, ...pad ? [pad] : [], spec.pressing && i === spec.selected ? pressed(label) : label];
  };
  return [head, ...spec.rows.map(rowLine)];
}
function menuKey(state, rows, key) {
  const isEnter = key === "return" || key === "enter";
  if (!state.open)
    return isEnter && rows.some((row) => !row.isHeading) ? { state: { open: true, selected: firstPickable(rows) } } : undefined;
  if (key === "escape" || key === "esc" || key === "backspace" || key === "left")
    return { state: closed(state) };
  if (key === "up" || key === "down")
    return { state: { open: true, selected: nextPickable(rows, state.selected, key === "up" ? -1 : 1) } };
  const row = rows[state.selected];
  if (isEnter && row && !row.isHeading)
    return { state: closed(state), picked: row.id };
  return;
}
function menuHit(state, rows, hit) {
  if (hit.type === "toggle")
    return { state: state.open ? closed(state) : { open: true, selected: firstPickable(rows) } };
  const row = rows[hit.at];
  if (!row || row.isHeading)
    return { state };
  return { state: { open: false, selected: hit.at }, picked: row.id };
}
// packages/mod-kit/src/widgets/scroll-bar.ts
function scrollBar(rows, total, offset) {
  if (total <= rows)
    return Array.from({ length: rows }, () => [sp("   ")]);
  const size = Math.max(1, Math.round(rows * rows / total));
  const at = Math.min(Math.max(0, offset), total - rows);
  const top = Math.round(at / (total - rows) * (rows - size));
  return Array.from({ length: rows }, (_, n) => [sp(" "), sp(" ", { bg: n >= top && n < top + size ? SCROLL.thumb : SCROLL.track }), sp(" ")]);
}
// packages/mod-kit/src/widgets/input-field.ts
function inputField(value, placeholder, width, showCursor) {
  const room = width - 2;
  const box = (spans) => [
    sp(" ", FILL.field),
    ...spans.map((span) => ({ ...span, bg: FILL.field.bg })),
    sp(" ".repeat(Math.max(0, width - 1 - widthOf(spans))), FILL.field)
  ];
  if (value === "") {
    const hint = cutCells(placeholder, room);
    const head = firstGrapheme(hint);
    return box([sp(head || " ", showCursor ? { ...PLACEHOLDER, inverse: true } : PLACEHOLDER), sp(hint.slice(head.length), PLACEHOLDER)]);
  }
  const shown = cellWidth(value) >= room ? tailCells(value, room - 1) : value;
  return box([sp(shown, { color: FILL.field.color }), ...showCursor ? [sp(" ", { color: FILL.field.color, inverse: true })] : []]);
}

// packages/mod-kit/src/widgets/select-list.ts
function selectList(spec) {
  const max = spec.maxShown ?? 8;
  const total = spec.choices.length;
  const start = total <= max ? 0 : Math.min(Math.max(0, spec.cursor - Math.floor(max / 2)), total - max);
  const shown = spec.choices.slice(start, start + max);
  const bar = sp(SYMBOL.bar, ACCENT);
  const lines = [];
  const padded = (rows) => [...rows, ...Array.from({ length: Math.max(0, 2 - rows.length) }, () => [bar])];
  if (start > 0)
    lines.push([bar, sp(`  ↑ ${start} more`, DIM)]);
  shown.forEach((choice, n) => lines.push(...withAction(padded(choiceRows(choice, start + n, spec)), spec.actionFor(start + n))));
  const below = total - start - shown.length;
  if (below > 0)
    lines.push([bar, sp(`  ↓ ${below} more`, DIM)]);
  return lines;
}
function choiceMark(spec, idx) {
  const isAt = idx === spec.cursor;
  if (!spec.multi)
    return isAt ? spec.cursorIsChoice ? sp(SYMBOL.radioOn, DONE) : sp(SYMBOL.radioOff, ACCENT) : sp(SYMBOL.radioOff, DIM);
  if (spec.isPicked(idx))
    return sp(SYMBOL.boxOn, DONE);
  return isAt ? sp(SYMBOL.boxActive, ACCENT) : sp(SYMBOL.boxOff, DIM);
}
function choiceRows(choice, idx, spec) {
  const bar = sp(SYMBOL.bar, ACCENT);
  const lead = [bar, sp("  "), choiceMark(spec, idx), sp(" ")];
  const under = [bar, sp("    ")];
  const isAt = idx === spec.cursor;
  const rows = choiceLines(choice, idx, spec, lead, under);
  if (!isAt || !spec.pressing)
    return rows;
  return rows.map((line) => line.map((span) => span.isLabel ? pressed(span) : span));
}
function choiceLines(choice, idx, spec, lead, under) {
  const isAt = idx === spec.cursor;
  if (choice.isWriteIn)
    return writeInRows(choice, isAt, lead, under, spec);
  return [...hang(lead, under, choice.label, spec.width, { isLabel: true, ...isAt && { bold: true } }), ...choice.description ? hang(under, under, choice.description, spec.width, DIM) : []];
}
function writeInRows(choice, isAt, lead, under, spec) {
  const label = [...lead, sp(`${ICON.edit} `, ACCENT), sp(choice.label, { isLabel: true, ...isAt && { bold: true } })];
  const typed = spec.writeIn;
  if (isAt)
    return [label, [...under, ...inputField(typed, choice.description ?? "", spec.width - widthOf(under), spec.focused)]];
  if (typed !== "")
    return [label, ...hang(under, under, `“${typed}”`, spec.width, {})];
  return [label, ...choice.description ? hang(under, under, choice.description, spec.width, DIM) : []];
}
// packages/mod-kit/src/widgets/tab-strip.ts
function fillWindow(seed, first, count, room, cost) {
  let lo = seed;
  let hi = seed;
  let used = cost(seed);
  const right = () => hi + 1 < count && used + cost(hi + 1) <= room && (used += cost(++hi), true);
  const left = () => lo > 0 && used + cost(lo - 1) <= room && (used += cost(--lo), true);
  while (first === "right" ? right() || left() : left() || right())
    ;
  return { lo, hi };
}
function tabText(tab, room) {
  if (!tab)
    return "";
  const text = tab.mark ? `${tab.mark} ${tab.label}` : tab.label;
  const limit = Math.max(1, room - 2);
  return cellWidth(text) <= limit ? text : `${cutCells(text, limit - 1)}…`;
}
var MARK_WIDTH = 5;
var STRIP_CHROME = 3 + 2 * MARK_WIDTH + 2;
var CHIP = { ...FILL.chip, bold: true };
function scrollMark(side, hidden, action) {
  const arrow = side === "left" ? "‹" : "›";
  const label = hidden === 0 ? ` ${arrow} ` : side === "left" ? ` ${arrow} ${hidden} ` : ` ${hidden} ${arrow} `;
  const text = side === "left" ? label.padEnd(MARK_WIDTH) : label.padStart(MARK_WIDTH);
  return hidden > 0 ? sp(text, { ...CHIP, action }) : sp(text, DIM);
}
function windowFiller(tabs, width) {
  const room = width - STRIP_CHROME;
  const cost = (k) => cellWidth(tabText(tabs[k], room)) + 2;
  return (seed, first) => fillWindow(Math.max(0, Math.min(tabs.length - 1, seed)), first, tabs.length, room, cost);
}
function revealTab(tabs, current, width, from) {
  const fill = windowFiller(tabs, width);
  const shown = fill(from, "right");
  if (current > shown.hi)
    return fill(current, "right").lo;
  if (current < shown.lo)
    return fill(current, "left").lo;
  return shown.lo;
}
function tabStrip(spec) {
  const { tabs, current } = spec;
  const fill = windowFiller(tabs, spec.width);
  const { lo, hi } = fill(spec.from, "right");
  const line = [...rail(GRAY), scrollMark("left", lo, spec.scrollTo(lo - 1)), sp(" ")];
  for (let k = lo;k <= hi; k += 1) {
    const tab = tabs[k];
    if (!tab)
      continue;
    const look = k === current ? FILL.current : tab.isDone ? DONE : DIM;
    line.push(sp(` ${tabText(tab, spec.width - STRIP_CHROME)} `, { ...look, action: tab.action }));
  }
  const after = tabs.length - 1 - hi;
  line.push(sp(" ".repeat(Math.max(1, spec.width - widthOf(line) - MARK_WIDTH))), scrollMark("right", after, spec.scrollTo(lo + 1)));
  return line;
}
// packages/mod-kit/src/widgets/text-cursor.ts
function textCursor(value, placeholder, showCursor) {
  if (!showCursor)
    return value === "" ? [sp(placeholder, DIM)] : [sp(value)];
  if (value === "") {
    const head = firstGrapheme(placeholder);
    return [sp(head, { inverse: true }), sp(placeholder.slice(head.length), DIM)];
  }
  return [sp(value), sp(" ", { inverse: true })];
}
// packages/mod-kit/src/interact/grid.ts
function gridMove(rows, here, ev, options = {}) {
  if (rows.length === 0)
    return { handled: false };
  const tab = options.tabSteps === true && ev.key === "tab";
  const step = ev.key === "up" || tab && ev.shift ? -1 : ev.key === "down" || tab ? 1 : 0;
  if (step !== 0) {
    const at = Math.min(Math.max(0, here.at + step), rows.length - 1);
    return at === here.at ? { handled: true } : { handled: true, to: { at, col: rows[at].main } };
  }
  if (ev.key === "left" || ev.key === "right") {
    const col = here.col + (ev.key === "left" ? -1 : 1);
    return col >= 0 && col < (rows[here.at]?.ids.length ?? 0) ? { handled: true, to: { at: here.at, col } } : { handled: true };
  }
  return { handled: false };
}
function gridLook(span, focus) {
  const base = focus.pressing ? pressed(span) : span;
  return focus.marked ? keySelected(base) : [base];
}
// packages/mod-kit/src/interact/pointer.ts
function lookOf(state, focused) {
  const hover = state?.hover;
  const held = state?.pressed;
  return { focused, hover, pressed: held === hover ? held : undefined };
}
var labelOf = (text) => text.split(SYMBOL.selectEdge).join("").trim();
function runOf(line, n) {
  const armed = JSON.stringify(line[n].action);
  const carries = (m) => line[m]?.action !== undefined && JSON.stringify(line[m].action) === armed;
  let first = n;
  let last = n;
  while (carries(first - 1))
    first--;
  while (carries(last + 1))
    last++;
  return { armed, label: labelOf(line.slice(first, last + 1).map((s) => s.t).join("")) };
}
function controlAt(line, x) {
  if (!line)
    return;
  let from = 0;
  for (let n = 0;n < line.length; n++) {
    const to = from + cellWidth(line[n].t);
    if (line[n].action !== undefined && x >= from && x < to)
      return runOf(line, n);
    from = to;
  }
  return line.action === undefined ? undefined : { armed: JSON.stringify(line.action), label: labelOf(line.map((s) => s.t).join("")) };
}
function drawnAction(lines, held) {
  for (const line of lines) {
    if (line.action !== undefined && JSON.stringify(line.action) === held.armed && labelOf(line.map((s) => s.t).join("")) === held.label)
      return line.action;
    for (let n = 0;n < line.length; n++) {
      const run = line[n].action === undefined ? undefined : runOf(line, n);
      if (run && run.armed === held.armed && run.label === held.label)
        return line[n].action;
    }
  }
  return;
}
function attachPointer(surface, lines, opts) {
  const s = surface.state;
  const look = lookOf(s, opts.focused);
  if (s === undefined)
    return { look };
  const isActive = opts.isActive ?? (() => true);
  surface.onPointer((ev) => {
    const key = hoverKeyAt(lines, ev.y, ev.x);
    if (ev.type === "down") {
      opts.onEngage?.();
      if (!opts.focused || ev.button !== "left" || !key || !isActive())
        return;
      const held = controlAt(lines[ev.y], ev.x);
      return surface.setState({ ...s, pressed: key, hover: key, armed: held?.armed, label: held?.label, pressAt: `${ev.x},${ev.y}` });
    }
    if (ev.type === "up") {
      if (s.pressed === undefined)
        return;
      const { armed, label, pressAt } = s;
      surface.setState({ ...s, pressed: undefined, armed: undefined, label: undefined, pressAt: undefined });
      if (armed === undefined || label === undefined)
        return;
      const here = controlAt(lines[ev.y], ev.x);
      const isSame = here !== undefined && here.armed === armed && here.label === label;
      const isStill = s.hover === s.pressed && pressAt === `${ev.x},${ev.y}`;
      const action = isSame ? hitAt(lines[ev.y], ev.x) : isStill ? drawnAction(lines, { armed, label }) : undefined;
      if (action !== undefined)
        opts.onAction(action);
      return;
    }
    const next = ev.type === "leave" ? undefined : key;
    if (next !== s.hover && isActive())
      surface.setState({ ...s, hover: next });
  });
  return { look };
}

// packages/mod-kit/src/components/core.tsx
var current;
function rendering(tag) {
  if (!current)
    throw new Error(`kit: <${tag}> draws only inside kitClient`);
  return current;
}
function drawKit(frame, draw) {
  const outer = current;
  const render = { ...frame, entries: new Map, next: 0, handlers: new Map };
  current = render;
  try {
    const tree = draw();
    return { tree, lines: render.lines ?? [], handlers: render.handlers };
  } finally {
    current = outer;
  }
}
function kitComponent(tag, toLines) {
  const component = (props) => {
    const render = rendering(tag);
    const key = `kit:${render.next++}`;
    render.entries.set(key, { component: kit, props });
    const { Box } = render.elements;
    return /* @__PURE__ */ h(Box, {
      key
    });
  };
  const kit = Object.assign(component, { toLines });
  return kit;
}
function textOf(children) {
  if (Array.isArray(children))
    return children.map(textOf).join("");
  if (typeof children === "string" || typeof children === "number")
    return String(children);
  return "";
}
function ctxFor(render, owner, view) {
  const ctx = {
    ...view,
    bind: (name, run) => {
      const key = `${owner}:${name}`;
      render.handlers.set(key, run);
      return key;
    },
    parts: (nodes, over) => partsOf(render, nodes, { ...view, ...over }),
    layout: (nodes, over) => ctx.parts(nodes, over).flatMap((part) => ("text" in part) ? [[sp(part.text)]] : part.component.toLines(part.props, part.ctx))
  };
  return ctx;
}
function partsOf(render, nodes, view) {
  const out = [];
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === "boolean")
      return;
    if (Array.isArray(node))
      return node.forEach(walk);
    if (typeof node === "string" || typeof node === "number") {
      out.push({ text: String(node) });
      return;
    }
    const el = node;
    const key = el.props?.key;
    const entry = typeof key === "string" ? render.entries.get(key) : undefined;
    if (entry && typeof key === "string") {
      out.push({ component: entry.component, props: entry.props, ctx: ctxFor(render, key, view) });
      return;
    }
    const inner = el.children ?? el.props?.children;
    if (inner === undefined)
      throw new Error(`kit: a Panel lays out kit components and text, not a ${String(el.type)} element`);
    walk(inner);
  };
  walk(nodes);
  return out;
}

// packages/mod-kit/src/components/client.tsx
var KEY_PRESS_MS = 150;
function kitClient(body, options = {}) {
  return function KitClient(props, surface) {
    const seed = surface.state ?? options.initial?.(props) ?? {};
    if (surface.state === undefined)
      surface.setState(seed);
    let latest = seed;
    const setState = (next) => {
      latest = next;
      surface.setState(next);
    };
    const focused = options.focused ? options.focused(props) : props?.focused !== false;
    const engage = options.engaged && (() => surface.post(options.engaged(props)));
    let reveal;
    const ui = {
      width: surface.columns || 80,
      focused,
      get state() {
        return latest;
      },
      setState,
      post: (message) => surface.post(message),
      hide: () => surface.post({ type: "hide" }),
      onKey: (fn) => void surface.onKey((event) => {
        if (latest.keyPress)
          return;
        engage?.();
        if (focused && !latest.keyboard && options.revealKeys?.includes(event.key)) {
          setState({ ...latest, keyboard: true });
          reveal?.();
          return;
        }
        if (fn(event) === true && !latest.keyboard)
          setState({ ...latest, keyboard: true });
      }),
      get keyboard() {
        return latest.keyboard === true;
      },
      get keyPressing() {
        return latest.keyPress === true;
      },
      onReveal: (fn) => {
        reveal = fn;
      },
      pressFor: (run, ms = KEY_PRESS_MS) => {
        if (latest.keyPress)
          return;
        setState({ ...latest, keyPress: true });
        const stop = surface.every(ms, () => {
          stop();
          setState({ ...surface.state, keyPress: undefined });
          run();
        });
      }
    };
    const { tree, lines, handlers } = drawKit({ elements: surface.elements, look: lookOf(latest, focused), width: ui.width, focused }, () => body(props, ui));
    const local = {
      get state() {
        return latest;
      },
      setState,
      onPointer: (fn) => surface.onPointer((event) => {
        fn(event);
        if (latest.keyboard)
          setState({ ...latest, keyboard: undefined });
      })
    };
    attachPointer(local, lines, {
      focused,
      onAction: (key) => handlers.get(key)?.(),
      ...engage && { onEngage: engage },
      ...options.isActive && { isActive: () => options.isActive(latest) }
    });
    return tree;
  };
}

// packages/mod-kit/src/draw/render.tsx
function isControl(span, line, row, key) {
  if (span.action !== undefined)
    return spanHoverKey(span, row) === key;
  return span.isLabel === true && lineHoverKey(line) === key;
}
function styleOf(span, line, row, look) {
  if (!look.focused)
    return muted(span);
  if (look.pressed !== undefined && isControl(span, line, row, look.pressed))
    return pressed(span);
  if (look.hover !== undefined && isControl(span, line, row, look.hover))
    return hovered(span);
  return span;
}
function renderLines(lines, elements, look) {
  const { Box, Text } = elements;
  return /* @__PURE__ */ h(Box, {
    flexDirection: "column"
  }, lines.map((line, n) => /* @__PURE__ */ h(Text, {
    key: `l${n}`,
    wrap: "truncate-end"
  }, line.map((span, m) => {
    const style = styleOf(span, line, n, look);
    return /* @__PURE__ */ h(Text, {
      key: `s${m}`,
      ...style.color && { color: style.color },
      ...style.bg && { backgroundColor: style.bg },
      ...style.dim && { dimColor: true },
      ...style.bold && { bold: true },
      ...style.italic && { italic: true },
      ...style.underline && { underline: true },
      ...style.inverse && { inverse: true }
    }, span.t);
  }))));
}

// packages/mod-kit/src/components/panel.tsx
function Panel(props) {
  const render = rendering("Panel");
  if (render.lines)
    throw new Error("kit: a Client draws one Panel");
  const lines = ctxFor(render, "panel", { width: props.width ?? render.width, focused: render.focused }).layout(props.children);
  render.lines = lines;
  return renderLines(lines, render.elements, render.look);
}
// packages/mod-kit/src/patterns/page-shell.ts
function padToHeight(page, height, filler) {
  const padding = Array.from({ length: Math.max(0, height - page.length) }, () => [...filler]);
  return [...page, ...padding];
}
function fitToRows(drawn, rows, withoutContext, pad) {
  const roomUnder = (head) => Math.max(6, rows - head.length);
  const { head, page, foot } = drawn.page.length + drawn.foot.length > roomUnder(drawn.head) ? withoutContext() : drawn;
  const room = roomUnder(head);
  const padded = pad ? padToHeight(page, Math.min(pad.height, room - foot.length), pad.filler) : page;
  const body = [...padded, ...foot];
  return [...head, ...body.slice(Math.max(0, body.length - room))];
}
function reviewList(items, width) {
  const bar = rail(GRAY);
  return items.flatMap((item) => {
    const isDone = item.summary !== undefined;
    const symbol = isDone ? sp(ICON.done, DONE) : sp(ICON.missing, WARN);
    const entry = [
      ...hang([symbol, sp("  ")], bar, item.label, width, item.action !== undefined ? { isLabel: true } : {}),
      ...isDone ? hang(bar, bar, item.summary, width, DIM) : [[...bar, sp("not answered", WARN)]]
    ];
    if (item.action !== undefined)
      for (const line of entry)
        line.action = item.action;
    return [[sp(SYMBOL.bar, GRAY)], ...entry];
  });
}
// packages/mod-kit/src/patterns/scroll-list.ts
var maxScroll = (total, windowRows) => Math.max(0, total - windowRows);
function revealOffset(view, index) {
  const stop = view.stops[index];
  const most = maxScroll(view.total, view.windowRows);
  if (!stop)
    return view.top;
  if (stop.first < view.top)
    return Math.max(0, stop.first);
  if (stop.last > view.top + view.windowRows - 1)
    return Math.min(most, Math.min(stop.first, stop.last - view.windowRows + 1));
  return view.top;
}
function clipLine(line, cells) {
  const out = [];
  let used = 0;
  for (const span of line) {
    const w = cellWidth(span.t);
    if (used + w <= cells) {
      out.push(span);
      used += w;
      continue;
    }
    const t = cutCells(span.t, cells - used);
    if (t !== "")
      out.push({ ...span, t });
    used += cellWidth(t);
    break;
  }
  out.push(sp(" ".repeat(Math.max(0, cells - used))));
  return out;
}
// packages/mod-kit/src/components/buttons.tsx
function buttonOf(props, ctx) {
  return { label: props.label ?? textOf(props.children), tone: props.tone, disabled: props.disabled, action: ctx.bind("press", () => props.onPress?.()) };
}
var Button = kitComponent("Button", (props, ctx) => [buttonRow([buttonOf(props, ctx)], undefined, ctx.width)]);
var ButtonRow = kitComponent("ButtonRow", (props, ctx) => {
  const buttons = (nodes) => ctx.parts(nodes).flatMap((part) => ("component" in part) && part.component === Button ? [buttonOf(part.props, part.ctx)] : []);
  return [buttonRow(buttons(props.children), buttons(props.right)[0], ctx.width)];
});

// packages/mod-kit/src/components/lines.tsx
function keyed(lines, key) {
  return lines.map((line) => {
    const out = line.map(({ action, ...span }) => action === undefined ? span : { ...span, action: key(action) });
    if (line.action !== undefined)
      out.action = key(line.action);
    return out;
  });
}
var Lines = kitComponent("Lines", (props, ctx) => keyed(props.lines, (action) => ctx.bind(JSON.stringify(action), () => props.onAction?.(action))));
var Span = kitComponent("Span", ({ children, ...style }) => [[sp(textOf(children), style)]]);
var Row = kitComponent("Row", (props, ctx) => [
  ctx.parts(props.children).flatMap((part) => {
    if ("text" in part)
      return [sp(part.text)];
    if (part.component === Button)
      return [buttonSpan(buttonOf(part.props, part.ctx))];
    return part.component.toLines(part.props, part.ctx)[0] ?? [];
  })
]);
// mods/gate-form/src/form/state.ts
var WRITE_IN = "__other__";
var isRecommended = (o) => /\(recommended\)\s*$/i.test(o.label);
var replaceAt = (list, i, value) => list.map((old, k) => k === i ? value : old);
var markAnswered = (s, i) => replaceAt(s.answered, i, true);
function choicesOf(q) {
  if (q.options.length === 0 || !q.other)
    return q.options;
  return [...q.options, { value: WRITE_IN, label: "Something else", description: "Write in your answer" }];
}
function initial(form) {
  return {
    page: 0,
    cursor: form.questions.map((q) => isConfirm(form) ? 0 : Math.max(0, q.options.findIndex(isRecommended))),
    picked: form.questions.map(() => []),
    text: form.questions.map(() => ""),
    answered: form.questions.map(() => false),
    moved: form.questions.map(() => false),
    phase: "active",
    tabsFrom: 0,
    menu: { open: false, selected: 0 },
    navAt: "next"
  };
}
function canSubmit(form, s) {
  if (isSinglePage(form))
    return chosenValue(form, s) !== undefined;
  return form.source !== "gate" || unansweredCount(s) === 0;
}
function chosenValue(form, s) {
  const q = form.questions[0];
  return q && (cursorIsChoice(q, s, 0) || choicesOf(q).length === 1) ? choicesOf(q)[s.cursor[0]]?.value : undefined;
}
var PAUSE = "pause";
var GO_BACK = "go-back:";
var canChat = (form) => form.source !== "plugin";
var isSinglePage = (form) => form.source === "plugin";
var isConfirm = (form) => form.confirm === true;
var isReview = (form, s) => !isSinglePage(form) && s.page === form.questions.length;
var isOnNav = (form, s) => s.onNav === true || isReview(form, s);
function navIds(form, s) {
  const ids = s.page > 0 && !isReview(form, s) ? ["back", "next"] : ["next"];
  if (isReview(form, s) && menuRows(form).length > 0)
    ids.push("more");
  if (canChat(form))
    ids.push("chat");
  return ids;
}
function navAtOf(form, s) {
  return navIds(form, s).includes(s.navAt) ? s.navAt : "next";
}
function menuRows(form) {
  const controls = form.controls;
  if (!controls)
    return [];
  const rows = controls.pause ? [{ id: PAUSE, label: "Pause run" }] : [];
  if (controls.goBack.length > 0)
    rows.push({ id: "go-back", label: "Go back to stage", isHeading: true }, ...controls.goBack.map((stage) => ({ id: `${GO_BACK}${stage}`, label: stage })));
  return rows;
}
function controlAnswers(id) {
  if (id === PAUSE)
    return { answers: { next: "hold" }, label: "Asked to pause the run." };
  if (!id.startsWith(GO_BACK))
    return;
  const to = id.slice(GO_BACK.length);
  return { answers: { next: "go-back", to }, label: `Asked to go back to stage ${to}.` };
}
function afterAttempt(form, s) {
  if (s.phase !== "submitted" || form.status !== "open" || (form.attempt ?? 0) <= (s.sent ?? 0))
    return s;
  return { ...s, phase: "active", sent: form.attempt, control: undefined };
}
var unansweredCount = (s) => s.answered.filter((a) => !a).length;
function isPicked(q, s, i, idx) {
  const value = choicesOf(q)[idx]?.value;
  if (value === undefined)
    return false;
  return s.picked[i].includes(value) || value === WRITE_IN && q.multi && s.text[i].trim() !== "";
}
function isTyping(form, s) {
  const q = form.questions[s.page];
  if (!q)
    return false;
  const choices = choicesOf(q);
  return choices.length === 0 || choices[s.cursor[s.page]]?.value === WRITE_IN;
}
function answersOf(form, s) {
  const out = {};
  form.questions.forEach((q, i) => {
    if (!s.answered[i])
      return;
    const typed = s.text[i].trim();
    if (choicesOf(q).length === 0)
      out[q.id] = s.text[i];
    else if (q.multi) {
      const values = s.picked[i].filter((v) => v !== WRITE_IN);
      out[q.id] = typed === "" ? values : values.length > 0 ? { value: values, note: typed } : { writeIn: typed };
    } else {
      const value = choicesOf(q)[s.cursor[i]]?.value;
      out[q.id] = value === WRITE_IN ? { writeIn: typed } : value;
    }
  });
  return out;
}
function goTo(form, s, page) {
  const last = isSinglePage(form) ? 0 : form.questions.length;
  return { ...s, page: Math.max(0, Math.min(last, page)) };
}
function cursorIsChoice(q, s, i) {
  const option = choicesOf(q)[s.cursor[i]];
  if (!option || option.value === WRITE_IN && s.text[i].trim() === "")
    return false;
  return s.answered[i] || s.moved[i] || isRecommended(option);
}
function takesCursorAsAnswer(form, s) {
  const q = form.questions[s.page];
  return q !== undefined && !q.multi && !s.answered[s.page] && cursorIsChoice(q, s, s.page);
}
function advance(form, s) {
  const answered = takesCursorAsAnswer(form, s) ? markAnswered(s, s.page) : s.answered;
  return goTo(form, { ...s, answered }, s.page + 1);
}
function moveCursor(form, s, by) {
  const q = form.questions[s.page];
  const count = q ? choicesOf(q).length : 0;
  if (count === 0)
    return s;
  return { ...s, cursor: replaceAt(s.cursor, s.page, (s.cursor[s.page] + by + count) % count), moved: replaceAt(s.moved, s.page, true) };
}
function toggled(s, i, value) {
  const has = s.picked[i].includes(value);
  return { ...s, picked: replaceAt(s.picked, i, has ? s.picked[i].filter((p) => p !== value) : [...s.picked[i], value]), answered: markAnswered(s, i) };
}
function toggleAtCursor(form, s) {
  const q = form.questions[s.page];
  const value = q && choicesOf(q)[s.cursor[s.page]]?.value;
  return value === undefined ? s : toggled(s, s.page, value);
}
function confirm(form, s) {
  const i = s.page;
  const q = form.questions[i];
  if (!q)
    return s;
  const value = choicesOf(q)[s.cursor[i]]?.value;
  const adds = q.multi && value !== undefined && value !== WRITE_IN && !s.picked[i].includes(value);
  return { ...s, page: i + 1, answered: markAnswered(s, i), ...adds && { picked: replaceAt(s.picked, i, [...s.picked[i], value]) } };
}
function clickChoice(form, s, idx) {
  const i = s.page;
  const q = form.questions[i];
  if (!q)
    return s;
  const value = choicesOf(q)[idx]?.value;
  const cursor = replaceAt(s.cursor, i, idx);
  if (value === undefined || value === WRITE_IN)
    return { ...s, cursor };
  if (!q.multi)
    return { ...s, cursor, answered: markAnswered(s, i) };
  return { ...toggled(s, i, value), cursor };
}
function typeChar(s, ch) {
  return { ...s, text: replaceAt(s.text, s.page, s.text[s.page] + ch), answered: markAnswered(s, s.page) };
}
function deleteChar(s) {
  return { ...s, text: replaceAt(s.text, s.page, s.text[s.page].slice(0, -1)) };
}

// mods/gate-form/src/form/input.ts
var disarm = (s) => ({ ...s, chatArmed: undefined });
function post(form, s, answers, control) {
  return { state: { ...s, phase: "submitted", sent: form.attempt ?? 0, control }, post: { type: "answer", formId: form.id, answers } };
}
function send(form, s) {
  if (!canSubmit(form, s))
    return;
  if (!isSinglePage(form))
    return post(form, s, answersOf(form, s));
  return post(form, s, { [form.questions[0].id]: chosenValue(form, s) });
}
function chat(form, s) {
  if (!canChat(form))
    return;
  if (!s.chatArmed)
    return { state: { ...s, chatArmed: true } };
  const state = form.source === "gate" ? disarm(s) : { ...disarm(s), phase: "chat" };
  return { state, post: { type: "chat", formId: form.id, draft: answersOf(form, s) } };
}
function moved(form, s, move) {
  if (!move)
    return;
  const state = { ...s, menu: move.state };
  const control = move.picked === undefined ? undefined : controlAnswers(move.picked);
  return control ? post(form, state, control.answers, control.label) : { state };
}
function settled(before, effect) {
  if (!effect || effect.state.page === before.page)
    return effect;
  return { ...effect, state: { ...effect.state, onNav: undefined, navAt: "next", pageTop: undefined, followed: undefined } };
}
function perform(action, form, armed) {
  return settled(armed, performOn(action, form, armed));
}
function performOn(action, form, armed) {
  if (action.type === "hide")
    return { state: armed, post: { type: "hide", formId: form.id } };
  if (armed.phase !== "active")
    return;
  if (action.type === "chat")
    return chat(form, armed);
  const s = disarm(armed);
  switch (action.type) {
    case "scroll-tabs":
      return { state: { ...s, tabsFrom: action.from } };
    case "page":
      return { state: goTo(form, s, action.page) };
    case "advance":
      return { state: advance(form, s) };
    case "option": {
      return { state: clickChoice(form, s, action.idx) };
    }
    case "send":
      return send(form, s);
    case "menu":
      return moved(form, { ...s, navAt: "more" }, menuHit(s.menu, menuRows(form), action.hit));
  }
}
function gridOf(form, s) {
  const q = form.questions[s.page];
  const choices = q ? choicesOf(q) : [];
  const above = !q ? [] : choices.length === 0 ? [{ key: "text", ids: ["text"], main: 0 }] : choices.map((_, i) => ({ key: `choice-${i}`, ids: ["choice"], main: 0 }));
  if (isSinglePage(form))
    return above;
  const ids = navIds(form, s);
  return [...above, { key: "nav", ids, main: Math.max(0, ids.indexOf("next")) }];
}
function spotOf(form, s, rows) {
  const nav = rows.length - 1;
  if (isOnNav(form, s))
    return { at: nav, col: rows[nav].ids.indexOf(navAtOf(form, s)) };
  const q = form.questions[s.page];
  return { at: q && choicesOf(q).length > 0 ? s.cursor[s.page] : 0, col: 0 };
}
function gridKey(ev, form, s) {
  const rows = gridOf(form, s);
  const here = spotOf(form, s, rows);
  const move = gridMove(rows, here, ev);
  if (!move.handled)
    return;
  if (!move.to)
    return { state: s };
  const nav = isSinglePage(form) ? -1 : rows.length - 1;
  if (move.to.at === nav)
    return { state: { ...s, onNav: true, navAt: rows[nav].ids[move.to.col] } };
  if (here.at === nav)
    return { state: { ...s, onNav: undefined } };
  return { state: moveCursor(form, s, move.to.at - here.at) };
}
function pressNav(ev, form, armed, s) {
  switch (navAtOf(form, s)) {
    case "back":
      return { state: goTo(form, s, s.page - 1) };
    case "next":
      return isReview(form, s) ? send(form, s) : { state: advance(form, s) };
    case "more":
      return moved(form, { ...s, navAt: "more" }, menuKey(s.menu, menuRows(form), ev.key));
    case "chat":
      return chat(form, armed);
  }
}
var isEnter = (ev) => ev.key === "return" || ev.key === "enter";
function pressesButton(ev, form, s) {
  if (s.phase !== "active")
    return false;
  if (isConfirm(form))
    return false;
  if (!isEnter(ev))
    return false;
  if (s.menu.open)
    return true;
  if (isSinglePage(form))
    return canSubmit(form, s);
  if (!isOnNav(form, s)) {
    const q = form.questions[s.page];
    return q !== undefined && choicesOf(q).length > 0;
  }
  return !(navAtOf(form, s) === "next" && isReview(form, s) && !canSubmit(form, s));
}
function reviewKey(ev, form, s) {
  if (ev.key === "left")
    return { state: goTo(form, s, s.page - 1) };
  if (ev.key === "right")
    return { state: s };
  if (ev.key !== "tab")
    return;
  const ids = navIds(form, s);
  const at = ids.indexOf(navAtOf(form, s));
  return { state: { ...s, navAt: ids[(at + (ev.shift ? -1 : 1) + ids.length) % ids.length] } };
}
function navKey(ev, form, armed, s) {
  if (s.menu.open)
    return moved(form, s, menuKey(s.menu, menuRows(form), ev.key)) ?? { state: s };
  if (isEnter(ev))
    return pressNav(ev, form, armed, s);
  return (isReview(form, s) ? reviewKey(ev, form, s) : undefined) ?? gridKey(ev, form, s);
}
function questionKey(ev, form, s) {
  const { key } = ev;
  const isSpace = key === " " || key === "space";
  const typing = isTyping(form, s);
  if (isEnter(ev))
    return isSinglePage(form) ? send(form, s) ?? { state: s } : { state: confirm(form, s) };
  if (key === "left" || key === "right")
    return { state: goTo(form, s, s.page + (key === "left" ? -1 : 1)) };
  if (key === "up" || key === "down")
    return gridKey(ev, form, s);
  if (isSpace && form.questions[s.page]?.multi && !typing)
    return { state: toggleAtCursor(form, s) };
  if (!typing)
    return;
  if (key === "backspace" || key === "delete")
    return { state: deleteChar(s) };
  const ch = isSpace ? " " : key;
  if (ch.length === 1 && !ev.ctrl && !ev.meta)
    return { state: typeChar(s, ch) };
  return;
}
function keyEffect(ev, form, armed) {
  if (armed.phase !== "active")
    return;
  if (ev.ctrl && (ev.key === "x" || ev.key === "c"))
    return chat(form, armed);
  const s = disarm(armed);
  if (isConfirm(form))
    return;
  if (ev.key === "tab" && isSinglePage(form))
    return { state: s };
  if (ev.key === "tab" && !isReview(form, s))
    return settled(s, { state: ev.shift ? goTo(form, s, s.page - 1) : advance(form, s) });
  return settled(s, isOnNav(form, s) ? navKey(ev, form, armed, s) : questionKey(ev, form, s));
}

// mods/gate-form/src/form/view.ts
function contextText(context) {
  try {
    const parsed = JSON.parse(context);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(`
`);
    }
  } catch {}
  return context;
}
function answerSummary(q, s, i) {
  const choices = choicesOf(q);
  if (choices.length === 0)
    return s.text[i] === "" ? "(blank)" : s.text[i];
  const label = (v) => v === WRITE_IN ? `“${s.text[i]}”` : choices.find((o) => o.value === v)?.label ?? v;
  if (!q.multi)
    return label(choices[s.cursor[i]]?.value ?? "");
  const values = [...s.picked[i], ...s.text[i].trim() !== "" ? [WRITE_IN] : []];
  return values.length === 0 ? "none" : values.map(label).join(", ");
}
function wonSummary(q, raw) {
  const label = (v) => q.options.find((o) => o.value === v)?.label ?? String(v);
  const labels = (v) => Array.isArray(v) ? v.length === 0 ? "none" : v.map(label).join(", ") : label(v);
  if (raw === undefined || raw === null)
    return "skipped";
  if (typeof raw === "string")
    return q.options.length > 0 ? label(raw) : raw === "" ? "(blank)" : raw;
  if (Array.isArray(raw))
    return labels(raw);
  if (typeof raw !== "object")
    return String(raw);
  const typed = raw;
  if (typeof typed.writeIn === "string")
    return `“${typed.writeIn}”`;
  const picked = typed.value === undefined ? "" : labels(typed.value);
  if (typeof typed.note !== "string")
    return picked || "skipped";
  return picked ? `${picked}, “${typed.note}”` : `“${typed.note}”`;
}
var kindIcon = (q) => choicesOf(q).length === 0 ? ICON.text : q.multi ? ICON.multi : ICON.single;
function questionPage(q, s, i, base) {
  const view = { ...base, focused: base.focused && !s.onNav, pressing: base.pressing && !s.onNav };
  const bar = rail(ACCENT);
  const lines = hang([sp(kindIcon(q), ACCENT), sp("  ")], bar, q.label, view.width, { bold: true });
  if (q.multi)
    lines.push([...bar, sp("pick any number", DIM)]);
  if (q.context)
    lines.push(...hang(bar, bar, q.context, view.width, DIM));
  lines.push([sp(SYMBOL.bar, ACCENT)]);
  const choices = choicesOf(q);
  if (choices.length === 0) {
    lines.push([...bar, ...textCursor(s.text[i], "Type your answer", view.focused)]);
    return lines;
  }
  lines.push(...selectList({
    choices: choices.map((c) => ({ label: c.label, description: c.description, isWriteIn: c.value === WRITE_IN })),
    cursor: s.cursor[i],
    multi: q.multi,
    isPicked: (idx) => isPicked(q, s, i, idx),
    cursorIsChoice: !q.multi && cursorIsChoice(q, s, i),
    writeIn: s.text[i],
    width: view.width,
    focused: view.focused,
    ...view.pressing && { pressing: true },
    maxShown: choices.length,
    actionFor: (idx) => ({ type: "option", idx })
  }));
  return lines;
}
function reviewList2(form, s, view) {
  const isOpen = s.phase === "active" && form.status === "open";
  const won = form.status === "open" ? undefined : form.won;
  return reviewList(form.questions.map((q, i) => ({
    label: q.label,
    summary: won ? wonSummary(q, won[q.id]) : s.answered[i] ? answerSummary(q, s, i) : undefined,
    ...isOpen && { action: { type: "page", page: i } }
  })), view.width);
}
function reviewPage(form, s, view) {
  const missing = unansweredCount(s);
  const bar = rail(ACCENT);
  const lines = [...reviewList2(form, s, view), [sp(SYMBOL.bar, GRAY)], [sp(ICON.review, DONE), sp("  Submit your answers?", { bold: true })]];
  const warning = form.source === "gate" ? `${missing} not answered. Answer every question to submit.` : `${missing} not answered; left out if you submit now`;
  if (missing > 0)
    lines.push(...hang(bar, bar, warning, view.width, WARN));
  return lines;
}
function ending(form, s) {
  if (form.note)
    return { text: form.note, isWarn: false };
  if (s.phase === "chat")
    return { text: "Set aside to chat about it.", isWarn: true };
  if (form.source !== "gate")
    return { text: "Answers sent.", isWarn: false };
  if (form.status === "open")
    return { text: "Recording your answer…", isWarn: false };
  return { text: s.control ?? "Answer recorded.", isWarn: false };
}
function closedPage(form, s, view) {
  const end = ending(form, s);
  const rest = [sp(" "), sp("  ")];
  return [...reviewList2(form, s, view), [sp(SYMBOL.bar, GRAY)], ...hang([sp(SYMBOL.end, GRAY), sp("  ")], rest, end.text, view.width, end.isWarn ? WARN : {})];
}
function tabList(form, s) {
  const n = form.questions.length;
  const list = form.questions.map((q, i) => ({
    label: q.header,
    mark: s.answered[i] ? ICON.done : ICON.todo,
    isDone: s.answered[i] === true,
    action: { type: "page", page: i }
  }));
  list.push({ label: "Submit", isDone: false, action: { type: "page", page: n } });
  return list;
}
function tabs(form, s, view) {
  return tabStrip({ tabs: tabList(form, s), current: s.page, width: view.width, from: s.tabsFrom, scrollTo: (from) => ({ type: "scroll-tabs", from }) });
}
function withTabInView(form, s, width) {
  return { ...s, tabsFrom: revealTab(tabList(form, s), s.page, width, s.tabsFrom) };
}
var MORE = { type: "menu", hit: { type: "toggle" } };
function spanAt2(id, left, line) {
  return id === "chat" ? line.length - 1 : 1 + 2 * left.indexOf(id);
}
function navRows(form, s, view) {
  const n = form.questions.length;
  const page = s.page;
  const back = { label: `${ICON.back} Back`, action: { type: "page", page: page - 1 }, tone: "secondary", disabled: page === 0 };
  const forward = (label) => ({ label, action: { type: "advance" }, tone: "secondary" });
  const submit = { label: unansweredCount(s) === 0 || form.source === "gate" ? "Submit" : "Submit anyway", action: { type: "send" }, tone: "brand", disabled: !canSubmit(form, s) };
  const next = page < n - 1 ? forward(`Next ${ICON.next}`) : page === n - 1 ? forward(`Review ${ICON.next}`) : submit;
  const aside = !canChat(form) ? undefined : s.chatArmed ? { label: `${ICON.chat} Press again to chat`, action: { type: "chat" }, tone: "caution" } : { label: `${ICON.chat} Chat about this`, action: { type: "chat" }, tone: "neutral" };
  const rows = page === n ? menuRows(form) : [];
  const more = { label: MORE_ACTIONS, action: MORE, tone: "quiet" };
  const left = [...page === n ? [] : [["back", back]], ["next", next], ...rows.length === 0 ? [] : [["more", more]]];
  const line = buttonRow(left.map(([, button]) => button), aside, view.width);
  const marked = (row) => {
    if (!view.focused || !isOnNav(form, s))
      return row;
    const at = spanAt2(navAtOf(form, s), left.map(([id]) => id), row);
    return [...row.slice(0, at), ...gridLook(row[at], { marked: true, pressing: view.pressing && !s.menu.open }), ...row.slice(at + 1)];
  };
  if (rows.length === 0)
    return [marked(line)];
  const at = line.findIndex((span) => span.action === MORE);
  const indent = widthOf(line.slice(0, at));
  const hung = menu({ ...s.menu, label: MORE_ACTIONS, rows, width: view.width, indent, pressing: view.pressing === true, actionFor: (hit) => ({ type: "menu", hit }) });
  return [marked(line), ...hung.slice(1)];
}
function confirmFoot(form, view) {
  return [[sp(SYMBOL.end, GRAY)], ...errorLines(form, view)];
}
function submitRow(form, s, view) {
  return buttonRow([{ label: "Submit", action: { type: "send" }, tone: "brand", disabled: !canSubmit(form, s) }], undefined, view.width);
}
function errorLines(form, view) {
  if (form.status !== "open" || !form.error)
    return [];
  const lead = [sp(SYMBOL.warn, WARN), sp("  ")];
  return [[sp(" ")], ...hang(lead, [sp("   ")], form.error, view.width, WARN)];
}
function hint(form, s) {
  const q = form.questions[s.page];
  if (isSinglePage(form))
    return "↑↓ choose  enter submit";
  if (!q) {
    const others = navIds(form, s).length > 1 ? "   tab buttons" : "";
    return `← back${others}   enter ${navAtOf(form, s) === "next" ? "submit" : "presses"}`;
  }
  if (s.onNav)
    return "←→ buttons  ↑ answers  enter presses";
  return choicesOf(q).length === 0 ? "←→ pages  ↓ buttons" : "←→ pages  ↑↓ move";
}
function draw(form, s, view) {
  const head = [brandBar(form.source === "plugin" ? "mattstack" : "mattstack decision gate", view.width, { type: "hide" }), [sp(" ")], [sp(SYMBOL.start, GRAY), sp("  "), sp(form.title, { bold: true })]];
  if (s.phase !== "active" || form.status !== "open")
    return { head, page: closedPage(form, s, view), foot: [] };
  const gap = [sp(SYMBOL.bar, GRAY)];
  head.push(gap);
  if (form.context) {
    const indent = rail(GRAY);
    const divider = [sp(`├${"─".repeat(Math.max(4, view.width - 2))}`, GRAY)];
    head.push(...hang(indent, indent, contextText(form.context), view.width), ...isConfirm(form) ? [] : [gap, divider, gap]);
  }
  if (isConfirm(form))
    return { head, page: [], foot: confirmFoot(form, view) };
  if (!isSinglePage(form))
    head.push(tabs(form, s, view), gap);
  const q = form.questions[s.page];
  const accentBar = rail(ACCENT);
  const page = q ? questionPage(q, s, s.page, view) : reviewPage(form, s, view);
  const keys = hint(form, s);
  const hintLines = keys === undefined ? [] : [[sp(SYMBOL.bar, ACCENT)], ...hang(accentBar, accentBar, keys, view.width, DIM)];
  const nav = [[sp(" ")], ...isSinglePage(form) ? [submitRow(form, s, view)] : navRows(form, s, view)];
  const foot = [...hintLines, [sp(SYMBOL.end, ACCENT)], ...errorLines(form, view), ...nav];
  return { head, page, foot };
}
function tallestQuestion(form, s, view) {
  let tallest = 0;
  form.questions.forEach((q, i) => {
    const positions = Math.max(1, choicesOf(q).length);
    for (let c = 0;c < positions; c += 1) {
      const at = { ...s, cursor: s.cursor.map((old, k) => k === i ? c : old) };
      tallest = Math.max(tallest, questionPage(q, at, i, view).length);
    }
  });
  return tallest;
}
var BAR_CELLS = 3;
var FIXED_TOP = 2;
function fittedLines(form, s, view, rows, wheel) {
  const full = draw(form, s, view);
  const room = rows - FIXED_TOP - full.foot.length;
  if (full.head.length - FIXED_TOP + full.page.length <= room) {
    const pad = s.phase === "active" && form.status === "open" && !isConfirm(form) ? { height: tallestQuestion(form, s, view), filler: [sp(SYMBOL.bar, ACCENT)] } : undefined;
    return { lines: fitToRows(full, rows, () => full, pad), top: 0, ...wheel !== undefined && { wheelAt: wheel } };
  }
  const inner = { ...view, width: Math.max(20, view.width - BAR_CELLS) };
  const narrow = draw(form, s, inner);
  const region = [...narrow.head.slice(FIXED_TOP), ...narrow.page];
  const windowRows = Math.max(1, rows - FIXED_TOP - narrow.foot.length);
  const turned = wheel === undefined || s.wheelAt === undefined ? 0 : wheel - s.wheelAt;
  const most = maxScroll(region.length, windowRows);
  const wheeled = Math.min(Math.max(0, (s.pageTop ?? 0) + turned), most);
  const cursor = `${s.page}:${s.onNav ? "nav" : s.cursor[s.page] ?? ""}`;
  const top = cursor === s.followed ? wheeled : followCursor(region, s, windowRows, wheeled);
  const bar = scrollBar(windowRows, region.length, top);
  const shown = region.slice(top, top + windowRows).map((line, n) => Object.assign([...clipLine(line, inner.width), ...bar[n] ?? []], line.action === undefined ? {} : { action: line.action }));
  return { lines: [...full.head.slice(0, FIXED_TOP), ...shown, ...narrow.foot], top, followed: cursor, ...wheel !== undefined && { wheelAt: wheel } };
}
function followCursor(region, s, windowRows, from) {
  const at = s.cursor[s.page];
  const isCursor = (line) => line.action?.type === "option" && line.action.idx === at;
  const first = s.onNav || at === undefined ? -1 : region.findIndex(isCursor);
  let last = first;
  while (first >= 0 && last + 1 < region.length && isCursor(region[last + 1]))
    last += 1;
  if (first < 0)
    return from;
  return revealOffset({ top: from, total: region.length, windowRows, stops: [{ key: "cursor", ids: ["choice"], main: 0, lines: [first], first, last }] }, 0);
}

// mods/gate-form/src/form.tsx
var form_default = kitClient((props, ui) => {
  const { form } = props;
  const retried = afterAttempt(form, ui.state);
  if (retried !== ui.state)
    ui.setState(retried);
  const width = Math.max(30, props.cols || ui.width);
  const apply = (effect) => {
    if (!effect)
      return false;
    if (effect.post !== undefined)
      ui.post(effect.post);
    ui.setState(effect.state.page === ui.state.page ? effect.state : withTabInView(form, effect.state, width));
    return true;
  };
  ui.onKey((ev) => {
    if (!pressesButton(ev, form, ui.state))
      return apply(keyEffect(ev, form, ui.state));
    ui.pressFor(() => apply(keyEffect(ev, form, ui.state)));
    return true;
  });
  const fitted = fittedLines(form, ui.state, { width, focused: ui.focused, pressing: ui.keyPressing }, props.rows, props.wheel);
  const s = ui.state;
  if (fitted.top !== (s.pageTop ?? 0) || fitted.followed !== s.followed || fitted.wheelAt !== s.wheelAt)
    ui.setState({ ...s, pageTop: fitted.top, followed: fitted.followed, wheelAt: fitted.wheelAt });
  return /* @__PURE__ */ h(Panel, {
    width
  }, /* @__PURE__ */ h(Lines, {
    lines: fitted.lines,
    onAction: (action) => apply(perform(action, form, ui.state))
  }));
}, {
  initial: (props) => initial(props.form),
  isActive: (s) => s.phase === "active",
  engaged: (props) => ({ type: "engaged", formId: props.form.id })
});
export {
  form_default as default
};
