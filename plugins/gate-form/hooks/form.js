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
  selectEdge: "❯"
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
function markButtonAt(line, at, focus = {}) {
  const button = line[at];
  if (!button)
    return line;
  const lit = focus.pressing ? pressed(button) : hoverOf(button);
  let back = at - 1;
  while (back >= 0 && line[back].t === "")
    back -= 1;
  const prev = line[back];
  const keep = (spans) => Object.assign(spans, line.action === undefined ? {} : { action: line.action });
  if (prev && prev.action === undefined && /^ +$/.test(prev.t)) {
    const mark = prev.t.length >= 2 ? `${SYMBOL.selectEdge} ` : SYMBOL.selectEdge;
    const rest = prev.t.slice(mark.length);
    return keep([...line.slice(0, back), ...rest === "" ? [] : [{ ...prev, t: rest }], sp(mark, { bold: true, ...prev.bg && { bg: prev.bg } }), ...line.slice(back + 1, at), lit, ...line.slice(at + 1)]);
  }
  return keep([...line.slice(0, at), sp(SYMBOL.selectEdge, { bold: true }), lit, ...line.slice(at + 1)]);
}
var CURSOR_ROW = "#2e2e2e";
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
  const button = " Close ";
  return [sp(fit(text, width - cellWidth(button) - 1), look), sp(button, { ...look, chip: BRAND.pinkDeep, action: hide }), sp(" ", look)];
}
// packages/mod-kit/src/widgets/buttons.ts
var TONE_FILL = { primary: FILL.primary, secondary: FILL.secondary, neutral: FILL.neutral, caution: FILL.caution, brand: FILL.brand, quiet: { color: QUIET.label, bg: QUIET.rest, quiet: true }, plain: { color: QUIET.muted, quiet: true } };
var ROOMY = { indent: 3, pad: 2, gap: 3 };
var COMPACT = { indent: 1, pad: 1, gap: 1 };
function buttonSpan(button, pad = ROOMY.pad) {
  const fill = button.disabled ? FILL.disabled : TONE_FILL[button.tone ?? "secondary"];
  const edge = " ".repeat(pad);
  return sp(`${edge}${button.label}${edge}`, { ...fill, bold: !button.disabled && button.tone !== "quiet" && button.tone !== "plain", ...!button.disabled && { action: button.action } });
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
  const plainHead = [sp(" ".repeat(indent)), button];
  const head = spec.isSelected ? markButtonAt(plainHead, 1) : plainHead;
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
function inputField(value, placeholder, width, showCursor, at) {
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
  const chars = Array.from(value);
  const caret = Math.min(Math.max(0, at ?? chars.length), chars.length);
  if (caret === chars.length) {
    const shown = cellWidth(value) >= room ? tailCells(value, room - 1) : value;
    return box([sp(shown, { color: FILL.field.color }), ...showCursor ? [sp(" ", { color: FILL.field.color, inverse: true })] : []]);
  }
  const look = { color: FILL.field.color };
  let from = 0;
  while (from < caret && cellWidth(chars.slice(from, caret + 1).join("")) > room)
    from++;
  const before = chars.slice(from, caret).join("");
  const after = cutCells(chars.slice(caret + 1).join(""), Math.max(0, room - cellWidth(before) - cellWidth(chars[caret])));
  return box([sp(before, look), sp(chars[caret], showCursor ? { ...look, inverse: true } : look), sp(after, look)]);
}

// packages/mod-kit/src/widgets/select-list.ts
function selectList(spec) {
  const max = spec.maxShown ?? 8;
  const total = spec.choices.length;
  const start = total <= max ? 0 : Math.min(Math.max(0, spec.cursor - Math.floor(max / 2)), total - max);
  const shown = spec.choices.slice(start, start + max);
  const bar = sp(spec.rail === false ? "" : SYMBOL.bar, ACCENT);
  const lines = [];
  const blank = () => [bar, sp(" ")];
  const padded = (rows) => [...rows, ...Array.from({ length: Math.max(0, 2 - rows.length) }, blank)];
  if (start > 0)
    lines.push([bar, sp(`  ↑ ${start} more`, DIM)]);
  shown.forEach((choice, n) => {
    const idx = start + n;
    if (spec.spaced && n > 0)
      lines.push(blank());
    const rows = choice.isWriteIn ? choiceRows(choice, idx, spec) : padded(choiceRows(choice, idx, spec));
    lines.push(...withAction(isCursorRow(spec, idx) ? rows.map((line) => tinted(line, spec.width, CURSOR_ROW)) : rows.map((line) => hoverTinted(line, spec.width)), spec.actionFor(idx)));
  });
  const below = total - start - shown.length;
  if (below > 0)
    lines.push([bar, sp(`  ↓ ${below} more`, DIM)]);
  return lines;
}
function choiceMark(spec, idx) {
  const isPicked = spec.isPicked(idx);
  if (!spec.multi)
    return isPicked ? sp(SYMBOL.radioOn, spec.isDefault?.(idx) ? DIM : DONE) : sp(SYMBOL.radioOff, DIM);
  return isPicked ? sp(SYMBOL.boxOn, spec.isDefault?.(idx) ? DIM : DONE) : sp(SYMBOL.boxOff, DIM);
}
var isCursorRow = (spec, idx) => spec.focused && idx === spec.cursor;
function choiceRows(choice, idx, spec) {
  const bar = sp(spec.rail === false ? "" : SYMBOL.bar, ACCENT);
  const isAt = isCursorRow(spec, idx);
  const gap = spec.multi ? "  " : " ";
  const lead = [bar, isAt ? sp(`${SYMBOL.selectEdge} `, { bold: true }) : sp("  "), choiceMark(spec, idx), sp(gap)];
  const under = [bar, sp(`   ${gap}`)];
  const rows = choiceLines(choice, idx, spec, lead, under);
  return rows;
}
function tinted(line, width, fill) {
  const [rail, ...rest] = line;
  const filled = rest.map((span) => span.bg ? span : { ...span, bg: fill, rowTint: true });
  const room = Math.max(0, width - widthOf(line));
  return [rail, ...filled, ...room > 0 ? [sp(" ".repeat(room), { bg: fill, rowTint: true })] : []];
}
function hoverTinted(line, width) {
  const [rail, ...rest] = line;
  const room = Math.max(0, width - widthOf(line));
  return [rail, ...rest.map((span) => ({ ...span, rowTint: true })), ...room > 0 ? [sp(" ".repeat(room), { rowTint: true })] : []];
}
function choiceLines(choice, idx, spec, lead, under) {
  const isAt = idx === spec.cursor;
  if (choice.isWriteIn)
    return writeInRows(choice, isAt, lead, under, spec);
  return [...hang(lead, under, choice.label, spec.width, { isLabel: true, ...isCursorRow(spec, idx) && { bold: true } }), ...choice.description ? hang(under, under, choice.description, spec.width, DIM) : []];
}
function writeInRows(choice, isAt, lead, under, spec) {
  const typed = spec.writeIn;
  const fieldLead = lead.slice(0, -1);
  if (isAt)
    return [[...fieldLead, ...inputField(typed, choice.label, spec.width - widthOf(fieldLead), spec.focused)]];
  if (typed !== "")
    return hang(lead, under, typed, spec.width, {});
  return hang(lead, under, choice.label, spec.width, { ...DIM, isLabel: true });
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
  const overRow = span.rowTint === true && [look.hover, look.pressed].some((key) => key !== undefined && lineHoverKey(line) === key);
  if (overRow)
    return span.bg !== undefined && span.bg !== CURSOR_ROW ? span : { ...span, bg: CURSOR_ROW };
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
function reviewList(items, width, options = {}) {
  const isRailed = options.rail !== false;
  const bar = isRailed ? rail(GRAY) : [sp("   ")];
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
    return [isRailed ? [sp(SYMBOL.bar, GRAY)] : [sp(" ")], ...entry];
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
  const ordered = [...q.options.filter(isRecommended), ...q.options.filter((o) => !isRecommended(o))];
  if (ordered.length === 0 || !q.other)
    return ordered;
  return [...ordered, { value: WRITE_IN, label: "Type something." }];
}
function initial(form) {
  const chosen = form.questions.map((q) => isConfirm(form) || q.multi ? undefined : q.options.find(isRecommended)?.value);
  return {
    page: 0,
    cursor: form.questions.map(() => 0),
    picked: form.questions.map((q) => isConfirm(form) || !q.multi ? [] : q.options.filter(isRecommended).map((o) => o.value)),
    text: form.questions.map(() => ""),
    answered: form.questions.map(() => false),
    chosen,
    phase: "active",
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
  if (!q)
    return;
  return s.chosen[0] ?? (choicesOf(q).length === 1 ? choicesOf(q)[0].value : undefined);
}
var PAUSE = "pause";
var GO_BACK = "go-back:";
var canChat = (form) => form.source !== "plugin";
var isSinglePage = (form) => form.source === "plugin";
var isConfirm = (form) => form.confirm === true;
var isOneQuestion = (form) => !isSinglePage(form) && form.questions.length === 1 && menuRows(form).length === 0;
var isReview = (form, s) => !isSinglePage(form) && s.page === form.questions.length;
var isOnNav = (form, s) => s.onNav === true || isReview(form, s);
function navIds(form, s) {
  const ids = s.page > firstPage(s) && !isReview(form, s) ? ["back", "next"] : ["next"];
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
  if (!q.multi)
    return s.chosen[i] === value;
  return s.picked[i].includes(value) || value === WRITE_IN && s.text[i].trim() !== "";
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
      if (q.parts)
        for (const part of q.parts)
          out[part.id] = values.filter((v) => part.values.includes(v));
      else
        out[q.id] = typed === "" ? values : values.length > 0 ? { value: values, note: typed } : { writeIn: typed };
    } else {
      const value = s.chosen[i];
      out[q.id] = value === WRITE_IN ? { writeIn: typed } : value;
    }
  });
  return out;
}
function goTo(form, s, page) {
  const last = isSinglePage(form) ? 0 : form.questions.length;
  return { ...s, page: Math.max(firstPage(s), Math.min(last, page)) };
}
var firstPage = (s) => s.contextPaged ? -1 : 0;
var isContextPage = (s) => s.page < 0;
function advance(form, s) {
  const i = s.page;
  const q = form.questions[i];
  const accepts = q !== undefined && (q.multi ? s.picked[i].length > 0 : s.chosen[i] !== undefined);
  return goTo(form, accepts ? { ...s, answered: markAnswered(s, i) } : s, i + 1);
}
function moveCursor(form, s, by) {
  const q = form.questions[s.page];
  const count = q ? choicesOf(q).length : 0;
  if (count === 0)
    return s;
  return { ...s, cursor: replaceAt(s.cursor, s.page, (s.cursor[s.page] + by + count) % count) };
}
function toggled(s, i, value) {
  const has = s.picked[i].includes(value);
  return { ...s, picked: replaceAt(s.picked, i, has ? s.picked[i].filter((p) => p !== value) : [...s.picked[i], value]), answered: markAnswered(s, i) };
}
function chose(s, i, value) {
  if (value === WRITE_IN && s.text[i].trim() === "")
    return s;
  return { ...s, chosen: replaceAt(s.chosen, i, value), answered: markAnswered(s, i) };
}
function toggleAtCursor(form, s) {
  const q = form.questions[s.page];
  const value = q && choicesOf(q)[s.cursor[s.page]]?.value;
  if (value === undefined)
    return s;
  return q?.multi ? toggled(s, s.page, value) : chose(s, s.page, value);
}
function confirm(form, s) {
  const i = s.page;
  const q = form.questions[i];
  if (!q)
    return s;
  const value = choicesOf(q)[s.cursor[i]]?.value;
  if (choicesOf(q).length > 0 && !q.multi) {
    const picked = value === undefined ? s : chose(s, i, value);
    return value !== undefined && picked.chosen[i] === value ? { ...picked, page: i + 1 } : picked;
  }
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
    return chose({ ...s, cursor }, i, value);
  return { ...toggled(s, i, value), cursor };
}
function typeChar(form, s, ch) {
  const i = s.page;
  const text = replaceAt(s.text, i, s.text[i] + ch);
  const q = form.questions[i];
  const isWriteIn = q !== undefined && choicesOf(q).length > 0;
  if (!isWriteIn)
    return { ...s, text, answered: markAnswered(s, i) };
  if (text[i].trim() === "")
    return { ...s, text };
  return q.multi ? { ...s, text, answered: markAnswered(s, i) } : { ...s, text, chosen: replaceAt(s.chosen, i, WRITE_IN), answered: markAnswered(s, i) };
}
function deleteChar(s) {
  const i = s.page;
  const text = replaceAt(s.text, i, s.text[i].slice(0, -1));
  if (s.chosen[i] !== WRITE_IN || text[i].trim() !== "")
    return { ...s, text };
  return { ...s, text, chosen: replaceAt(s.chosen, i, undefined), answered: replaceAt(s.answered, i, false) };
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
function sendPicked(form, s) {
  const picked = toggleAtCursor(form, s);
  return send(form, picked) ?? { state: picked };
}
var DOUBLE_MS = 450;
function optionClick(form, s, idx, now) {
  const last = s.lastClick;
  const isDouble = last !== undefined && last.page === s.page && last.idx === idx && now - last.at < DOUBLE_MS;
  if (!isDouble)
    return { state: { ...clickChoice(form, s, idx), lastClick: { page: s.page, idx, at: now } } };
  const once = { ...s, lastClick: undefined };
  const q = form.questions[s.page];
  const value = q && choicesOf(q)[idx]?.value;
  const isTaken = q !== undefined && value !== undefined && (q.multi ? isPicked(q, once, s.page, idx) : once.chosen[s.page] === value);
  if (!isTaken)
    return { state: once };
  if (isSinglePage(form))
    return send(form, once) ?? { state: once };
  return { state: advance(form, once) };
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
function settled(form, before, effect) {
  if (!effect || effect.state.page === before.page)
    return effect;
  if (isOneQuestion(form) && effect.state.page > 0 && effect.post === undefined && effect.state.phase === "active") {
    const kept = { ...effect.state, page: 0 };
    return send(form, kept) ?? { state: kept };
  }
  return { ...effect, state: { ...effect.state, onNav: undefined, navAt: "next", pageTop: undefined, followed: undefined } };
}
function perform(action, form, armed) {
  return settled(form, armed, performOn(action, form, armed));
}
function performOn(action, form, armed) {
  if (action.type === "hide")
    return { state: armed, post: { type: "hide", formId: form.id } };
  if (armed.phase !== "active")
    return;
  if (action.type === "chat")
    return chat(form, armed);
  const s = action.type === "option" ? disarm(armed) : { ...disarm(armed), lastClick: undefined };
  switch (action.type) {
    case "page":
      return { state: goTo(form, s, action.page) };
    case "advance":
      return { state: advance(form, s) };
    case "option":
      return optionClick(form, s, action.idx, Date.now());
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
  if (isSinglePage(form) || !isOnNav(form, s))
    return false;
  return !(navAtOf(form, s) === "next" && isReview(form, s) && !canSubmit(form, s));
}
function reviewKey(ev, form, s) {
  const ids = navIds(form, s);
  const at = ids.indexOf(navAtOf(form, s));
  if (ev.key === "left")
    return { state: at > 0 ? { ...s, navAt: ids[at - 1] } : goTo(form, s, s.page - 1) };
  if (ev.key === "right")
    return { state: at < ids.length - 1 ? { ...s, navAt: ids[at + 1] } : s };
  if (ev.key !== "tab")
    return;
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
    return isSinglePage(form) ? sendPicked(form, s) : { state: confirm(form, s) };
  if (key === "left" || key === "right")
    return { state: isOneQuestion(form) && key === "right" ? s : goTo(form, s, s.page + (key === "left" ? -1 : 1)) };
  if (key === "up" || key === "down")
    return gridKey(ev, form, s);
  if (isSpace && !typing)
    return { state: toggleAtCursor(form, s) };
  if (!typing)
    return;
  if (key === "backspace" || key === "delete")
    return { state: deleteChar(s) };
  const ch = isSpace ? " " : key;
  if (ch.length === 1 && !ev.ctrl && !ev.meta)
    return { state: typeChar(form, s, ch) };
  return;
}
function contextKey(ev, form, s) {
  if (ev.key === "up" || ev.key === "down")
    return { state: { ...s, ctxTop: Math.max(0, (s.ctxTop ?? 0) + (ev.key === "up" ? -1 : 1)) } };
  if (isEnter(ev) || ev.key === "right" || ev.key === "tab" && !ev.shift)
    return { state: goTo(form, s, 0) };
  return { state: s };
}
function keyEffect(ev, form, armed) {
  if (armed.phase !== "active")
    return;
  if (ev.ctrl && (ev.key === "x" || ev.key === "c"))
    return chat(form, armed);
  const s = { ...disarm(armed), lastClick: undefined };
  if (isConfirm(form))
    return;
  if (isContextPage(s))
    return settled(form, s, contextKey(ev, form, s));
  if (ev.shift && (ev.key === "up" || ev.key === "down"))
    return { state: { ...s, ctxTop: Math.max(0, (s.ctxTop ?? 0) + (ev.key === "up" ? -1 : 1)) } };
  if (ev.key === "tab" && (isSinglePage(form) || isOneQuestion(form)))
    return { state: s };
  if (ev.key === "tab" && !isReview(form, s))
    return settled(form, s, { state: goTo(form, s, s.page + (ev.shift ? -1 : 1)) });
  return settled(form, s, isOnNav(form, s) ? navKey(ev, form, armed, s) : questionKey(ev, form, s));
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
var CODE = { color: "#7fa7ad" };
function styledWords(text, style) {
  const parts = text.split("`");
  const balanced = parts.length % 2 === 1;
  return parts.flatMap((part, n) => {
    const isCode = balanced && n % 2 === 1;
    const piece = !balanced && n > 0 ? `\`${part}` : part;
    return piece.split(/( +)/).filter((w) => w !== "").map((w) => sp(w, isCode ? { ...style, ...CODE } : style));
  });
}
function richHang(first, rest, text, width, style = {}) {
  const out = [];
  let row = [...first];
  let lead = first;
  const flush = () => {
    while (row.length > lead.length && row[row.length - 1].t.trim() === "")
      row.pop();
    out.push(row);
    lead = rest;
    row = [...rest];
  };
  for (const word of styledWords(text, style)) {
    const isSpace = word.t.trim() === "";
    if (isSpace && row.length === lead.length)
      continue;
    if (widthOf(row) + cellWidth(word.t) > width && row.length > lead.length) {
      flush();
      if (isSpace)
        continue;
    }
    const room = Math.max(1, width - widthOf(row));
    if (cellWidth(word.t) <= room)
      row.push(word);
    else
      for (const chunk of chunkCells(word.t, Math.max(1, width - widthOf(rest)))) {
        if (row.length > lead.length)
          flush();
        row.push({ ...word, t: chunk });
      }
  }
  if (row.length > lead.length || out.length === 0)
    flush();
  return out;
}
function contextBody(context, width) {
  const out = [];
  for (const raw of contextText(context).split(`
`)) {
    const t = raw.trimEnd();
    const bullet = /^\s*[-*] +/.exec(t);
    if (t.trim() === "") {
      if (out.length > 0 && out[out.length - 1].length > 0)
        out.push([]);
    } else if (bullet)
      out.push(...richHang([sp("  • ", DIM)], [sp("    ")], t.slice(bullet[0].length), width));
    else if (/^#{1,6} /.test(t))
      out.push(...richHang([], [], t.replace(/^#+ +/, ""), width, { bold: true }));
    else if (t.endsWith(":") && t.length <= 60)
      out.push(...richHang([], [], t.slice(0, -1), width, { bold: true }));
    else
      out.push(...richHang([], [], t, width));
  }
  while (out.length > 0 && out[out.length - 1].length === 0)
    out.pop();
  return out;
}
var BOX_CELLS = 3;
var MIN_CTX = 3;
var CTX_FLOOR = 8;
var BLANK = [sp(" ")];
var RULE_COLOR = "#3a3a3a";
var rule = (width) => [sp("─".repeat(width), { color: RULE_COLOR })];
function contextBox(context, width, ctx) {
  if (ctx.cap <= 0)
    return [];
  const inner = width - BOX_CELLS;
  const body = contextBody(context, inner);
  const cap = Math.min(ctx.cap, body.length);
  const top = Math.min(Math.max(0, ctx.top), Math.max(0, body.length - cap));
  const bar = scrollBar(cap, body.length, top);
  const shown = body.slice(top, top + cap);
  const lines = shown.map((line, n) => {
    const clipped = clipLine(line, inner);
    const text = clipped.length === 0 ? BLANK : clipped;
    const pad = Math.max(0, inner - widthOf(text));
    return [...text, ...body.length > cap ? [sp(" ".repeat(pad)), ...bar[n]] : []];
  });
  return lines;
}
function answerSummary(q, s, i) {
  const choices = choicesOf(q);
  if (choices.length === 0)
    return s.text[i] === "" ? "(blank)" : s.text[i];
  const label = (v) => v === WRITE_IN ? `“${s.text[i]}”` : choices.find((o) => o.value === v)?.label ?? v;
  if (!q.multi)
    return label(s.chosen[i] ?? "");
  const values = [...s.picked[i], ...s.text[i].trim() !== "" ? [WRITE_IN] : []];
  return values.length === 0 ? "none" : values.map(label).join(", ");
}
function wonOf(q, won) {
  if (!q.parts)
    return won[q.id];
  const recorded = q.parts.map((part) => won[part.id]).filter((raw) => raw !== undefined && raw !== null);
  if (recorded.length === 0)
    return;
  const valuesOf = (raw) => Array.isArray(raw) ? raw : typeof raw === "object" && raw !== null && Array.isArray(raw.value) ? raw.value : [];
  const notes = recorded.flatMap((raw) => typeof raw === "object" && raw !== null && typeof raw.note === "string" ? [raw.note] : []);
  const value = recorded.flatMap(valuesOf);
  return notes.length > 0 ? { value, note: notes.join("; ") } : value;
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
function questionPage(q, s, i, base) {
  const view = { ...base, focused: base.focused && !s.onNav, pressing: base.pressing && !s.onNav };
  const number = `${i + 1}.`.padEnd(4);
  const bar = [sp(" ".repeat(number.length))];
  const lines = hang([sp(number, DIM)], bar, q.label, view.width, { bold: true });
  if (q.multi)
    lines.push([...bar, sp("pick any number", DIM)]);
  if (q.context)
    lines.push(...hang(bar, bar, q.context, view.width, DIM));
  lines.push(BLANK);
  const choices = choicesOf(q);
  if (choices.length === 0) {
    lines.push([sp("  "), ...textCursor(s.text[i], "Type your answer", view.focused)]);
    return lines;
  }
  lines.push(...selectList({
    choices: choices.map((c) => ({ label: c.label, description: c.description, isWriteIn: c.value === WRITE_IN })),
    cursor: s.cursor[i],
    multi: q.multi,
    isPicked: (idx) => isPicked(q, s, i, idx),
    isDefault: () => !s.answered[i],
    writeIn: s.text[i],
    width: view.width,
    focused: view.focused,
    ...view.pressing && { pressing: true },
    maxShown: choices.length,
    actionFor: (idx) => ({ type: "option", idx }),
    rail: false,
    spaced: true
  }));
  return lines;
}
function reviewList2(form, s, view) {
  const isOpen = s.phase === "active" && form.status === "open";
  const won = form.status === "open" ? undefined : form.won;
  return reviewList(form.questions.map((q, i) => ({
    label: q.label,
    summary: won ? wonSummary(q, wonOf(q, won)) : s.answered[i] ? answerSummary(q, s, i) : undefined,
    ...isOpen && { action: { type: "page", page: i } }
  })), view.width, { rail: false });
}
function reviewPage(form, s, view) {
  const missing = unansweredCount(s);
  const bar = [sp("   ")];
  const lines = [...reviewList2(form, s, view), BLANK, [sp(ICON.review, DONE), sp("  Submit your answers?", { bold: true })]];
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
  return [...reviewList2(form, s, view), BLANK, ...hang([], [], end.text, view.width, end.isWarn ? WARN : {})];
}
function progress(form, s, view) {
  const n = form.questions.length;
  const dots = form.questions.flatMap((_, i) => [
    sp(s.answered[i] ? "☑" : "☐", { color: i === s.page ? "white" : "#8a8a8a" }),
    sp(" ")
  ]);
  const marker = s.contextPaged ? [sp("◆", { color: isContextPage(s) ? "white" : "#8a8a8a" }), sp(" ")] : [];
  const q = form.questions[s.page];
  const where = [sp(isContextPage(s) ? ` context, then ${n} question${n === 1 ? "" : "s"}` : q ? ` question ${s.page + 1} of ${n}` : " review", DIM)];
  const missing = unansweredCount(s);
  const left = sp(missing === 0 ? "all answered" : `${missing} to answer`, DIM);
  const review = isOneQuestion(form) ? [] : [sp("⏎", { color: isReview(form, s) ? "white" : "#8a8a8a" }), sp(" ")];
  const line = [...marker, ...dots, ...review, ...where];
  const room = view.width - widthOf(line) - widthOf([left]);
  return room >= 2 ? [...line, sp(" ".repeat(room)), left] : line;
}
var MORE = { type: "menu", hit: { type: "toggle" } };
function spanAt2(id, left, line) {
  return id === "chat" ? line.length - 1 : 1 + 2 * left.indexOf(id);
}
function navRows(form, s, view) {
  const n = form.questions.length;
  const page = s.page;
  const back = { label: "← Back", action: { type: "page", page: page - 1 }, tone: "secondary", disabled: page === firstPage(s) };
  const forward = (label) => ({ label, action: { type: "advance" }, tone: "secondary" });
  const submit = { label: unansweredCount(s) === 0 || form.source === "gate" ? "Submit" : "Submit anyway", action: { type: "send" }, tone: "brand", disabled: !canSubmit(form, s) };
  const next = isOneQuestion(form) || page === n ? submit : page < n - 1 ? forward("Next →") : forward("Review →");
  const aside = chatButton(form, s);
  const rows = page === n ? menuRows(form) : [];
  const more = { label: MORE_ACTIONS, action: MORE, tone: "quiet" };
  const left = [...page === n || isOneQuestion(form) && !s.contextPaged ? [] : [["back", back]], ["next", next], ...rows.length === 0 ? [] : [["more", more]]];
  const line = buttonRow(left.map(([, button]) => button), aside, view.width, 2);
  const marked = (row) => {
    if (!view.focused || !isOnNav(form, s))
      return row;
    const at = spanAt2(navAtOf(form, s), left.map(([id]) => id), row);
    return markButtonAt(row, at, { pressing: view.pressing && !s.menu.open });
  };
  if (rows.length === 0)
    return [marked(line)];
  const at = line.findIndex((span) => span.action === MORE);
  const indent = widthOf(line.slice(0, at));
  const hung = menu({ ...s.menu, label: MORE_ACTIONS, rows, width: view.width, indent, pressing: view.pressing === true, actionFor: (hit) => ({ type: "menu", hit }) });
  return [marked(line), ...hung.slice(1)];
}
function confirmFoot(form, view) {
  return [BLANK, ...errorLines(form, view)];
}
function submitRow(form, s, view) {
  return buttonRow([{ label: "Submit", action: { type: "send" }, tone: "brand", disabled: !canSubmit(form, s) }], undefined, view.width, 2);
}
function errorLines(form, view) {
  if (form.status !== "open" || !form.error)
    return [];
  const lead = [sp(SYMBOL.warn, WARN), sp("  ")];
  return [[sp(" ")], ...hang(lead, [sp("   ")], form.error, view.width, WARN)];
}
function chatButton(form, s) {
  if (!canChat(form))
    return;
  return s.chatArmed ? { label: `${ICON.chat} Press again to chat`, action: { type: "chat" }, tone: "caution" } : { label: `${ICON.chat} Chat about this`, action: { type: "chat" }, tone: "neutral" };
}
function contextPage(form, s, view, head, ctx) {
  const n = form.questions.length;
  if (!ctx.compact)
    head.push([sp(`${n} question${n === 1 ? "" : "s"} after this`, DIM)], BLANK);
  const start = { label: "Start →", action: { type: "page", page: 0 }, tone: "secondary" };
  const line = buttonRow([start], chatButton(form, s), view.width, 2);
  const marked = view.focused ? markButtonAt(line, 1, { pressing: view.pressing }) : line;
  const first = form.questions[0];
  const next = first ? clipLine([sp("Next: ", DIM), sp(first.label)], view.width) : BLANK;
  const foot = ctx.compact ? [rule(view.width), marked] : [BLANK, rule(view.width), BLANK, next, BLANK, marked];
  return { head, page: contextBox(form.context ?? "", view.width, ctx), foot };
}
function draw(form, s, view, ctx) {
  const head = [brandBar(`mattstack · ${form.title}`, view.width, { type: "hide" }), BLANK];
  if (s.phase !== "active" || form.status !== "open")
    return { head, page: closedPage(form, s, view), foot: [] };
  const gap = BLANK;
  if (isContextPage(s) && form.context && !isConfirm(form))
    return contextPage(form, s, view, head, ctx ?? { cap: Number.MAX_SAFE_INTEGER, top: 0 });
  if (form.context && isConfirm(form))
    head.push(...hang([], [], contextText(form.context), view.width));
  else if (form.context && !s.contextPaged)
    head.push(...contextBox(form.context, view.width, ctx ?? { cap: Number.MAX_SAFE_INTEGER, top: 0 }), gap, rule(view.width));
  if (isConfirm(form))
    return { head, page: [], foot: confirmFoot(form, view) };
  const q = form.questions[s.page];
  const page = [...progressRows(form, s, view), ...q ? questionPage(q, s, s.page, view) : reviewPage(form, s, view)];
  const nav = [[sp(" ")], ...isSinglePage(form) ? [submitRow(form, s, view)] : navRows(form, s, view)];
  const foot = [BLANK, rule(view.width), ...errorLines(form, view), ...nav];
  return { head, page, foot };
}
function progressRows(form, s, view) {
  return isSinglePage(form) || isOneQuestion(form) && !s.contextPaged ? [BLANK] : [BLANK, progress(form, s, view), BLANK];
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
  return tallest + progressRows(form, s, view).length;
}
var BAR_CELLS = 3;
var FIXED_TOP = 2;
function contextFit(form, s, view, rows, turned) {
  if (!form.context || isConfirm(form) || s.phase !== "active" || form.status !== "open")
    return { usedWheel: false, paged: false };
  const total = contextBody(form.context, view.width - BOX_CELLS).length;
  const most = (cap) => Math.max(0, contextBody(form.context ?? "", view.width - BOX_CELLS - BAR_CELLS).length - cap);
  const last = Math.max(0, form.questions.length - 1);
  const inline = { ...s, page: Math.min(Math.max(0, s.page), last), contextPaged: undefined, menu: { ...s.menu, open: false } };
  const bare = draw(form, inline, view, { cap: 0, top: 0 });
  const pageRows = Math.max(bare.page.length, tallestQuestion(form, inline, view));
  const room = rows - bare.head.length - pageRows - bare.foot.length;
  const scrolled = (cap, compact) => ({ cap, top: Math.min(Math.max(0, (s.ctxTop ?? 0) + turned), most(cap)), ...compact && { compact } });
  if (total <= Math.max(MIN_CTX, room))
    return { ctx: { cap: total, top: 0 }, usedWheel: false, paged: false };
  if (room >= CTX_FLOOR)
    return { ctx: scrolled(room), usedWheel: true, paged: false };
  if (!isContextPage(s))
    return { usedWheel: false, paged: true };
  const roomy = draw(form, s, view, { cap: 0, top: 0 });
  const compact = rows - roomy.head.length - roomy.foot.length < MIN_CTX;
  const page = compact ? draw(form, s, view, { cap: 0, top: 0, compact }) : roomy;
  const cap = Math.max(1, rows - page.head.length - page.foot.length);
  return { ctx: total <= cap ? { cap: total, top: 0, ...compact && { compact } } : scrolled(cap, compact), usedWheel: total > cap, paged: true };
}
function fittedLines(form, s, view, rows, wheel) {
  const wheelTurn = wheel === undefined || s.wheelAt === undefined ? 0 : wheel - s.wheelAt;
  const { ctx, usedWheel, paged } = contextFit(form, s, view, rows, wheelTurn);
  const keptAt = (width) => ({
    ...wheel !== undefined && { wheelAt: wheel },
    ...ctx && { ctxTop: Math.min(ctx.top, Math.max(0, contextBody(form.context ?? "", width - BOX_CELLS).length - ctx.cap)) },
    contextPaged: paged
  });
  const kept = keptAt(view.width);
  const full = draw(form, s, view, ctx);
  const room = rows - FIXED_TOP - full.foot.length;
  if (full.head.length - FIXED_TOP + full.page.length <= room) {
    if (isContextPage(s)) {
      const spare = Math.max(0, rows - full.head.length - full.page.length - full.foot.length);
      return { lines: [...full.head, ...full.page, ...Array.from({ length: spare }, () => BLANK), ...full.foot], top: 0, ...kept };
    }
    if (s.phase === "active" && form.status === "open" && !isConfirm(form)) {
      const height = Math.max(full.page.length, Math.min(tallestQuestion(form, s, view), rows - full.head.length - full.foot.length));
      const page = [...full.page, ...Array.from({ length: height - full.page.length }, () => BLANK)];
      const spare = Math.max(0, rows - full.head.length - page.length - full.foot.length);
      return { lines: [...full.head, ...Array.from({ length: spare }, () => BLANK), ...page, ...full.foot], top: 0, ...kept };
    }
    const pad = s.phase === "active" && form.status === "open" && !isConfirm(form) ? { height: tallestQuestion(form, s, view), filler: BLANK } : undefined;
    return { lines: fitToRows(full, rows, () => full, pad), top: 0, ...kept };
  }
  const inner = { ...view, width: Math.max(20, view.width - BAR_CELLS) };
  const narrow = draw(form, s, inner, ctx);
  const region = [...narrow.head.slice(FIXED_TOP), ...narrow.page];
  const windowRows = Math.max(1, rows - FIXED_TOP - narrow.foot.length);
  const turned = usedWheel ? 0 : wheelTurn;
  const most = maxScroll(region.length, windowRows);
  const wheeled = Math.min(Math.max(0, (s.pageTop ?? 0) + turned), most);
  const cursor = `${s.page}:${s.onNav ? "nav" : s.cursor[s.page] ?? ""}`;
  const top = cursor === s.followed ? wheeled : followCursor(region, s, windowRows, wheeled);
  const bar = scrollBar(windowRows, region.length, top);
  const shown = region.slice(top, top + windowRows).map((line, n) => Object.assign([...clipLine(line, inner.width), ...bar[n] ?? []], line.action === undefined ? {} : { action: line.action }));
  return { lines: [...full.head.slice(0, FIXED_TOP), ...shown, ...narrow.foot], top, followed: cursor, ...keptAt(inner.width) };
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
    ui.setState(effect.state);
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
  const paged = fitted.contextPaged === true;
  const page = paged && s.contextPaged === undefined ? -1 : !paged && s.page < 0 ? 0 : s.page;
  if (fitted.top !== (s.pageTop ?? 0) || fitted.followed !== s.followed || fitted.wheelAt !== s.wheelAt || fitted.ctxTop !== s.ctxTop || paged !== (s.contextPaged ?? false) || page !== s.page)
    ui.setState({ ...s, pageTop: fitted.top, followed: fitted.followed, wheelAt: fitted.wheelAt, ctxTop: fitted.ctxTop, contextPaged: paged, page });
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
