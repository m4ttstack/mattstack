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
  return [
    { ...span, t: SYMBOL.selectEdge, color: BRAND.pink, mark: BRAND.pink, bold: false },
    { ...span, t: span.t.slice(1) }
  ];
}
var ACCENT = { color: "cyan" };
var GRAY = { color: "gray" };
var DONE = { color: "green" };
var WARN = { color: "yellow" };
var DIM = { dim: true };
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
// packages/mod-kit/src/widgets/scroll-bar.ts
function scrollBar(rows, total, offset) {
  if (total <= rows)
    return Array.from({ length: rows }, () => [sp("   ")]);
  const size = Math.max(1, Math.round(rows * rows / total));
  const at = Math.min(Math.max(0, offset), total - rows);
  const top = Math.round(at / (total - rows) * (rows - size));
  return Array.from({ length: rows }, (_, n) => [sp(" "), sp(" ", { bg: n >= top && n < top + size ? SCROLL.thumb : SCROLL.track }), sp(" ")]);
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
          surface.setState({ ...surface.state, keyPress: undefined });
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

// packages/mod-kit/src/components/brand-bar.tsx
var BrandBar = kitComponent("BrandBar", (props, ctx) => [brandBar(props.title, ctx.width, props.onHide && ctx.bind("hide", props.onHide))]);
// mods/human-todos/src/items.ts
var PLUGIN = "human-todos";
var TITLE = "Human Todos";
var KINDS = ["task", "run", "terminal", "link", "image"];
var LIVE_LINES_LOCAL = 15;
var LIVE_LINES_HERDR = 3;
var LINE_MAX = 300;
var TAIL_MAX = 8 * 1024;
function checkKind(input) {
  if (!KINDS.includes(input.kind))
    return `kind ${String(input.kind)} is not one of ${KINDS.join(", ")}.`;
  if ((input.kind === "run" || input.kind === "terminal") && !input.script?.trim())
    return `kind ${input.kind} needs a script.`;
  if (input.kind === "link" && !/^https?:\/\//.test(input.url ?? ""))
    return "kind link needs an http(s) url.";
  if (input.kind === "image") {
    const paths = Array.isArray(input.paths) ? input.paths : [];
    if (paths.length === 0)
      return "kind image needs paths: one absolute path per image.";
    const relative = paths.find((p) => typeof p !== "string" || !p.startsWith("/"));
    if (relative !== undefined)
      return `kind image needs absolute paths; ${String(relative)} is not one.`;
    const other = paths.find((p) => !isImageName(p));
    if (other !== undefined)
      return `kind image opens image files only (${IMAGE_EXTENSIONS.join(", ")}); ${other} is not one.`;
  }
  return;
}
function toTodo(id, input) {
  const hasScript = input.kind === "run" || input.kind === "terminal";
  return {
    id,
    kind: input.kind,
    title: input.title,
    status: "open",
    ...input.detail !== undefined && { detail: input.detail },
    ...hasScript && input.script !== undefined && { script: input.script },
    ...input.kind === "link" && input.url !== undefined && { url: input.url },
    ...input.kind === "image" && input.paths !== undefined && { paths: [...input.paths] },
    ...input.kind === "run" && input.cwd !== undefined && { cwd: input.cwd }
  };
}
function buttonsFor(todo) {
  if (todo.status === "confirming")
    return ["confirm", "cancel"];
  if (todo.status === "running") {
    const view = todo.runner === "local" ? "openLog" : "show";
    return [view, todo.isStopping ? "forceStop" : "stop"];
  }
  if (todo.status !== "open")
    return [];
  switch (todo.kind) {
    case "run":
      return ["run", "copy", "done", "skip"];
    case "terminal":
      return ["copy", "done", "skip"];
    case "link":
    case "image":
      return ["open", "done", "skip"];
    case "task":
      return ["done", "skip"];
  }
}
function isActionable(t) {
  return t.status === "open" || t.status === "confirming" || t.status === "running";
}
function hardWrap(text, width) {
  const rows = [];
  for (const line of text.split(`
`)) {
    if (line.length === 0)
      rows.push("");
    for (let i = 0;i < line.length; i += width)
      rows.push(line.slice(i, i + width));
  }
  return rows;
}
function wrapWords(text, width) {
  const rows = [];
  for (const line of text.split(`
`)) {
    let row = "";
    for (const word of line.split(" ").filter((w) => w !== "")) {
      const joined = row === "" ? word : `${row} ${word}`;
      if (joined.length <= width) {
        row = joined;
        continue;
      }
      if (row !== "")
        rows.push(row);
      const pieces = hardWrap(word, width);
      row = pieces.pop() ?? "";
      rows.push(...pieces);
    }
    rows.push(row);
  }
  return rows;
}
function clipLine(line) {
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line;
}
function clipLines(lines) {
  return lines.map(clipLine);
}
function tail(out, lines = 30) {
  const kept = clipLines(out.trimEnd().split(`
`).slice(-lines));
  let size = kept.reduce((sum, line) => sum + line.length + 1, 0);
  while (kept.length > 1 && size > TAIL_MAX)
    size -= (kept.shift() ?? "").length + 1;
  return kept.join(`
`);
}
function newToken() {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}
function describe(list) {
  if (list.length === 0)
    return "No to-dos.";
  return list.map((t) => {
    const script = t.script ? `
    script: ${t.script}` : "";
    const images = t.paths?.length ? `
    images: ${t.paths.join(", ")}` : "";
    return `#${t.id} [${t.status}] ${t.title}${script}${images}`;
  }).join(`
`);
}
var IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "svg"];
function isImageName(path) {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 && IMAGE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}
function fileName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}
function quote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// mods/human-todos/src/pane/model.ts
var SCRIPT_ROWS = 2;
var FINISHED_SHOWN = 8;
var LABELS = {
  run: "Run",
  open: "Open",
  copy: "Copy",
  done: "Done",
  skip: "Skip",
  confirm: "Confirm",
  cancel: "Cancel",
  show: "Show",
  stop: "Stop",
  forceStop: "Force stop",
  openLog: "Open log"
};
var TONES = {
  run: "primary",
  open: "primary",
  confirm: "primary",
  show: "primary",
  done: "secondary",
  skip: "secondary",
  cancel: "neutral",
  copy: "neutral",
  openLog: "neutral",
  stop: "caution",
  forceStop: "caution"
};
function markFor(todo) {
  if (todo.status === "failed")
    return { mark: "✗", tone: "error" };
  if (todo.status === "skipped")
    return { mark: "–", tone: "inactive" };
  return { mark: "✓", tone: "success" };
}
function buttonsOf(todo) {
  const ids = buttonsFor(todo);
  const main = ids.find((id) => id === "stop" || id === "forceStop") ?? ids[0];
  return ids.map((id) => ({ id, label: LABELS[id], tone: id === main ? TONES[id] : "quiet", todoId: todo.id }));
}
function paneModel(input) {
  const { list, expanded, spin, width } = input;
  const inner = width + 2;
  const actionable = list.filter(isActionable);
  const finished = list.filter((t) => !isActionable(t));
  const rows = [];
  const spans = [];
  const blank = () => rows.push({ kind: "blank" });
  const lines = (text, w, tone, indent) => {
    for (const line of wrapWords(text, w))
      rows.push({ kind: "text", text: line, tone, indent });
  };
  if (actionable.length === 0) {
    rows.push({ kind: "text", text: "Nothing for you right now.", tone: "dim", indent: false });
    if (finished.length > 0)
      blank();
  }
  for (const todo of actionable) {
    const first = rows.length;
    const script = todo.script ? hardWrap(`$ ${todo.script}`, width) : [];
    const isConfirming = todo.status === "confirming";
    const isOpen = expanded.includes(todo.id) || isConfirming;
    const shown = isOpen ? script : script.slice(0, SCRIPT_ROWS);
    const hidden = script.length - SCRIPT_ROWS;
    const tail = (todo.liveTail ?? []).slice(todo.runner === "local" ? -LIVE_LINES_LOCAL : -LIVE_LINES_HERDR);
    const isRunning = todo.status === "running";
    wrapWords(todo.title, inner - 2).forEach((line, n) => rows.push(n === 0 ? { kind: "text", text: `${isRunning ? `${spin} ` : "○ "}${line}`, tone: "title", indent: false, ...isRunning && { spin: true } } : { kind: "text", text: line, tone: "title", indent: true }));
    if (todo.detail)
      lines(todo.detail, width, "dim", true);
    if (!isRunning && todo.note)
      lines(todo.note, width, "warning", true);
    for (const row of shown)
      rows.push({ kind: "text", text: row, tone: "script", indent: true });
    if (hidden > 0 && !isConfirming) {
      const more = { id: "more", label: isOpen ? "Show less" : "Show all", tone: "quiet", todoId: todo.id };
      rows.push({ kind: "buttons", buttons: [more], ...!isOpen && { lead: { text: `… +${hidden} more`, tone: "dim" } } });
    }
    if (todo.kind === "run" && todo.cwd)
      rows.push({ kind: "text", text: `in ${todo.cwd}`, tone: "dim", indent: true });
    if (todo.url)
      lines(todo.url, width, "link", true);
    if (todo.paths?.length)
      lines(todo.paths.map(fileName).join(", "), width, "link", true);
    if (isRunning) {
      blank();
      for (const line of tail)
        rows.push({ kind: "text", text: line, tone: "dim", indent: true });
      if (tail.length > 0)
        blank();
      const lead = {
        text: `${spin} ${todo.isStopping ? "Stopping…" : "Running"}`,
        tone: todo.isStopping ? "error" : "warning",
        spin: true,
        pad: true
      };
      rows.push({ kind: "buttons", lead, buttons: buttonsOf(todo) });
    } else {
      blank();
      rows.push({ kind: "buttons", buttons: buttonsOf(todo) });
      if (isConfirming)
        lines("Are you sure you want to run this script?", width, "plain", true);
    }
    spans.push({ first, last: rows.length - 1 });
    blank();
  }
  if (finished.length > 0) {
    for (const todo of finished.slice(-FINISHED_SHOWN)) {
      const { mark, tone } = markFor(todo);
      spans.push({ first: rows.length, last: rows.length });
      rows.push({
        kind: "finished",
        mark,
        tone,
        title: todo.title,
        ...todo.exitCode !== undefined && todo.exitCode !== 0 && { exit: todo.exitCode }
      });
    }
    blank();
    rows.push({ kind: "buttons", flush: true, buttons: [{ id: "clear", label: "Clear finished", tone: "quiet" }] });
  }
  return { rows, spans, hasFinished: finished.length > 0 };
}
function messageOf(button) {
  if (button.id === "clear")
    return { type: "clear" };
  if (button.id === "more")
    return { type: "toggle", id: button.todoId ?? "" };
  return { type: "press", id: button.todoId ?? "", button: button.id };
}
function endRows(model) {
  const end = { kind: "text", text: "You've reached the end of the list.", tone: "dim", indent: false };
  return model.hasFinished ? [{ kind: "blank" }, end] : [end];
}
function bandModel(list) {
  const waiting = list.filter((t) => t.status === "open" || t.status === "confirming").length;
  if (waiting === 0)
    return;
  return { waiting, title: `${waiting} ${waiting === 1 ? "to-do" : "to-dos"}` };
}

