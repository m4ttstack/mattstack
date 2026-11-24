// mods/fresh-context/src/busy.ts
var BLOCKING_TYPES = new Set(["shell", "monitor", "subagent", "workflow"]);
var ACTIVE = new Set(["running", "pending"]);
var AGENT_ACTIVE = new Set(["running", "pending", "waiting"]);
function busyTasks(agents, tasks) {
  const lines = [];
  for (const a of agents) {
    if (a.status === undefined || AGENT_ACTIVE.has(a.status))
      lines.push(`subagent: ${a.description}`);
  }
  for (const t of tasks) {
    if (BLOCKING_TYPES.has(t.type) && ACTIVE.has(t.status))
      lines.push(`${t.type}: ${t.description ?? "no description"}`);
  }
  return [...new Set(lines)];
}

// mods/fresh-context/src/chat.ts
var RT_MS = 1e4;
var EXIT_RT_MS = 1000;
var START_FAILURE_MS = 2000;
async function handoff($, sessionId, args, timeoutMs = RT_MS) {
  const home = await $.env.get("HOME");
  for (const rt of ["rt", `${home ?? ""}/.local/bin/rt`]) {
    const started = await $.clock.now();
    let stdout;
    try {
      stdout = (await $.process.run([rt, "chat", "handoff", ...args, "--json"], { env: { CLAUDE_CODE_SESSION_ID: sessionId }, timeoutMs })).stdout;
    } catch {
      if (await $.clock.now() - started >= Math.min(timeoutMs, START_FAILURE_MS))
        return null;
      continue;
    }
    try {
      const last = stdout.trim().split(`
`).pop();
      return last ? JSON.parse(last) : null;
    } catch {
      return null;
    }
  }
  return null;
}
async function beginChat($, sessionId, since) {
  const reply = await handoff($, sessionId, ["begin", "--since", String(Math.floor(since))]);
  if (reply?.ok && typeof reply.handle === "string")
    return reply.handle;
  if (reply === null)
    await handoff($, sessionId, ["cancel", "--from", sessionId]);
  return null;
}
async function completeChat($, fromSessionId, sessionId) {
  const reply = await handoff($, sessionId, ["complete", "--from", fromSessionId, "--quiet"]);
  return reply?.ok === true ? reply.welcome ?? "" : null;
}
async function cancelChat($, fromSessionId, sessionId, opts = {}) {
  await handoff($, sessionId, ["cancel", "--from", fromSessionId], opts.onExit ? EXIT_RT_MS : RT_MS);
}

// mods/fresh-context/src/carry.ts
function ledgerMessage(ledger) {
  return `Ledger carried from before the reset:

${ledger}`;
}

