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
  return spans.reduce((n, span) => n + span.t.length, 0);
}
function spanAt(line, x) {
  let from = 0;
  for (const span of line) {
    const to = from + span.t.length;
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
      if (next.length > width && row !== "") {
        out.push(row);
        row = word;
      } else
        row = next;
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
  boxOff: "◻"
};
var ICON = {
  layers: "",
  done: "",
  todo: "",
  missing: "",
  back: "",
  next: "",
  chat: "",
  single: "\uDB81\uDC3E",
  multi: "\uDB80\uDD38",
  text: "\uDB81\uDE0E",
  review: "",
  edit: "",
  info: "",
  minimize: ""
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
function hovered(span) {
  return span.bg ? { ...span, bg: HOVER_FILL[span.bg] ?? span.bg } : { ...span, bg: "#404040", dim: false };
}
function pressed(span) {
  return span.bg ? { ...span, bg: PRESS_FILL[span.bg] ?? span.bg } : { ...span, bg: "#353535", dim: false };
}
var ACCENT = { color: "cyan" };
var GRAY = { color: "gray" };
var DONE = { color: "green" };
var WARN = { color: "yellow" };
var DIM = { dim: true };
var rail = (style) => [sp(SYMBOL.bar, style), sp("  ")];
var MUTED = { cyan: "#3d6f78", green: "#4d7a4d", yellow: "#857640", red: "#8a4a4a", gray: "#4a4a4a", [BRAND.pink]: "#7a3d58" };
var MUTED_FILL = { [BRAND.pink]: { bg: "#6e3a52", color: "#1f1a2b" }, [BRAND.pinkDeep]: { bg: "#5e2f45", color: "#1f1a2b" }, [FILL.secondary.bg]: { bg: "#24313f", color: "#8a8a8a" }, [FILL.disabled.bg]: FILL.disabled, [FILL.field.bg]: { bg: "#262626", color: "#8a8a8a" } };
function muted(span) {
  if (span.bg)
    return { ...span, ...MUTED_FILL[span.bg] ?? { bg: "#3a3a3a", color: "#8a8a8a" }, dim: false };
  if (span.color)
    return { ...span, color: MUTED[span.color] ?? span.color, dim: false };
  return { ...span, color: span.dim ? "#555555" : "#8a8a8a", dim: false };
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
// packages/mod-kit/src/widgets/brand-bar.ts
var fit = (text, room) => text.length <= room ? text.padEnd(room) : `${text.slice(0, Math.max(0, room - 1))}…`;
function brandBar(label, width, hide) {
  const look = { bg: BRAND.pink, color: BRAND.plum, bold: true };
  const text = `  ${BRAND.glyph}  ${label}`;
  if (hide === undefined)
    return [sp(fit(text, width), look)];
  const button = ` ${ICON.minimize} Hide `;
  return [sp(fit(text, width - button.length - 1), look), sp(button, { bg: BRAND.pinkDeep, color: BRAND.plum, action: hide }), sp(" ", look)];
}
// packages/mod-kit/src/widgets/buttons.ts
var TONE_FILL = { primary: FILL.primary, secondary: FILL.secondary, neutral: FILL.neutral, caution: FILL.caution, brand: FILL.brand };
var ROOMY = { indent: 3, pad: 2, gap: 2 };
var COMPACT = { indent: 1, pad: 1, gap: 1 };
function buttonSpan(button, pad = ROOMY.pad) {
  const fill = button.disabled ? FILL.disabled : TONE_FILL[button.tone ?? "secondary"];
  const edge = " ".repeat(pad);
  return sp(`${edge}${button.label}${edge}`, { ...fill, bold: !button.disabled, ...!button.disabled && { action: button.action } });
}
var widthWith = (left, right, { indent, pad, gap }) => indent + left.reduce((n, button) => n + button.label.length + 2 * pad + gap, 0) + (right ? gap + right.label.length + 2 * pad : 0);
var cut = (label, room) => label.length <= room ? label : `${label.slice(0, Math.max(0, room - 1))}…`;
function buttonRow(left, right, width) {
  const space = widthWith(left, right, ROOMY) <= width ? ROOMY : COMPACT;
  const line = [sp(" ".repeat(space.indent))];
  for (const button of left)
    line.push(buttonSpan(button, space.pad), sp(" ".repeat(space.gap)));
  if (!right)
    return line;
  const room = width - widthOf(line) - space.gap - 2 * space.pad;
  const end = buttonSpan({ ...right, label: cut(right.label, Math.max(1, room)) }, space.pad);
  line.push(sp(" ".repeat(Math.max(space.gap, width - widthOf(line) - end.t.length))), end);
  return line;
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
    const hint = placeholder.slice(0, room);
    return box([sp(hint.slice(0, 1) || " ", showCursor ? { ...PLACEHOLDER, inverse: true } : PLACEHOLDER), sp(hint.slice(1), PLACEHOLDER)]);
  }
  const shown = value.length >= room ? value.slice(value.length - room + 1) : value;
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
  if (choice.isWriteIn)
    return writeInRows(choice, isAt, lead, under, spec);
  if (!isAt)
    return [[...lead, sp(choice.label, { isLabel: true })], ...choice.description ? [[...under, sp(choice.description, DIM)]] : []];
  return [...hang(lead, under, choice.label, spec.width, { bold: true, isLabel: true }), ...choice.description ? hang(under, under, choice.description, spec.width, DIM) : []];
}
function writeInRows(choice, isAt, lead, under, spec) {
  const label = [...lead, sp(`${ICON.edit} `, ACCENT), sp(choice.label, { isLabel: true, ...isAt && { bold: true } })];
  const typed = spec.writeIn;
  if (isAt)
    return [label, [...under, ...inputField(typed, choice.description ?? "", spec.width - widthOf(under), spec.focused)]];
  if (typed !== "")
    return [label, [...under, sp(`“${typed}”`)]];
  return [label, ...choice.description ? [[...under, sp(choice.description, DIM)]] : []];
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
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
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
  const cost = (k) => tabText(tabs[k], room).length + 2;
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
  if (value === "")
    return [sp(placeholder.slice(0, 1), { inverse: true }), sp(placeholder.slice(1), DIM)];
  return [sp(value), sp(" ", { inverse: true })];
}
// mods/gate-form/src/band.tsx
function GateBand(props, surface) {
  const s = surface.state ?? {};
  const line = [
    sp(`${BRAND.glyph} mattstack gate waiting  `, { color: BRAND.pink, bold: true }),
    sp(props.title),
    sp("  "),
    buttonSpan({ label: "Open", action: "open", tone: "brand" })
  ];
  const lines = [line];
  surface.onPointer((ev) => {
    const key = hoverKeyAt(lines, ev.y, ev.x);
    if (ev.type === "down")
      return ev.button === "left" && key ? surface.setState({ hover: key, pressed: key }) : undefined;
    if (ev.type === "up") {
      if (s.pressed !== undefined && key === s.pressed && hitAt(lines[ev.y], ev.x) === "open")
        surface.post({ type: "reopen", formId: props.formId });
      return surface.setState({ hover: key });
    }
    const hover = ev.type === "leave" ? undefined : key;
    if (hover !== s.hover)
      surface.setState({ ...s, hover });
  });
  return renderLines(lines, surface.elements, { focused: true, hover: s.hover, pressed: s.pressed === s.hover ? s.pressed : undefined });
}
export {
  GateBand as default
};