// mods/human-todos/src/pane/kit-layout.ts
var GUTTER = 2;
var INDENT = 2;
var BAR = 3;
var BAR_ROWS = 2;
var modelWidth = (width) => Math.max(1, width - GUTTER - BAR - INDENT);
var STYLE = {
  title: { bold: true },
  dim: DIM,
  warning: WARN,
  script: ACCENT,
  link: ACCENT,
  success: DONE,
  error: { color: "red" },
  inactive: GRAY,
  plain: {}
};
var fit2 = (text, cells) => cellWidth(text) <= cells ? text : `${cutCells(text, Math.max(0, cells - 1))}…`;
function buttonLines(row, room) {
  const indent = sp(" ".repeat(row.flush ? 0 : INDENT));
  const lead = row.lead ? [sp(row.lead.pad ? `${row.lead.text} ` : row.lead.text, STYLE[row.lead.tone])] : [];
  const gap = row.lead ? 1 : 0;
  const avail = Math.max(1, room - widthOf([indent, ...lead]));
  let rest = row.buttons.map((b) => ({ label: b.label, tone: b.tone, action: messageOf(b) }));
  const draw = (buttons) => buttonRow(buttons, undefined, avail, gap);
  const out = [];
  while (rest.length > 0) {
    let n = rest.length;
    while (n > 1 && widthOf(draw(rest.slice(0, n))) > avail)
      n--;
    out.push([indent, ...out.length === 0 ? lead : [sp(" ".repeat(widthOf(lead)))], ...draw(rest.slice(0, n))]);
    rest = rest.slice(n);
  }
  return out;
}
function rowLines(row, room) {
  switch (row.kind) {
    case "blank":
      return [[]];
    case "text": {
      const indent = row.indent ? INDENT : 0;
      const cells = Math.max(1, room - indent);
      const pieces = cellWidth(row.text) > cells ? wrap(row.text, cells) : [row.text];
      return pieces.map((piece) => [sp(" ".repeat(indent)), sp(piece, STYLE[row.tone])]);
    }
    case "finished": {
      const mark = `${row.mark} `;
      const exit = row.exit === undefined ? "" : ` (exit ${row.exit})`;
      const title = fit2(row.title, room - cellWidth(mark) - cellWidth(exit));
      return [[sp(mark, STYLE[row.tone]), sp(title, DIM), ...exit ? [sp(exit, DIM)] : []]];
    }
    case "buttons":
      return buttonLines(row, room);
  }
}
function kitLayout(model, width, bodyRows) {
  const room = Math.max(1, width - GUTTER - BAR);
  const windowRows = Math.max(1, bodyRows - BAR_ROWS);
  const starts = [];
  const lines = [];
  for (const row of model.rows) {
    starts.push(lines.length);
    lines.push(...rowLines(row, room));
  }
  const spans = model.spans.map((s) => ({ first: starts[s.first] ?? 0, last: (starts[s.last + 1] ?? lines.length) - 1 }));
  if (lines.length > windowRows)
    for (const row of endRows(model))
      lines.push(...rowLines(row, room));
  return { lines, spans, windowRows };
}
function maxOffset(layout) {
  return Math.max(0, layout.lines.length - layout.windowRows);
}
function clip(line, cells) {
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
var RAIL = [sp(SYMBOL.bar, { color: BRAND.pink }), sp(" ".repeat(GUTTER - 1))];
function keyStops(model) {
  const stops = [];
  for (const row of model.rows) {
    if (row.kind !== "buttons")
      continue;
    for (const button of row.buttons) {
      const key = button.todoId ?? button.id;
      const stop = stops.find((s) => s.key === key);
      if (stop)
        stop.buttons.push(button);
      else
        stops.push({ key, buttons: [button] });
    }
  }
  return stops;
}
function stopLines(layout, stops, index) {
  const stop = stops[index];
  if (!stop)
    return;
  if (stop.buttons[0]?.todoId !== undefined)
    return layout.spans[stops.slice(0, index).filter((s) => s.buttons[0]?.todoId !== undefined).length];
  const wanted = JSON.stringify(messageOf(stop.buttons[0]));
  const at = layout.lines.findIndex((line) => line.some((span) => span.action !== undefined && JSON.stringify(span.action) === wanted));
  return at < 0 ? undefined : { first: at, last: at };
}
function revealOffset(layout, stops, index, offset) {
  const range = stopLines(layout, stops, index);
  const most = maxOffset(layout);
  const top = Math.min(Math.max(0, offset), most);
  if (!range)
    return top;
  const { first, last } = range;
  if (first < top)
    return Math.max(0, first);
  if (last > top + layout.windowRows - 1)
    return Math.min(most, Math.max(first, last - layout.windowRows + 1));
  return top;
}
function markFirst(line) {
  const at = line.findIndex((span) => span.t.startsWith("○ "));
  if (at < 0)
    return line;
  const span = line[at];
  return [...line.slice(0, at), { ...span, t: "○", color: BRAND.pink }, { ...span, t: span.t.slice(1) }, ...line.slice(at + 1)];
}
function kitWindow(layout, width, offset, focus = {}) {
  const { lines: all, windowRows } = layout;
  const chosen = focus.selected && JSON.stringify(focus.selected);
  const range = focus.marked ? focus.range : undefined;
  const look = (span) => {
    const base = focus.pressing ? pressed(span) : span;
    return focus.marked ? keySelected(base) : [base];
  };
  const lines = all.map((line, n) => {
    const lit = chosen ? line.flatMap((span) => span.action !== undefined && JSON.stringify(span.action) === chosen ? look(span) : [span]) : line;
    return range && n === range.first ? markFirst(lit) : lit;
  });
  const top = Math.min(Math.max(0, offset), maxOffset(layout));
  const shown = lines.slice(top, top + windowRows);
  const bar = scrollBar(windowRows, lines.length, top);
  const gutter = (n) => {
    const at = top + n;
    return range && at >= range.first && at <= range.last ? RAIL : [sp(" ".repeat(GUTTER))];
  };
  return shown.map((line, n) => [...clip([...gutter(n), ...line], width - BAR), ...bar[n] ?? []]);
}

// mods/human-todos/src/pane/kit-view.tsx
function resolve(stops, sel) {
  if (!sel)
    return { at: 0, col: stops[0] ? mainOf(stops[0]) : 0 };
  const found = stops.findIndex((s) => s.key === sel.key);
  if (found < 0) {
    const at = Math.min(sel.at, stops.length - 1);
    return { at, col: stops[at] ? mainOf(stops[at]) : 0 };
  }
  const buttons = stops[found]?.buttons ?? [];
  const col = buttons.findIndex((b) => b.id === sel.button);
  return { at: found, col: col >= 0 ? col : Math.min(sel.col, buttons.length - 1) };
}
var mainOf = (stop) => Math.max(0, stop.buttons.findIndex((b) => b.tone !== "quiet"));
var kit_view_default = kitClient((props, ui) => {
  const layout = kitLayout(props.model, props.width, props.bodyRows);
  const stops = keyStops(props.model);
  const here = resolve(stops, ui.state.sel);
  const current = stops[here.at]?.buttons[here.col];
  const rail = current?.todoId === undefined ? undefined : stopLines(layout, stops, here.at);
  const mark = (at, col) => {
    const stop = stops[at];
    const button = stop?.buttons[col];
    if (!stop || !button)
      return false;
    ui.setState({ ...ui.state, sel: { key: stop.key, button: button.id, at, col } });
    return true;
  };
  const select = (at, col) => {
    if (!mark(at, col))
      return;
    const offset = revealOffset(layout, stops, at, props.offset);
    if (offset !== props.offset)
      ui.post({ type: "scrollTo", offset });
  };
  const clicked = (message) => {
    const wanted = JSON.stringify(message);
    stops.forEach((stop, at) => stop.buttons.forEach((button, col) => JSON.stringify(messageOf(button)) === wanted && mark(at, col)));
    ui.post(message);
  };
  ui.onReveal(() => {
    const offset = revealOffset(layout, stops, here.at, props.offset);
    if (offset !== props.offset)
      ui.post({ type: "scrollTo", offset });
  });
  ui.onKey((ev) => {
    if (!ui.focused || stops.length === 0)
      return false;
    const step = ev.key === "up" || ev.key === "tab" && ev.shift ? -1 : ev.key === "down" || ev.key === "tab" ? 1 : 0;
    if (step !== 0) {
      const at = Math.min(Math.max(0, here.at + step), stops.length - 1);
      if (at !== here.at)
        select(at, mainOf(stops[at]));
      return true;
    }
    if (ev.key === "left" || ev.key === "right") {
      const col = here.col + (ev.key === "left" ? -1 : 1);
      if (col >= 0 && col < (stops[here.at]?.buttons.length ?? 0))
        select(here.at, col);
      return true;
    }
    if ((ev.key === "return" || ev.key === "enter") && current) {
      const message = messageOf(current);
      ui.pressFor(() => ui.post(message));
      return true;
    }
    return false;
  });
  return /* @__PURE__ */ h(Panel, {
    width: props.width
  }, /* @__PURE__ */ h(BrandBar, {
    title: TITLE,
    onHide: ui.hide
  }), /* @__PURE__ */ h(Lines, {
    lines: [[sp(" ")]]
  }), /* @__PURE__ */ h(Lines, {
    lines: kitWindow(layout, props.width, props.offset, ui.focused && current ? { selected: messageOf(current), range: rail, marked: ui.keyboard, pressing: ui.keyPressing } : {}),
    onAction: clicked
  }));
}, {
  initial: () => ({}),
  revealKeys: ["up", "down", "left", "right", "tab", "return", "enter"],
  engaged: () => ({ type: "engaged" })
});
export {
  kit_view_default as default
};