// mods/fresh-context/src/reset.ts
var CARRY = { plugin: "fresh-context", key: "carry" };
var pending = null;
var lastStopTasks = [];
var isFiring = false;
var isClaiming = false;
function claim() {
  if (pending !== null || isClaiming)
    return false;
  isClaiming = true;
  return true;
}
function release() {
  isClaiming = false;
}
async function busyNow($) {
  return busyTasks(await $.agent.list(), lastStopTasks);
}
async function queue($, carry) {
  pending = carry;
  isClaiming = false;
  isFiring = false;
  await $.state.set(CARRY, carry);
}
async function drop($) {
  pending = null;
  isFiring = false;
  await $.state.set(CARRY, null);
}
function notice($, text) {
  $.clock.after(0, () => {
    $.prompt.submit({ text });
  });
}
async function submit($, text) {
  const slash = /^\/([\w:-]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (slash?.[1])
    await $.command.run({ command: slash[1], ...slash[2] ? { args: slash[2].trim() } : {} });
  else
    await $.prompt.submit({ text: text.startsWith("/") ? `Next step from before the reset: ${text}` : text });
}
async function abandon($, carry, why) {
  await drop($);
  if (carry.chatHandle)
    await cancelChat($, carry.oldSessionId, await $.session.id());
  notice($, `fresh_context did not run: ${why}`);
}
async function hold($, text) {
  let appended;
  try {
    appended = await $.session.append({ message: { type: "user", content: [{ type: "text", text }] } });
  } catch {
    appended = undefined;
  }
  if (!appended || appended.deny !== undefined)
    await $.prompt.submit({ text });
}
async function handOver($, carry, sessionId) {
  if (pending !== carry)
    return;
  pending = null;
  await hold($, ledgerMessage(carry.ledger));
  await drop($);
  if (carry.chatHandle) {
    const welcome = await completeChat($, carry.oldSessionId, sessionId);
    if (welcome === null)
      await cancelChat($, carry.oldSessionId, sessionId);
    else if (welcome)
      await hold($, welcome);
  }
  if (carry.then)
    await submit($, carry.then);
}
async function runReset($, queued) {
  let carry = queued;
  if (carry.mode === "clear") {
    const handle = await beginChat($, carry.oldSessionId, carry.createdAt);
    if (pending !== queued) {
      if (handle)
        await cancelChat($, carry.oldSessionId, await $.session.id());
      return;
    }
    if (handle) {
      carry = { ...carry, chatHandle: handle };
      await queue($, carry);
      isFiring = true;
    }
    try {
      await $.command.run({ command: "clear" });
    } catch (err) {
      await abandon($, carry, `the clear was refused (${String(err)})`);
    }
    return;
  }
  let compacted;
  try {
    compacted = await $.session.compact({ instructions: carry.ledger });
  } catch (err) {
    await abandon($, carry, `the compaction failed (${String(err)})`);
    return;
  }
  if ("skip" in compacted && compacted.skip) {
    await abandon($, carry, `the compaction was skipped (${compacted.skip})`);
    return;
  }
  await handOver($, carry, await $.session.id());
}
async function resumeCarry($) {
  const { value } = await $.state.get(CARRY);
  if (!value)
    return;
  const current = await $.session.id();
  pending = value;
  if (value.oldSessionId !== current)
    $.clock.after(0, () => void handOver($, value, current));
}
function registerReset(on) {
  on("classic.Stop", async ($, e, next) => {
    const result = await next(e);
    lastStopTasks = e.background_tasks ?? [];
    const carry = pending;
    if (!carry)
      return result;
    if (result.block || result.preventContinuation)
      return result;
    if (isFiring) {
      if (carry.mode === "clear" && carry.oldSessionId === await $.session.id())
        await abandon($, carry, "the clear did not happen");
      return result;
    }
    if (carry.mode === "clear") {
      const busy = await busyNow($);
      if (busy.length > 0) {
        await abandon($, carry, `still running
${busy.join(`
`)}`);
        return result;
      }
    }
    isFiring = true;
    $.clock.after(0, () => {
      runReset($, carry);
    });
    return result;
  });
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    const carry = pending;
    if (carry && !isFiring && !e.agentId && (e.reason === "aborted" || e.reason === "error")) {
      await drop($);
      if (carry.chatHandle)
        await cancelChat($, carry.oldSessionId, await $.session.id());
    }
    return result;
  });
  on("classic.SessionStart", async ($, e, next) => {
    const result = await next(e);
    const carry = pending;
    if (carry?.mode === "clear" && e.source === "clear" && e.session_id !== carry.oldSessionId) {
      $.clock.after(0, () => {
        handOver($, carry, e.session_id);
      });
    }
    return result;
  });
  on("session.end", async ($, e, next) => {
    const ended = await next(e);
    const carry = pending;
    if (!carry || carry.oldSessionId !== e.sessionId)
      return ended;
    if (carry.mode === "clear" && e.reason === "clear")
      return ended;
    await drop($);
    if (carry.chatHandle)
      await cancelChat($, carry.oldSessionId, e.sessionId, { onExit: true });
    return ended;
  });
}

