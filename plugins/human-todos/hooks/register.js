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

// mods/human-todos/src/store.ts
import { atom, read, update } from "claude-code";

// mods/human-todos/src/herdr.ts
var POLL_MS = 1000;
var SCAN_LINES = 400;
var LABEL_MAX = 40;
var POLLS_TO_END = 2;
var HERDR_MS = 15000;
var runs = new Map;
var placing = Promise.resolve();
function sh($, command) {
  return $.process.run(["/bin/zsh", "-lc", command], { timeoutMs: HERDR_MS });
}
async function herdrJson($, args) {
  const ran = await sh($, `herdr ${args}`);
  if (ran.exitCode !== 0)
    return null;
  try {
    return JSON.parse(ran.stdout).result ?? null;
  } catch {
    return null;
  }
}
async function paneFor($, todo, cwd) {
  if (todo.paneId && await herdrJson($, `pane get ${quote(todo.paneId)}`))
    return { paneId: todo.paneId, tabId: todo.tabId };
  const label = quote(`#${todo.id} ${todo.title}`.slice(0, LABEL_MAX));
  const known = await getWorkspace($);
  if (known && await herdrJson($, `workspace get ${quote(known)}`)) {
    const made = await herdrJson($, `tab create --workspace ${quote(known)} --cwd ${quote(cwd)} --label ${label} --no-focus`);
    if (made?.root_pane?.pane_id)
      return { paneId: made.root_pane.pane_id, tabId: made.tab?.tab_id ?? made.root_pane.tab_id };
  }
  const made = await herdrJson($, `workspace create --cwd ${quote(cwd)} --label ${quote(TITLE)} --no-focus`);
  if (!made?.root_pane?.pane_id || !made.workspace?.workspace_id)
    return null;
  await setWorkspace($, made.workspace.workspace_id);
  if (made.root_pane.tab_id)
    await sh($, `herdr tab rename ${quote(made.root_pane.tab_id)} ${label}`);
  return { paneId: made.root_pane.pane_id, tabId: made.root_pane.tab_id };
}
function placeTab($, todo, cwd) {
  const placed = placing.then(() => paneFor($, todo, cwd));
  placing = placed.catch(() => {
    return;
  });
  return placed;
}
async function paneIsIdle($, paneId) {
  const info = (await herdrJson($, `pane process-info --pane ${quote(paneId)}`))?.process_info;
  return Boolean(info?.shell_pid && info.foreground_process_group_id === info.shell_pid);
}
async function readPane($, paneId) {
  try {
    const ran = await sh($, `herdr pane read ${quote(paneId)} --source recent-unwrapped --lines ${SCAN_LINES}`);
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
  if (!todo || todo.status !== "running" || todo.token !== token || !todo.paneId)
    return end(token);
  const text = await readPane($, todo.paneId);
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
  const isIdle = scan.isEchoed && await paneIsIdle($, todo.paneId);
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
  let token = "";
  do
    token = newToken();
  while (runs.has(token));
  const run = { id: todo.id, isGone: false, isBusy: false, idlePolls: 0, unreadPolls: 0, output: [] };
  runs.set(token, run);
  try {
    const placed = await placeTab($, todo, todo.cwd ?? await $.session.cwd());
    if (!placed)
      throw new Error("herdr made no tab");
    const still = run.isGone ? undefined : (await listTodos($)).find((t) => t.id === todo.id);
    if (run.isGone || still?.status !== "running") {
      run.isGone = true;
      if (placed.tabId)
        await sh($, `herdr tab close ${quote(placed.tabId)}`);
      return end(token);
    }
    await patchTodo($, todo.id, { token, paneId: placed.paneId, tabId: placed.tabId, liveTail: [], isStopping: false });
    const wrapper = `trap : INT; zsh -lc "$1"; printf "\\n__todo_exit_${token} %s\\n" $?`;
    const typed = await sh($, `herdr pane run ${quote(placed.paneId)} ${quote(`zsh -c ${quote(wrapper)} todo ${quote(todo.script ?? "")}`)}`);
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
    isSent = todo.paneId !== undefined && (await sh($, `herdr pane send-keys ${quote(todo.paneId)} ctrl+c`)).exitCode === 0;
  } catch {
    isSent = false;
  }
  if (isSent)
    return;
  await patchTodo($, todo.id, { isStopping: false });
  $.ui.toast(`Could not stop #${todo.id}`);
}
async function showHerdr($, todo) {
  let isShown = true;
  try {
    const workspace = await getWorkspace($);
    if (workspace)
      isShown = (await sh($, `herdr workspace focus ${quote(workspace)}`)).exitCode === 0;
    if (todo.tabId)
      isShown = (await sh($, `herdr tab focus ${quote(todo.tabId)}`)).exitCode === 0 && isShown;
    if (todo.paneId && (await sh($, "command -v rt")).exitCode === 0)
      await sh($, `rt pane focus ${quote(todo.paneId)}`);
  } catch {
    isShown = false;
  }
  if (!isShown)
    $.ui.toast("Could not bring that tab forward");
}
async function cleanupHerdr($, todo) {
  const run = todo.token ? runs.get(todo.token) : undefined;
  if (todo.token && run) {
    run.isGone = true;
    end(todo.token);
  }
  if (todo.tabId)
    await sh($, `herdr tab close ${quote(todo.tabId)}`);
}
function releaseHerdr() {
  for (const [token, run] of [...runs]) {
    run.isGone = true;
    end(token);
  }
}
async function resumeWatching($) {
  for (const todo of await listTodos($)) {
    if (todo.status !== "running" || todo.runner !== "herdr" || !todo.token || !todo.paneId || runs.has(todo.token))
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
var workspace = atom({ plugin: "human-todos", key: "workspace" }, null);
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
  if (t.status === "running" && !(t.runner === "herdr" && t.token && t.paneId)) {
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
function getWorkspace($) {
  return read($, workspace);
}
async function setWorkspace($, id) {
  await update($, workspace, () => id);
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
var HERDR_PROBE_MS = 15000;
var confirmingIds = new Set;
async function chooseRunner($) {
  const pref = await getRunnerPref($);
  if (pref !== "auto")
    return pref;
  if (!await $.env.get("HERDR_SOCKET_PATH"))
    return "local";
  try {
    const probe = await $.process.run(["/bin/zsh", "-lc", "herdr workspace list"], { timeoutMs: HERDR_PROBE_MS });
    return probe.exitCode === 0 ? "herdr" : "local";
  } catch {
    return "local";
  }
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
  const runner = await chooseRunner($);
  const still = (await listTodos($)).find((t) => t.id === todo.id);
  if (still?.status !== "running")
    return;
  await patchTodo($, todo.id, { runner });
  launch($, { ...still, runner });
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
var PANE = "human-todos";
var SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
var SCRIPT_ROWS = 2;
var FINISHED_SHOWN = 8;
var END_OF_LIST = "You've reached the end of the list.";
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
var PRIMARY = ["run", "open", "confirm", "show"];
async function openPane($) {
  await $.ui.open({ id: PANE, title: TITLE });
  $.ui.invalidate("ui.render");
}
async function closePane($) {
  await $.ui.close({ id: PANE });
  $.ui.invalidate("ui.render");
}
function markFor(todo) {
  if (todo.status === "failed")
    return { mark: "✗ ", color: "error" };
  if (todo.status === "skipped")
    return { mark: "– ", color: "inactive" };
  return { mark: "✓ ", color: "success" };
}
function registerPane(on) {
  on("ui.close", async ($, e, next) => {
    const closed = await next(e);
    $.ui.invalidate("ui.render");
    return closed;
  });
  on("command.run", { command: "todos" }, async ($) => {
    await openPane($);
    return { text: `${TITLE} pane opened.` };
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey)
      return next(e);
    if ((await $.ui.panes()).some((p) => p.id === PANE && p.isPlaced))
      return next(e);
    const waiting = (await peekTodos($)).filter((t) => t.status === "open" || t.status === "confirming").length;
    if (waiting === 0)
      return next(e);
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
    const { Box, Text, Button } = $.ui.resolve(e);
    const { list, openIds, spin: frameNo } = await readPane2($);
    const actionable = list.filter(isActionable);
    const finished = list.filter((t) => !isActionable(t));
    const spin = SPIN[frameNo % SPIN.length];
    const columns = e.props.bodyColumns ?? 60;
    const inner = Math.max(22, columns - 4);
    const width = inner - 2;
    const rows = [];
    const spans = [];
    const blank = (key) => rows.push(/* @__PURE__ */ h(Text, {
      key
    }, " "));
    const indented = (key, node) => rows.push(/* @__PURE__ */ h(Box, {
      key,
      marginLeft: 2
    }, node));
    const lines = (key, text, w, props, indent) => wrapWords(text, w).forEach((line, n) => {
      const node = /* @__PURE__ */ h(Text, {
        key: `${key}-${n}`,
        wrap: "truncate-end",
        ...props
      }, line);
      if (indent)
        indented(`${key}-row-${n}`, node);
      else
        rows.push(node);
    });
    const buttonsRow = (todo) => buttonsFor(todo).map((id) => /* @__PURE__ */ h(Button, {
      key: `${id}-${todo.id}`,
      variant: PRIMARY.includes(id) ? "primary" : undefined,
      label: LABELS[id],
      onPress: (p) => {
        press($, todo, id, p.surface).catch(() => $.ui.toast(`Could not ${LABELS[id].toLowerCase()} #${todo.id}`));
      }
    }));
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
      onPress: () => closePane($)
    })));
    blank("pad-header");
    if (actionable.length === 0) {
      rows.push(/* @__PURE__ */ h(Text, {
        key: "empty",
        dimColor: true
      }, "Nothing for you right now."));
      if (finished.length > 0)
        blank("pad-empty");
    }
    for (const todo of actionable) {
      const first = rows.length;
      const id = todo.id;
      const script = todo.script ? hardWrap(`$ ${todo.script}`, width) : [];
      const isConfirming = todo.status === "confirming";
      const isOpen = openIds.includes(id) || isConfirming;
      const shown = isOpen ? script : script.slice(0, SCRIPT_ROWS);
      const hidden = script.length - SCRIPT_ROWS;
      const tail = (todo.liveTail ?? []).slice(todo.runner === "local" ? -LIVE_LINES_LOCAL : -LIVE_LINES_HERDR);
      lines(`title-${id}`, `${todo.status === "running" ? `${spin} ` : "○ "}${todo.title}`, inner, { bold: true }, false);
      if (todo.detail)
        lines(`detail-${id}`, todo.detail, width, { dimColor: true }, true);
      if (todo.status !== "running" && todo.note)
        lines(`note-${id}`, todo.note, width, { color: "warning" }, true);
      shown.forEach((row, n) => indented(`s-row-${id}-${n}`, /* @__PURE__ */ h(Text, {
        key: `s-${id}-${n}`,
        color: "cyan",
        wrap: "truncate-end"
      }, row)));
      if (hidden > 0 && !isConfirming)
        rows.push(/* @__PURE__ */ h(Box, {
          key: `more-row-${id}`,
          flexDirection: "row",
          gap: 1,
          marginLeft: 2
        }, !isOpen && /* @__PURE__ */ h(Text, {
          dimColor: true
        }, `… +${hidden} more`), /* @__PURE__ */ h(Button, {
          key: `more-${id}`,
          plain: true,
          label: isOpen ? "Show less" : "Show all",
          onPress: () => toggleExpanded($, id)
        })));
      if (todo.kind === "run" && todo.cwd)
        indented(`cwd-row-${id}`, /* @__PURE__ */ h(Text, {
          key: `cwd-${id}`,
          dimColor: true,
          wrap: "truncate-end"
        }, `in ${todo.cwd}`));
      if (todo.url)
        lines(`url-${id}`, todo.url, width, { color: "cyan" }, true);
      if (todo.paths?.length)
        lines(`images-${id}`, todo.paths.map(fileName).join(", "), width, { color: "cyan" }, true);
      if (todo.status === "running") {
        blank(`pad-tail-${id}`);
        tail.forEach((line, n) => indented(`tail-row-${id}-${n}`, /* @__PURE__ */ h(Text, {
          key: `tail-${id}-${n}`,
          dimColor: true,
          wrap: "truncate-end"
        }, line)));
        if (tail.length > 0)
          blank(`pad-status-${id}`);
        rows.push(/* @__PURE__ */ h(Box, {
          key: `status-${id}`,
          flexDirection: "row",
          gap: 1,
          marginLeft: 2
        }, /* @__PURE__ */ h(Text, {
          color: todo.isStopping ? "error" : "warning"
        }, `${spin} ${todo.isStopping ? "Stopping…" : "Running"} `), buttonsRow(todo)));
      } else {
        blank(`pad-buttons-${id}`);
        if (isConfirming)
          lines(`confirm-${id}`, "Are you sure you want to run this script?", width, {}, true);
        rows.push(/* @__PURE__ */ h(Box, {
          key: `buttons-${id}`,
          flexDirection: "row",
          gap: 1,
          marginLeft: 2
        }, buttonsRow(todo)));
      }
      spans.push({ first, last: rows.length - 1 });
      blank(`pad-item-${id}`);
    }
    if (finished.length > 0) {
      for (const todo of finished.slice(-FINISHED_SHOWN)) {
        const { mark, color } = markFor(todo);
        spans.push({ first: rows.length, last: rows.length });
        rows.push(/* @__PURE__ */ h(Box, {
          key: `fin-${todo.id}`,
          flexDirection: "row"
        }, /* @__PURE__ */ h(Text, {
          color
        }, mark), /* @__PURE__ */ h(Text, {
          dimColor: true,
          wrap: "truncate-end"
        }, todo.title), todo.exitCode !== undefined && todo.exitCode !== 0 && /* @__PURE__ */ h(Text, {
          dimColor: true
        }, ` (exit ${todo.exitCode})`)));
      }
      blank("pad-clear");
      rows.push(/* @__PURE__ */ h(Box, {
        key: "clear-row",
        flexDirection: "row"
      }, /* @__PURE__ */ h(Button, {
        key: "clear",
        label: "Clear finished",
        onPress: async () => {
          const gone = await removeTodos($, (t) => !isActionable(t));
          cleanup($, gone).catch(() => $.ui.toast("Could not tidy up after the cleared items"));
        }
      })));
    }
    const scroll = e.props.scroll ?? { offset: 0, bodyRows: Number.POSITIVE_INFINITY };
    const overflows = rows.length + 1 > scroll.bodyRows;
    if (overflows) {
      if (finished.length > 0)
        blank("pad-end");
      rows.push(/* @__PURE__ */ h(Text, {
        key: "end",
        dimColor: true
      }, END_OF_LIST));
    }
    blank("pad-bottom");
    const hints = [];
    if (overflows && e.surface === "terminal") {
      const bottom = scroll.offset + scroll.bodyRows - 1;
      const above = spans.filter((s) => s.first < scroll.offset).length;
      const below = spans.filter((s) => s.last > bottom).length;
      const hint = (key, top, text) => /* @__PURE__ */ h(Box, {
        key,
        position: "absolute",
        top,
        left: 0,
        right: 0
      }, /* @__PURE__ */ h(Text, {
        color: "suggestion",
        wrap: "truncate-end"
      }, `  ${text}`.padEnd(columns)));
      if (above > 0)
        hints.push(hint("more-above", scroll.offset, `↑ ${above} more`));
      if (below > 0)
        hints.push(hint("more-below", bottom, `↓ ${below} more`));
    }
    return /* @__PURE__ */ h(Box, {
      flexDirection: "column",
      paddingX: 2
    }, rows, hints);
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
      await cleanup($, dropped).catch(() => $.ui.toast("Could not tidy up after the cleared items"));
    } else if (e.reason === "resume" && e.resume?.id !== e.sessionId) {
      const released = release($);
      await leaveList($);
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
