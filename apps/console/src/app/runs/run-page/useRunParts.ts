import { useCallback } from 'react';
import type { RunDetail } from '@mattstack/rt-client';

import { useEditorHref } from '../../editorHref';
import { nowOf } from '../derive/clock';
import { filePath } from '../derive/fields';
import { inputsSummary } from '../derive/inputs';
import { enrichedRunTitle, runKind } from '../derive/kind';
import { runPageFacts } from '../derive/page';
import { liveStory, runBlock } from '../derive/story';
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
    enrichment, the page facts, the story, the side card rows and the inputs
    drawer. */
export function useRunParts(repo: string, runId: string, data: RunPageData) {
  const { run, stages, fields, decisions } = data;
  const now = nowOf(data);
  const kind = runKind(run.work_type);
  const { gates, failed: gatesFailed, retry: retryGates } = useRunGates(runId);
  const enrich = useRunsEnrich(run.branch ? [run.branch] : []);
  const enrichment = run.branch ? enrich.data?.[run.branch] : undefined;
  const workspace = useLinearWorkspace().data ?? null;
  const editorHref = useEditorHref();
  const drawer = useInputsDrawer();
  const inputs = useEffectiveInputs(repo, runId);

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
      copy: facts.mr.url ?? facts.mr.value,
      sub: facts.mr.sub,
    },
    {
      name: 'Branch',
      label: 'Branch',
      icon: 'gitBranch',
      iconLayer: 'git-branch',
      value: facts.branch.value,
      empty: 'not recorded',
      sub: facts.branch.sub,
    },
    {
      name: 'Worktree',
      label: 'Worktree',
      icon: 'folder',
      iconLayer: 'folder',
      value: facts.worktree.value,
      empty: 'not recorded',
      copy: facts.worktree.path,
      sub: facts.worktree.sub,
    },
  ];

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
    gatesFailed,
    retryGates,
    enrichment,
    facts,
    story,
    block,
    factRows,
    sideInputs,
    evidenceField: fields.find(f => f.key === 'evidence') ?? null,
    title: enrichedRunTitle(
      run,
      enrichment,
      fields.find(f => f.key === 'mr')?.value
    ),
    pathHref,
    drawer,
  };
}
