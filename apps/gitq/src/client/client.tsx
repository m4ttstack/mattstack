import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { createRoot } from 'react-dom/client';

// ---- wire types (mirror src/server/data.ts and job-state.ts) ----
interface BoardMr {
  iid: number;
  url: string | null;
  title: string;
  state: string;
  pipelineStatus: string;
}
interface BoardNode {
  branch: string;
  parent: string;
  situation: string;
  statusLine: string;
  badge: { label: string; variant: string } | null;
  mr: BoardMr | null;
  checkedOutIn: string | null;
  checkedOutDirty: boolean;
}
interface BoardWorktree {
  name: string;
  path: string;
  branch: string | null;
  dirty: boolean;
  isWorkSlot: boolean;
  lease: { stackName: string; action: string; state: 'running' | 'parked' } | null;
}
interface ConflictPrediction {
  branch: string;
  files: { file: string; type: string }[];
}
interface BoardStack {
  stackName: string;
  root: string;
  nodes: BoardNode[];
  banner: unknown;
  globalBlocks: string[];
  predictedConflicts: ConflictPrediction[];
  /** Every node merged: rendered in the collapsed group, not the active grid. */
  done: boolean;
}
interface ActivityEntry {
  id: string;
  timestamp: number;
  operation: string;
  stackName: string;
  branches: string[];
}
type ForgeSlug = 'gitlab' | 'github';

/**
 * How a forge writes a merge/pull request reference, and what to call it.
 *
 * A null forge is a repo whose remote names none gitq can identify: it still
 * gets a working link, just without claiming a notation or a name that might be
 * the wrong one.
 */
const FORGE_STYLE: Record<ForgeSlug, { sigil: string; name: string }> = {
  gitlab: { sigil: '!', name: 'gitlab' },
  github: { sigil: '#', name: 'github' },
};

function mrRef(forge: ForgeSlug | null, iid: number): string {
  return forge ? `${FORGE_STYLE[forge].sigil}${iid}` : `MR ${iid}`;
}

interface BoardRepo {
  path: string;
  name: string;
  forge: ForgeSlug | null;
  stacks: BoardStack[];
  activity: ActivityEntry[];
  worktrees: BoardWorktree[];
  error: string | null;
}
interface JobInfo {
  repoPath: string;
  stack: string;
  action: string;
  status: string;
  detail?: string;
  startedAt: number;
  updatedAt: number;
}
interface BoardData {
  repos: BoardRepo[];
  jobs: JobInfo[];
  fetchedAt: number;
  fetchError: string | null;
  local: boolean;
}

const ACTIONS = ['sync', 'publish', 'absorb', 'restructure'] as const;
type Action = (typeof ACTIONS)[number];

const LIVE_STATUSES = new Set(['starting', 'working', 'conflict']);

const OP_CLASS: Record<string, string> = {
  'cascade-rebase': 'ghost-emphasis',
  sync: 'ghost-emphasis',
  absorb: 'ghost-positive',
  split: 'ghost-merge',
  fold: 'ghost-merge',
  reparent: 'ghost-merge',
  rename: 'ghost-neutral',
  retarget: 'ghost-caution',
  'toggle-unmanaged': 'ghost-neutral',
};

function jobKey(repoPath: string, stack: string, action: string): string {
  return `${repoPath} ${stack} ${action}`;
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** Order nodes root-first via parent links so the tree reads top-down.
    Orphans (parent missing from the stack) still render, at the end. */
function topoOrder(nodes: BoardNode[], root: string): BoardNode[] {
  const byParent = new Map<string, BoardNode[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parent) ?? [];
    list.push(n);
    byParent.set(n.parent, list);
  }
  const out: BoardNode[] = [];
  const walk = (parent: string) => {
    for (const child of byParent.get(parent) ?? []) {
      out.push(child);
      walk(child.branch);
    }
  };
  walk(root);
  for (const n of nodes) if (!out.includes(n)) out.push(n);
  return out;
}

const ROW_H = 32;

