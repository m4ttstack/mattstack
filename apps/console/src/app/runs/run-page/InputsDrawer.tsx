import { useCallback } from 'react';
import { Drawer } from '@mattstack/app-kit/core';
import type { RunDecisionRow } from '@mattstack/rt-client';
import { useLocation, useSearch } from 'wouter';

import { EffectiveInputs } from '../EffectiveInputs';

const PARAM = 'inputs';

/** Whether the drawer is open, kept in the URL as `?inputs` so a reload or a
    link reopens it. */
export function useInputsDrawer() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const opened = new URLSearchParams(search).has(PARAM);
  const set = useCallback(
    (open: boolean) => {
      const params = new URLSearchParams(search);
      if (open) params.set(PARAM, '');
      else params.delete(PARAM);
      const qs = params.toString().replace(/=(?=&|$)/g, '');
      navigate(qs ? `${location}?${qs}` : location, { replace: true });
    },
    [search, location, navigate]
  );
  return {
    opened,
    open: useCallback(() => set(true), [set]),
    close: useCallback(() => set(false), [set]),
  };
}

export function InputsDrawer({
  repo,
  runId,
  decisions,
  opened,
  onClose,
}: {
  repo: string;
  runId: string;
  decisions: RunDecisionRow[];
  opened: boolean;
  onClose: () => void;
}) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      title="Effective inputs"
      data-testid="inputs-drawer"
    >
      {opened ? (
        <EffectiveInputs repo={repo} runId={runId} decisions={decisions} />
      ) : null}
    </Drawer>
  );
}
