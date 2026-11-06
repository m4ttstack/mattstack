import { useEffect, useState } from 'react';

import type { BoardMR } from '../../data.ts';
import { isOwnMr } from '../../view.ts';
import { postAction, type ActionResult } from '../api.ts';
import type { BoardMRWithReview, RowMenuState } from '../types.ts';
import { ActionMenu } from './ActionMenu.tsx';
import { mrRef } from './MrLinks.tsx';
import {
  rowActions,
  type ActionEnv,
  type FlockMenuData,
  type RowAction,
  type RunOpts,
} from './row-actions.ts';

/** One MR's right-click menu. The one thing only a single row has is the
    live slack marks: the menu stays open while several are set, so each
    reply's reactions are held here and fed back into rowActions. */
function RowMenu({
  menu,
  env,
  onRun,
  onClose,
}: {
  menu: RowMenuState;
  env: ActionEnv;
  onRun: (
    action: RowAction,
    mr: BoardMR,
    opts: RunOpts
  ) => Promise<ActionResult | undefined> | undefined;
  onClose: () => void;
}) {
  const mrx = menu.mr as BoardMRWithReview;
  const [reactions, setReactions] = useState<string[]>(
    mrx.slack?.reactions ?? []
  );
  const flock = useFlockMenu(mrx, env);
  const live: BoardMRWithReview = mrx.slack
    ? { ...mrx, slack: { ...mrx.slack, reactions } }
    : mrx;
  const actions = rowActions(live, flock ? { ...env, flock } : env);
  return (
    <ActionMenu
      x={menu.x}
      y={menu.y}
      subject={mrRef(mrx)}
      entries={actions}
      onClose={onClose}
      onRun={async (key, opts) => {
        const action = actions.find(a => a.key === key);
        if (!action) return;
        const result = await onRun(action, menu.mr, opts);
        const next = result?.body?.reactions;
        if (action.request.kind === 'react' && next) setReactions(next);
      }}
    />
  );
}

/** The flock section's worktree, resume session and saved commands, read
    once per opening on the seat's own MR. A failed read leaves the shell
    and claude rows, whose own failure then says why. */
function useFlockMenu(mr: BoardMR, env: ActionEnv): FlockMenuData | undefined {
  const [data, setData] = useState<FlockMenuData>();
  const wanted = env.local && isOwnMr(mr, env.self) && !!mr.webUrl;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void postAction('/flock/menu', { mrUrl: mr.webUrl, iid: mr.iid }).then(
      r => {
        if (live && r.ok) setData(flockMenuData(r.body));
      }
    );
    return () => {
      live = false;
    };
  }, [wanted, mr.webUrl, mr.iid]);
  return data;
}

function flockMenuData(body: unknown): FlockMenuData | undefined {
  const b = body as Partial<FlockMenuData> | null;
  if (!b || !Array.isArray(b.commands)) return undefined;
  return {
    installed: b.installed === true,
    tree: typeof b.tree === 'string' ? b.tree : null,
    resume: b.resume ?? null,
    commands: b.commands,
  };
}

export { RowMenu };
