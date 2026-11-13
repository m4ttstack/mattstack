// mods/gate-form/src/register.tsx
import { atom, read, update } from "claude-code";

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
function summaryOf(text) {
  const summary = (text.split(`
`)[0] ?? "").replace(REPLY_TAG, "").replace(/^The user /, "");
  return summary.charAt(0).toUpperCase() + summary.slice(1);
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
async function setKeysInForm($, value) {
  if (await read($, keysAtom) !== value)
    await update($, keysAtom, () => value);
}
async function show($, form) {
  await update($, formAtom, () => form);
  await $.ui.open({ id: PANE, title: form.title, focus: true });
  $.ui.invalidate("ui.render");
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
  on("session.start", async ($, e, next) => {
    await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false });
    await $.command.register({ name: "gate-form-demo", description: "Open the gate form with a demo gate" });
    return next(e);
  });
  on("command.run", { command: "gate-form-demo" }, async ($) => {
    const form = toForm(DEMO.title, DEMO.context, DEMO.questions, "toast");
    if (typeof form === "string")
      return { text: form };
    await show($, form);
    return { text: "Demo gate form opened." };
  });
  on("tool.call", { tool: "mcp__gate-form__ask" }, async ($, e) => {
    const args = e;
    const form = toForm(args.title, args.context, args.questions, "agent");
    if (typeof form === "string")
      return { deny: form };
    await show($, form);
    return {
      result: `Form ${form.id} is open in the pane with ${form.questions.length} questions. End your turn now: the user's answers arrive as your next input, as JSON keyed by question id.`
    };
  });
  on("ui.message", async ($, e, next) => {
    const message = e.data;
    if (message.type === "reopen") {
      const form = await read($, formAtom);
      if (form && form.id === message.formId && form.status === "open")
        await show($, form);
      return next(e);
    }
    if (e.requestId !== PANE)
      return next(e);
    if (message.type === "engaged")
      await setKeysInForm($, true);
    if (message.type === "minimize")
      await $.ui.close({ id: PANE });
    if (message.type === "answer")
      await settle($, message.formId, { status: "answered", answers: message.answers ?? {} });
    if (message.type === "chat")
      await settle($, message.formId, { status: "chat", draft: message.draft ?? {} });
    return next(e);
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
  on("ui.render", { component: "UserMessage" }, async ($, e, next) => {
    const origin = e.props.origin;
    if (origin.kind !== "plugin" || origin.name !== "gate-form")
      return next(e);
    return next({ ...e, props: { ...e.props, text: `${BRAND.glyph} mattstack gate  ${summaryOf(e.props.text)}` } });
  });
  on("ui.close", async ($, e, next) => {
    const closed = await next(e);
    $.ui.invalidate("ui.render");
    return closed;
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey)
      return next(e);
    const form = await read($, formAtom);
    if (!form || form.status !== "open" || (await $.ui.panes()).some((p) => p.id === PANE && p.isPlaced))
      return next(e);
    const els = $.ui.resolve(e);
    const { Box, Text, Button } = els;
    const Client = "Client" in els ? els.Client : undefined;
    const rest = await next(e);
    const band = Client ? /* @__PURE__ */ h(Client, {
      key: `band-${form.id}`,
      module: "./band.js",
      props: { formId: form.id, title: form.title }
    }) : /* @__PURE__ */ h(Box, {
      flexDirection: "row",
      gap: 2
    }, /* @__PURE__ */ h(Text, {
      color: BRAND.pink
    }, `${BRAND.glyph} mattstack gate waiting `), /* @__PURE__ */ h(Text, {
      wrap: "truncate-end"
    }, form.title), /* @__PURE__ */ h(Button, {
      key: "open-gate-form",
      label: "Open",
      onPress: () => show($, form)
    }));
    return /* @__PURE__ */ h(Box, {
      flexDirection: "column"
    }, band, rest);
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
