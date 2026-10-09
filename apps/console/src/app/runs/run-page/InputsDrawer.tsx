import { useCallback } from 'react';
import { Drawer, Stack, Text } from '@mattstack/app-kit/core';
import type { RunDecisionRow } from '@mattstack/rt-client';
import { useLocation, useSearch } from 'wouter';

import { EffectiveInputs, INPUTS_SUB } from '../EffectiveInputs';
import classes from './InputsDrawer.module.css';

const PARAM = 'inputs';
const DOC_PARAM = 'doc';

/** Whether the drawer is open, kept in the URL as `?inputs` so a reload or a
    link reopens it. Opening it closes the stage doc drawer. */
export function useInputsDrawer() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const opened = new URLSearchParams(search).has(PARAM);
  const set = useCallback(
    (open: boolean) => {
      const params = new URLSearchParams(search);
      params.delete(DOC_PARAM);
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
      size={640}
      padding={24}
      classNames={{ header: classes.header, body: classes.body }}
      title={
        <Stack gap={4}>
          <Text fz={17} fw={700} lh="normal" data-parity="title">
            Effective inputs
          </Text>
          <Text fz={13} lh="normal" c="dimmed" data-parity="sub">
            {INPUTS_SUB}
          </Text>
        </Stack>
      }
      data-testid="inputs-drawer"
      attributes={{
        content: { 'data-parity': 'Drawer' },
        header: { 'data-parity': 'head' },
        close: { 'data-parity': 'close' },
      }}
    >
      {opened ? (
        <EffectiveInputs repo={repo} runId={runId} decisions={decisions} />
      ) : null}
    </Drawer>
  );
}
