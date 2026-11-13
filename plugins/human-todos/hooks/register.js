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
    else
      rows.push(...chunkCells(line, width));
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
      if (cellWidth(joined) <= width) {
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

// mods/human-todos/src/store.ts
import { atom, read, update } from "claude-code";

// mods/human-todos/src/local.ts
var PID_LINE = /^__human_todo_pid__(\d+)$/;
var FLUSH_MS = 1000;
var WINDOW = 1024 * 1024;
var SLACK = WINDOW;
var TAIL_SCAN = 64 * 1024;
var DROPPED = `[earlier output was dropped]
`;
var jobs = new Map;
async function logFolder($) {
  const cache = await $.env.get("XDG_CACHE_HOME");
  if (cache)
    return `${cache}/human-todos`;
  const home = await $.env.get("HOME");
  if (!home)
    throw new Error("no home folder for the log");
  return `${home}/Library/Caches/human-todos`;
}
function signal($, pid, sig = "TERM") {
  const walk = 'walk() { for c in $(pgrep -P "$1"); do walk "$c"; done; echo "$1"; }';
  return $.process.run(["/bin/sh", "-c", `${walk}; kill -${sig} $(walk ${pid}) 2>/dev/null`]);
}
function scanStderr(held, text) {
  const buffered = held + text;
  const cut = buffered.lastIndexOf(`
`) + 1;
  let passed = "";
  let pid;
  for (const line of buffered.slice(0, cut).split(`
`).slice(0, -1)) {
    const marker = pid === undefined ? PID_LINE.exec(line) : null;
    if (marker)
      pid = Number(marker[1]);
    else
      passed += `${line}
`;
  }
  const rest = buffered.slice(cut);
  return pid === undefined ? { held: rest, passed } : { held: "", passed: passed + rest, pid };
}
function liveLines(output) {
  return output.split(`
`).filter((line) => line.trim() !== "").slice(-LIVE_LINES_LOCAL);
}
async function startLocal($, todo) {
  let token = newToken();
  while (jobs.has(token))
    token = newToken();
  const job = { isStopped: false, isGone: false };
  jobs.set(token, job);
  const logPath = `${await logFolder($)}/${await $.session.id()}-${todo.id}-${token}.log`;
  const abandon = async () => {
    jobs.delete(token);
    await $.process.run(["rm", "-f", "--", logPath]).catch(() => {
      return;
    });
  };
  await $.fs.write(logPath, "");
  if (job.isGone)
    return abandon();
  if (todo.logPath)
    await $.process.run(["rm", "-f", "--", todo.logPath]).catch(() => {
      return;
    });
  if (job.isGone)
    return abandon();
  await patchTodo($, todo.id, { token, logPath, liveTail: [], isStopping: false });
  const still = job.isGone ? undefined : (await listTodos($)).find((t) => t.id === todo.id);
  if (job.isGone || still?.status !== "running" || still.token !== token) {
    await abandon();
    if (!job.isGone && still?.token === token)
      await patchTodo($, todo.id, { token: undefined, logPath: undefined }).catch(() => {
        return;
      });
    return;
  }
  let output = "";
  let isTrimmed = false;
  let held = "";
  let revision = 0;
  let written = 0;
  let isWriteFailed = false;
  const append = (text) => {
    output += text;
    if (output.length > WINDOW + SLACK) {
      output = output.slice(-WINDOW);
      isTrimmed = true;
    }
    revision += 1;
  };
  const kept = () => output.length > WINDOW ? output.slice(-WINDOW) : output;
  const isCut = () => isTrimmed || output.length > WINDOW;
  let queue = Promise.resolve();
  const writeOut = async () => {
    if (job.isGone || revision === written)
      return;
    written = revision;
    try {
      await $.fs.write(logPath, isCut() ? `${DROPPED}${kept()}` : output);
    } catch {
      if (!isWriteFailed)
        $.ui.toast(`Could not save the output of #${todo.id}`);
      isWriteFailed = true;
    }
    if (job.isGone)
      return;
    await patchTodo($, todo.id, { liveTail: clipLines(liveLines(output.slice(-TAIL_SCAN))) }).catch(() => {
      return;
    });
  };
  const flush = () => queue = queue.then(writeOut);
  const ticker = $.clock.every(FLUSH_MS, () => {
    flush();
  });
  const child = $.process.spawn({
    argv: ["/bin/zsh", "-lc", `print -u2 "__human_todo_pid__$$"; ${todo.script ?? ""}`],
    cwd: todo.cwd
  });
  let step;
  try {
    step = await child.next();
  } catch (err) {
    ticker.cancel();
    jobs.delete(token);
    await $.process.run(["rm", "-f", "--", logPath]).catch(() => {
      return;
    });
    await patchTodo($, todo.id, { token: undefined, logPath: undefined }).catch(() => {
      return;
    });
    throw err;
  }
  let exitCode = -1;
  try {
    while (!step.done) {
      if (job.pid === undefined && step.value.stream === "stderr") {
        const scanned = scanStderr(held, step.value.text);
        held = scanned.held;
        append(scanned.passed);
        if (scanned.pid !== undefined) {
          job.pid = scanned.pid;
          if (job.isGone)
            await signal($, job.pid);
        }
      } else {
        append(step.value.text);
      }
      step = await child.next();
    }
    exitCode = step.value.code ?? (step.value.signal ? 130 : -1);
  } catch (err) {
    append(`
${String(err)}`);
  }
  append(held);
  ticker.cancel();
  if (job.isGone)
    return void jobs.delete(token);
  await flush();
  jobs.delete(token);
  if (job.isGone)
    return;
  await report($, todo, job.isStopped ? { kind: "stopped", outputTail: kept() } : { kind: "ran", exitCode, outputTail: kept() });
}
async function stopLocal($, todo) {
  const job = todo.token ? jobs.get(todo.token) : undefined;
  if (job?.pid === undefined) {
    await patchTodo($, todo.id, { isStopping: false });
    $.ui.toast("Still starting; try Stop again in a moment");
    return;
  }
  job.isStopped = true;
  try {
    await signal($, job.pid);
  } catch {
    job.isStopped = false;
    await patchTodo($, todo.id, { isStopping: false });
    $.ui.toast(`Could not stop #${todo.id}`);
  }
}
async function forceStopLocal($, todo) {
  const job = todo.token ? jobs.get(todo.token) : undefined;
  if (job?.pid === undefined)
    return;
  try {
    await signal($, job.pid, "KILL");
  } catch {
    $.ui.toast(`Could not force stop #${todo.id}`);
  }
}
async function showLocal(_$, _todo) {}
async function releaseLocal($) {
  const held = [...jobs.values()];
  for (const job of held)
    job.isGone = true;
  let isFailed = false;
  for (const job of held) {
    if (job.pid === undefined)
      continue;
    await signal($, job.pid).catch(() => {
      isFailed = true;
    });
  }
  if (isFailed)
    throw new Error("A local run could not be stopped");
}
async function cleanupLocal($, todo) {
  const job = todo.token ? jobs.get(todo.token) : undefined;
  try {
    if (job) {
      job.isGone = true;
      if (job.pid !== undefined)
        await signal($, job.pid);
    }
  } finally {
    if (todo.logPath)
      await $.process.run(["rm", "-f", "--", todo.logPath]);
  }
}

// mods/human-todos/src/herdr.ts
var POLL_MS = 1000;
var SCAN_LINES = 400;
var SHOW_LINES = 5000;
var LABEL_MAX = 40;
var POLLS_TO_END = 2;
var HERDR_MS = 15000;
var BG_SESSION = "mattstack-bg";
var OWN_SESSION = "human-todos";
var START_MS = 1e4;
var START_POLL_MS = 250;
var runs = new Map;
var placing = Promise.resolve();
var picking;
function sh($, command) {
  return $.process.run(["/bin/zsh", "-lc", command], { timeoutMs: HERDR_MS });
}
function herdrCommand(session, args) {
  return `env -u HERDR_SOCKET_PATH HERDR_SESSION=${quote(session)} herdr ${args}`;
}
function herdr($, session, args) {
  return sh($, herdrCommand(session, args));
}
async function herdrJson($, session, args) {
  const ran = await herdr($, session, args);
  if (ran.exitCode !== 0)
    return null;
  try {
    return JSON.parse(ran.stdout).result ?? null;
  } catch {
    return null;
  }
}
async function runningSessions($) {
  try {
    const ran = await sh($, "env -u HERDR_SOCKET_PATH herdr session list --json");
    if (ran.exitCode !== 0)
      return null;
    const listed = JSON.parse(ran.stdout).sessions ?? [];
    return listed.flatMap((s) => s.running && s.name ? [s.name] : []);
  } catch {
    return null;
  }
}
async function pickSession($) {
  const running = await runningSessions($);
  if (!running)
    return null;
  if (running.includes(BG_SESSION))
    return BG_SESSION;
  if (running.includes(OWN_SESSION))
    return OWN_SESSION;
  await sh($, `env -u HERDR_SOCKET_PATH HERDR_SESSION=${quote(OWN_SESSION)} nohup herdr --session ${quote(OWN_SESSION)} server >/dev/null 2>&1 </dev/null &!`);
  for (let waited = 0;; waited += START_POLL_MS) {
    if ((await runningSessions($))?.includes(OWN_SESSION))
      return OWN_SESSION;
    if (waited >= START_MS)
      return null;
    await $.clock.sleep(START_POLL_MS);
  }
}
function herdrSession($) {
  if (!picking) {
    picking = pickSession($).finally(() => {
      picking = undefined;
    });
  }
  return picking;
}
async function sharedWorkspace($, session) {
  const known = await getWorkspace($, session);
  if (known && await herdrJson($, session, `workspace get ${quote(known)}`))
    return known;
  const found = (await herdrJson($, session, "workspace list"))?.workspaces?.find((w) => w.label === TITLE)?.workspace_id;
  if (found)
    await setWorkspace($, session, found);
  return found;
}
async function repoName($) {
  const cwd = (await $.session.cwd()).replace(/\/+$/, "");
  try {
    const ran = await sh($, `cd ${quote(cwd)} && git rev-parse --path-format=absolute --git-common-dir`);
    const common = ran.stdout.trim().replace(/\/+$/, "");
    if (ran.exitCode === 0 && common.startsWith("/"))
      return fileName(common.slice(0, common.lastIndexOf("/")));
  } catch {}
  return fileName(cwd);
}
async function tabLabel($, todo) {
  const repo = await repoName($);
  return quote(`${repo ? `${repo} ` : ""}#${todo.id} ${todo.title}`.slice(0, LABEL_MAX));
}
async function paneFor($, session, todo, cwd) {
  if (todo.paneId && todo.herdrSession === session && await herdrJson($, session, `pane get ${quote(todo.paneId)}`))
    return { paneId: todo.paneId, tabId: todo.tabId };
  const label = await tabLabel($, todo);
  const shared = await sharedWorkspace($, session);
  if (shared) {
    const made = await herdrJson($, session, `tab create --workspace ${quote(shared)} --cwd ${quote(cwd)} --label ${label} --no-focus`);
    if (made?.root_pane?.pane_id)
      return { paneId: made.root_pane.pane_id, tabId: made.tab?.tab_id ?? made.root_pane.tab_id };
  }
  const made = await herdrJson($, session, `workspace create --cwd ${quote(cwd)} --label ${quote(TITLE)} --no-focus`);
  if (!made?.root_pane?.pane_id || !made.workspace?.workspace_id)
    return null;
  await setWorkspace($, session, made.workspace.workspace_id);
  if (made.root_pane.tab_id)
    await herdr($, session, `tab rename ${quote(made.root_pane.tab_id)} ${label}`);
  return { paneId: made.root_pane.pane_id, tabId: made.root_pane.tab_id };
}
function placeTab($, session, todo, cwd) {
  const placed = placing.then(() => paneFor($, session, todo, cwd));
  placing = placed.catch(() => {
    return;
  });
  return placed;
}
async function paneIsIdle($, session, paneId) {
  const info = (await herdrJson($, session, `pane process-info --pane ${quote(paneId)}`))?.process_info;
  return Boolean(info?.shell_pid && info.foreground_process_group_id === info.shell_pid);
}
async function readPane($, session, paneId, lines = SCAN_LINES) {
  try {
    const ran = await herdr($, session, `pane read ${quote(paneId)} --source recent-unwrapped --lines ${lines}`);
    return ran.exitCode === 0 ? ran.stdout : null;
  } catch {
    return null;
  }
}
function scanPane(text, token, script) {
  const lines = text.split(`
`);
  const marker = `__todo_exit_${token}`;
  const echoed = lines.findLastIndex((line) => line.includes(marker) && line.includes("%s"));
  const body = lines.slice(echoed === -1 ? 0 : echoed + script.split(`
`).length);
  const end = body.findIndex((line) => line.trimStart().startsWith(`${marker} `));
  const output = (end === -1 ? body : body.slice(0, end)).filter((line) => line.trim() !== "");
  if (end === -1)
    return { isEchoed: echoed !== -1, output };
  const code = Number.parseInt((body[end] ?? "").trimStart().slice(marker.length + 1), 10);
  return { isEchoed: echoed !== -1, output, exitCode: Number.isNaN(code) ? -1 : code };
}
function end(token) {
  runs.get(token)?.poller?.cancel();
  runs.delete(token);
}
async function conclude($, token, todo, outcome) {
  await report($, todo, outcome);
  end(token);
}
async function pollOnce($, token, run) {
  const todo = (await listTodos($)).find((t) => t.id === run.id);
  if (!todo || todo.status !== "running" || todo.token !== token || !todo.paneId || !todo.herdrSession)
    return end(token);
  const text = await readPane($, todo.herdrSession, todo.paneId);
  if (run.isGone)
    return;
  if (text === null) {
    run.unreadPolls += 1;
    if (run.unreadPolls >= POLLS_TO_END)
      await conclude($, token, todo, { kind: "ended", outputTail: run.output.join(`
`) });
    return;
  }
  run.unreadPolls = 0;
  const scan = scanPane(text, token, todo.script ?? "");
  run.output = scan.output;
  const outputTail = scan.output.join(`
`);
  if (scan.exitCode !== undefined) {
    await conclude($, token, todo, todo.isStopping ? { kind: "stopped", outputTail } : { kind: "ran", exitCode: scan.exitCode, outputTail });
    return;
  }
  const isIdle = scan.isEchoed && await paneIsIdle($, todo.herdrSession, todo.paneId);
  if (run.isGone)
    return;
  run.idlePolls = isIdle ? run.idlePolls + 1 : 0;
  if (run.idlePolls >= POLLS_TO_END) {
    await conclude($, token, todo, { kind: "ended", outputTail });
    return;
  }
  const liveTail = clipLines(scan.output.slice(-LIVE_LINES_HERDR));
  if (JSON.stringify(liveTail) !== JSON.stringify(todo.liveTail))
    await patchTodo($, todo.id, { liveTail });
}
async function poll($, token) {
  const run = runs.get(token);
  if (!run || run.isBusy)
    return;
  run.isBusy = true;
  try {
    await pollOnce($, token, run);
  } catch {} finally {
    run.isBusy = false;
  }
}
function watch($, token) {
  const run = runs.get(token);
  if (!run || run.poller)
    return;
  run.poller = $.clock.every(POLL_MS, () => {
    poll($, token);
  });
}
async function startHerdr($, todo) {
  const session = todo.herdrSession;
  if (!session)
    throw new Error("no herdr server for the run");
  let token = "";
  do
    token = newToken();
  while (runs.has(token));
  const run = { id: todo.id, isGone: false, isBusy: false, idlePolls: 0, unreadPolls: 0, output: [] };
  runs.set(token, run);
  try {
    const placed = await placeTab($, session, todo, todo.cwd ?? await $.session.cwd());
    if (!placed)
      throw new Error("herdr made no tab");
    const still = run.isGone ? undefined : (await listTodos($)).find((t) => t.id === todo.id);
    if (run.isGone || still?.status !== "running") {
      run.isGone = true;
      if (placed.tabId)
        await herdr($, session, `tab close ${quote(placed.tabId)}`);
      return end(token);
    }
    await patchTodo($, todo.id, { token, paneId: placed.paneId, tabId: placed.tabId, herdrSession: session, liveTail: [], isStopping: false });
    const wrapper = `trap : INT; zsh -lc "$1"; printf "\\n__todo_exit_${token} %s\\n" $?`;
    const typed = await herdr($, session, `pane run ${quote(placed.paneId)} ${quote(`zsh -c ${quote(wrapper)} todo ${quote(todo.script ?? "")}`)}`);
    if (typed.exitCode !== 0)
      throw new Error("herdr would not run the script");
  } catch (err) {
    end(token);
    if (run.isGone)
      return;
    await patchTodo($, todo.id, { token: undefined }).catch(() => {
      return;
    });
    throw err;
  }
  if (!run.isGone)
    watch($, token);
}
async function stopHerdr($, todo) {
  let isSent = false;
  try {
    isSent = todo.paneId !== undefined && todo.herdrSession !== undefined && (await herdr($, todo.herdrSession, `pane send-keys ${quote(todo.paneId)} ctrl+c`)).exitCode === 0;
  } catch {
    isSent = false;
  }
  if (isSent)
    return;
  await patchTodo($, todo.id, { isStopping: false });
  $.ui.toast(`Could not stop #${todo.id}`);
}
async function showLog($, todo) {
  return `${await logFolder($)}/${await $.session.id()}-${todo.id}-herdr.log`;
}
async function showHerdr($, todo) {
  let step = "find the run's pane";
  try {
    if (!todo.paneId || !todo.herdrSession)
      throw new Error(`pane ${todo.paneId ?? "none"} on ${todo.herdrSession ?? "no server"}`);
    step = "read the pane";
    const text = await readPane($, todo.herdrSession, todo.paneId, SHOW_LINES);
    if (text === null)
      throw new Error(`herdr would not read ${todo.paneId} on ${todo.herdrSession}`);
    step = "write the log";
    const path = await showLog($, todo);
    await $.fs.write(path, text);
    if (todo.logPath !== path)
      await patchTodo($, todo.id, { logPath: path });
    step = "open the log";
    const opened = await $.process.run(["open", "-t", path]);
    if (opened.exitCode !== 0)
      throw new Error(`open exited ${opened.exitCode}: ${opened.stderr.trim()}`);
  } catch (err) {
    $.ui.log(`human-todos: Show for #${todo.id} could not ${step}: ${err instanceof Error ? err.message : String(err)}`, { to: "debug" });
    $.ui.toast(`Could not show the output of #${todo.id}: could not ${step}`);
  }
}
async function cleanupHerdr($, todo) {
  const run = todo.token ? runs.get(todo.token) : undefined;
  if (todo.token && run) {
    run.isGone = true;
    end(todo.token);
  }
  if (todo.tabId && todo.herdrSession)
    await herdr($, todo.herdrSession, `tab close ${quote(todo.tabId)}`);
  if (todo.runner === "herdr" && todo.logPath)
    await $.process.run(["rm", "-f", "--", todo.logPath]).catch(() => {
      return;
    });
}
function releaseHerdr() {
  for (const [token, run] of [...runs]) {
    run.isGone = true;
    end(token);
  }
}
async function resumeWatching($) {
  for (const todo of await listTodos($)) {
    if (todo.status !== "running" || todo.runner !== "herdr" || !todo.token || !todo.paneId || !todo.herdrSession || runs.has(todo.token))
      continue;
    runs.set(todo.token, { id: todo.id, isGone: false, isBusy: false, idlePolls: 0, unreadPolls: 0, output: [] });
    watch($, todo.token);
  }
}

// mods/human-todos/src/store.ts
var todos = atom({ plugin: "human-todos", key: "todos" }, [], { shape: "todos-1" });
var nextId = atom({ plugin: "human-todos", key: "nextId" }, 1);
var expanded = atom({ plugin: "human-todos", key: "expanded" }, []);
var frame = atom({ plugin: "human-todos", key: "frame" }, 0);
var workspace = atom({ plugin: "human-todos", key: "herdrWorkspace" }, null);
var loadedFor = atom({ plugin: "human-todos", key: "loadedFor" }, null);
var isSaveFailed = atom({ plugin: "human-todos", key: "isSaveFailed" }, false);
var runnerPref = atom({ plugin: "human-todos", key: "runnerPref" }, "auto");
var LIST_PREFIX = "list:";
var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
async function saveList($) {
  try {
    const entry = {
      todos: await read($, todos),
      nextId: await read($, nextId),
      savedAt: await $.clock.now()
    };
    const owner = await read($, loadedFor);
    if (owner === null)
      return;
    await $.store.set(`${LIST_PREFIX}${owner}`, entry);
    await update($, isSaveFailed, () => false);
  } catch {
    if (await read($, isSaveFailed))
      return;
    await update($, isSaveFailed, () => true);
    $.ui.toast("Could not save the to-do list; it will not survive a restart");
  }
}
var loading;
var leaving;
async function ensureLoaded($) {
  const id = await $.session.id();
  if (await read($, loadedFor) === id || id === leaving)
    return;
  const pending = loading;
  if (pending && pending.id === id)
    return pending.done;
  const done = loadResumed($).finally(() => {
    if (loading?.done === done)
      loading = undefined;
  });
  loading = { id, done };
  await done;
}
async function loadResumed($) {
  await restoreList($);
  await resumeWatching($);
  await syncSpinner($);
}
async function addTodo($, input) {
  await ensureLoaded($);
  let id = 0;
  await update($, nextId, (n) => {
    id = n;
    return n + 1;
  });
  const todo = toTodo(String(id), input);
  await update($, todos, (list) => [...list, todo]);
  await saveList($);
  return todo;
}
async function listTodos($) {
  await ensureLoaded($);
  return read($, todos);
}
async function patchTodo($, id, change) {
  await ensureLoaded($);
  await update($, todos, (list) => list.map((t) => t.id === id ? { ...t, ...change } : t));
  await saveList($);
}
async function removeTodos($, pick) {
  await ensureLoaded($);
  const removed = [];
  await update($, todos, (list) => {
    removed.length = 0;
    for (const t of list)
      if (pick(t))
        removed.push(t);
    return list.filter((t) => !pick(t));
  });
  await saveList($);
  return removed;
}
function isFresh(entry, now) {
  return typeof entry?.savedAt === "number" && now - entry.savedAt <= MAX_AGE_MS;
}
function resume(t) {
  if (t.status === "confirming")
    return { ...t, status: "open" };
  if (t.status === "running" && !(t.runner === "herdr" && t.token && t.paneId && t.herdrSession)) {
    const { liveTail: _tail, isStopping: _stopping, ...rest } = t;
    return { ...rest, status: "open", note: "Ended without an exit code." };
  }
  return t;
}
async function restoreList($) {
  leaving = undefined;
  const now = await $.clock.now();
  for (const key of await $.store.keys()) {
    if (!key.startsWith(LIST_PREFIX))
      continue;
    const entry = await $.store.get(key);
    if (!isFresh(entry, now))
      await $.store.delete(key);
  }
  const id = await $.session.id();
  const mine = await $.store.get(`${LIST_PREFIX}${id}`);
  if (mine) {
    await update($, todos, () => mine.todos.map(resume));
    await update($, expanded, () => []);
    await update($, nextId, () => mine.nextId);
  } else {
    await resetList($);
  }
  await update($, loadedFor, () => id);
}
async function leaveList($) {
  leaving = await $.session.id();
  await update($, loadedFor, () => null);
  await resetList($);
}
async function resetList($) {
  await update($, todos, () => []);
  await update($, expanded, () => []);
  await update($, nextId, () => 1);
}
function peekTodos($) {
  return read($, todos);
}
async function readPane2($) {
  return { list: await read($, todos), openIds: await read($, expanded), spin: await read($, frame) };
}
async function bumpFrame($) {
  await update($, frame, (n) => n + 1);
}
function getRunnerPref($) {
  return read($, runnerPref);
}
async function setRunnerPref($, pref) {
  await update($, runnerPref, () => pref);
}
async function getWorkspace($, session) {
  const stored = await read($, workspace);
  return stored?.session === session ? stored.id : null;
}
async function setWorkspace($, session, id) {
  await update($, workspace, () => ({ session, id }));
}
async function toggleExpanded($, id) {
  await update($, expanded, (ids) => ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]);
}

