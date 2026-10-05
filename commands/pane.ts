/**
 * rt pane: herdr panes as rt sees them (joined to chat presence).
 *
 *   rt pane list [--json]                                         claude panes, presence joined
 *   rt pane peek <pane> [--lines 8] [--json]                      the last lines of a pane's screen
 *   rt pane spawn --cwd <path> [--account <a>] [--model <m>]
 *                 [--effort <e>] [--prompt <text>] [--workspace <label>] [--json]
 *   rt pane send <pane|self> --text <text> [--then <text>]        inject text into a pane; self is this pane; --then lands after its turn (--text - reads stdin)
 *   rt pane accounts [--json]                                     cswap accounts with headroom
 *   rt pane directories [--q <text>] [--json]                     repos and worktrees for --cwd
 *
 * Every verb needs herdr; without it the daemon answers "herdr unavailable".
 */
import type { ChatPane, PaneSendResult, RtResponse } from "../packages/rt-client/src/index.ts";
import { BG_PREFIX, paneAccounts as paneAccountsRt, paneDirectories as paneDirectoriesRt, paneFocus as paneFocusRt, paneList as paneListRt, panePeek as panePeekRt, paneSend as paneSendRt, paneSpawn as paneSpawnRt } from "../packages/rt-client/src/index.ts";
import { selfPaneRef } from "../lib/self-pane.ts";
import * as out from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";

const FLAGS_WITH_VALUES = new Set(["--lines", "--cwd", "--account", "--model", "--effort", "--prompt", "--workspace", "--q", "--sock", "--text", "--then"]);

function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (FLAGS_WITH_VALUES.has(a)) i++;
      continue;
    }
    return a;
  }
  return undefined;
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function fail(msg: string): never {
  out.diagnostic(`rt pane: ${msg}\n`);
  process.exit(1);
}

function unwrap<T>(res: RtResponse<T>, label: string): T {
  if (!res.ok || res.data === undefined) fail(res.error ?? `${label} failed`);
  return res.data;
}

function opts(args: string[]) {
  const sockPath = flagValue(args, "--sock");
  return sockPath ? { sockPath } : {};
}

/** One line an agent may be reading: stdout, byte for byte. */
function say(text: string): void {
  out.payload(`${text}\n`);
}

/** Blocks for a person at a terminal; the frozen text for every other reader. */
function show(blocks: () => Block[], frozen: () => string): void {
  if (out.isHuman()) out.print(...blocks());
  else say(frozen());
}

const PANE_STATUS: Record<ChatPane["agentStatus"], { word: string; role: Segment["role"] }> = {
  working: { word: "working", role: "running" },
  idle: { word: "idle", role: "pending" },
  blocked: { word: "waiting on you", role: "needs-you" },
  done: { word: "done", role: "done" },
  unknown: { word: "unknown", role: "skipped" },
};

function paneRow(p: ChatPane): out.CellInput[] {
  const name = p.presence ? (p.presence.name ?? p.presence.handle) : undefined;
  const status = PANE_STATUS[p.agentStatus] ?? PANE_STATUS.unknown;
  const where = [p.workspace, p.title && p.title !== name ? p.title : undefined].filter(Boolean).join(" · ");
  const repo = [p.repo, p.branch].filter(Boolean).join(" · ");
  const rooms = p.presence?.rooms.length ? `#${p.presence.rooms.join(" #")}` : "";
  return [out.strong(p.paneId), { text: status.word, role: status.role }, name ?? out.dim("not signed in"), out.dim(where), out.dim(repo), out.dim(rooms)];
}

export function paneListBlocks(panes: ChatPane[]): Block[] {
  if (panes.length === 0) return [out.line("skipped", "No Claude panes")];
  const visible = panes.filter((p) => !p.paneId.startsWith(BG_PREFIX)).map(paneRow);
  const bg = panes.filter((p) => p.paneId.startsWith(BG_PREFIX)).map(paneRow);
  return [out.table(bg.length > 0 ? [...visible, { group: "background" }, ...bg] : visible)];
}

function renderPane(p: ChatPane, idWidth: number): string {
  const name = p.presence ? (p.presence.name ?? p.presence.handle) : undefined;
  const who = p.presence ? `${name} (${p.presence.status})` : "not signed in";
  const where = [p.repo, p.branch].filter(Boolean).join(" · ");
  const title = p.title && p.title !== name ? ` · ${p.title}` : "";
  const rooms = p.presence?.rooms.length ? `  #${p.presence.rooms.join(" #")}` : "";
  return `${p.paneId.padEnd(idWidth)} ${p.agentStatus.padEnd(8)} ${who.padEnd(22)} ${p.workspace}${title}${where ? `  ${where}` : ""}${rooms}`;
}

export async function paneList(args: string[]): Promise<void> {
  const data = unwrap(await paneListRt(opts(args)), "pane list");
  if (args.includes("--json")) return void out.json({ ok: true, panes: data.panes });
  show(
    () => paneListBlocks(data.panes),
    () => {
      if (data.panes.length === 0) return "no claude panes";
      const idWidth = Math.max(...data.panes.map((p) => p.paneId.length));
      const visible = data.panes.filter((p) => !p.paneId.startsWith(BG_PREFIX));
      const bg = data.panes.filter((p) => p.paneId.startsWith(BG_PREFIX));
      const lines = visible.map((p) => renderPane(p, idWidth));
      if (bg.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("background:");
        lines.push(...bg.map((p) => renderPane(p, idWidth)));
      }
      return lines.join("\n");
    },
  );
}

