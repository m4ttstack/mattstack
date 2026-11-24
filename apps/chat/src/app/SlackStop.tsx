import { useState } from 'react';

import { Button, Group, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { notifications } from '@mattstack/app-kit/notifications';

import { useRefreshSlackChats, type SlackChat } from './slack-chats-context';

type Step = 'rest' | 'asking' | 'stopping' | 'told' | 'not-told';

async function stopChat(conversation: number): Promise<{ told: boolean }> {
  const res = await fetch('/api/chat/slack-stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    told?: boolean;
    error?: string;
  };
  if (!res.ok)
    throw new Error(body.error ?? `The server answered ${res.status}`);
  return { told: body.told === true };
}

/** Ends a live Slack chat at once, asked about once and in place. Keep it
    mounted after the chat closes: it says whether the teammate was told. */
export function SlackStop({ chat, live }: { chat: SlackChat; live: boolean }) {
  const refresh = useRefreshSlackChats();
  const [step, setStep] = useState<Step>('rest');
  const name =
    chat.displayName?.trim().split(/\s+/)[0] || chat.name || 'your teammate';

  const stop = async () => {
    if (chat.id === undefined) return;
    setStep('stopping');
    try {
      const { told } = await stopChat(chat.id);
      setStep(told ? 'told' : 'not-told');
      refresh();
    } catch (err) {
      setStep('rest');
      refresh();
      notifications.error(
        `Couldn't stop the chat: ${err instanceof Error ? err.message : 'no answer from the server'}`
      );
    }
  };

  if (step === 'told' || step === 'not-told')
    return (
      <Text
        size="sm"
        role="status"
        c={step === 'told' ? 'dimmed' : 'gold'}
        data-testid="slack-stopped"
      >
        {step === 'told'
          ? `Stopped. ${name} was told`
          : `Stopped. ${name} was not told, check the DM`}
      </Text>
    );
  if (chat.id === undefined || !live) return null;
  if (step === 'rest')
    return (
      <Button
        variant="default"
        c="bad"
        leftSection={<Icon name="circleStop" size={14} />}
        onClick={() => setStep('asking')}
        data-testid="slack-stop"
      >
        Stop
      </Button>
    );
  return (
    <Group gap="sm" wrap="nowrap" data-testid="slack-stop-ask">
      <Text size="sm" c="dimmed" truncate>
        Ends it now. {name}'s next request waits for you
      </Text>
      <Button
        variant="default"
        onClick={() => setStep('rest')}
        disabled={step === 'stopping'}
      >
        Cancel
      </Button>
      <Button color="bad" loading={step === 'stopping'} onClick={stop}>
        Stop chat
      </Button>
    </Group>
  );
}