// mods/human-todos/src/spinner.ts
var FRAME_MS = 100;
var timer;
function stop() {
  timer?.cancel();
  timer = undefined;
}
async function hasRunning($) {
  return (await peekTodos($)).some((t) => t.status === "running");
}
async function syncSpinner($) {
  if (!await hasRunning($))
    return stop();
  if (timer)
    return;
  timer = $.clock.every(FRAME_MS, () => {
    (async () => {
      try {
        if (await hasRunning($))
          await bumpFrame($);
        else
          stop();
      } catch {}
    })();
  });
}

// mods/human-todos/src/report.ts
var SETTLED = { liveTail: undefined, isStopping: false };
function settle(todo, outcome) {
  const who = `#${todo.id} "${todo.title}"`;
  switch (outcome.kind) {
    case "done":
      return { patch: { status: "done" }, text: `${who}: the user marked it done.` };
    case "skipped":
      return { patch: { status: "skipped" }, text: `${who}: the user skipped it.` };
    case "ran": {
      const outputTail = tail(outcome.outputTail);
      return {
        patch: { ...SETTLED, status: outcome.exitCode === 0 ? "done" : "failed", exitCode: outcome.exitCode, outputTail },
        text: `The user ran ${who} from the pane: exit ${outcome.exitCode}.
\`\`\`
${outputTail || "(no output)"}
\`\`\``
      };
    }
    case "stopped":
      return {
        patch: { ...SETTLED, status: "open", outputTail: tail(outcome.outputTail), note: "Stopped" },
        text: `The user stopped ${who} before it finished. It is open again.`
      };
    case "ended":
      return {
        patch: { ...SETTLED, status: "open", outputTail: tail(outcome.outputTail), note: "Ended without an exit code." },
        text: `${who} ended in its tab without reporting an exit code (most likely stopped). It is open again.`
      };
  }
}
async function report($, todo, outcome) {
  const { patch, text } = settle(todo, outcome);
  await patchTodo($, todo.id, patch);
  await syncSpinner($);
  const warn = () => {
    $.ui.log(`could not send #${todo.id} to the agent`, { to: "debug" });
    $.ui.toast(`Could not tell the agent about #${todo.id}`);
  };
  $.prompt.submit({ text: `[${TITLE}] ${text}` }).then((sent) => {
    if (sent.drop !== undefined)
      warn();
  }).catch(warn);
}

