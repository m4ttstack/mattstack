import { useState } from 'react';

import type { BoardMR } from '../../data.ts';
import { forgeWord } from '../../mr-ref.ts';
import { isOwnMr } from '../../view.ts';
import type { ActionResult } from '../api.ts';
import type { BoardMRWithReview, RowMenuState } from '../types.ts';
import { ActionMenu } from './ActionMenu.tsx';
import { useFlockMenu } from './flock-menu-cache.ts';
import { mrRef } from './MrLinks.tsx';
import {
  rowActions,
  type ActionEnv,
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
  const flock = useFlockMenu(mrx, wantsFlockMenu(mrx, env));
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
      forge={forgeWord(mrx)}
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

/** Only the seat's own MRs on a local board have a flock section. */
function wantsFlockMenu(mr: BoardMR, env: ActionEnv): boolean {
  return env.local && isOwnMr(mr, env.self) && !!mr.webUrl;
}

export { RowMenu, wantsFlockMenu };
