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
var WARN = { color: "yellow" };
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
// packages/mod-kit/src/interact/focus.ts
function isEngaged(e) {
  return e.data?.type === "engaged";
}
// packages/mod-kit/src/patterns/hideable-pane.tsx
var DEFAULT_BAND_LABEL = "mattstack waiting";
async function showPane($, pane, title) {
  await $.ui.open({ id: pane.id, title, focus: true });
  $.ui.invalidate("ui.render");
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
async function bandAbovePrompt($, e, rest, waiting, pane) {
  const label = pane.label ?? DEFAULT_BAND_LABEL;
  const els = $.ui.resolve(e);
  const { Box, Text, Button } = els;
  const Client = "Client" in els ? els.Client : undefined;
  const band = Client ? /* @__PURE__ */ h(Client, {
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
// mods/gate-form/src/gate/demo.ts
var DEMO = {
  title: "respond-plan gate (demo)",
  context: ["Review round 2 on !482 found 7 threads. Pick which to fix in this pass.", "", "Important:", "- 2 threads are blocking", "- CodeRabbit flagged the cache key twice"].join(`
`),
  questions: [
    {
      id: "threads",
      label: "Which threads should this pass fix?",
      multi: true,
      context: "Each option is one review thread, newest first.",
      options: [
        { value: "t1", label: "Cache key ignores the repo identity (Recommended)", description: "blocking, lib/cache.ts:41" },
        { value: "t2", label: "Retry loop never backs off", description: "blocking, lib/retry.ts:88" },
        { value: "t3", label: "Rename fetchAll to listAll", description: "non-blocking" },
        { value: "t4", label: "Missing test for an empty page", description: "non-blocking" },
        { value: "t5", label: "Log line leaks the token prefix", description: "question" },
        { value: "t6", label: "Prefer a Map over a plain object", description: "non-blocking" },
        { value: "t7", label: "Typo in the README", description: "non-blocking" }
      ]
    },
    {
      id: "approach",
      label: "How should the cache key change?",
      writeIn: true,
      options: [
        { value: "identity", label: "Key on the serialized identity (Recommended)", description: "matches every other store" },
        { value: "path", label: "Key on the host/path form", description: "what the settings resolver uses" },
        { value: "hash", label: "Hash the remote URL", description: "stable across renames, opaque in logs" },
        { value: "both", label: "Write both, read identity first", description: "a one-release migration" },
        { value: "drop", label: "Drop the cache", description: "every read goes to the forge" },
        { value: "later", label: "Leave it for a follow-up", description: "file a ticket instead" }
      ]
    },
    { id: "note", label: "Anything the fixer should know?" },
    {
      id: "notify",
      label: "Post a reply on each fixed thread?",
      options: [
        { value: "yes", label: "Yes", description: "a short note on each thread naming the fix" },
        { value: "no", label: "No", description: "resolve the threads without a reply" }
      ]
    },
    {
      id: "checks",
      header: "checks",
      label: "Which checks should run before pushing?",
      multi: true,
      options: [
        { value: "unit", label: "Unit tests for the touched files", description: "about a minute" },
        { value: "e2e", label: "The e2e suite", description: "slow, needs the preload" },
        { value: "types", label: "Type-check", description: "tsc over the workspace" },
        { value: "lint", label: "Lint", description: "biome and the import walls" },
        { value: "purity", label: "Purity scan", description: "no private slugs in fixtures" }
      ]
    },
    {
      id: "reviewer",
      header: "reviewer",
      label: "Who should re-review once the fixes are pushed?",
      context: "More than eight choices, so the list scrolls.",
      options: [
        { value: "coderabbit", label: "CodeRabbit (Recommended)", description: "reviews every push on its own" },
        { value: "opus", label: "An Opus subagent", description: "when CodeRabbit is rate limited" },
        { value: "author", label: "The thread authors", description: "each person who opened a thread" },
        { value: "owner", label: "The code owner", description: "from CODEOWNERS" },
        { value: "pair", label: "Whoever paired on it" },
        { value: "lead", label: "The team lead" },
        { value: "qa", label: "QA", description: "for the behaviour change" },
        { value: "security", label: "Security", description: "the token prefix thread" },
        { value: "docs", label: "Docs", description: "the README thread" },
        { value: "none", label: "Nobody", description: "merge once CI is green" }
      ]
    },
    {
      id: "scope",
      header: "scope",
      label: "How big should this pass be?",
      writeIn: true,
      options: [
        { value: "blocking", label: "Blocking threads only", description: "the smallest diff that unblocks the merge" },
        { value: "picked", label: "Everything picked above (Recommended)", description: "one push, one review round" },
        { value: "split", label: "Split into two MRs", description: "blocking now, the rest as a follow-up" }
      ]
    },
    { id: "summary", header: "summary", label: "One line for the MR comment that lists the fixes?" },
    {
      id: "next",
      label: "Happy with this, or should something change?",
      options: [
        { value: "proceed", label: "Looks good, continue (Recommended)", description: "Move on to the next step" },
        { value: "iterate", label: "Change something", description: "Say what to change, then redo this step" },
        { value: "go-back", label: "Redo an earlier step", description: "Return to a step that needs redoing" },
        { value: "hold", label: "Pause", description: "Stop until you resume this run" },
        { value: "abandon", label: "Abandon", description: "End this run for good" }
      ]
    }
  ]
};

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
function toOptions(q) {
  const options = [];
  const seen = new Set;
  for (const raw of Array.isArray(q.options) ? q.options : []) {
    const option = toOption(raw);
    if (option.value === "")
      return `question ${q.id} has an option with no value.`;
    if (seen.has(option.value))
      return `question ${q.id} has option ${option.value} twice.`;
    seen.add(option.value);
    options.push(option);
  }
  return options;
}
function toQuestion(q, seen) {
  if (typeof q?.id !== "string" || q.id === "")
    return "every question needs a string id.";
  if (seen.has(q.id))
    return `question id ${q.id} is used twice.`;
  if (typeof q.label !== "string")
    return `question ${q.id} needs a label.`;
  seen.add(q.id);
  const options = toOptions(q);
  if (typeof options === "string")
    return options;
  return {
    id: q.id,
    header: isText(q.header) ? q.header : q.id,
    label: q.label,
    multi: q.multi === true,
    writeIn: q.writeIn === true,
    ...isText(q.context) && { context: q.context },
    options
  };
}
function toForm(title, context, raw, replyTo) {
  if (!Array.isArray(raw) || raw.length === 0)
    return "questions must be a non-empty array.";
  const seen = new Set;
  const questions = [];
  for (const q of raw) {
    const question = toQuestion(q, seen);
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
    replyTo
  };
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
function toastReply(form, outcome) {
  if (outcome.status === "chat")
    return `Set "${form.title}" aside to chat about it`;
  return `Submitted "${form.title}": ${Object.keys(outcome.answers).length} of ${form.questions.length} questions answered`;
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

// mods/gate-form/src/register.tsx
var PANE = "gate-form";
var TOOL = "ask";
var formAtom = atom({ plugin: "gate-form", key: "form" }, null, { shape: "form-3" });
var keysAtom = atom({ plugin: "gate-form", key: "keysInForm" }, false);
async function waitingForm($) {
  const form = await read($, formAtom);
  return form && form.status === "open" ? { formId: form.id, title: form.title } : undefined;
}
var GATE_PANE = { id: PANE, label: "mattstack gate waiting" };
async function setKeysInForm($, value) {
  if (await read($, keysAtom) !== value)
    await update($, keysAtom, () => value);
}
async function settle($, formId, outcome) {
  const form = await read($, formAtom);
  if (!form || form.id !== formId || form.status !== "open")
    return;
  const status = outcome.status === "answered" ? "answered" : "cancelled";
  await update($, formAtom, (f) => f && f.id === formId ? { ...f, status } : f);
  if (form.replyTo === "toast")
    return $.ui.toast(toastReply(form, outcome));
  const warn = () => $.ui.toast(`Could not send the answers for ${formId} to Claude`);
  $.prompt.submit({ text: agentReply(form, outcome) }).then((sent) => {
    if (sent.drop !== undefined)
      warn();
  }).catch(warn);
}
function register(on) {
  registerPaneRedraw(on);
  on("session.start", async ($, e, next) => {
    await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false });
    await $.command.register({ name: "gate-form-demo", description: "Open the gate form with a demo gate" });
    return next(e);
  });
  on("command.run", { command: "gate-form-demo" }, async ($) => {
    const form = toForm(DEMO.title, DEMO.context, DEMO.questions, "toast");
    if (typeof form === "string")
      return { text: form };
    await update($, formAtom, () => form);
    await showPane($, GATE_PANE, form.title);
    return { text: "Demo gate form opened." };
  });
  on("tool.call", { tool: "mcp__gate-form__ask" }, async ($, e) => {
    const args = e;
    const form = toForm(args.title, args.context, args.questions, "agent");
    if (typeof form === "string")
      return { deny: form };
    await update($, formAtom, () => form);
    await showPane($, GATE_PANE, form.title);
    return {
      result: `Form ${form.id} is open in the pane with ${form.questions.length} questions. End your turn now: the user's answers arrive as your next input, as JSON keyed by question id.`
    };
  });
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
    if (e.props.hasSurvey)
      return next(e);
    const waiting = await waitingForm($);
    if (!waiting || await isPlaced($, GATE_PANE))
      return next(e);
    return bandAbovePrompt($, e, await next(e), waiting, GATE_PANE);
  });
  on("ui.render", { component: "Pane", requestId: "gate-form" }, async ($, e) => {
    const els = $.ui.resolve(e);
    const { Box, Text, Button } = els;
    const Client = "Client" in els ? els.Client : undefined;
    const form = await read($, formAtom);
    if (!form)
      return /* @__PURE__ */ h(Text, {
        dimColor: true
      }, "No questions right now.");
    if (!Client)
      return /* @__PURE__ */ h(Text, {
        dimColor: true
      }, "This screen can't draw the form yet. Answer in the terminal.");
    const rows = Math.max(8, (e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30) - 3);
    const focused = e.props.isFocused || await read($, keysAtom);
    return /* @__PURE__ */ h(Box, {
      flexDirection: "column",
      paddingX: 1,
      gap: 1
    }, /* @__PURE__ */ h(Client, {
      key: `form-${form.id}`,
      module: "./form.js",
      props: { form, rows, cols: (e.props.bodyColumns ?? 60) - 2, focused }
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
