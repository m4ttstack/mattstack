import { useState } from 'react';
import { Button, Code, Popover, Stack, Text } from '@mattstack/app-kit/core';

import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../server/blocksPayload';
import { buildBlockContext } from './model/brief';

export interface CopyForClaudeProps {
  payload: BlocksPayload;
  block: PayloadBlock;
}

export function CopyForClaude({ payload, block }: CopyForClaudeProps) {
  const [state, setState] = useState<'closed' | 'copied' | 'failed'>('closed');
  const brief = buildBlockContext({ payload, block });

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
      shadow="md"
      width={440}
      withinPortal
    >
      <Popover.Target>
        <Button onClick={copy}>Copy for Claude</Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text fw={500}>
            {state === 'copied'
              ? 'Copied. Paste it into Claude'
              : 'Could not copy. Select the text below and copy it by hand'}
          </Text>
          <Code block>{brief}</Code>
          <Text c="dimmed" fz="sm">
            Add what you want changed after the last line
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
