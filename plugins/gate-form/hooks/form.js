// packages/mod-kit/src/draw/cells.ts
var segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
var PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
var EMOJI = /\p{Emoji_Presentation}|\u20E3/u;
var EMOJI_BASE_WITH_VS16 = /^(?![A-Za-z])\p{Emoji}\uFE0F/u;
var ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]/u;
var WIDE_RANGES = [
  [4352, 4447],
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
      while (cellWidth(row) > width) {
        const piece = cutCells(row, width) || firstGrapheme(row);
        if (piece === row)
          break;
        out.push(piece);
        row = row.slice(piece.length);
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
var ACCENT = { color: "cyan" };
var GRAY = { color: "gray" };
var DONE = { color: "green" };
var WARN = { color: "yellow" };
var DIM = { dim: true };
var rail = (style) => [sp(SYMBOL.bar, style), sp("  ")];
var MUTED = { cyan: "#62a4b0", green: "#72b072", yellow: "#baa75c", red: "#c46e6e", gray: "#6e6e6e", [BRAND.pink]: "#b05680" };
var MUTED_FILL = { [BRAND.pink]: { bg: "#9e5270", color: "#1f1a2b" }, [BRAND.pinkDeep]: { bg: "#884465", color: "#1f1a2b" }, [FILL.secondary.bg]: { bg: "#334659", color: "#b8b8b8" }, [FILL.disabled.bg]: FILL.disabled, [FILL.field.bg]: { bg: "#323232", color: "#b8b8b8" }, [SCROLL.track]: { bg: "#353535" }, [SCROLL.thumb]: { bg: "#646464" } };
function muted(span) {
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
// packages/mod-kit/src/interact/pointer.ts
function lookOf(state, focused) {
  const hover = state?.hover;
  const held = state?.pressed;
  return { focused, hover, pressed: held === hover ? held : undefined };
}
function drawnAction(lines, armed) {
  for (const line of lines) {
    if (line.action !== undefined && JSON.stringify(line.action) === armed)
      return line.action;
    const span = line.find((piece) => piece.action !== undefined && JSON.stringify(piece.action) === armed);
    if (span)
      return span.action;
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
      return surface.setState({ ...s, pressed: key, hover: key, armed: JSON.stringify(hitAt(lines[ev.y], ev.x)) });
    }
    if (ev.type === "up") {
      if (s.pressed === undefined)
        return;
      const { armed } = s;
      surface.setState({ ...s, pressed: undefined, armed: undefined });
      const here = hitAt(lines[ev.y], ev.x);
      const isStill = s.hover === s.pressed && armed !== undefined;
      const action = here !== undefined && JSON.stringify(here) === armed ? here : isStill ? drawnAction(lines, armed) : undefined;
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
        engage?.();
        if (latest.keyPress)
          return;
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
function navRow(spec, width) {
  return buttonRow(spec.next ? [spec.back, spec.next] : [spec.back], spec.aside, width);
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
// mods/gate-form/src/form/state.ts
var WRITE_IN = "__other__";
var isRecommended = (o) => /\(recommended\)\s*$/i.test(o.label);
var replaceAt = (list, i, value) => list.map((old, k) => k === i ? value : old);
var markAnswered = (s, i) => replaceAt(s.answered, i, true);
function choicesOf(q) {
  if (q.options.length === 0)
    return q.options;
  return [...q.options, { value: WRITE_IN, label: "Something else", description: "Write in your answer" }];
}
function initial(form) {
  return {
    page: 0,
    cursor: form.questions.map((q) => Math.max(0, q.options.findIndex(isRecommended))),
    picked: form.questions.map(() => []),
    text: form.questions.map(() => ""),
    answered: form.questions.map(() => false),
    moved: form.questions.map(() => false),
    phase: "active",
    tabsFrom: 0
  };
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
  return { ...s, page: Math.max(0, Math.min(form.questions.length, page)) };
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
function send(form, s) {
  return { state: { ...s, phase: "submitted" }, post: { type: "answer", formId: form.id, answers: answersOf(form, s) } };
}
function chat(form, s) {
  if (!s.chatArmed)
    return { state: { ...s, chatArmed: true } };
  return { state: { ...disarm(s), phase: "chat" }, post: { type: "chat", formId: form.id, draft: answersOf(form, s) } };
}
function perform(action, form, armed) {
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
    case "option":
      return { state: clickChoice(form, s, action.idx) };
    case "send":
      return send(form, s);
  }
}
function reviewKey(ev, form, s) {
  if (ev.key === "left")
    return { state: goTo(form, s, s.page - 1) };
  if (ev.key === "return" || ev.key === "enter")
    return send(form, s);
  return;
}
function questionKey(ev, form, s) {
  const { key } = ev;
  const isSpace = key === " " || key === "space";
  const typing = isTyping(form, s);
  if (key === "return" || key === "enter")
    return { state: confirm(form, s) };
  if (key === "left" || key === "right")
    return { state: goTo(form, s, s.page + (key === "left" ? -1 : 1)) };
  if (key === "up" || key === "down")
    return { state: moveCursor(form, s, key === "up" ? -1 : 1) };
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
  if (ev.key === "tab")
    return { state: ev.shift ? goTo(form, s, s.page - 1) : advance(form, s) };
  return s.page === form.questions.length ? reviewKey(ev, form, s) : questionKey(ev, form, s);
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
var kindIcon = (q) => choicesOf(q).length === 0 ? ICON.text : q.multi ? ICON.multi : ICON.single;
function questionPage(q, s, i, view) {
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
    actionFor: (idx) => ({ type: "option", idx })
  }));
  return lines;
}
function reviewList2(form, s, view) {
  const isOpen = s.phase === "active";
  return reviewList(form.questions.map((q, i) => ({
    label: q.label,
    summary: s.answered[i] ? answerSummary(q, s, i) : undefined,
    ...isOpen && { action: { type: "page", page: i } }
  })), view.width);
}
function reviewPage(form, s, view) {
  const missing = unansweredCount(s);
  const bar = rail(ACCENT);
  const lines = [...reviewList2(form, s, view), [sp(SYMBOL.bar, GRAY)], [sp(ICON.review, DONE), sp("  Submit your answers?", { bold: true })]];
  if (missing > 0)
    lines.push([...bar, sp(`${missing} not answered; left out if you submit now`, WARN)]);
  return lines;
}
function closedPage(form, s, view) {
  const end = s.phase === "submitted" ? [sp(SYMBOL.end, GRAY), sp("  Answers sent.")] : [sp(SYMBOL.end, GRAY), sp("  Set aside to chat about it.", WARN)];
  return [...reviewList2(form, s, view), [sp(SYMBOL.bar, GRAY)], end];
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
function navRow2(form, s, view) {
  const n = form.questions.length;
  const page = s.page;
  const back = { label: `${ICON.back} Back`, action: { type: "page", page: page - 1 }, tone: "secondary", disabled: page === 0 };
  const forward = (label) => ({ label, action: { type: "advance" }, tone: "secondary" });
  const next = page < n - 1 ? forward(`Next ${ICON.next}`) : page === n - 1 ? forward(`Review ${ICON.next}`) : { label: unansweredCount(s) === 0 ? "Submit" : "Submit anyway", action: { type: "send" }, tone: "brand" };
  const aside = s.chatArmed ? { label: `${ICON.chat} Press again to chat`, action: { type: "chat" }, tone: "caution" } : { label: `${ICON.chat} Chat about this`, action: { type: "chat" }, tone: "neutral" };
  return navRow({ back, next, aside }, view.width);
}
function hint(form, s, view) {
  if (!view.focused)
    return "click the form to answer with the keyboard";
  const q = form.questions[s.page];
  if (!q)
    return;
  return choicesOf(q).length === 0 ? "←→ pages" : "←→ pages  ↑↓ move";
}
function draw(form, s, view, withContext) {
  const head = [brandBar("mattstack decision gate", view.width, { type: "hide" }), [sp(" ")], [sp(SYMBOL.start, GRAY), sp("  "), sp(form.title, { bold: true })]];
  if (s.phase !== "active")
    return { head, page: closedPage(form, s, view), foot: [] };
  if (withContext && form.context) {
    const first = [sp(SYMBOL.bar, GRAY), sp("  "), sp(ICON.info, ACCENT), sp(" ")];
    const rest = [sp(SYMBOL.bar, GRAY), sp("    ")];
    head.push([sp(SYMBOL.bar, GRAY)], ...hang(first, rest, contextText(form.context), view.width));
  }
  const divider = [sp(`├${"─".repeat(Math.max(4, view.width - 2))}`, GRAY)];
  head.push([sp(SYMBOL.bar, GRAY)], [sp(SYMBOL.bar, GRAY)], divider, [sp(SYMBOL.bar, GRAY)], tabs(form, s, view), [sp(SYMBOL.bar, GRAY)]);
  const q = form.questions[s.page];
  const accentBar = rail(ACCENT);
  const page = q ? questionPage(q, s, s.page, view) : reviewPage(form, s, view);
  const keys = hint(form, s, view);
  const hintLines = keys === undefined ? [] : [[sp(SYMBOL.bar, ACCENT)], ...hang(accentBar, accentBar, keys, view.width, DIM)];
  const foot = [...hintLines, [sp(SYMBOL.end, ACCENT)], [sp(" ")], navRow2(form, s, view)];
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
function visibleLines(form, s, view, rows) {
  const pad = s.phase === "active" ? { height: tallestQuestion(form, s, view), filler: [sp(SYMBOL.bar, ACCENT)] } : undefined;
  return fitToRows(draw(form, s, view, true), rows, () => draw(form, s, view, false), pad);
}

// mods/gate-form/src/form.tsx
var form_default = kitClient((props, ui) => {
  const { form } = props;
  const width = Math.max(30, props.cols || ui.width);
  const apply = (effect) => {
    if (!effect)
      return;
    if (effect.post !== undefined)
      ui.post(effect.post);
    ui.setState(effect.state.page === ui.state.page ? effect.state : withTabInView(form, effect.state, width));
  };
  ui.onKey((ev) => apply(keyEffect(ev, form, ui.state)));
  return /* @__PURE__ */ h(Panel, {
    width
  }, /* @__PURE__ */ h(Lines, {
    lines: visibleLines(form, ui.state, { width, focused: ui.focused }, props.rows),
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