// mods/fresh-context/src/tool.ts
var TOOL = "mcp__fresh-context__fresh_context";
var DESCRIPTION = `Clear or compact this session and pick up where it left off.
Write your ledger first: the one your current skill keeps, or a short note of the goal, where things are, what is done, what is next and what you are waiting on.
mode "clear" starts a brand-new conversation holding only the ledger; "compact" runs compaction steered by the ledger.
then (optional) is the instruction the fresh context starts on, submitted on its own (a slash command works). Leave it out to let a pending wakeup or a chat message start the next turn.
The reset runs right after this turn ends; end your turn after calling it. A clear is refused while a subagent, background shell, monitor or workflow is running.`;
async function registerToolDef($) {
  await $.tool.register({
    name: "fresh_context",
    description: DESCRIPTION,
    isDeferred: false,
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["clear", "compact"], description: "clear: a brand-new conversation. compact: a summary plus recent turns." },
        ledger: { type: "string", description: "Free text carried into the fresh context as is." },
        then: { type: "string", description: "The instruction the fresh context starts on." }
      },
      required: ["mode", "ledger"]
    }
  });
}
function registerTool(on) {
  on("tool.check", { tool: "mcp__fresh-context__fresh_context" }, () => ({ decision: "allow" }));
  on("ui.render", { component: "ToolUse", props: { tool: TOOL } }, ($, e, next) => {
    const { mode } = e.props.input ?? {};
    if (e.props.isExpanded || typeof mode !== "string")
      return next(e);
    return next({ ...e, props: { ...e.props, input: { mode } } });
  });
  on("tool.call", { tool: "mcp__fresh-context__fresh_context" }, async ($, e) => {
    if (e.agentId)
      return { deny: "Only the main session can reset itself; a subagent cannot." };
    const { mode, ledger, then } = e;
    if (mode !== "clear" && mode !== "compact")
      return { deny: 'mode must be "clear" or "compact".' };
    if (typeof ledger !== "string" || ledger.trim() === "")
      return { deny: "Write a ledger first: the reset carries nothing else." };
    if (then !== undefined && typeof then !== "string")
      return { deny: "then must be text." };
    if (!claim())
      return { deny: "A reset is already queued for the end of this turn." };
    try {
      if (mode === "clear") {
        const busy = await busyNow($);
        if (busy.length > 0) {
          release();
          return { deny: `Not now: still running
${busy.join(`
`)}` };
        }
      }
      const oldSessionId = await $.session.id();
      const carry = { mode, ledger, oldSessionId, createdAt: await $.clock.now(), ...then ? { then } : {} };
      await queue($, carry);
    } catch (err) {
      release();
      throw err;
    }
    return { result: `Reset queued: ${mode} after this turn.` };
  });
}

// mods/fresh-context/src/command.ts
async function registerCommandDef($) {
  await $.command.register({ name: "fresh", description: "Write your ledger, then start fresh (clear by default)", argumentHint: "[clear|compact] [note]" });
}
function freshPrompt(mode, note) {
  const then = note ? `and then ${JSON.stringify(note)}.` : "and no then.";
  return `Write your ledger now: the one your current skill keeps, or if none does, these sections: Goal, Where, Done, In progress, Next step, Decisions, Learned, Waiting on the user. Then call ${TOOL} with mode "${mode}", the ledger, ${then}`;
}
function parse(args) {
  const [first = "", ...rest] = args.trim().split(/\s+/);
  const word = first.toLowerCase();
  if (word === "clear" || word === "compact")
    return { mode: word, note: rest.join(" ") };
  return { mode: "clear", note: args.trim() };
}
function registerCommand(on) {
  on("command.run", { command: "fresh" }, async ($, e) => {
    const { mode, note } = parse(e.args ?? "");
    $.clock.after(0, () => {
      $.prompt.submit({ text: freshPrompt(mode, note) });
    });
    return { text: `Asked the session to write its ledger and reset (${mode}).` };
  });
}

// mods/fresh-context/src/register.tsx
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerToolDef($);
    await registerCommandDef($);
    const started = await next(e);
    await resumeCarry($);
    return started;
  });
  registerTool(on);
  registerCommand(on);
  registerReset(on);
}
export {
  register
};
