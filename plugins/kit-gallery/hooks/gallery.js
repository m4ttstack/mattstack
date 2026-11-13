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
var QUIET = { label: PLACEHOLDER.color, hover: FILL.chip.bg, press: "#333333", muted: "#555555" };
function hovered(span) {
  if (span.quiet)
    return { ...span, bg: QUIET.hover, color: "white" };
  return span.bg ? { ...span, bg: HOVER_FILL[span.bg] ?? span.bg } : { ...span, bg: "#404040", dim: false };
}
function pressed(span) {
  if (span.quiet)
    return { ...span, bg: QUIET.press, color: "white" };
  return span.bg ? { ...span, bg: PRESS_FILL[span.bg] ?? span.bg } : { ...span, bg: "#353535", dim: false };
}
var ACCENT = { color: "cyan" };
var GRAY = { color: "gray" };
var DONE = { color: "green" };
var DIM = { dim: true };
var rail = (style) => [sp(SYMBOL.bar, style), sp("  ")];
var MUTED = { cyan: "#3d6f78", green: "#4d7a4d", yellow: "#857640", red: "#8a4a4a", gray: "#4a4a4a", [BRAND.pink]: "#7a3d58" };
var MUTED_FILL = { [BRAND.pink]: { bg: "#6e3a52", color: "#1f1a2b" }, [BRAND.pinkDeep]: { bg: "#5e2f45", color: "#1f1a2b" }, [FILL.secondary.bg]: { bg: "#24313f", color: "#8a8a8a" }, [FILL.disabled.bg]: FILL.disabled, [FILL.field.bg]: { bg: "#262626", color: "#8a8a8a" }, [SCROLL.track]: { bg: "#2a2a2a" }, [SCROLL.thumb]: { bg: "#4a4a4a" } };
function muted(span) {
  if (span.quiet)
    return { ...span, color: QUIET.muted, dim: false };
  if (span.bg)
    return { ...span, ...MUTED_FILL[span.bg] ?? { bg: "#3a3a3a", color: "#8a8a8a" }, dim: false };
  if (span.color)
    return { ...span, color: MUTED[span.color] ?? span.color, dim: false };
  return { ...span, color: span.dim ? "#555555" : "#8a8a8a", dim: false };
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
        fn(event);
      })
    };
    const { tree, lines, handlers } = drawKit({ elements: surface.elements, look: lookOf(latest, focused), width: ui.width, focused }, () => body(props, ui));
    const local = {
      get state() {
        return latest;
      },
      setState,
      onPointer: (fn) => surface.onPointer(fn)
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
// packages/mod-kit/src/widgets/brand-bar.ts
var fit = (text, room) => padCells(cellWidth(text) <= room ? text : `${cutCells(text, Math.max(0, room - 1))}…`, room);
function brandBar(label, width, hide) {
  const look = { bg: BRAND.pink, color: BRAND.plum, bold: true };
  const text = `  ${BRAND.glyph}  ${label}`;
  if (hide === undefined)
    return [sp(fit(text, width), look)];
  const button = ` ${ICON.minimize} Hide `;
  return [sp(fit(text, width - cellWidth(button) - 1), look), sp(button, { bg: BRAND.pinkDeep, color: BRAND.plum, action: hide }), sp(" ", look)];
}

// packages/mod-kit/src/components/brand-bar.tsx
var BrandBar = kitComponent("BrandBar", (props, ctx) => [brandBar(props.title, ctx.width, props.onHide && ctx.bind("hide", props.onHide))]);
// packages/mod-kit/src/widgets/buttons.ts
var TONE_FILL = { primary: FILL.primary, secondary: FILL.secondary, neutral: FILL.neutral, caution: FILL.caution, brand: FILL.brand, quiet: { color: QUIET.label, quiet: true } };
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

// packages/mod-kit/src/components/input-field.tsx
var InputField = kitComponent("InputField", (props, ctx) => [inputField(props.value, props.placeholder ?? "", props.width ?? ctx.width, props.cursor ?? ctx.focused)]);
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

// packages/mod-kit/src/components/page-shell.tsx
var PageShell = kitComponent("PageShell", (props, ctx) => {
  const head = ctx.layout(props.head);
  const context = ctx.layout(props.context);
  const page = ctx.layout(props.children);
  const foot = ctx.layout(props.foot);
  const pad = props.padTo === undefined ? undefined : { height: props.padTo, filler: [sp(SYMBOL.bar, ACCENT)] };
  return fitToRows({ head: [...head, ...context], page, foot }, props.rows, () => ({ head, page, foot }), pad);
});
// packages/mod-kit/src/components/rail.tsx
var Rail = kitComponent("Rail", (props, ctx) => {
  const bar = { color: props.color ?? GRAY.color };
  const text = textOf(props.children);
  if (text === "")
    return [[sp(SYMBOL.bar, bar)]];
  return hang(rail(bar), rail(bar), text, ctx.width, { ...props.dim && DIM, ...props.bold && { bold: true } });
});
// packages/mod-kit/src/components/reopen-band.tsx
function ReopenBand(props) {
  return /* @__PURE__ */ h(Row, null, /* @__PURE__ */ h(Span, {
    color: BRAND.pink,
    bold: true
  }, `${BRAND.glyph} ${props.label}  `), /* @__PURE__ */ h(Span, null, props.title), /* @__PURE__ */ h(Span, null, "  "), /* @__PURE__ */ h(Button, {
    tone: "brand",
    onPress: props.onOpen
  }, "Open"));
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

// packages/mod-kit/src/components/select-list.tsx
var SelectList = kitComponent("SelectList", (props, ctx) => selectList({
  choices: props.choices,
  cursor: props.cursor,
  multi: props.multi ?? false,
  cursorIsChoice: props.cursorIsChoice ?? false,
  isPicked: props.isPicked ?? (() => false),
  writeIn: props.writeIn ?? "",
  width: ctx.width,
  focused: ctx.focused,
  actionFor: (idx) => ctx.bind(`pick:${idx}`, () => props.onPick?.(idx)),
  ...props.maxShown !== undefined && { maxShown: props.maxShown }
}));
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

// packages/mod-kit/src/components/tab-strip.tsx
var TabStrip = kitComponent("TabStrip", (props, ctx) => [
  tabStrip({
    tabs: props.tabs.map((tab, k) => ({ label: tab.label, mark: tab.mark, isDone: tab.isDone ?? false, action: ctx.bind(`tab:${k}`, () => props.onSelect?.(k)) })),
    current: props.current,
    width: ctx.width,
    from: props.from ?? 0,
    scrollTo: (from) => ctx.bind(`scroll:${from}`, () => props.onScroll?.(from))
  })
]);
// packages/mod-kit/src/components/unfocused.tsx
var Unfocused = kitComponent("Unfocused", (props, ctx) => ctx.layout(props.children, { focused: false }).map((line) => line.map(({ action, isLabel, ...span }) => ctx.focused ? muted(span) : span)));
// mods/kit-gallery/src/gallery.tsx
var initial = () => ({
  page: 0,
  pageFrom: 0,
  presses: 0,
  typed: "",
  cursor: { single: 0, described: 1, long: 5 },
  picked: { multi: [1], described: [0, 2] },
  tabs: { short: { current: 0, from: 0 }, overflow: { current: 0, from: 0 }, scrolled: { current: 7, from: 5 } },
  shell: 0
});
var patch = (ui, change) => ui.setState({ ...ui.state, ...change });
var cursorOf = (ui, id) => ui.state.cursor[id] ?? 0;
var pickedOf = (ui, id) => ui.state.picked[id] ?? [];
var moveCursor = (ui, id, idx) => patch(ui, { cursor: { ...ui.state.cursor, [id]: idx } });
var toggle = (ui, id, idx) => {
  const picked = pickedOf(ui, id);
  patch(ui, { cursor: { ...ui.state.cursor, [id]: idx }, picked: { ...ui.state.picked, [id]: picked.includes(idx) ? picked.filter((i) => i !== idx) : [...picked, idx] } });
};
var heading = (text) => [/* @__PURE__ */ h(Rail, null), /* @__PURE__ */ h(Rail, {
  color: ACCENT.color,
  bold: true
}, text)];
var PLAIN = [{ label: "Rename fetchAll" }, { label: "Keep the name" }, { label: "Ask me later" }];
var DESCRIBED = [
  { label: "Rename fetchAll", description: "Matches the other loaders and every call site" },
  { label: "Keep the name", description: "Nothing changes; the next caller decides" },
  { label: "Ask me later", description: "Park it as a follow-up" }
];
var WRITE_IN = { label: "Something else", description: "Say what you have in mind", isWriteIn: true };
var LONG = ["Rename", "Extract", "Inline", "Move", "Split", "Merge", "Delete", "Rewrite", "Document", "Defer"].map((label) => ({ label }));
var TAB_NAMES = ["Overview", "Install", "Configure", "Usage", "Hooks", "Commands", "Settings", "Tools", "Panes", "Themes", "Testing", "Release", "Upgrade", "Support", "Billing", "Audit", "Export", "Import", "Sync", "Search"];
var TONES = ["primary", "secondary", "neutral", "caution", "brand"];
function toneRow(ui, tone) {
  const fill = { ...FILL[tone], bold: true };
  return /* @__PURE__ */ h(Row, null, /* @__PURE__ */ h(Span, {
    ...ACCENT
  }, SYMBOL.bar), `  ${tone.padEnd(11)}`, /* @__PURE__ */ h(Button, {
    tone,
    onPress: tone === "primary" ? () => patch(ui, { presses: ui.state.presses + 1 }) : undefined
  }, "Save"), "   ", /* @__PURE__ */ h(Span, {
    ...hovered(fill)
  }, "  Save  "), "   ", /* @__PURE__ */ h(Span, {
    ...pressed(fill)
  }, "  Save  "), "   ", /* @__PURE__ */ h(Button, {
    tone,
    disabled: true
  }, "Save"), /* @__PURE__ */ h(Unfocused, null, /* @__PURE__ */ h(Button, {
    tone
  }, "Save")));
}
function buttonsPage(ui) {
  const times = ui.state.presses === 1 ? "time" : "times";
  return [
    ...heading("Button tones: the rest column is live, hover and pressed are drawn still"),
    /* @__PURE__ */ h(Row, null, /* @__PURE__ */ h(Span, {
      ...ACCENT
    }, SYMBOL.bar), /* @__PURE__ */ h(Span, {
      ...DIM
    }, `  ${"tone".padEnd(11)}${"rest".padEnd(11)}${"hover".padEnd(11)}${"pressed".padEnd(11)}${"disabled".padEnd(11)}unfocused`)),
    ...TONES.map((tone) => toneRow(ui, tone)),
    /* @__PURE__ */ h(Rail, {
      dim: true
    }, `Primary rest button: pressed ${ui.state.presses} ${times}. A press counts on release, over the button it started on.`),
    ...heading("ButtonRow: buttons from the left, one against the right edge"),
    /* @__PURE__ */ h(ButtonRow, {
      right: /* @__PURE__ */ h(Button, {
        tone: "neutral"
      }, "Chat")
    }, /* @__PURE__ */ h(Button, {
      disabled: true
    }, "Back"), /* @__PURE__ */ h(Button, {
      tone: "primary"
    }, "Next"))
  ];
}
function barsPage(ui, width) {
  const half = Math.floor((width - 5) / 2);
  const field = (value, placeholder) => /* @__PURE__ */ h(Row, null, /* @__PURE__ */ h(Span, {
    ...ACCENT
  }, SYMBOL.bar), "  ", /* @__PURE__ */ h(InputField, {
    width: half,
    value,
    placeholder
  }), "  ", /* @__PURE__ */ h(Unfocused, null, /* @__PURE__ */ h(InputField, {
    width: half,
    value,
    placeholder
  })));
  return [
    ...heading("BrandBar"),
    /* @__PURE__ */ h(BrandBar, {
      title: "mattstack kit gallery"
    }),
    /* @__PURE__ */ h(Rail, {
      dim: true
    }, "No Hide button: the pane has nothing to put away."),
    /* @__PURE__ */ h(BrandBar, {
      title: "mattstack kit gallery",
      onHide: ui.hide
    }),
    /* @__PURE__ */ h(Rail, {
      dim: true
    }, "With Hide: the button puts this pane away."),
    ...heading("InputField: focused on the left, unfocused on the right"),
    field("", "Name the function"),
    field("fetchAllPages", "Name the function"),
    /* @__PURE__ */ h(Rail, {
      dim: true
    }, "Typed text scrolls to keep its end in view; the live field below takes your keys."),
    field(ui.state.typed, "Type here")
  ];
}
function singlePage(ui) {
  return [
    ...heading("SelectList, single, no descriptions: click a choice"),
    /* @__PURE__ */ h(SelectList, {
      choices: PLAIN,
      cursor: cursorOf(ui, "single"),
      cursorIsChoice: true,
      onPick: (idx) => moveCursor(ui, "single", idx)
    }),
    ...heading("SelectList, single, with descriptions"),
    /* @__PURE__ */ h(SelectList, {
      choices: DESCRIBED,
      cursor: cursorOf(ui, "described"),
      cursorIsChoice: true,
      onPick: (idx) => moveCursor(ui, "described", idx)
    }),
    ...heading("SelectList, single, unfocused: muted, nothing to click"),
    /* @__PURE__ */ h(Unfocused, null, /* @__PURE__ */ h(SelectList, {
      choices: DESCRIBED.slice(0, 2),
      cursor: 0,
      cursorIsChoice: true
    }))
  ];
}
function multiPage(ui) {
  return [
    ...heading("SelectList, multi, no descriptions: click to tick"),
    /* @__PURE__ */ h(SelectList, {
      multi: true,
      choices: PLAIN,
      cursor: cursorOf(ui, "multi"),
      isPicked: (idx) => pickedOf(ui, "multi").includes(idx),
      onPick: (idx) => toggle(ui, "multi", idx)
    }),
    ...heading("SelectList, multi, with descriptions"),
    /* @__PURE__ */ h(SelectList, {
      multi: true,
      choices: DESCRIBED,
      cursor: cursorOf(ui, "described"),
      isPicked: (idx) => pickedOf(ui, "described").includes(idx),
      onPick: (idx) => toggle(ui, "described", idx)
    }),
    ...heading("SelectList, multi, unfocused"),
    /* @__PURE__ */ h(Unfocused, null, /* @__PURE__ */ h(SelectList, {
      multi: true,
      choices: DESCRIBED.slice(0, 2),
      cursor: 0,
      isPicked: (idx) => idx === 1
    }))
  ];
}
function writeInPage() {
  const choices = [PLAIN[0], WRITE_IN];
  return [
    ...heading("Write-in, empty, focused: the description becomes the placeholder"),
    /* @__PURE__ */ h(SelectList, {
      choices,
      cursor: 1
    }),
    ...heading("Write-in, filled, focused"),
    /* @__PURE__ */ h(SelectList, {
      choices,
      cursor: 1,
      writeIn: "A fresh name for it"
    }),
    ...heading("Write-in, filled, cursor elsewhere: the typed text shows quoted"),
    /* @__PURE__ */ h(SelectList, {
      choices,
      cursor: 0,
      writeIn: "A fresh name for it"
    }),
    ...heading("Write-in, empty, unfocused"),
    /* @__PURE__ */ h(Unfocused, null, /* @__PURE__ */ h(SelectList, {
      choices,
      cursor: 1
    }))
  ];
}
function longPage(ui) {
  return [
    ...heading("SelectList of 10: eight show at a time, and the window follows the cursor"),
    /* @__PURE__ */ h(SelectList, {
      choices: LONG,
      cursor: cursorOf(ui, "long"),
      cursorIsChoice: true,
      onPick: (idx) => moveCursor(ui, "long", idx)
    })
  ];
}
function liveTabs(ui, id) {
  const state = ui.state.tabs[id] ?? { current: 0, from: 0 };
  const set = (change) => patch(ui, { tabs: { ...ui.state.tabs, [id]: { ...state, ...change } } });
  return { current: state.current, from: state.from, onSelect: (current) => set({ current }), onScroll: (from) => set({ from }) };
}
var NAMED = TAB_NAMES.map((label) => ({ label }));
function tabsPage(ui) {
  const short = [{ label: "Overview", isDone: true, mark: ICON.done }, { label: "Details", isDone: true, mark: ICON.done }, { label: "Notes" }];
  return [
    ...heading("TabStrip, short: done tabs are green, the current one is filled"),
    /* @__PURE__ */ h(TabStrip, {
      tabs: short,
      ...liveTabs(ui, "short")
    }),
    /* @__PURE__ */ h(Unfocused, null, /* @__PURE__ */ h(TabStrip, {
      tabs: short,
      current: 0
    })),
    ...heading("TabStrip, overflowing: a chip counts the tabs out of sight and scrolls one"),
    /* @__PURE__ */ h(TabStrip, {
      tabs: NAMED,
      ...liveTabs(ui, "overflow")
    }),
    ...heading("TabStrip, scrolled: chips on both sides"),
    /* @__PURE__ */ h(TabStrip, {
      tabs: NAMED,
      ...liveTabs(ui, "scrolled")
    }),
    ...heading("Reopen band: what waits above the prompt once a pane is put away"),
    /* @__PURE__ */ h(ReopenBand, {
      label: "mattstack waiting",
      title: "Kit gallery",
      onOpen: () => {}
    })
  ];
}
function shellPage(ui) {
  const at = ui.state.shell;
  const last = 2;
  return [
    ...heading("PageShell: head, context, a page held to one height, and a nav row that keeps its place"),
    /* @__PURE__ */ h(PageShell, {
      rows: 16,
      padTo: 8,
      head: /* @__PURE__ */ h(BrandBar, {
        title: "mattstack page shell"
      }),
      context: /* @__PURE__ */ h(Rail, {
        dim: true
      }, "The context sits under the head and is the first thing given up when rows run out."),
      foot: /* @__PURE__ */ h(ButtonRow, {
        right: /* @__PURE__ */ h(Button, {
          tone: "neutral"
        }, "Chat")
      }, /* @__PURE__ */ h(Button, {
        disabled: at === 0,
        onPress: () => patch(ui, { shell: at - 1 })
      }, "Back"), /* @__PURE__ */ h(Button, {
        tone: at === last ? "primary" : "secondary",
        onPress: () => patch(ui, { shell: at === last ? 0 : at + 1 })
      }, at === last ? "Start over" : "Next"))
    }, /* @__PURE__ */ h(Rail, {
      bold: true
    }, `Page ${at + 1} of ${last + 1}`), /* @__PURE__ */ h(Rail, {
      dim: true
    }, "Pages are different heights; the foot stays on one row."), /* @__PURE__ */ h(SelectList, {
      choices: DESCRIBED.slice(0, at + 1),
      cursor: 0,
      cursorIsChoice: true
    }))
  ];
}
var PAGES = [
  { label: "Buttons", draw: buttonsPage },
  { label: "Bars", draw: barsPage },
  { label: "Single", draw: singlePage },
  { label: "Multi", draw: multiPage },
  { label: "Write-in", draw: writeInPage },
  { label: "Long list", draw: longPage },
  { label: "Tabs", draw: tabsPage },
  { label: "Shell", draw: shellPage }
];
var PAGE_TABS = PAGES.map(({ label }) => ({ label }));
var BARS = 1;
var gallery_default = kitClient((props, ui) => {
  const width = Math.max(40, props.cols || ui.width);
  ui.onKey(({ key, ctrl, meta }) => {
    if (ui.state.page !== BARS || ctrl || meta)
      return;
    if (key === "backspace")
      patch(ui, { typed: ui.state.typed.slice(0, -1) });
    else if (key.length === 1)
      patch(ui, { typed: ui.state.typed + key });
  });
  return /* @__PURE__ */ h(Panel, {
    width
  }, /* @__PURE__ */ h(TabStrip, {
    tabs: PAGE_TABS,
    current: ui.state.page,
    from: ui.state.pageFrom,
    onSelect: (page) => patch(ui, { page }),
    onScroll: (pageFrom) => patch(ui, { pageFrom })
  }), PAGES[ui.state.page].draw(ui, width));
}, { initial });
export {
  gallery_default as default
};