// mods/human-todos/src/runners.ts
function startRun($, todo) {
  return todo.runner === "herdr" ? startHerdr($, todo) : startLocal($, todo);
}
function stopRun($, todo) {
  return todo.runner === "herdr" ? stopHerdr($, todo) : stopLocal($, todo);
}
function forceStopRun($, todo) {
  return todo.runner === "herdr" ? stopHerdr($, todo) : forceStopLocal($, todo);
}
function showRun($, todo) {
  return todo.runner === "herdr" ? showHerdr($, todo) : showLocal($, todo);
}
function cleanupRun($, todo) {
  return todo.runner === "herdr" ? cleanupHerdr($, todo) : cleanupLocal($, todo);
}

// mods/human-todos/src/actions.ts
var confirmingIds = new Set;
async function chooseRunner($) {
  const pref = await getRunnerPref($);
  if (pref === "local")
    return { runner: "local" };
  const session = await herdrSession($);
  if (session)
    return { runner: "herdr", session };
  return pref === "herdr" ? null : { runner: "local" };
}
async function launch($, todo) {
  try {
    await startRun($, todo);
    return;
  } catch {}
  try {
    const held = (await listTodos($)).find((t) => t.id === todo.id);
    if (held?.tabId)
      await cleanupHerdr($, held).catch(() => {
        return;
      });
    const gone = { runner: undefined, token: undefined, paneId: undefined, tabId: undefined };
    await patchTodo($, todo.id, { ...gone, status: "open", liveTail: undefined, note: "Could not start" });
    await syncSpinner($);
  } catch {}
  $.ui.toast(`Could not start #${todo.id}`);
}
async function confirm($, todo) {
  const fresh = { runner: undefined, liveTail: [], isStopping: false, note: undefined, exitCode: undefined, outputTail: undefined };
  await patchTodo($, todo.id, { ...fresh, status: "running" });
  await syncSpinner($);
  const chosen = await chooseRunner($);
  const still = (await listTodos($)).find((t) => t.id === todo.id);
  if (still?.status !== "running")
    return;
  if (!chosen) {
    await patchTodo($, todo.id, { status: "open", liveTail: undefined, note: "herdr is not running" });
    await syncSpinner($);
    $.ui.toast(`herdr is not running and could not be started, so #${todo.id} did not run`);
    return;
  }
  const where = chosen.runner === "herdr" ? { runner: chosen.runner, herdrSession: chosen.session } : { runner: chosen.runner };
  await patchTodo($, todo.id, where);
  launch($, { ...still, ...where });
}
async function stop2($, todo) {
  if (todo.isStopping)
    return;
  if (!todo.runner) {
    await patchTodo($, todo.id, { status: "open", liveTail: undefined, note: "Stopped" });
    await syncSpinner($);
    return;
  }
  await patchTodo($, todo.id, { isStopping: true });
  $.ui.toast(`Stopping #${todo.id}`);
  await stopRun($, { ...todo, isStopping: true });
}
async function forceStop($, todo) {
  $.ui.toast(`Force stopping #${todo.id}`);
  await forceStopRun($, todo);
}
async function openLink($, url) {
  if (!/^https?:\/\//.test(url))
    return $.ui.toast("Only http and https links open from here");
  await $.process.run(["open", url]);
}
async function openImages($, todo) {
  const real = [];
  for (const path of todo.paths ?? []) {
    const stat = path.startsWith("/") ? await $.fs.stat(path, { resolve: true }).catch(() => {
      return;
    }) : undefined;
    const landed = stat?.realPath;
    if (stat?.kind !== "file" || landed === undefined || !landed.startsWith("/") || !isImageName(landed)) {
      return $.ui.toast(`Could not open #${todo.id}: ${fileName(path)} is not an image file`);
    }
    real.push(landed);
  }
  if (real.length === 0)
    return $.ui.toast(`#${todo.id} has no images to open`);
  const opened = await $.process.run(["open", ...real]);
  if (opened.exitCode !== 0)
    $.ui.toast(`Could not open the images for #${todo.id}`);
}
async function press($, todo, button, surface) {
  const current = (await listTodos($)).find((t) => t.id === todo.id);
  if (!current)
    return;
  switch (button) {
    case "run":
      if (current.status === "open")
        await patchTodo($, current.id, { status: "confirming" });
      return;
    case "cancel":
      if (current.status === "confirming")
        await patchTodo($, current.id, { status: "open" });
      return;
    case "confirm":
      if (current.status !== "confirming" || confirmingIds.has(current.id))
        return;
      confirmingIds.add(current.id);
      try {
        await confirm($, current);
      } finally {
        confirmingIds.delete(current.id);
      }
      return;
    case "done":
    case "skip":
      if (current.status === "open")
        await report($, current, { kind: button === "done" ? "done" : "skipped" });
      return;
    case "stop":
      if (current.status === "running")
        await stop2($, current);
      return;
    case "forceStop":
      if (current.status === "running" && current.isStopping && current.runner)
        await forceStop($, current);
      return;
    case "show":
      if (current.status === "running" && current.runner)
        await showRun($, current);
      else
        $.ui.log(`human-todos: Show for #${current.id} came after its run ended (${current.status})`, { to: "debug" });
      return;
    case "open":
      return current.kind === "image" ? openImages($, current) : openLink($, current.url ?? "");
    case "copy":
      if (current.script)
        await $.ui.copy({ text: current.script, surface });
      return;
    case "openLog":
      if (current.logPath)
        await $.process.run(["open", "-t", current.logPath]);
      return;
  }
}
async function cleanup($, gone) {
  let isFailed = false;
  for (const t of gone) {
    try {
      if (t.runner)
        await cleanupRun($, t);
    } catch {
      isFailed = true;
    }
    try {
      if (t.tabId && t.runner !== "herdr")
        await cleanupHerdr($, t);
    } catch {
      isFailed = true;
    }
  }
  await syncSpinner($);
  if (isFailed)
    throw new Error("A runner could not tidy up");
}
async function release($) {
  let isFailed = false;
  releaseHerdr();
  try {
    await releaseLocal($);
  } catch {
    isFailed = true;
  }
  await syncSpinner($);
  if (isFailed)
    throw new Error("A runner could not let go");
}
function registerActions(on) {
  on("command.run", { command: "todos-runner" }, async ($, e) => {
    const choice = e.args.trim();
    if (choice !== "auto" && choice !== "herdr" && choice !== "local") {
      return { text: `Runner is ${await getRunnerPref($)}. Use /todos-runner auto, herdr or local.` };
    }
    await setRunnerPref($, choice);
    return { text: `Run now uses ${choice === "auto" ? "herdr when it is available, else the plugin itself" : choice}.` };
  });
}

// mods/human-todos/src/pane.tsx
import { atom as atom2, read as read2, update as update2 } from "claude-code";

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
var ESCAPES = new RegExp("\\x1b\\[[0-?]*[ -/]*[@-~]|\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)?|\\x1b[@-_]", "g");
var CONTROLS = new RegExp("[\\x00-\\x08\\x0b-\\x1f\\x7f]", "g");
var TAB_STOP = 8;
function cleanLine(line) {
  const text = line.replace(ESCAPES, "").replace(/\r+$/, "");
  const [first = "", ...rest] = text.slice(text.lastIndexOf("\r") + 1).replace(CONTROLS, "").split("\t");
  let out = first;
  for (const piece of rest)
    out += " ".repeat(TAB_STOP - cellWidth(out) % TAB_STOP) + piece;
  return out;
}
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
    const tail = (todo.liveTail ?? []).slice(todo.runner === "local" ? -LIVE_LINES_LOCAL : -LIVE_LINES_HERDR).map(cleanLine);
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

// mods/human-todos/src/pane/act.ts
async function pressTodo($, todoId, button, surface) {
  const todo = (await peekTodos($)).find((t) => t.id === todoId);
  if (!todo)
    return;
  try {
    await press($, todo, button, surface);
  } catch {
    $.ui.toast(`Could not ${LABELS[button].toLowerCase()} #${todo.id}`);
  }
}
async function clearFinished($) {
  const gone = await removeTodos($, (t) => !isActionable(t));
  await clampScroll($);
  cleanup($, gone).catch(() => $.ui.toast("Could not tidy up after the cleared items"));
}
async function act($, message, surface) {
  try {
    if (message.type === "press")
      return await pressTodo($, message.id, message.button, surface);
    if (message.type === "toggle")
      return await toggleExpanded($, message.id);
    if (message.type === "clear")
      return await clearFinished($);
  } catch {
    $.ui.toast(`Could not update ${TITLE}`);
  }
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
var fit = (text, cells) => cellWidth(text) <= cells ? text : `${cutCells(text, Math.max(0, cells - 1))}…`;
var roomOf = (width) => Math.max(1, width - GUTTER - BAR);
function buttonLines(row, room) {
  const indent = sp(" ".repeat(row.flush ? 0 : INDENT));
  const lead = row.lead ? [sp(row.lead.pad ? `${row.lead.text} ` : row.lead.text, STYLE[row.lead.tone])] : [];
  let rest = row.buttons.map((b) => ({ label: b.label, tone: b.tone, action: messageOf(b) }));
  const out = [];
  let withLead = lead.length > 0;
  while (rest.length > 0) {
    const leadIn = withLead ? 1 : 0;
    const avail = Math.max(1, room - widthOf([indent, ...withLead ? lead : []]));
    const draw = (buttons) => buttonRow(buttons, undefined, avail, leadIn);
    let n = rest.length;
    while (n > 0 && widthOf(draw(rest.slice(0, n))) > avail)
      n--;
    if (n === 0 && withLead) {
      out.push([indent, ...lead]);
      withLead = false;
      continue;
    }
    n = Math.max(1, n);
    out.push([indent, ...withLead ? lead : [], ...draw(rest.slice(0, n))]);
    rest = rest.slice(n);
    withLead = false;
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
      const title = fit(row.title, room - cellWidth(mark) - cellWidth(exit));
      return [[sp(mark, STYLE[row.tone]), sp(title, DIM), ...exit ? [sp(exit, DIM)] : []]];
    }
    case "buttons":
      return buttonLines(row, room);
  }
}
function kitLayout(model, width, bodyRows) {
  const room = roomOf(width);
  const windowRows = Math.max(1, bodyRows - BAR_ROWS);
  const rows = [];
  const lines = [];
  const add = (row) => {
    const laid = rowLines(row, room);
    rows.push({ row, first: lines.length, count: laid.length });
    lines.push(...laid);
  };
  model.rows.forEach(add);
  const spans = model.spans.map((s) => ({ first: rows[s.first]?.first ?? 0, last: (rows[s.last + 1]?.first ?? lines.length) - 1 }));
  if (lines.length > windowRows)
    endRows(model).forEach(add);
  return { lines, spans, windowRows, rows };
}
function maxOffset(layout) {
  return Math.max(0, layout.lines.length - layout.windowRows);
}
function stopMessage(stop, col) {
  const id = stop.ids[col];
  return id === undefined ? undefined : messageOf({ id, todoId: stop.isItem ? stop.key : undefined });
}
function keyStops(model, layout) {
  const stops = new Map;
  model.rows.forEach((row, r) => {
    if (row.kind !== "buttons")
      return;
    const laid = layout.rows[r];
    for (const button of row.buttons) {
      const wanted = JSON.stringify(messageOf(button));
      const offsetInRow = layout.lines.slice(laid.first, laid.first + laid.count).findIndex((line) => line.some((span) => span.action !== undefined && JSON.stringify(span.action) === wanted));
      const line = laid.first + Math.max(0, offsetInRow);
      const key = button.todoId ?? button.id;
      const stop = stops.get(key);
      if (stop) {
        stop.ids.push(button.id);
        stop.tones.push(button.tone);
        stop.lines.push(line);
      } else
        stops.set(key, { key, ids: [button.id], tones: [button.tone], lines: [line], main: 0, first: line, last: line, isItem: button.todoId !== undefined });
    }
  });
  let item = 0;
  return [...stops.values()].map(({ tones, ...stop }) => {
    const span = stop.isItem ? layout.spans[item++] : undefined;
    return { ...stop, main: Math.max(0, tones.findIndex((t) => t !== "quiet")), first: span?.first ?? stop.first, last: span?.last ?? stop.last };
  });
}
function kitView(model, width, bodyRows, offset) {
  const layout = kitLayout(model, width, bodyRows);
  const top = Math.min(Math.max(0, offset), maxOffset(layout));
  const touched = layout.rows.filter((r) => r.first + r.count > top && r.first < top + layout.windowRows);
  return {
    rows: touched.map((r) => r.row),
    skip: top - (touched[0]?.first ?? top),
    top,
    total: layout.lines.length,
    windowRows: layout.windowRows,
    stops: keyStops(model, layout)
  };
}
function revealOffset(view, index) {
  const stop = view.stops[index];
  const most = Math.max(0, view.total - view.windowRows);
  if (!stop)
    return view.top;
  if (stop.first < view.top)
    return Math.max(0, stop.first);
  if (stop.last > view.top + view.windowRows - 1)
    return Math.min(most, Math.min(stop.first, stop.last - view.windowRows + 1));
  return view.top;
}
function isButtonInView(view, index, col) {
  const line = view.stops[index]?.lines[col];
  return line !== undefined && line >= view.top && line <= view.top + view.windowRows - 1;
}
function revealButtonOffset(view, index, col) {
  const line = view.stops[index]?.lines[col];
  if (line === undefined || isButtonInView(view, index, col))
    return view.top;
  return line < view.top ? line : Math.min(Math.max(0, view.total - view.windowRows), line - view.windowRows + 1);
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
function markFirst(line) {
  const at = line.findIndex((span) => span.t.startsWith("○ "));
  if (at < 0)
    return line;
  const span = line[at];
  return [...line.slice(0, at), { ...span, t: "○", color: BRAND.pink }, { ...span, t: span.t.slice(1) }, ...line.slice(at + 1)];
}
function viewLines(view, width, focus = {}) {
  const room = roomOf(width);
  const shown = view.rows.flatMap((row) => rowLines(row, room)).slice(view.skip, view.skip + view.windowRows);
  const chosen = focus.selected && JSON.stringify(focus.selected);
  const range = focus.marked ? focus.range : undefined;
  const look = (span) => {
    const base = focus.pressing ? pressed(span) : span;
    return focus.marked ? keySelected(base) : [base];
  };
  const bar = scrollBar(view.windowRows, view.total, view.top);
  return shown.map((line, n) => {
    const at = view.top + n;
    const lit = chosen ? line.flatMap((span) => span.action !== undefined && JSON.stringify(span.action) === chosen ? look(span) : [span]) : line;
    const marked = range && at === range.first ? markFirst(lit) : lit;
    const gutter = range && at >= range.first && at <= range.last ? RAIL : [sp(" ".repeat(GUTTER))];
    return [...clip([...gutter, ...marked], width - BAR), ...bar[n] ?? []];
  });
}

// mods/human-todos/src/pane/plain-view.tsx
var HEADER_ROWS = 3;
var PRIMARY = new Set(["run", "open", "confirm", "show"]);
var TEXT_PROPS = {
  title: { bold: true },
  dim: { dimColor: true },
  warning: { color: "warning" },
  script: { color: "cyan" },
  link: { color: "cyan" },
  success: { color: "success" },
  error: { color: "error" },
  inactive: { color: "inactive" },
  plain: {}
};
function paneColumns(e) {
  return e.props.bodyColumns ?? 60;
}
async function closePane($, paneId) {
  await $.ui.close({ id: paneId });
  $.ui.invalidate("ui.render");
}
function drawPlainPane($, e, model, scroll, paneId) {
  const { Box, Text, Button } = $.ui.resolve(e);
  const rows = [];
  const blank = (key) => rows.push(/* @__PURE__ */ h(Text, {
    key
  }, " "));
  const button = (b) => {
    const key = b.id === "clear" ? "clear" : b.id === "more" ? `more-${b.todoId}` : `${b.id}-${b.todoId}`;
    return /* @__PURE__ */ h(Button, {
      key,
      plain: b.id === "more" ? true : undefined,
      variant: PRIMARY.has(b.id) ? "primary" : undefined,
      label: b.label,
      onPress: (p) => void act($, messageOf(b), p.surface)
    });
  };
  const draw = (row, key) => {
    switch (row.kind) {
      case "blank":
        return blank(key);
      case "text": {
        const text = /* @__PURE__ */ h(Text, {
          key: `${key}-text`,
          wrap: "truncate-end",
          ...TEXT_PROPS[row.tone]
        }, row.text);
        return rows.push(row.indent ? /* @__PURE__ */ h(Box, {
          key,
          marginLeft: 2
        }, text) : text);
      }
      case "finished":
        return rows.push(/* @__PURE__ */ h(Box, {
          key,
          flexDirection: "row"
        }, /* @__PURE__ */ h(Text, {
          ...TEXT_PROPS[row.tone]
        }, `${row.mark} `), /* @__PURE__ */ h(Text, {
          dimColor: true,
          wrap: "truncate-end"
        }, row.title), row.exit !== undefined && /* @__PURE__ */ h(Text, {
          dimColor: true
        }, ` (exit ${row.exit})`)));
      case "buttons": {
        return rows.push(/* @__PURE__ */ h(Box, {
          key,
          flexDirection: "row",
          gap: row.flush ? undefined : 1,
          marginLeft: row.flush ? undefined : 2
        }, row.lead && /* @__PURE__ */ h(Text, {
          ...TEXT_PROPS[row.lead.tone]
        }, row.lead.pad ? `${row.lead.text} ` : row.lead.text), row.buttons.map(button)));
      }
    }
  };
  blank("pad-top");
  rows.push(/* @__PURE__ */ h(Box, {
    key: "header",
    flexDirection: "row",
    justifyContent: "space-between"
  }, /* @__PURE__ */ h(Text, {
    bold: true
  }, TITLE), /* @__PURE__ */ h(Button, {
    key: "close",
    role: "dismiss",
    label: "Close",
    onPress: () => closePane($, paneId)
  })));
  blank("pad-header");
  model.rows.forEach((row, i) => draw(row, `row-${i}`));
  const overflows = HEADER_ROWS + model.rows.length + 1 > scroll.bodyRows;
  if (overflows)
    endRows(model).forEach((row, i) => draw(row, `end-${i}`));
  blank("pad-bottom");
  return /* @__PURE__ */ h(Box, {
    flexDirection: "column",
    paddingX: 2
  }, rows);
}

// mods/human-todos/src/pane.tsx
var PANE = "human-todos";
var SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
var TODO_PANE = { id: PANE, label: "Human Todos waiting" };
var keysAtom = atom2({ plugin: "human-todos", key: "keysInPane" }, false);
var scrollAtom = atom2({ plugin: "human-todos", key: "scrollOffset" }, 0);
var kitSizes = new Map;
async function openPane($) {
  await $.ui.open({ id: PANE, title: TITLE });
  $.ui.invalidate("ui.render");
}
function modelOf(pane, width) {
  return paneModel({ list: pane.list, expanded: pane.openIds, spin: SPIN[pane.spin % SPIN.length] ?? "", width });
}
async function waitingBand($) {
  const band = bandModel(await peekTodos($));
  return band && { formId: PANE, title: band.title };
}
async function setKeysInPane($, value) {
  if (await read2($, keysAtom) !== value)
    await update2($, keysAtom, () => value);
}
async function scrollKit($, to) {
  if (kitSizes.size === 0)
    return;
  const pane = await readPane2($);
  const most = Math.max(...[...kitSizes.values()].map(({ columns, bodyRows }) => maxOffset(kitLayout(modelOf(pane, modelWidth(columns)), columns, bodyRows))));
  const from = Math.min(await read2($, scrollAtom), most);
  const next = Math.min(Math.max(0, to(from)), most);
  if (next !== await read2($, scrollAtom))
    await update2($, scrollAtom, () => next);
}
async function clampScroll($) {
  await scrollKit($, (from) => from);
}
function registerPane(on) {
  registerPaneRedraw(on);
  on("command.run", { command: "todos" }, async ($) => {
    await openPane($);
    return { text: `${TITLE} pane opened.` };
  });
  on("prompt.edit", async ($, e, next) => {
    await setKeysInPane($, false);
    return next(e);
  });
  on("prompt.submit", async ($, e, next) => {
    await setKeysInPane($, false);
    return next(e);
  });
  on("ui.focus", async ($, e, next) => {
    await setKeysInPane($, false);
    return next(e);
  });
  on("ui.message", async ($, e, next) => {
    if (isEngaged(e))
      await setKeysInPane($, true);
    await paneMessage($, e, TODO_PANE, await waitingBand($));
    const reveal = e.data;
    if (e.requestId === PANE && reveal.type === "scrollTo" && typeof reveal.offset === "number") {
      const offset = reveal.offset;
      await scrollKit($, () => offset);
    }
    if (e.requestId === PANE)
      act($, e.data, e.surface);
    return next(e);
  });
  on("ui.scroll", { component: "Pane", requestId: "human-todos" }, async ($, e, next) => {
    if (e.contentRows > e.bodyRows || kitSizes.size === 0)
      return next(e);
    await scrollKit($, (from) => from + e.by);
    return {};
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey)
      return next(e);
    if (await isPlaced($, TODO_PANE))
      return next(e);
    const band = bandModel(await peekTodos($));
    if (!band)
      return next(e);
    if (e.surface === "terminal" || e.surface === "desktop")
      return bandAbovePrompt($, e, await next(e), { formId: PANE, title: band.title }, TODO_PANE);
    const { waiting } = band;
    const { Box, Text, Button } = $.ui.resolve(e);
    return /* @__PURE__ */ h(Box, {
      flexDirection: "row",
      gap: 2
    }, /* @__PURE__ */ h(Text, {
      color: "warning"
    }, `○ ${waiting} ${waiting === 1 ? TITLE.replace(/s$/, "") : TITLE}`), /* @__PURE__ */ h(Button, {
      key: "open-pane",
      label: "Open",
      onPress: () => openPane($)
    }));
  });
  on("ui.render", { component: "UserMessage", props: { origin: { kind: "plugin" } } }, async ($, e, next) => {
    const origin = e.props.origin;
    if (e.props.isExpanded || origin.name !== PLUGIN)
      return next(e);
    const { Box, Text } = $.ui.resolve(e);
    const [first, ...rest] = e.props.text.split(`
`);
    const extra = rest.filter((line) => line.trim() !== "" && !line.startsWith("```")).length;
    const summary = (first ?? "").replace(`[${TITLE}] `, "");
    return /* @__PURE__ */ h(Box, {
      flexDirection: "row"
    }, /* @__PURE__ */ h(Text, {
      color: "suggestion"
    }, `${TITLE} `), /* @__PURE__ */ h(Text, {
      dimColor: true,
      wrap: "truncate-end"
    }, summary, extra > 0 ? `  (+${extra} ${extra === 1 ? "line" : "lines"}, ctrl+o)` : ""));
  });
  on("ui.render", { component: "Pane", requestId: "human-todos" }, async ($, e) => {
    const pane = await readPane2($);
    if (e.surface !== "terminal" && e.surface !== "desktop") {
      const inner = Math.max(22, paneColumns(e) - 4);
      return drawPlainPane($, e, modelOf(pane, inner - 2), e.props.scroll ?? { offset: 0, bodyRows: Number.POSITIVE_INFINITY }, PANE);
    }
    const { Client } = $.ui.resolve(e);
    const width = paneColumns(e);
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30;
    kitSizes.set(e.surface, { columns: width, bodyRows });
    const props = {
      view: kitView(modelOf(pane, modelWidth(width)), width, bodyRows, await read2($, scrollAtom)),
      focused: e.props.isFocused || await read2($, keysAtom),
      width
    };
    return /* @__PURE__ */ h(Client, {
      key: "human-todos-pane",
      module: "./pane/kit-view.js",
      props
    });
  });
}
// mods/human-todos/src/contract.ts
var PREFIX = "mcp__human-todos__";
function addDescription(paneTitle) {
  return `Add a step only the user can do to their "${paneTitle}" pane, which stays beside the transcript while replies scroll away. Use it whenever you need the user to act: a command you cannot run (denied, needs sudo, a TTY, a login or a credential), a step in a browser or another app, or an account or physical action. Add the step as soon as you hit the wall, instead of only writing it in your reply, and keep working on anything else meanwhile. Pick the kind: task (by hand), run (a command the pane runs for them and reports back), terminal (needs their terminal: sudo, password or login prompts), link (a web page), image (screenshots or other images for them to look at, opened in their default image app). You get a message when they finish, skip, stop or run it, so never ask them to type "done".`;
}
function guidance(names) {
  return `# To-dos for the user
When you need the user to do something you cannot do yourself (a command that needs their terminal, sudo, an interactive login or a credential; a step in a browser or another app; a physical or account action), add it with ${names.add} instead of only writing it in your reply. Long replies scroll away; the list stays in a "${TITLE}" pane beside the transcript.
- Every item has a \`kind\`, which decides the buttons the user gets:
  - \`task\`: something they do by hand (an account setting, a physical step, a decision). Done or Skip.
  - \`run\`: a shell command that runs without a TTY. Give \`script\`; the pane offers Run and sends you the exit code and output.
  - \`terminal\`: a command that needs their terminal (sudo, a login or password prompt). Give \`script\`; the pane offers Copy.
  - \`link\`: a step on a web page. Give \`url\`; the pane offers Open.
  - \`image\`: images for the user to look at (screenshots, captures). Give \`paths\`, one absolute path per image; the pane offers Open, which opens them all in their default image app. Use it instead of running \`open\` yourself or wrapping \`open\` in a run script.
- When the user ticks, skips or runs an item, you receive a message saying so. Do not ask them to type "done".
- Use ${names.list} to see what is still open, and ${names.withdraw} when an item is no longer needed.`;
}
function registerContract(on) {
  let names = { add: `${PREFIX}add`, list: `${PREFIX}list`, withdraw: `${PREFIX}withdraw` };
  on("session.start", async ($, e, next) => {
    const add = await $.tool.register({
      name: "add",
      description: addDescription(TITLE),
      isDeferred: false,
      inputSchema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [...KINDS],
            description: "task: done by hand. run: script the pane can Run (needs script). terminal: script that needs a TTY, offered as Copy (needs script). link: a web page step (needs url). image: images to look at, offered as Open (needs paths)."
          },
          title: { type: "string", description: 'Short imperative, e.g. "Sign in to gcloud"' },
          detail: { type: "string", description: "Optional one or two lines of context" },
          script: { type: "string", description: "The shell command, for kind run or terminal (run uses zsh -lc)" },
          url: { type: "string", description: "The http(s) page, for kind link" },
          paths: {
            type: "array",
            items: { type: "string" },
            description: "For kind image: one absolute path per image file (png, jpg, gif, webp, heic, tiff, bmp, svg); Open opens them all in the default image app"
          },
          cwd: { type: "string", description: "For kind run: directory to run in; defaults to the session cwd" }
        },
        required: ["kind", "title"]
      }
    });
    const list = await $.tool.register({
      name: "list",
      description: `List the items in the user's "${TITLE}" pane with their status.`,
      isDeferred: false
    });
    const withdraw = await $.tool.register({
      name: "withdraw",
      description: `Remove an item from the user's "${TITLE}" pane when it is no longer needed.`,
      isDeferred: false,
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      }
    });
    names = { add: add.tool, list: list.tool, withdraw: withdraw.tool };
    await $.command.register({ name: "todos", description: `Open the ${TITLE} pane` });
    await $.command.register({
      name: "todos-runner",
      description: "Choose where Run executes scripts: auto, herdr or local",
      argumentHint: "auto|herdr|local"
    });
    const started = await next(e);
    await restoreList($);
    await resumeWatching($);
    await syncSpinner($);
    return started;
  });
  on("session.end", async ($, e, next) => {
    const ended = await next(e);
    if (e.reason === "clear") {
      const dropped = await listTodos($);
      await resetList($);
      await clampScroll($);
      await cleanup($, dropped).catch(() => $.ui.toast("Could not tidy up after the cleared items"));
    } else if (e.reason === "resume" && e.resume?.id !== e.sessionId) {
      const released = release($);
      await leaveList($);
      await clampScroll($);
      await released.catch(() => $.ui.toast("Could not stop the runs of the session you left"));
    }
    return ended;
  });
  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    return {
      sections: [...composed.sections, { id: "human-todos:guidance", text: guidance(names), scope: "session" }]
    };
  });
  on("tool.check", { tool: "mcp__human-todos__add" }, () => ({ decision: "allow" }));
  on("tool.check", { tool: "mcp__human-todos__list" }, () => ({ decision: "allow" }));
  on("tool.check", { tool: "mcp__human-todos__withdraw" }, () => ({ decision: "allow" }));
  on("tool.call", { tool: "mcp__human-todos__add" }, async ($, e) => {
    const input = e;
    const missing = checkKind(input);
    if (missing)
      return { deny: missing };
    const todo = await addTodo($, input);
    await openPane($);
    return {
      result: `Added #${todo.id} to the user's ${TITLE} pane. You will get a message when they act on it; carry on with other work meanwhile.`
    };
  });
  on("tool.call", { tool: "mcp__human-todos__list" }, async ($) => {
    return { result: describe(await listTodos($)) };
  });
  on("tool.call", { tool: "mcp__human-todos__withdraw" }, async ($, e) => {
    const id = String(e.id).replace(/^#/, "");
    const gone = await removeTodos($, (t) => t.id === id);
    if (gone.length === 0)
      return { result: `No to-do #${id}.` };
    await clampScroll($);
    await cleanup($, gone).catch(() => $.ui.toast(`Could not tidy up after #${id}`));
    return { result: `Withdrew #${id}.` };
  });
}

// mods/human-todos/src/register.tsx
function register(on) {
  registerContract(on);
  registerPane(on);
  registerActions(on);
}
export {
  register
};