export async function panePeek(args: string[]): Promise<void> {
  const paneId = positional(args);
  if (!paneId) fail("usage: rt pane peek <pane> [--lines 8]");
  const linesRaw = flagValue(args, "--lines");
  let lines: number | undefined;
  if (linesRaw !== undefined) {
    lines = Number(linesRaw);
    if (!Number.isInteger(lines) || lines <= 0) fail(`--lines must be a positive integer (got "${linesRaw}")`);
  }
  const data = unwrap(await panePeekRt({ paneId, lines }, opts(args)), "pane peek");
  if (args.includes("--json")) return void out.json({ ok: true, ...data });
  say(data.lines.join("\n"));
}

export async function paneSpawn(args: string[]): Promise<void> {
  const cwd = flagValue(args, "--cwd");
  if (!cwd) fail("usage: rt pane spawn --cwd <path> [--account <a>] [--model <m>] [--effort <e>] [--prompt <text>] [--workspace <label>]");
  const data = unwrap(
    await paneSpawnRt(
      { cwd, account: flagValue(args, "--account"), model: flagValue(args, "--model"), effort: flagValue(args, "--effort"), prompt: flagValue(args, "--prompt"), workspace: flagValue(args, "--workspace") },
      opts(args),
    ),
    "pane spawn",
  );
  if (args.includes("--json")) return void out.json({ ok: true, ...data });
  say(`${data.ready ? "ready" : "not ready"}  ${renderPane(data.pane, data.pane.paneId.length)}`);
}

const SELF_TARGET = "self";
export const NOT_IN_PANE = "not in a herdr pane (HERDR_PANE_ID unset)";

export async function paneSend(args: string[]): Promise<void> {
  const target = positional(args);
  const rawText = flagValue(args, "--text");
  if (!target || rawText === undefined) fail("usage: rt pane send <pane|self> --text <text> [--then <text>]  (--text - reads stdin)");
  const text = rawText === "-" ? await new Response(Bun.stdin.stream()).text() : rawText;
  const own = selfPaneRef();
  // The daemon refuses a callerPane equal to the target, so `self` is the one
  // spelling that reaches this pane: it sends the own ref as the target and no
  // callerPane. A literal copy of the own id keeps the guard.
  const paneId = target === SELF_TARGET ? (own ?? fail(NOT_IN_PANE)) : target;
  const callerPane = target === SELF_TARGET ? undefined : own;
  const continuation = flagValue(args, "--then");
  if (args.includes("--then") && !continuation) fail("--then needs a body");
  const data = unwrap(
    await paneSendRt({ paneId, text, ...(callerPane ? { callerPane } : {}), ...(continuation !== undefined ? { continuation } : {}) }, opts(args)),
    "pane send",
  );
  const { continuation: then, ...first } = data;
  if (args.includes("--json")) return void out.json({ ok: true, ...first, ...(then ? { then } : {}) });
  say(renderDelivery(first));
  if (then) say(`then: ${first.paneId} ${then.delivered}`);
}

function renderDelivery(d: Pick<PaneSendResult, "paneId" | "delivered" | "reason">): string {
  return `${d.paneId} ${d.delivered}${d.reason ? ` (${d.reason})` : ""}`;
}

export function renderPaneFocus(data: { paneId: string; focused: boolean; attendTab?: string }): string {
  if (data.attendTab) return `attached ${data.paneId} in tab ${data.attendTab}; detach with ctrl+b q, then close the tab`;
  return `${data.paneId} ${data.focused ? "focused" : "not focused"}`;
}

export async function paneFocus(args: string[]): Promise<void> {
  const paneId = positional(args);
  if (!paneId) fail("usage: rt pane focus <pane>");
  const callerWorkspace = process.env.HERDR_WORKSPACE_ID;
  const data = unwrap(await paneFocusRt({ paneId, ...(callerWorkspace ? { callerWorkspace } : {}) }, opts(args)), "pane focus");
  if (args.includes("--json")) return void out.json({ ok: true, ...data });
  say(renderPaneFocus(data));
}

export async function paneAccounts(args: string[]): Promise<void> {
  const data = unwrap(await paneAccountsRt(opts(args)), "pane accounts");
  if (args.includes("--json")) return void out.json({ ok: true, accounts: data.accounts });
  if (data.accounts.length === 0) return void say("no cswap accounts");
  say(data.accounts.map((a) => `${String(a.slot).padStart(2)}: ${a.alias ?? a.email}${a.alias ? `  ${a.email}` : ""}${a.headroom ? `  ${a.headroom}` : ""}`).join("\n"));
}

export async function paneDirectories(args: string[]): Promise<void> {
  const data = unwrap(await paneDirectoriesRt({ q: flagValue(args, "--q") }, opts(args)), "pane directories");
  if (args.includes("--json")) return void out.json({ ok: true, directories: data.directories });
  say(data.directories.map((d) => `${d.path}  ${d.repo}${d.branch ? ` · ${d.branch}` : ""}`).join("\n"));
}
