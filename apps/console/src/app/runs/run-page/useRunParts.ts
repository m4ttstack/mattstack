import { useCallback } from 'react';
import { useClipboard, useHotkeys } from '@mattstack/app-kit/hooks';
import { notifications } from '@mattstack/app-kit/notifications';
import type { RunDetail } from '@mattstack/rt-client';

import { useEditorHref } from '../../editorHref';
import { nowOf } from '../derive/clock';
import { filePath } from '../derive/fields';
import { inputsSummary } from '../derive/inputs';
import { runKind, runTitle } from '../derive/kind';
import { runPageFacts } from '../derive/page';
import { decisionEntries, liveStory, runBlock } from '../derive/story';
import { useEffectiveInputs } from '../EffectiveInputs';
import { useLinearWorkspace, useRunsEnrich } from '../useRuns';
import { useInputsDrawer } from './InputsDrawer';
import type { FactProps, SideCardsProps } from './SideCards';
import { useRunGates } from './useRunGates';

export type RunPageData = RunDetail & {
  asOf?: number;
  boardUrl?: string | null;
};

/** What the live page and the record both read from a run: its gates and
    enrichment, the page facts, the story, the side card rows, the inputs
    drawer and the copy hotkeys. */
export function useRunParts(repo: string, runId: string, data: RunPageData) {
  const { run, stages, fields, decisions } = data;
  const now = nowOf(data);
  const kind = runKind(run.work_type);
  const { gates } = useRunGates(runId);
  const enrich = useRunsEnrich(run.branch ? [run.branch] : []);
  const enrichment = run.branch ? enrich.data?.[run.branch] : undefined;
  const workspace = useLinearWorkspace().data ?? null;
  const editorHref = useEditorHref();
  const drawer = useInputsDrawer();
  const inputs = useEffectiveInputs(repo, runId);
  const clipboard = useClipboard();

  const worktreePath = fields.find(f => f.key === 'worktree')?.value ?? null;
  const pathHref = useCallback(
    (path: string) => {
      const abs = filePath(path, worktreePath);
      return abs ? editorHref(abs) : null;
    },
    [editorHref, worktreePath]
  );

  const facts = runPageFacts({
    repo,
    runId,
    run,
    stages,
    fields,
    gates,
    kind,
    enrichment,
    workspace,
    now,
  });

  const storyInput = { stages, fields, decisions, gates, run, now };
  const story = kind === 'work' ? liveStory(storyInput) : null;
  const block = kind === 'work' ? null : runBlock(storyInput);

  const factRows: FactProps[] = [
    {
      name: 'MR',
      label: facts.mr.label,
      icon: 'gitPullRequest',
      iconLayer: 'git-pull-request',
      value: facts.mr.value,
      empty: 'not opened yet',
      href: facts.mr.url,
      hotkey: 'm',
      copy: facts.copies.mr,
      sub: facts.mr.sub,
    },
    {
      name: 'Branch',
      label: 'Branch',
      icon: 'gitBranch',
      iconLayer: 'git-branch',
      value: facts.branch.value,
      empty: 'not recorded',
      hotkey: 'b',
      sub: facts.branch.sub,
    },
    {
      name: 'Worktree',
      label: 'Worktree',
      icon: 'folder',
      iconLayer: 'folder',
      value: facts.worktree.value,
      empty: 'not recorded',
      hotkey: 'w',
      copy: facts.worktree.path,
      sub: facts.worktree.sub,
    },
  ];

  const copyKeys: [string, string, string | null][] = [
    ['t', 'ticket', facts.copies.ticket],
    ['b', 'branch', facts.copies.branch],
    ['w', 'worktree', facts.copies.worktree],
    ['m', 'MR', facts.copies.mr],
    ['c', 'commits', facts.copies.commits],
  ];
  useHotkeys(
    copyKeys.map(([key, label, value]) => [
      key,
      () => {
        if (!value) return;
        clipboard.copy(value);
        notifications.success(`Copied ${label}`);
      },
    ])
  );

  const summary = inputs.data ? inputsSummary(inputs.data) : null;
  const sideInputs: SideCardsProps['inputs'] = summary
    ? { state: 'ready', ...summary }
    : inputs.isError
      ? { state: 'error' }
      : { state: 'loading' };

  return {
    now,
    kind,
    gates,
    enrichment,
    facts,
    story,
    block,
    factRows,
    sideInputs,
    decisionEntries: decisionEntries(gates, stages),
    evidenceField: fields.find(f => f.key === 'evidence') ?? null,
    title: runTitle(run, { ticketTitle: enrichment?.ticket?.title }),
    pathHref,
    drawer,
  };
}
