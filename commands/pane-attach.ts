/**
 * rt pane attach [pane] [--takeover]: pick one of your Claude agents and
 * attach this terminal to it. The daemon says which herdr command reaches
 * the pane (`pane:attach-plan`); this verb gathers the rows and runs it.
 */
import type { AgentStatusKey, ChatPane, PaneFocusResult, RtResponse, StartedByKind } from "../packages/rt-client/src/index.ts";
import {
  AGENT_STATUS_WORDS,
  agentStartedBy,
  agentStatusKey,
  BG_PREFIX,
  paneAttachPlan as paneAttachPlanRt,
  paneFocus as paneFocusRt,
  paneList as paneListRt,
  panePeek as panePeekRt,
} from "../packages/rt-client/src/index.ts";
import { homedir } from "os";
import { UserActionableError } from "../lib/errors.ts";
import { PICKER_FACE_SIZE, resolveFaces } from "../lib/pane-faces.ts";
import { rtSelfArgv } from "../lib/rt-self.ts";
import { selfPaneRef } from "../lib/self-pane.ts";
import { childEnv } from "../lib/subprocess.ts";
import { runPick } from "../lib/ui/pick.ts";
import type { PickAction, PickPreview, PickRequest, PickResult, PickRow, PickSegment } from "../lib/ui/protocol.ts";

const USAGE = "rt pane attach <pane>";
const SCREEN_LINES = 3;

const GLYPHS: Record<AgentStatusKey, { glyph: string; tone: string }> = {
  working: { glyph: "●", tone: "mint" },
  blocked: { glyph: "◆", tone: "peach" },
  idle: { glyph: "○", tone: "dim" },
  done: { glyph: "✓", tone: "cyan" },
  unknown: { glyph: "·", tone: "faint" },
  gate: { glyph: "◆", tone: "peach" },
  ended: { glyph: "·", tone: "faint" },
};

const PRESENCE: Record<string, string> = { live: "live in chat", idle: "idle in chat", offline: "offline" };

function statusOf(p: ChatPane): { glyph: string; word: string; tone: string } {
  const key = agentStatusKey(p);
  return { ...GLYPHS[key], word: AGENT_STATUS_WORDS[key] };
}

const STARTED_BY_TONE: Record<StartedByKind, string> = { herd: "lav", caller: "cyan", run: "cyan", agent: "dim", hand: "faint" };

function startedBy(p: ChatPane): PickSegment {
  const s = agentStartedBy({ herdId: p.herd?.herdId, caller: p.agent?.caller, hasRecord: !!p.agent });
  return { text: s.text, tone: STARTED_BY_TONE[s.kind] };
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

const plain = (text: string): PickSegment[] => [{ text }];

export function tildePath(path: string, home = homedir()): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}
const faint = (text: string): PickSegment[] => [{ text, tone: "faint" }];