function StackPanel(props: {
  stack: BoardStack;
  jobs: JobInfo[];
  forge: ForgeSlug | null;
  onMenu: (e: ReactMouseEvent, stack: BoardStack, node: BoardNode | null) => void;
}) {
  const { stack, jobs, forge } = props;
  const nodes = topoOrder(stack.nodes, stack.root);
  const height = (nodes.length + 1) * ROW_H;
  const predicted = new Set(stack.predictedConflicts.map((c) => c.branch));
  return (
    <div className="stack" onContextMenu={(e) => props.onMenu(e, stack, null)}>
      <div className="stack-head">
        <span className="stack-name">{stack.stackName}</span>
        {jobs.map((j) => {
          const cls =
            j.status === 'conflict' ? 'chip-conflict'
            : LIVE_STATUSES.has(j.status) ? 'chip-live'
            : j.status === 'error' ? 'chip-error'
            : 'chip-done';
          return (
            <span key={j.action} className={`chip ${cls}`} title={j.detail ?? ''}>
              {j.action} {j.status}
            </span>
          );
        })}
      </div>
      {stack.globalBlocks.length > 0 && <div className="blocks">{stack.globalBlocks.join(' / ')}</div>}
      <div className="tree" style={{ height }}>
        <svg className="tree-lines" width="40" height={height}>
          {nodes.length > 0 && (
            <>
              <line x1="8" y1={ROW_H - 8} x2="8" y2={ROW_H + ROW_H / 2} stroke="currentColor" strokeOpacity="0.35" />
              <line
                x1="8" y1={ROW_H + ROW_H / 2} x2="28" y2={ROW_H + ROW_H / 2}
                stroke="currentColor" strokeOpacity="0.35"
              />
              <line
                x1="28" y1={ROW_H + ROW_H / 2} x2="28" y2={height - ROW_H / 2}
                stroke="currentColor" strokeOpacity="0.35"
              />
            </>
          )}
          {nodes.map((n, i) => (
            <circle key={n.branch} className="gap" cx="28" cy={ROW_H * (i + 1) + ROW_H / 2} r="9" />
          ))}
        </svg>
        <div className="row root">
          <span>{stack.root}</span>
        </div>
        {nodes.map((n) => (
          <div key={n.branch} className="row branch" onContextMenu={(e) => props.onMenu(e, stack, n)}>
            <span className={`dot dot-${n.badge?.variant ?? 'positive'}`} />
            <span className="branch-name" title={n.statusLine}>{n.branch}</span>
            {n.badge ? (
              <span className={`label ghost-${n.badge.variant}`} title={n.statusLine}>
                {n.badge.label.toLowerCase()}
              </span>
            ) : predicted.has(n.branch) ? (
              <span className="label ghost-caution" title="preflight predicts a rebase conflict">
                conflict predicted
              </span>
            ) : null}
            {n.checkedOutIn && (
              <span
                className={`slot-chip${n.checkedOutDirty ? ' slot-dirty' : ''}`}
                title={n.checkedOutDirty ? `checked out in ${n.checkedOutIn} (dirty)` : `checked out in ${n.checkedOutIn}`}
              >
                {n.checkedOutIn}
              </span>
            )}
            {n.mr?.url && (
              <a className="mr-link" href={n.mr.url} target="_blank" rel="noreferrer" title={n.mr.title}>
                {mrRef(forge, n.mr.iid)}
              </a>
            )}
          </div>
        ))}
        {nodes.length === 0 && <div className="empty">no branches tracked</div>}
      </div>
    </div>
  );
}

