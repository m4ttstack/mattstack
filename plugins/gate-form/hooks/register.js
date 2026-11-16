// mods/gate-form/src/register.tsx
import { atom, read, update } from "claude-code";

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
// packages/mod-kit/src/interact/focus.ts
function isEngaged(e) {
  return e.data?.type === "engaged";
}
// packages/mod-kit/src/patterns/hideable-pane.tsx
var DEFAULT_BAND_LABEL = "mattstack waiting";
async function showPane($, pane, title) {
  const opened = await $.ui.open({ id: pane.id, title, focus: true });
  $.ui.invalidate("ui.render");
  return opened.isPlaced;
}
async function paneMessage($, e, pane, waiting) {
  const message = e.data;
  if (message?.type === "reopen" && waiting && waiting.formId === message.formId)
    await showPane($, pane, waiting.title);
  if (message?.type === "hide" && e.requestId === pane.id)
    await $.ui.close({ id: pane.id });
}
function registerPaneRedraw(on) {
  on("ui.close", async ($, e, next) => {
    const closed = await next(e);
    $.ui.invalidate("ui.render");
    return closed;
  });
}
async function bandAbovePrompt($, e, rest, waiting, pane, options = {}) {
  const label = pane.label ?? DEFAULT_BAND_LABEL;
  const els = $.ui.resolve(e);
  const { Box, Text, Button } = els;
  const Client = "Client" in els ? els.Client : undefined;
  const show = /* @__PURE__ */ h(Button, {
    key: `open-${pane.id}`,
    label: "Show",
    onPress: () => showPane($, pane, waiting.title)
  });
  const band = Client ? options.engineShow ? /* @__PURE__ */ h(Box, {
    flexDirection: "row",
    gap: 2
  }, /* @__PURE__ */ h(Client, {
    key: `band-${waiting.formId}`,
    module: "./band.js",
    flexGrow: 1,
    props: { formId: waiting.formId, title: waiting.title, label, bareText: true }
  }), show) : /* @__PURE__ */ h(Client, {
    key: `band-${waiting.formId}`,
    module: "./band.js",
    props: { formId: waiting.formId, title: waiting.title, label }
  }) : /* @__PURE__ */ h(Box, {
    flexDirection: "row",
    gap: 2
  }, /* @__PURE__ */ h(Text, {
    color: BRAND.pink
  }, `${BRAND.glyph} ${label} `), /* @__PURE__ */ h(Text, {
    wrap: "truncate-end"
  }, waiting.title), /* @__PURE__ */ h(Button, {
    key: `open-${pane.id}`,
    label: "Open",
    onPress: () => showPane($, pane, waiting.title)
  }));
  return /* @__PURE__ */ h(Box, {
    flexDirection: "column"
  }, band, rest);
}
async function isPlaced($, pane) {
  return (await $.ui.panes()).some((p) => p.id === pane.id && p.isPlaced);
}
function paneRows(e) {
  return e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30;
}
var wheels = new Map;
function addWheel($, paneId, by) {
  wheels.set(paneId, (wheels.get(paneId) ?? 0) + by);
  $.ui.invalidate("ui.render");
}
var wheelTotal = (paneId) => wheels.get(paneId) ?? 0;
// packages/mod-kit/src/patterns/hotkey-choices.tsx
function hotkeyChoices(els, spec) {
  const { Box, Text, Button } = els;
  const lead = " ".repeat(spec.indent ?? 3);
  return /* @__PURE__ */ h(Box, {
    flexDirection: "column"
  }, spec.choices.map((choice, idx) => /* @__PURE__ */ h(Box, {
    key: `${spec.key}-row-${idx}`,
    flexDirection: "row"
  }, /* @__PURE__ */ h(Text, null, lead), /* @__PURE__ */ h(Button, {
    key: `${spec.key}:${idx}`,
    plain: true,
    hotkey: spec.focused && idx < 9 ? String(idx + 1) : undefined,
    autoFocus: idx === 0 ? true : undefined,
    onPress: choice.onPress
  }, choice.label))));
}
// mods/gate-form/src/gate/bell.ts
var BODY_MAX = 140;
function bellArgs(cwd, questions) {
  const who = cwd.replace(/\/+$/, "").split("/").at(-1) || "claude";
  let body = (questions[0]?.label ?? "").split(/\s+/).filter(Boolean).join(" ") || "needs an answer";
  if (body.length > BODY_MAX)
    body = `${body.slice(0, BODY_MAX - 3)}...`;
  if (questions.length > 1)
    body += `  (+${questions.length - 1} more)`;
  return ["herdr", "notification", "show", `${who} needs you`, "--body", body, "--sound", "request"];
}

// mods/gate-form/src/gate/board.ts
var NO_ADDRESS = "Board address not found";
var KIND_TITLES = {
  "review-post": "Review findings",
  "respond-plan": "Respond plan",
  "respond-post": "Respond replies"
};
function kindTitle(kind) {
  if (KIND_TITLES[kind])
    return KIND_TITLES[kind];
  const words = kind.trim().replace(/[-_]+/g, " ");
  return words === "" ? "A gate" : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var local = (port) => typeof port === "number" && Number.isInteger(port) && port > 0 ? `http://localhost:${port}` : undefined;
function boardAddress(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const row = stdout.split(`
`).map((line) => line.trim().split(/\s+/)).find((cells) => cells[0] === "board");
    return row && /^\d+$/.test(row[1] ?? "") ? local(Number(row[1])) : undefined;
  }
  const apps = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.apps) ? parsed.apps : [];
  const board = apps.find((app) => isObject(app) && app.name === "board");
  return board ? local(board.port) : undefined;
}
var boardUrl = (address, gateId) => `${address}/?gate=${encodeURIComponent(gateId)}`;
function boardText(list) {
  const newest = list.at(-1);
  if (!newest)
    return "";
  const more = list.length - 1;
  return `${kindTitle(newest.kind)} is waiting on the board${more > 0 ? `, ${more} more` : ""}`;
}
function readBoardOnly(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (!isObject(parsed) || parsed.boardOnly !== true || parsed.paneAction !== "wait" || typeof parsed.id !== "string" || parsed.id === "")
    return;
  return { gateId: parsed.id, ...typeof parsed.supersededId === "string" && { supersededId: parsed.supersededId } };
}
function addBoardGate(list, gate, supersededId) {
  if (list.some((b) => b.gateId === gate.gateId))
    return list;
  return [...list.filter((b) => b.gateId !== supersededId), gate];
}