function preview(p: ChatPane, faces: Map<string, string>, peeks: Map<string, string[]>): PickPreview {
  const status = statusOf(p);
  const handle = p.presence?.handle;
  const facePath = handle ? faces.get(handle) : undefined;

  const header: PickSegment[][] = [
    handle ? [{ text: handle, bold: true }] : faint("not signed in"),
    [{ text: status.word, tone: status.tone }, ...(p.presence ? [{ text: ` · ${PRESENCE[p.presence.status] ?? p.presence.status}`, tone: "dim" }] : [])],
  ];
  if (p.presence?.rooms.length) header.push([{ text: p.presence.rooms.map((r) => `#${r}`).join(" "), tone: "dim" }]);
  if (p.agent) header.push([{ text: [p.agent.provider, p.agent.model, p.agent.effort].filter(Boolean).join(" · "), tone: "dim" }]);

  const where = [
    { key: "repo", value: plain([p.repo, p.branch].filter(Boolean).join(" · ") || "unknown") },
    ...(p.cwd ? [{ key: "folder", value: plain(tildePath(p.cwd)) }] : []),
    { key: "herdr", value: plain(`${[p.workspace, p.tab].filter(Boolean).join(" › ")} · pane ${p.paneId}`) },
  ];
  const startedBy = p.agent
    ? [
        { key: "agent", value: plain(p.agent.id) },
        ...(p.agent.caller ? [{ key: "caller", value: plain(p.agent.caller) }] : []),
        ...(p.agent.account ? [{ key: "account", value: plain(p.agent.account) }] : []),
        { key: "started", value: plain(stamp(p.agent.startedAt)) },
      ]
    : [{ key: "", value: faint("started by hand") }];
  const herd = p.herd
    ? [{ key: "herd", value: plain(p.herd.herdId) }, { key: "job", value: plain(p.herd.job) }]
    : [{ key: "", value: faint("not in a herd") }];

  const screen = peeks.get(p.paneId);
  return {
    face: facePath ? { path: facePath } : { placeholder: "?" },
    header,
    sections: [
      { title: "WHERE", rows: where },
      { title: "STARTED BY", rows: startedBy },
      ...(p.gate ? [{ title: "GATE", rows: [{ key: "", value: plain(p.gate.question) }] }] : []),
      { title: "HERD", rows: herd },
    ],
    ...(screen?.length ? { screen } : {}),
  };
}

const GAP = 2;
const CAP = { agent: 18, repo: 44, tab: 16 };

/** Pads or cuts text to exactly width terminal cells. */
function fit(text: string, width: number): string {
  const w = Bun.stringWidth(text);
  if (w <= width) return text + " ".repeat(width - w);
  let out = "";
  for (const ch of text) {
    if (Bun.stringWidth(out + ch) > width - 1) break;
    out += ch;
  }
  return out + "…" + " ".repeat(Math.max(0, width - 1 - Bun.stringWidth(out)));
}

interface Cells { glyph: PickSegment; agent: PickSegment; status: PickSegment; repo: PickSegment; tab: PickSegment; startedBy: PickSegment }

function cells(p: ChatPane): Cells {
  const status = statusOf(p);
  const bg = p.paneId.startsWith(BG_PREFIX);
  return {
    glyph: { text: `${status.glyph} `, tone: status.tone },
    agent: p.presence ? { text: p.presence.name || p.presence.handle, bold: true } : { text: "not signed in", tone: "faint" },
    status: { text: status.word, tone: status.tone },
    repo: { text: [p.repo, p.branch].filter(Boolean).join(" · "), tone: "dim" },
    tab: { text: (bg ? p.herd?.job : p.tab) ?? "", tone: "faint" },
    startedBy: startedBy(p),
  };
}

function colWidth(texts: string[], title: string, cap: number): number {
  return Math.min(cap, Math.max(Bun.stringWidth(title), ...texts.map((t) => Bun.stringWidth(t))));
}

const BG_GROUP = "\u0000background";