function ActivityFeed(props: { repo: BoardRepo; jobs: JobInfo[] }) {
  const jobRows = props.jobs
    .filter((j) => LIVE_STATUSES.has(j.status) || j.status === 'error')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="activity">
      <div className="activity-head">activity</div>
      {jobRows.map((j) => (
        <div key={jobKey(j.repoPath, j.stack, j.action)} className="activity-row">
          <span className="when">{ago(j.updatedAt)}</span>
          <span>
            <span className={j.status === 'error' ? 'ghost-negative' : 'ghost-emphasis'}>{j.action}</span>{' '}
            {j.stack}: {j.status}
            {j.detail ? ` ${j.detail}` : ''}
          </span>
        </div>
      ))}
      {props.repo.activity.map((a) => (
        <div key={a.id} className="activity-row">
          <span className="when">{ago(a.timestamp)}</span>
          <span>
            <span className={OP_CLASS[a.operation] ?? 'ghost-neutral'}>{a.operation}</span> {a.stackName} (
            {a.branches.join(', ')})
          </span>
        </div>
      ))}
      {jobRows.length === 0 && props.repo.activity.length === 0 && (
        <div className="activity-empty">nothing to report</div>
      )}
    </div>
  );
}

interface MenuState {
  x: number;
  y: number;
  repo: BoardRepo;
  stack: BoardStack;
  node: BoardNode | null;
}