// mods/gate-form/src/gate/forms.ts
function currentForm(list) {
  return list.find((f) => f.status === "open") ?? list.at(-1);
}
var openCount = (list) => list.filter((f) => f.status === "open").length;
function addForm(list, form, supersededId) {
  const replaces = (f) => f.gateId === undefined ? form.gateId === undefined && f.source === form.source : f.gateId === form.gateId || f.gateId === supersededId;
  const at = list.findIndex(replaces);
  const kept = list.filter((f, i) => i === at || !replaces(f) && f.status === "open");
  return at < 0 ? [...kept, form] : kept.map((f) => replaces(f) ? form : f);
}
function patchForm(list, formId, patch) {
  return list.map((f) => f.id === formId ? { ...f, ...patch } : f);
}
function fitForm(form, budget) {
  const fits = (f) => JSON.stringify(f).length <= budget;
  if (fits(form))
    return form;
  const plain = { ...form, questions: form.questions.map((q) => ({ ...q, options: q.options.map(({ description: _, ...o }) => o) })) };
  if (fits(plain))
    return plain;
  const bare = { ...plain, questions: plain.questions.map(({ context: _, ...q }) => q) };
  if (fits(bare))
    return bare;
  const { context: _, ...rest } = bare;
  return rest;
}
function fromLegacy(old) {
  if (!old || old.replyTo !== "agent")
    return [];
  const { replyTo: _, ...rest } = old;
  return [{ ...rest, source: "ask", questions: old.questions.map((q) => ({ ...q, other: true })) }];
}
var knownForms = (list) => list.filter((f) => f.source === "gate" || f.source === "ask" || f.source === "plugin");

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

// mods/gate-form/src/gate/reply.ts
var REPLY_TAG = "[gate-form] ";
var json = (value) => `\`\`\`json
${JSON.stringify(value, null, 2)}
\`\`\``;
function agentReply(form, outcome) {
  const total = form.questions.length;
  if (outcome.status === "answered") {
    const count = Object.keys(outcome.answers).length;
    return [
      `${REPLY_TAG}The user answered "${form.title}" (${count} of ${total} questions).`,
      `Form ${form.id}. Answers by question id; an unanswered question is left out:`,
      json(outcome.answers)
    ].join(`
`);
  }
  return [
    `${REPLY_TAG}The user set "${form.title}" aside to chat about it first.`,
    `Form ${form.id} is closed; any gate it stands for stays open. Talk it through with them, then ask again. What they had answered so far:`,
    json(outcome.draft)
  ].join(`
`);
}
var GATE_INSTRUCTION = (gateId) => `The gate is open in the kit form. Open any boards first (per \`boards_to_open\`), then end your turn holding at gate \`${gateId}\`. The answer arrives as your next input.`;
var BOARD_INSTRUCTION = (gateId) => `The kit form can't draw this gate, so it waits on the board. Run \`rt gate wait ${gateId}\` as a background Bash task, then end your turn holding at gate \`${gateId}\`.`;
var BOARD_TOAST = (title, reason) => `${title} can't show in the form: ${reason} Answer it on the board.`;
var GATE_ANSWERED = (gateId) => `Gate ${gateId} was answered in the kit form. Call gate_reconcile for it.`;
var GATE_ASIDE = (gateId) => `The user set gate ${gateId} aside to talk about it first. Don't present it again; it stays open in the kit form.`;

