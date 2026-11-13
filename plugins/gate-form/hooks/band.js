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

// packages/mod-kit/src/components/buttons.tsx
function buttonOf(props, ctx) {
  return { label: props.label ?? textOf(props.children), tone: props.tone, disabled: props.disabled, action: ctx.bind("press", () => props.onPress?.()) };
}
var Button = kitComponent("Button", (props, ctx) => [buttonRow([buttonOf(props, ctx)], undefined, ctx.width)]);
var ButtonRow = kitComponent("ButtonRow", (props, ctx) => {
  const buttons = (nodes) => ctx.parts(nodes).flatMap((part) => ("component" in part) && part.component === Button ? [buttonOf(part.props, part.ctx)] : []);
  return [buttonRow(buttons(props.children), buttons(props.right)[0], ctx.width)];
});

// packages/mod-kit/src/interact/pointer.ts
function lookOf(state, focused) {
  const hover = state?.hover;
  const held = state?.pressed;
  return { focused, hover, pressed: held === hover ? held : undefined };
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
      return surface.setState({ ...s, pressed: key, hover: key });
    }
    if (ev.type === "up") {
      if (s.pressed === undefined)
        return;
      surface.setState({ ...s, pressed: undefined });
      const action = key === s.pressed ? hitAt(lines[ev.y], ev.x) : undefined;
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

// packages/mod-kit/src/patterns/band-client.tsx
var bandClient = kitClient((props, ui) => /* @__PURE__ */ h(Panel, null, /* @__PURE__ */ h(Row, null, /* @__PURE__ */ h(Span, {
  color: BRAND.pink,
  bold: true
}, `${BRAND.glyph} ${props.label}  `), /* @__PURE__ */ h(Span, null, props.title), /* @__PURE__ */ h(Span, null, "  "), /* @__PURE__ */ h(Button, {
  tone: "brand",
  onPress: () => ui.post({ type: "reopen", formId: props.formId })
}, "Open"))), { focused: () => true });
export {
  bandClient as default
};