/** Picker rows and the header naming their columns, padded to shared widths; grouped by herdr workspace in first-seen order, background panes last, the caller's own pane left out. */
export function attachView(panes: ChatPane[], faces: Map<string, string>, peeks: Map<string, string[]>, selfRef: string | undefined): { rows: PickRow[]; header: PickSegment[] } {
  const order: string[] = [];
  const byGroup = new Map<string, ChatPane[]>();
  for (const p of panes.filter((p) => p.paneId !== selfRef)) {
    const g = p.paneId.startsWith(BG_PREFIX) ? BG_GROUP : p.workspace;
    if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
    byGroup.get(g)!.push(p);
  }
  order.sort((a, b) => Number(a === BG_GROUP) - Number(b === BG_GROUP));
  const sorted = order.flatMap((g) => byGroup.get(g)!);
  const all = sorted.map(cells);

  const glyphW = Bun.stringWidth(all[0]?.glyph.text ?? "  ");
  const w = {
    agent: colWidth(all.map((c) => c.glyph.text + c.agent.text), "AGENT", CAP.agent),
    status: colWidth(all.map((c) => c.status.text), "STATUS", Infinity),
    repo: colWidth(all.map((c) => c.repo.text), "REPO · BRANCH", CAP.repo),
    tab: colWidth(all.map((c) => c.tab.text), "TAB", CAP.tab),
  };
  const anyTab = all.some((c) => c.tab.text);
  const tabW = w.tab + GAP;

  const rows = sorted.map((p, i): PickRow => {
    const c = all[i]!;
    return {
      value: p.paneId,
      group: p.paneId.startsWith(BG_PREFIX) ? "background" : p.workspace,
      left: [
        c.glyph,
        { ...c.agent, text: fit(c.agent.text, w.agent - glyphW + GAP) },
        { ...c.status, text: fit(c.status.text, w.status + GAP) },
        { ...c.repo, text: fit(c.repo.text, w.repo + GAP) },
        ...(anyTab ? [{ ...c.tab, text: fit(c.tab.text, tabW) }] : []),
        c.startedBy,
      ],
      match: [p.presence?.handle, p.repo, p.branch, p.tab, ...(p.presence?.rooms ?? [])].filter(Boolean).join(" "),
      preview: preview(p, faces, peeks),
    };
  });
  const header: PickSegment[] = [
    { text: fit("AGENT", w.agent + GAP) },
    { text: fit("STATUS", w.status + GAP) },
    { text: fit("REPO · BRANCH", w.repo + GAP) },
    ...(anyTab ? [{ text: fit("TAB", tabW) }] : []),
    { text: "STARTED BY" },
  ];
  return { rows, header };
}

export function attachRows(panes: ChatPane[], faces: Map<string, string>, peeks: Map<string, string[]>, selfRef: string | undefined): PickRow[] {
  return attachView(panes, faces, peeks, selfRef).rows;
}

export interface AttachDeps {
  isTTY: () => boolean;
  selfRef: () => string | undefined;
  list: () => Promise<RtResponse<{ panes: ChatPane[] }>>;
  peek: (paneId: string) => Promise<RtResponse<{ paneId: string; lines: string[] }>>;
  faces: (handles: string[]) => Promise<Map<string, string>>;
  plan: (payload: { paneId: string; takeover?: boolean }) => Promise<RtResponse<{ argv: string[]; env: Record<string, string> }>>;
  focus: (payload: { paneId: string; callerWorkspace?: string }) => Promise<RtResponse<PaneFocusResult>>;
  pick: (req: Omit<PickRequest, "t" | "protocol">) => Promise<PickResult>;
  /** Runs argv in this terminal with inherited stdio; resolves to its exit code. */
  spawn: (argv: string[], env: Record<string, string | undefined>) => Promise<number>;
  /** Draws these faces in a process that outlives this one, so the next picker has them. */
  cacheLater: (handles: string[]) => void;
  exit: (code: number) => never;
}

const ACTIONS: PickAction[] = [
  { id: "attach", label: "attach", key: "enter", scope: "item", primary: true },
  { id: "takeover", label: "attach and take over", key: "ctrl+t", scope: "item" },
  { id: "focus", label: "just focus it", key: "ctrl+f", scope: "item" },
];

function failed(message: string): never {
  throw new UserActionableError("pane-attach", message);
}

async function attach(paneId: string, takeover: boolean, deps: AttachDeps): Promise<never> {
  const res = await deps.plan({ paneId, ...(takeover ? { takeover: true } : {}) });
  if (!res.ok || !res.data) failed(res.error ?? "rt could not work out how to attach to that pane");
  const code = await deps.spawn(res.data.argv, { ...childEnv(), ...res.data.env });
  return deps.exit(code);
}