// mods/gate-form/src/gate/parse.ts
var DEFAULT_TITLE = "Questions";
var counter = 0;
var isText = (v) => typeof v === "string" && v.trim() !== "";
function toOption(raw) {
  if (typeof raw === "string")
    return { value: raw, label: raw };
  return {
    value: String(raw.value ?? raw.label ?? ""),
    label: String(raw.label ?? raw.value ?? ""),
    ...typeof raw.description === "string" && { description: raw.description }
  };
}
function toOptions(q, source) {
  const raws = Array.isArray(q.options) ? q.options : [];
  const options = [];
  const seen = new Set;
  for (const raw of raws) {
    const option = toOption(raw);
    const problem = option.value === "" ? `question ${q.id} has an option with no value.` : seen.has(option.value) ? `question ${q.id} has option ${option.value} twice.` : undefined;
    if (problem && source !== "gate")
      return problem;
    if (problem)
      continue;
    seen.add(option.value);
    options.push(option);
  }
  if (raws.length > 0 && options.length === 0)
    return `question ${q.id} has no option with a value.`;
  return options;
}
function toQuestion(q, seen, source) {
  if (typeof q?.id !== "string" || q.id === "")
    return "every question needs a string id.";
  if (seen.has(q.id))
    return `question id ${q.id} is used twice.`;
  if (typeof q.label !== "string")
    return `question ${q.id} needs a label.`;
  seen.add(q.id);
  const options = toOptions(q, source);
  if (typeof options === "string")
    return options;
  return {
    id: q.id,
    header: isText(q.header) ? q.header : q.id,
    label: q.label,
    multi: q.multi === true,
    writeIn: q.writeIn === true,
    other: source === "ask" || q.writeIn === true,
    ...isText(q.context) && { context: q.context },
    options
  };
}
function toForm(title, context, raw, source) {
  if (!Array.isArray(raw) || raw.length === 0)
    return "questions must be a non-empty array.";
  const seen = new Set;
  const questions = [];
  for (const q of raw) {
    const question = toQuestion(q, seen, source);
    if (typeof question === "string")
      return question;
    questions.push(question);
  }
  counter += 1;
  return {
    id: `f${Date.now().toString(36)}${counter}`,
    title: isText(title) ? title : DEFAULT_TITLE,
    ...isText(context) && { context },
    questions,
    status: "open",
    source
  };
}
var PLUGIN_QUESTION = "choice";
function pluginForm(raw) {
  const args = raw ?? {};
  if (!isText(args.title))
    return "title must be a non-empty string.";
  if (typeof args.timeoutMs !== "number" || !(args.timeoutMs > 0))
    return "timeoutMs must be a positive number of milliseconds.";
  if (args.kind !== undefined && args.kind !== "choice" && args.kind !== "confirm")
    return "kind must be 'choice' or 'confirm'.";
  const confirm = args.kind === "confirm";
  if (!Array.isArray(args.options) || args.options.length === 0)
    return "options must be a non-empty array.";
  if (confirm && (args.options.length < 2 || args.options.length > 3))
    return "a confirm takes 2 or 3 options.";
  if (args.options.some((option) => option?.value === WRITE_IN))
    return `option value ${WRITE_IN} is reserved.`;
  const label = confirm && args.label === undefined ? args.title : args.label;
  const question = { id: PLUGIN_QUESTION, header: "Choice", label, options: args.options };
  const form = toForm(args.title, args.context, [question], "plugin");
  return typeof form === "string" || !confirm ? form : { ...form, confirm: true };
}
var isObject2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function readKitResult(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "spilled" };
  }
  return isObject2(parsed) && parsed.paneAction === "kit" ? { kind: "kit", fields: parsed } : { kind: "other" };
}
function controlsOf(raw, questions) {
  if (!isObject2(raw) || questions.some((q) => q.id === "next"))
    return;
  const pause = raw.pause === true;
  const goBack = Array.isArray(raw.goBack) ? raw.goBack.filter((s) => typeof s === "string" && s !== "") : [];
  return pause || goBack.length > 0 ? { pause, goBack } : undefined;
}
function gateFormOf(id, title, context, questions, controls) {
  if (!isText(id))
    return "the gate result has no id.";
  const form = toForm(title, context, questions, "gate");
  if (typeof form === "string")
    return form;
  const allowed = controlsOf(controls, form.questions);
  return { ...form, gateId: id, ...allowed && { controls: allowed } };
}
function gateForm(fields, title) {
  const kit = isObject2(fields.kitForm) ? fields.kitForm : {};
  return gateFormOf(fields.id, title, kit.context, kit.questions, kit.controls);
}
function agentFields(fields) {
  const { kitForm: _, ...rest } = fields;
  return { ...rest, instruction: GATE_INSTRUCTION(String(fields.id)) };
}
function boardFields(fields) {
  const { kitForm: _, ...rest } = fields;
  return { ...rest, paneAction: "wait", instruction: BOARD_INSTRUCTION(String(fields.id)) };
}
function listedGates(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return;
  }
  if (!isObject2(parsed) || !Array.isArray(parsed.gates))
    return;
  return parsed.gates.filter((g) => isObject2(g) && isText(g.id));
}
function spillPaths(text) {
  const found = [...text.matchAll(/(?:^|[\s:"'`(])(\/[^\s"'`<>()[\]{},;]+)/g)].map((m) => m[1].replace(/[.:]+$/, ""));
  return [...new Set(found)].filter((p) => p.length > 1 && !p.endsWith("/"));
}
function savedResult(fileText) {
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return;
    }
  };
  const parsed = parse(fileText);
  const blocks = Array.isArray(parsed) ? parsed : isObject2(parsed) && Array.isArray(parsed.content) ? parsed.content : undefined;
  if (!blocks)
    return isObject2(parsed) ? parsed : undefined;
  const inner = parse(blocks.map((b) => isObject2(b) && typeof b.text === "string" ? b.text : "").join(""));
  return isObject2(inner) ? inner : undefined;
}
var shapeOf = (questions) => JSON.stringify((Array.isArray(questions) ? questions : []).map((q) => isObject2(q) ? [q.id, q.label] : null));
function spilledGate(stdout, session, known, call) {
  const kind = isText(call.kind) ? call.kind.trim() : "question";
  const gates = listedGates(stdout) ?? [];
  const mine = gates.filter((g) => g.presentation === "kit" && g.status === "open" && isObject2(g.nudge) && g.nudge.session === session && !known.includes(g.id) && g.kind === kind && (!isText(call.subject) || g.subject === call.subject.trim()) && (!Array.isArray(call.questions) || shapeOf(g.questions) === shapeOf(call.questions)));
  return mine.sort((a, b) => Number(b.openedAt ?? 0) - Number(a.openedAt ?? 0))[0];
}
function formFromRow(row) {
  const controls = isObject2(row.meta) ? row.meta.kitControls : undefined;
  return gateFormOf(row.id, isText(row.kind) ? row.kind : DEFAULT_TITLE, row.context, row.questions, controls);
}
function answerOutcome(stdout, session) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return "recorded";
  }
  if (!isObject2(parsed) || parsed.conflict !== true)
    return "recorded";
  const answer = isObject2(parsed.row) && isObject2(parsed.row.answer) ? parsed.row.answer : {};
  return answer.by === "pane" && answer.session === session ? "recorded" : "elsewhere";
}

// mods/gate-form/src/gate/rt.ts
var RT_TIMEOUT_MS = 15000;
var START_FAILURE_MS = 2000;
var RT_OVERRAN = "rt overran";
async function runRt($, args, timeoutMs = RT_TIMEOUT_MS) {
  const home = await $.env.get("HOME");
  const names = ["rt", `${home ?? ""}/.local/bin/rt`];
  let failure;
  for (const rt of names) {
    const started = await $.clock.now();
    try {
      return await $.process.run([rt, ...args], { timeoutMs });
    } catch (error) {
      if (await $.clock.now() - started >= START_FAILURE_MS)
        throw new Error(RT_OVERRAN);
      failure = error;
    }
  }
  throw failure;
}
function rtError(ran) {
  const said = (ran.stderr.trim() || ran.stdout.trim()).replace(/^rt gate: /, "");
  return said || `rt exited ${ran.exitCode}`;
}
function settingIsOn(ran) {
  if (ran.exitCode !== 0)
    return false;
  try {
    const parsed = JSON.parse(ran.stdout);
    return parsed.ok === true && parsed.value === true;
  } catch {
    return false;
  }
}