function App() {
  const [data, setData] = useState<BoardData | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [optimistic, setOptimistic] = useState<Record<string, JobInfo>>({});
  // Which repos have their merged group expanded, by repo path. Collapsed is the
  // point of the group, so this starts empty on every load and is not persisted;
  // polling replaces `data` without remounting, so an expansion survives refreshes.
  const [openMerged, setOpenMerged] = useState<Record<string, boolean>>({});
  const toastId = useRef(0);

  const addToast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const load = useCallback(async (fresh = false) => {
    try {
      const res = await fetch(fresh ? '/data.json?fresh=1' : '/data.json');
      if (!res.ok) throw new Error(`${res.status}`);
      setData((await res.json()) as BoardData);
    } catch {
      // keep the last snapshot; the next poll retries
    }
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(t);
    };
  }, [load]);

  const anyLive =
    (data?.jobs.some((j) => LIVE_STATUSES.has(j.status)) ?? false) ||
    Object.values(optimistic).some((j) => LIVE_STATUSES.has(j.status));

  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 4_000);
    return () => clearInterval(t);
  }, [anyLive, load]);

  // Drop an optimistic entry once the server reports the real job.
  useEffect(() => {
    if (!data) return;
    setOptimistic((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const j of data.jobs) {
        const key = jobKey(j.repoPath, j.stack, j.action);
        if (next[key]) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  const launch = useCallback(
    async (repo: BoardRepo, stack: BoardStack, action: Action, sourceSlot?: string) => {
      setMenu(null);
      const key = jobKey(repo.path, stack.stackName, action);
      const now = Date.now();
      setOptimistic((prev) => ({
        ...prev,
        [key]: { repoPath: repo.path, stack: stack.stackName, action, status: 'starting', startedAt: now, updatedAt: now },
      }));
      addToast(`launching ${action} for ${repo.name}:${stack.stackName}`);
      try {
        const res = await fetch('/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repoPath: repo.path, stack: stack.stackName, action, ...(sourceSlot ? { sourceSlot } : {}) }),
        });
        if (!res.ok) throw new Error(await res.text());
        const out = (await res.json()) as { ok: boolean; focused?: boolean };
        if (out.focused) addToast(`${action} already running for ${stack.stackName}, focused its tab`);
        void load();
      } catch (err) {
        setOptimistic((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        addToast(`${action} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [addToast, load],
  );

  const openMenu = useCallback((e: ReactMouseEvent, repo: BoardRepo, stack: BoardStack, node: BoardNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 220), repo, stack, node });
  }, []);

  if (!data) return <div className="main empty">loading...</div>;

  const jobsFor = (repoPath: string, stackName: string): JobInfo[] => {
    const server = data.jobs.filter((j) => j.repoPath === repoPath && j.stack === stackName);
    const serverKeys = new Set(server.map((j) => jobKey(j.repoPath, j.stack, j.action)));
    const opt = Object.values(optimistic).filter(
      (j) => j.repoPath === repoPath && j.stack === stackName && !serverKeys.has(jobKey(j.repoPath, j.stack, j.action)),
    );
    return [...server, ...opt].sort((a, b) => a.action.localeCompare(b.action));
  };

  return (
    <>
      <div className="topbar">
        <span className="title">gitq</span>
        <span className="spacer" />
        <span className="meta">updated {ago(data.fetchedAt)}</span>
        <button onClick={() => void load(true)}>refresh</button>
      </div>
      {data.fetchError && <div className="error-banner">refresh failed: {data.fetchError} (showing last good data)</div>}
      <div className="main">
        {data.repos.map((repo) => {
          const active = repo.stacks.filter((s) => !s.done);
          const merged = repo.stacks.filter((s) => s.done);
          const mergedOpen = openMerged[repo.path] ?? false;
          const panel = (stack: BoardStack) => (
            <StackPanel
              key={stack.stackName}
              stack={stack}
              jobs={jobsFor(repo.path, stack.stackName)}
              forge={repo.forge}
              onMenu={(e, s, n) => openMenu(e, repo, s, n)}
            />
          );
          return (
            <section key={repo.path}>
              <div className="repo-head">
                {repo.name}
                {repo.worktrees.filter((w) => w.isWorkSlot).map((w) => (
                  <span key={w.path} className={`slot-status${w.lease ? ` slot-${w.lease.state}` : ''}`}>
                    {w.name}: {w.lease ? `${w.lease.state === 'parked' ? 'parked' : w.lease.action} on ${w.lease.stackName}` : 'free'}
                  </span>
                ))}
              </div>
              {repo.error && <div className="repo-error">{repo.error}</div>}
              <div className="repo-body">
                <div className="stacks">
                  {active.map(panel)}
                  {repo.stacks.length === 0 && !repo.error && <div className="empty">no tracked stacks</div>}
                  {merged.length > 0 && (
                    <div className="merged-group">
                      <button
                        className="merged-head"
                        aria-expanded={mergedOpen}
                        onClick={() => setOpenMerged((prev) => ({ ...prev, [repo.path]: !mergedOpen }))}
                      >
                        <span className="caret">{mergedOpen ? '▾' : '▸'}</span>
                        merged ({merged.length})
                        {!mergedOpen && (
                          <span className="merged-names">{merged.map((s) => s.stackName).join(', ')}</span>
                        )}
                      </button>
                      {mergedOpen && <div className="stacks">{merged.map(panel)}</div>}
                    </div>
                  )}
                </div>
                <ActivityFeed repo={repo} jobs={data.jobs.filter((j) => j.repoPath === repo.path)} />
              </div>
            </section>
          );
        })}
      </div>
      {menu && (
        <div className="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {data.local &&
            ACTIONS.filter((a) => a !== 'absorb').map((action) => (
              <button key={action} className="menu-item" onClick={() => void launch(menu.repo, menu.stack, action)}>
                {action} {menu.stack.stackName}
                <span className="hint">herdr</span>
              </button>
            ))}
          {data.local && (() => {
            const dirty = menu.repo.worktrees.filter((w) => !w.isWorkSlot && w.dirty);
            if (dirty.length === 0) {
              return <div className="menu-item menu-disabled">absorb (no dirty worktree)</div>;
            }
            return dirty.map((w) => (
              <button key={w.path} className="menu-item" onClick={() => void launch(menu.repo, menu.stack, 'absorb', w.path)}>
                absorb from {w.name}
                <span className="hint">herdr</span>
              </button>
            ));
          })()}
          {data.local && menu.node?.mr?.url && <div className="menu-sep" />}
          {menu.node?.mr?.url && (
            <button
              className="menu-item"
              onClick={() => {
                window.open(menu.node!.mr!.url!, '_blank');
                setMenu(null);
              }}
            >
              open {mrRef(menu.repo.forge, menu.node.mr.iid)}
              {menu.repo.forge ? ` in ${FORGE_STYLE[menu.repo.forge].name}` : ''}
            </button>
          )}
          {!data.local && !menu.node?.mr?.url && <div className="menu-item">read-only over the tunnel</div>}
        </div>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