async function choose(deps: AttachDeps): Promise<{ paneId: string; action: string } | null> {
  const listed = await deps.list();
  if (!listed.ok || !listed.data) failed(listed.error ?? "rt could not list your panes");
  const self = deps.selfRef();
  const panes = listed.data.panes.filter((p) => p.paneId !== self);
  if (panes.length === 0) failed("No Claude panes to attach to");

  const handles = panes.flatMap((p) => (p.presence ? [p.presence.handle] : []));
  const [faces, peeked] = await Promise.all([
    deps.faces(handles),
    Promise.all(panes.map(async (p) => {
      const r = await deps.peek(p.paneId).catch(() => undefined);
      return [p.paneId, r?.ok && r.data ? r.data.lines.slice(-SCREEN_LINES) : undefined] as const;
    })),
  ]);
  const missing = [...new Set(handles)].filter((h) => !faces.has(h));
  if (missing.length) deps.cacheLater(missing);
  const peeks = new Map(peeked.filter((e): e is readonly [string, string[]] => e[1] !== undefined));
  const waiting = panes.filter((p) => p.agentStatus === "blocked" || p.gate).length;

  const view = attachView(panes, faces, peeks, self);
  const result = await deps.pick({
    message: "Which pane should rt attach to?",
    layout: "fullscreen",
    breadcrumb: ["rt", "pane attach"],
    idleCount: `${panes.length} agent${panes.length === 1 ? "" : "s"} · ${waiting} waiting on you`,
    rows: view.rows,
    columnHeader: view.header,
    actions: ACTIONS,
  });
  if (!result.value || result.action === "cancel" || result.action === "esc") return null;
  return { paneId: result.value, action: result.action };
}

export async function paneAttachWith(args: string[], deps: AttachDeps): Promise<void> {
  const takeover = args.includes("--takeover");
  const named = args.find((a) => !a.startsWith("--"));
  if (named) return void (await attach(named, takeover, deps));

  if (!deps.isTTY() || args.includes("--json") || process.env.RT_BATCH) {
    throw new UserActionableError("usage", "Which pane should rt attach to?", {}, { next: USAGE });
  }
  // Face renders still running in this process would hold it open for up
  // to 15 s, so a path that does not hand the terminal to herdr exits now.
  const picked = await choose(deps);
  if (!picked) return deps.exit(0);
  if (picked.action === "focus") {
    const callerWorkspace = process.env.HERDR_WORKSPACE_ID;
    const res = await deps.focus({ paneId: picked.paneId, ...(callerWorkspace ? { callerWorkspace } : {}) });
    if (!res.ok) failed(res.error ?? "rt could not focus that pane");
    if (!res.data?.focused) failed("rt could not focus that pane");
    return deps.exit(0);
  }
  await attach(picked.paneId, takeover || picked.action === "takeover", deps);
}

/** The `rt chat avatar` call that caches a handle's face at the size the picker reads. */
export function cacheFaceArgv(handle: string): string[] {
  return [...rtSelfArgv(), "chat", "avatar", handle, "--size", String(PICKER_FACE_SIZE), "--json"];
}

const realDeps: AttachDeps = {
  isTTY: () => Boolean(process.stdin.isTTY),
  selfRef: () => selfPaneRef(),
  list: () => paneListRt(),
  peek: (paneId) => panePeekRt({ paneId, lines: SCREEN_LINES }),
  faces: (handles) => resolveFaces(handles),
  plan: (payload) => paneAttachPlanRt(payload),
  focus: (payload) => paneFocusRt(payload),
  pick: (req) => runPick(req).result,
  spawn: async (argv, env) => Bun.spawn(argv, { env, stdio: ["inherit", "inherit", "inherit"] }).exited,
  cacheLater: (handles) => {
    for (const handle of handles) {
      Bun.spawn(cacheFaceArgv(handle), { env: childEnv(), stdio: ["ignore", "ignore", "ignore"] }).unref();
    }
  },
  exit: (code) => process.exit(code),
};

export function paneAttach(args: string[]): Promise<void> {
  return paneAttachWith(args, realDeps);
}