// mods/gate-form/src/gate/schema.ts
var TOOL_DESCRIPTION = "Ask the person questions in a form pane and wait for their answers. No limit on how many questions or options. Takes questions in mattstack gate_ask shape ({id, label, multi, writeIn, context, options}); give every option a description, one short line on what picking it means. Returns at once; the person's answers arrive as your next input, keyed by question id in gate_answer's shape: a value for a single pick, an array for multi, text for a question with no options, {writeIn} or {value, note} for typed Other text.";
var INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "The form title, e.g. the gate kind." },
    context: { type: "string", description: "Markdown shown above the questions, or a gate-ctx@1 JSON string." },
    questions: {
      type: "array",
      description: "Questions in gate_ask shape. Any number of questions and options.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          header: { type: "string", description: "A short tab name, a word or two. Defaults to the id." },
          label: { type: "string" },
          multi: { type: "boolean" },
          writeIn: { type: "boolean", description: "Marks a question whose Other text you can act on, as gate_ask does. Every question with options shows an Other row either way." },
          context: { type: "string" },
          options: {
            type: "array",
            description: "Objects {value, label, description}, each with a one-line description of what picking it means (a bare string is accepted but draws a blank line under it). Leave out for a free-text question.",
            items: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: { value: { type: "string" }, label: { type: "string" }, description: { type: "string" } },
                  required: ["value"]
                }
              ]
            }
          }
        },
        required: ["id", "label"]
      }
    }
  },
  required: ["questions"]
};

// mods/gate-form/src/gate/watch.ts
var isObject3 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function rowEnd(row) {
  if (row.status === "answered") {
    const answer = isObject3(row.answer) ? row.answer : {};
    return {
      status: "answered",
      by: String(answer.by ?? ""),
      ...typeof answer.session === "string" && { session: answer.session },
      ...isObject3(answer.answers) && { answers: answer.answers }
    };
  }
  if (row.status === "closed")
    return { status: "closed", ...typeof row.closedReason === "string" && { reason: row.closedReason } };
  return;
}
function waitEnd(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return;
  }
  if (!isObject3(parsed) || parsed.ok !== true)
    return;
  return rowEnd({ ...isObject3(parsed.row) ? parsed.row : {}, status: parsed.status });
}
var isSelf = (end, session) => end.status === "answered" && end.by === "pane" && (end.session === undefined || end.session === session);
var ANSWERED_ON = {
  board: "Answered on the board",
  console: "Answered in the console",
  shepherd: "Answered by the shepherd",
  pane: "Answered in another pane"
};
function endNote(end) {
  if (end.status === "closed")
    return end.reason === "superseded" ? "Replaced by a newer gate" : "Closed elsewhere";
  return ANSWERED_ON[end.by] ?? "Answered elsewhere";
}
async function waitFor($, gateId) {
  const home = await $.env.get("HOME");
  for (const rt of ["rt", `${home ?? ""}/.local/bin/rt`]) {
    const child = $.process.spawn({ argv: [rt, "gate", "wait", gateId], env: { CLAUDE_CODE_SESSION_ID: "" } });
    let step;
    try {
      step = await child.next();
    } catch {
      continue;
    }
    let stdout = "";
    try {
      while (!step.done) {
        if (step.value.stream === "stdout")
          stdout += step.value.text;
        step = await child.next();
      }
    } catch {
      return;
    }
    return step.value.code === 0 ? waitEnd(stdout) : undefined;
  }
  return;
}

