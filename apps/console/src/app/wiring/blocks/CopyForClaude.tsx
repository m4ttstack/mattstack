import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Group, Popover, Stack, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../server/blocksPayload';
import classes from './blocks.module.css';
import { buildBlockContext } from './model/brief';

export interface CopyForClaudeProps {
  payload: BlocksPayload;
  block: PayloadBlock;
  /** The header actions after the button; the popover lines up with their
      end. */
  trailing?: ReactNode;
}

export function CopyForClaude({
  payload,
  block,
  trailing,
}: CopyForClaudeProps) {
  const [state, setState] = useState<'closed' | 'copied' | 'failed'>('closed');
  const brief = buildBlockContext({ payload, block });
  const lines = brief.split('\n');
  const last = lines.pop();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <Popover
      opened={state !== 'closed'}
      onChange={opened => !opened && setState('closed')}
      position="bottom-end"
      offset={30}
      shadow="md"
      width={460}
      withinPortal
    >
      <Popover.Target>
        <Group gap={10} wrap="nowrap">
          <Button onClick={copy} leftSection={<Icon name="copy" size={14} />}>
            Copy for Claude
          </Button>
          {trailing}
        </Group>
      </Popover.Target>
      <Popover.Dropdown className={classes.briefPopover}>
        <Stack gap={10}>
          <Group gap={8} wrap="nowrap">
            <Icon
              name={state === 'copied' ? 'check' : 'warning'}
              size={14}
              className={classes.briefCopied}
              data-state={state}
              aria-hidden
            />
            <Text fz={14} fw={500} c="var(--tk-text-1)">
              {state === 'copied'
                ? 'Copied. Paste it into Claude'
                : 'Could not copy. Select the text below and copy it by hand'}
            </Text>
          </Group>
          <pre className={classes.brief} data-testid="brief">
            {lines.join('\n')}
            {'\n'}
            <span className={classes.briefAsk}>{last}</span>
          </pre>
          <Text c="dimmed" fz={13}>
            Add what you want changed after the last line
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