// mods/gate-form/src/register.tsx
var PANE = "gate-form";
var TOOL = "ask";
var GATE_TITLE = "Decision gate";
var FORM_BUDGET = 95000;
var formsAtom = atom({ plugin: "gate-form", key: "forms" }, [], { shape: "forms-1" });
var legacyAtom = atom({ plugin: "gate-form", key: "form" }, null, { shape: "form-3" });
var keysAtom = atom({ plugin: "gate-form", key: "keysInForm" }, false);
var boardAtom = atom({ plugin: "gate-form", key: "board" }, [], { shape: "board-1" });
var drawn = {};
var setting = { isOn: false };
var ELSEWHERE = "Already answered elsewhere";
var ASK_OFF = "The gate form is off. Turn on rt.gates.kitForm and run /reload-plugins to use it.";
var SETTING_TIMEOUT_MS = 5000;
var QUICK_TIMEOUT_MS = 5000;
var watching = new Set;
var WAIT_RETRY_MS = [1000, 5000, 15000];
var answering = new Set;
var deck = {};
var asked = new Map;
var queued = [];
var WAIT_MS = 5000;
var TIMED_OUT = "No answer in time.";
var CLOSED = "Closed without an answer.";
var GATE_PANE = { id: PANE, label: "mattstack gate waiting" };
async function readForms($) {
  const forms = knownForms(await read($, formsAtom));
  return forms.length > 0 ? forms : fromLegacy(await read($, legacyAtom));
}
async function writeForms($, change) {
  const legacy = fromLegacy(await read($, legacyAtom));
  let written = [];
  await update($, formsAtom, (stored) => {
    const list = knownForms(stored);
    return written = change(list.length > 0 || legacy.length === 0 ? list : legacy);
  });
  if (legacy.length > 0)
    await update($, legacyAtom, () => null);
  return written;
}
async function waitingForm($) {
  const forms = await readForms($);
  const form = currentForm(forms);
  if (!form || form.status !== "open")
    return;
  const more = openCount(forms) - 1;
  return { formId: form.id, title: more > 0 ? `${form.title}, ${more} more waiting` : form.title };
}
async function setKeysInForm($, value) {
  if (await read($, keysAtom) !== value)
    await update($, keysAtom, () => value);
}
async function wake($, text, what, recovery) {
  const warn = () => $.ui.toast(`Could not tell Claude about ${what}${recovery ? `. ${recovery}` : ""}`);
  $.prompt.submit({ text }).then((sent) => {
    if (sent.drop !== undefined)
      warn();
  }).catch(warn);
}
async function wakeAnswered($, gateId) {
  await wake($, GATE_ANSWERED(gateId), `the answer to gate ${gateId}`, `Ask it to run gate_reconcile ${gateId}.`);
}
async function showCurrent($, forms, note) {
  const next = currentForm(forms);
  if (next?.status === "open") {
    await showPane($, GATE_PANE, next.title);
    return;
  }
  if (note)
    $.ui.toast(note);
  await $.ui.close({ id: PANE });
  $.ui.invalidate("ui.render");
}
async function readSetting($) {
  try {
    setting.isOn = settingIsOn(await runRt($, ["settings", "get", "rt.gates.kitForm", "--json"], SETTING_TIMEOUT_MS));
  } catch {
    setting.isOn = false;
  }
}
var failureText = (failure) => failure instanceof Error && failure.message === RT_OVERRAN ? `rt took longer than ${RT_TIMEOUT_MS / 1000}s, so the answer may already be recorded. Submit again to check.` : `Not recorded: rt could not run (${failure instanceof Error ? failure.message : String(failure)}).`;
async function answerGate($, form, answers) {
  const gateId = form.gateId ?? "";
  answering.add(form.id);
  let failed = true;
  try {
    failed = !await recordAnswer($, form, gateId, answers);
  } catch (failure) {
    await markFailed($, form, `Not recorded: ${failure instanceof Error ? failure.message : String(failure)}`).catch(() => {
      return;
    });
  } finally {
    answering.delete(form.id);
    if (failed)
      watchGate($, gateId);
  }
}
async function markFailed($, form, error) {
  await writeForms($, (list) => list.map((f) => f.id === form.id && f.status === "open" ? { ...f, error, attempt: (form.attempt ?? 0) + 1 } : f));
}
async function recordAnswer($, form, gateId, answers) {
  const session = await $.session.id();
  const args = ["gate", "answer", gateId, "--answers", JSON.stringify(answers), "--by", "pane", "--session", session];
  let error;
  let outcome = "recorded";
  try {
    const ran = await runRt($, args);
    if (ran.exitCode !== 0)
      error = `Not recorded: ${rtError(ran)}`;
    else
      outcome = answerOutcome(ran.stdout, session);
  } catch (failure) {
    error = failureText(failure);
  }
  if (error !== undefined) {
    await markFailed($, form, error);
    return false;
  }
  const patch = outcome === "elsewhere" ? { status: "answered", error: undefined, note: ELSEWHERE } : { status: "answered", error: undefined };
  const forms = await writeForms($, (list) => patchForm(list, form.id, patch));
  if (outcome === "recorded")
    await wakeAnswered($, gateId);
  await showCurrent($, forms, outcome === "elsewhere" ? ELSEWHERE : undefined);
  return true;
}
async function setGateAside($, form) {
  await wake($, GATE_ASIDE(form.gateId ?? ""), `setting gate ${form.gateId} aside`);
  await $.ui.close({ id: PANE });
}
async function settle($, formId, outcome) {
  const form = (await readForms($)).find((f) => f.id === formId);
  if (!form || form.status !== "open")
    return;
  if (form.source === "plugin")
    return settlePlugin($, form, outcome);
  if (form.source === "gate") {
    if (outcome.status === "answered")
      return answerGate($, form, outcome.answers);
    return setGateAside($, form);
  }
  const status = outcome.status === "answered" ? "answered" : "cancelled";
  const forms = await writeForms($, (list) => patchForm(list, formId, { status }));
  await wake($, agentReply(form, outcome), `the answers for ${formId}`);
  await showCurrent($, forms);
}
async function askPlugin($, args) {
  const form = pluginForm(args);
  if (typeof form === "string")
    return { deny: form };
  const entry = { wakes: [] };
  asked.set(form.id, entry);
  entry.timer = $.clock.after(args.timeoutMs, () => void endAsk($, form.id, { timedOut: true }, TIMED_OUT).catch(() => {
    return;
  }));
  const isAsking = (await readForms($)).some((f) => f.source === "plugin" && f.status === "open" && asked.has(f.id));
  if (isAsking || queued.length > 0)
    queued.push(form);
  else
    await openAsk($, form);
  return { value: { id: form.id } };
}
async function waitAsk($, id) {
  const entry = asked.get(id);
  if (!entry)
    return { closed: true };
  if (!entry.outcome) {
    const stop = new AbortController;
    await Promise.race([new Promise((resolve) => entry.wakes.push(resolve)), $.clock.sleep(WAIT_MS, { signal: stop.signal }).catch(() => {
      return;
    })]);
    stop.abort();
  }
  if (!entry.outcome)
    return { pending: true };
  asked.delete(id);
  return entry.outcome;
}
async function endAsk($, id, outcome, note) {
  const entry = asked.get(id);
  if (entry?.outcome)
    return;
  if (entry) {
    entry.outcome = outcome;
    entry.timer?.cancel();
    for (const wake of entry.wakes.splice(0))
      wake();
  }
  const at = queued.findIndex((f) => f.id === id);
  if (at >= 0) {
    queued.splice(at, 1);
    return;
  }
  const status = "value" in outcome ? "answered" : "cancelled";
  const forms = await writeForms($, (list) => patchForm(list, id, { status, ...note && { note } }));
  const next = queued.shift();
  if (next)
    await openAsk($, next);
  else
    await showCurrent($, forms);
}
async function openAsk($, form) {
  await openForm($, form).catch(() => {
    return;
  });
}
async function settlePlugin($, form, outcome) {
  if (!asked.has(form.id))
    return;
  const value = outcome.status === "answered" ? outcome.answers[PLUGIN_QUESTION] : undefined;
  await (typeof value === "string" ? endAsk($, form.id, { value }) : endAsk($, form.id, { closed: true }, CLOSED));
}
async function closeOrphans($) {
  const isOrphan = (f) => f.source === "plugin" && f.status === "open" && !asked.has(f.id);
  if (!(await readForms($)).some(isOrphan))
    return;
  const forms = await writeForms($, (list) => list.map((f) => isOrphan(f) ? { ...f, status: "cancelled", note: CLOSED } : f));
  if (openCount(forms) === 0)
    await $.ui.close({ id: PANE });
  $.ui.invalidate("ui.render");
}
async function openForm($, form, supersededId) {
  await writeForms($, (list) => addForm(list, form, supersededId));
  const shown = currentForm(await readForms($));
  const title = shown?.title ?? form.title;
  if (!await showPane($, GATE_PANE, title))
    $.ui.toast(`${title} is waiting: press Show above the prompt`);
}
async function ringBell($, form) {
  if (await $.env.get("HERDR_ENV") !== "1" || !await $.env.get("HERDR_PANE_ID"))
    return;
  await $.process.run(bellArgs(await $.session.cwd(), form.questions), { timeoutMs: QUICK_TIMEOUT_MS }).catch(() => {
    return;
  });
}
async function gateEnded($, gateId, end) {
  if ((await read($, boardAtom)).some((b) => b.gateId === gateId))
    await update($, boardAtom, (list) => list.filter((b) => b.gateId !== gateId));
  const open = (await readForms($)).filter((f) => f.gateId === gateId && f.status === "open" && !answering.has(f.id));
  if (open.length === 0)
    return $.ui.invalidate("ui.render");
  const self = isSelf(end, await $.session.id());
  const won = end.status === "answered" ? end.answers : undefined;
  const note = self ? undefined : [endNote(end), won && controlText(won)].filter(Boolean).join(". ");
  const patch = self ? { status: "answered", error: undefined } : { status: end.status === "answered" ? "answered" : "cancelled", error: undefined, note, ...won && { won } };
  const forms = await writeForms($, (list) => list.map((f) => open.some((o) => o.id === f.id) ? { ...f, ...patch } : f));
  if (self)
    await wakeAnswered($, gateId);
  await showCurrent($, forms, note && `${open[0].title}: ${note}`);
}
function controlText(answers) {
  if (answers.next === "hold")
    return "Paused the run";
  if (answers.next === "go-back")
    return typeof answers.to === "string" && answers.to !== "" ? `Went back to ${answers.to}` : "Went back a stage";
  return;
}
async function shownHere($, gateId) {
  if ((await readForms($)).some((f) => f.gateId === gateId && f.status === "open"))
    return true;
  return (await read($, boardAtom)).some((b) => b.gateId === gateId);
}
function watchGate($, gateId, retry = 0) {
  if (!setting.isOn || watching.has(gateId))
    return;
  watching.add(gateId);
  (async () => {
    let failed = false;
    try {
      const end = await waitFor($, gateId);
      if (end)
        await gateEnded($, gateId, end);
      else
        failed = true;
    } catch {} finally {
      watching.delete(gateId);
    }
    const pause = WAIT_RETRY_MS[retry];
    if (!failed || pause === undefined)
      return;
    try {
      if (!await shownHere($, gateId))
        return;
      await $.clock.sleep(pause);
      if (await shownHere($, gateId))
        watchGate($, gateId, retry + 1);
    } catch {}
  })();
}
async function gateOpened($, form) {
  if (form.gateId)
    watchGate($, form.gateId);
  ringBell($, form);
}
async function readDeck($) {
  const home = await $.env.get("HOME");
  for (const name of ["deck", `${home ?? ""}/.local/bin/deck`]) {
    try {
      const ran = await $.process.run([name, "list", "--json"], { timeoutMs: QUICK_TIMEOUT_MS });
      deck.address = ran.exitCode === 0 ? boardAddress(ran.stdout) ?? null : null;
      return;
    } catch {
      deck.address = null;
    }
  }
}
async function addBoard($, gate, supersededId) {
  await readDeck($);
  await update($, boardAtom, (list) => addBoardGate(list, gate, supersededId));
  watchGate($, gate.gateId);
  $.ui.invalidate("ui.render");
}
async function sendToBoard($, gate, reason, supersededId) {
  await addBoard($, gate, supersededId);
  $.ui.toast(BOARD_TOAST(kindTitle(gate.kind), reason));
}
async function openBoard($, gateId) {
  const gate = (await read($, boardAtom)).find((b) => b.gateId === gateId);
  if (!gate || !deck.address)
    return;
  await $.process.run(["open", boardUrl(deck.address, gate.gateId)]).catch(() => $.ui.toast("Could not open the board"));
}
async function restore($) {
  let rows;
  try {
    const ran = await runRt($, ["gate", "list", "--json"]);
    rows = ran.exitCode === 0 ? listedGates(ran.stdout) : undefined;
  } catch {
    rows = undefined;
  }
  const listed = rows ?? [];
  const session = rows ? await $.session.id() : "";
  const byId = new Map(listed.map((row) => [row.id, row]));
  const fresh = [];
  const undrawable = [];
  for (const row of listed.filter((row) => row.presentation === "kit" && row.status === "open" && row.nudge?.session === session).sort((a, b) => Number(a.openedAt ?? 0) - Number(b.openedAt ?? 0))) {
    const form = formFromRow(row);
    if (typeof form === "string")
      undrawable.push({ gate: { gateId: row.id, kind: typeof row.kind === "string" ? row.kind : "" }, reason: form });
    else
      fresh.push(form);
  }
  const added = [];
  const forms = await writeForms($, (list) => fresh.reduce((acc, form) => {
    if (acc.some((f) => f.gateId === form.gateId))
      return acc;
    added.push(form);
    return addForm(acc, form);
  }, list));
  const onBoard = (await read($, boardAtom)).map((b) => b.gateId);
  const newlyOnBoard = undrawable.filter((u) => !onBoard.includes(u.gate.gateId) && !forms.some((f) => f.gateId === u.gate.gateId));
  if (newlyOnBoard.length > 0)
    await update($, boardAtom, (list) => newlyOnBoard.reduce((acc, u) => addBoardGate(acc, u.gate), list));
  for (const u of newlyOnBoard)
    $.ui.toast(BOARD_TOAST(kindTitle(u.gate.kind), u.reason));
  const ended = (gateId) => {
    const row = byId.get(gateId);
    return row ? rowEnd(row) : undefined;
  };
  for (const form of forms.filter((f) => f.status === "open" && f.gateId)) {
    const end = ended(form.gateId);
    if (end)
      await gateEnded($, form.gateId, end);
    else
      watchGate($, form.gateId);
  }
  for (const gate of await read($, boardAtom)) {
    const end = ended(gate.gateId);
    if (end)
      await gateEnded($, gate.gateId, end);
    else
      watchGate($, gate.gateId);
  }
  if ((await read($, boardAtom)).length > 0)
    await readDeck($);
  for (const form of added)
    ringBell($, form);
  $.ui.invalidate("ui.render");
}
function canDraw(e) {
  if (!setting.isOn)
    return false;
  const surface = drawn.surface;
  const args = e;
  return e.agentId === undefined && args.handBack !== true && (surface === "terminal" || surface === "desktop");
}
var textOf = (out) => {
  if (typeof out.text === "string")
    return out.text;
  const result = out.result;
  if (typeof result === "string")
    return result;
  const blocks = Array.isArray(result) ? result : result?.content ?? [];
  return (Array.isArray(blocks) ? blocks : []).map((b) => typeof b.text === "string" ? b.text : "").join("");
};
function withText(result, text) {
  if (Array.isArray(result))
    return [{ type: "text", text }];
  if (result && typeof result === "object" && "content" in result)
    return { ...result, content: [{ type: "text", text }], structuredContent: undefined };
  return text;
}
async function takeGate($, e, next) {
  if (setting.reading)
    await setting.reading;
  if (!canDraw(e))
    return next(e);
  const out = await next({ ...e, kitForm: true });
  if (out.deny !== undefined || out.isError)
    return out;
  const text = textOf(out);
  const kit = readKitResult(text);
  const board = kit.kind === "other" ? readBoardOnly(text) : undefined;
  if (board)
    await addBoard($, { gateId: board.gateId, kind: String(e.kind ?? "") }, board.supersededId);
  if (kit.kind === "other")
    return out;
  const kind = e.kind;
  const title = typeof kind === "string" && kind.trim() !== "" ? kind : GATE_TITLE;
  const kindText = typeof kind === "string" ? kind : "";
  if (kit.kind === "kit") {
    const gateId = kit.fields.id;
    if (typeof gateId !== "string" || gateId === "")
      return out;
    const shown = await showKitGate($, gateForm(kit.fields, title), { gateId, kind: kindText }, supersededOf(kit.fields));
    return { result: withText(out.result, JSON.stringify(shown === "form" ? agentFields(kit.fields) : boardFields(kit.fields))) };
  }
  return takeSpilled($, e, out, text, title, kindText);
}
var supersededOf = (fields) => typeof fields.supersededId === "string" ? fields.supersededId : undefined;
async function showKitGate($, form, gate, supersededId) {
  if (typeof form === "string") {
    await sendToBoard($, gate, form, supersededId);
    return "board";
  }
  await openForm($, form, supersededId);
  await gateOpened($, form);
  return "form";
}
async function takeSpilled($, e, out, text, title, kindText) {
  const saved = await readSpill($, text);
  if (saved && saved.paneAction !== "kit")
    return out;
  let gateId;
  let form;
  let supersededId;
  if (saved && typeof saved.id === "string" && saved.id !== "") {
    gateId = saved.id;
    form = gateForm(saved, title);
    supersededId = supersededOf(saved);
  } else {
    const row = await matchingGate($, e);
    if (!row)
      return out;
    gateId = row.id;
    form = formFromRow(row);
  }
  const shown = await showKitGate($, form, { gateId, kind: kindText }, supersededId);
  return { result: withText(out.result, `${text}

${shown === "form" ? GATE_INSTRUCTION(gateId) : BOARD_INSTRUCTION(gateId)}`) };
}
async function readSpill($, text) {
  for (const path of spillPaths(text)) {
    try {
      const saved = savedResult(await $.fs.read(path));
      if (saved)
        return saved;
    } catch {}
  }
  return;
}
async function matchingGate($, e) {
  const known = (await readForms($)).flatMap((f) => f.gateId ? [f.gateId] : []);
  try {
    const ran = await runRt($, ["gate", "list", "--open", "--json"]);
    return ran.exitCode === 0 ? spilledGate(ran.stdout, await $.session.id(), known, e) : undefined;
  } catch {
    return;
  }
}
function boardBand($, e, rest, board) {
  const newest = board.at(-1);
  const text = boardText(board);
  const hasAddress = typeof deck.address === "string";
  const els = $.ui.resolve(e);
  const { Box, Text, Button } = els;
  const Client = "Client" in els ? els.Client : undefined;
  const band = Client ? /* @__PURE__ */ h(Client, {
    key: "board-band",
    module: "./board-band.js",
    props: { text, gateId: newest.gateId, hasAddress }
  }) : /* @__PURE__ */ h(Box, {
    flexDirection: "row",
    gap: 2
  }, /* @__PURE__ */ h(Text, {
    wrap: "truncate-end"
  }, text), hasAddress ? /* @__PURE__ */ h(Button, {
    key: "open-board",
    label: "Open on board",
    onPress: () => openBoard($, newest.gateId)
  }) : /* @__PURE__ */ h(Text, {
    dimColor: true
  }, NO_ADDRESS));
  return /* @__PURE__ */ h(Box, {
    flexDirection: "column"
  }, band, rest);
}
async function turnOn($) {
  await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false }).catch(() => {
    return;
  });
  await restore($);
}
function register(on) {
  registerPaneRedraw(on);
  on("engine.create", async ($, e, next) => {
    const built = await next(e);
    return { ...built, gateForm: { ask: async () => ({ id: "" }), wait: async () => ({ closed: true }) } };
  });
  on("gateForm.ask", ($, e) => askPlugin($, e));
  on("gateForm.wait", ($, e) => waitAsk($, e.id).then((value) => ({ value })));
  on("session.start", async ($, e, next) => {
    setting.reading = readSetting($);
    setting.reading.then(() => setting.isOn ? turnOn($) : undefined).catch(() => {
      return;
    });
    await closeOrphans($).catch(() => {
      return;
    });
    return next(e);
  });
  on("tool.call", { tool: "mcp__gate-form__ask" }, async ($, e) => {
    if (setting.reading)
      await setting.reading;
    if (!setting.isOn)
      return { deny: ASK_OFF };
    const args = e;
    const form = toForm(args.title, args.context, args.questions, "ask");
    if (typeof form === "string")
      return { deny: form };
    await openForm($, form);
    return {
      result: `Form ${form.id} is open in the pane with ${form.questions.length} questions. End your turn now: the user's answers arrive as your next input, as JSON keyed by question id.`
    };
  });
  on("tool.call", { tool: "mcp__plugin_mattstack_mattstack__gate_ask" }, ($, e, next) => takeGate($, e, next)).catch(($, e, next) => next(e));
  on("tool.call", { tool: "mcp__plugin_mattstack_mattstack__gate_open" }, ($, e, next) => takeGate($, e, next)).catch(($, e, next) => next(e));
  on("prompt.edit", async ($, e, next) => {
    await setKeysInForm($, false);
    return next(e);
  });
  on("prompt.submit", async ($, e, next) => {
    await setKeysInForm($, false);
    return next(e);
  });
  on("ui.focus", async ($, e, next) => {
    await setKeysInForm($, false);
    return next(e);
  });
  on("ui.message", async ($, e, next) => {
    if (isEngaged(e))
      await setKeysInForm($, true);
    await paneMessage($, e, GATE_PANE, await waitingForm($));
    const posted = e.data;
    if (posted?.type === "open-board")
      await openBoard($, posted.gateId);
    if (e.requestId !== PANE)
      return next(e);
    const message = e.data;
    if (message.type === "answer")
      await settle($, message.formId, { status: "answered", answers: message.answers ?? {} });
    if (message.type === "chat")
      await settle($, message.formId, { status: "chat", draft: message.draft ?? {} });
    return next(e);
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    drawn.surface = e.surface;
    if (e.props.hasSurvey)
      return next(e);
    const waiting = await waitingForm($);
    const formWaits = waiting !== undefined && !await isPlaced($, GATE_PANE);
    const board = setting.isOn && deck.address !== undefined ? await read($, boardAtom) : [];
    if (!formWaits && board.length === 0)
      return next(e);
    const rest = formWaits ? await bandAbovePrompt($, e, await next(e), waiting, GATE_PANE, { engineShow: true }) : await next(e);
    return board.length > 0 ? boardBand($, e, rest, board) : rest;
  });
  on("ui.scroll", { component: "Pane", requestId: "gate-form" }, async ($, e, next) => {
    if (e.contentRows > e.bodyRows)
      return next(e);
    addWheel($, PANE, e.by);
    return {};
  });
  on("ui.render", { component: "Pane", requestId: "gate-form" }, async ($, e) => {
    const els = $.ui.resolve(e);
    const { Box, Text, Button } = els;
    const Client = "Client" in els ? els.Client : undefined;
    const form = currentForm(await readForms($));
    if (!form)
      return /* @__PURE__ */ h(Text, {
        dimColor: true
      }, "No questions right now.");
    if (!Client)
      return /* @__PURE__ */ h(Text, {
        dimColor: true
      }, "This screen can't draw the form yet. Answer in the terminal.");
    const body = paneRows(e);
    const rows = Math.max(8, body - 3);
    const focused = e.props.isFocused || await read($, keysAtom);
    const height = Math.max(1, form.status === "open" ? body : body - 2);
    if (form.confirm && form.status === "open") {
      const answers = (form.questions[0]?.options ?? []).map((option) => ({ label: option.label, onPress: () => void settle($, form.id, { status: "answered", answers: { [PLUGIN_QUESTION]: option.value } }) }));
      return /* @__PURE__ */ h(Box, {
        flexDirection: "column",
        paddingX: 1,
        gap: 1
      }, /* @__PURE__ */ h(Client, {
        key: `form-${form.id}`,
        module: "./form.js",
        props: { form: fitForm(form, FORM_BUDGET), rows, cols: (e.props.bodyColumns ?? 60) - 2, focused, wheel: wheelTotal(PANE) }
      }), hotkeyChoices(els, { key: `confirm-${form.id}`, choices: answers, focused: e.props.isFocused === true }));
    }
    return /* @__PURE__ */ h(Box, {
      flexDirection: "column",
      paddingX: 1,
      gap: 1
    }, /* @__PURE__ */ h(Client, {
      key: `form-${form.id}`,
      module: "./form.js",
      height,
      props: { form: fitForm(form, FORM_BUDGET), rows, cols: (e.props.bodyColumns ?? 60) - 2, focused, wheel: wheelTotal(PANE) }
    }), form.status === "open" ? null : /* @__PURE__ */ h(Box, {
      flexDirection: "row",
      gap: 1
    }, /* @__PURE__ */ h(Button, {
      key: "close",
      role: "dismiss",
      label: "Close",
      onPress: () => void $.ui.close({ id: PANE })
    })));
  });
}
export {
  register
};
