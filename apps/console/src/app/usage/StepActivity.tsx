import { Drawer, Group, Loader, Stack, Text } from '@mattstack/app-kit/core';
import type {
  UsageActivityData,
  UsageActivityQuery,
} from '@mattstack/rt-client';

import { clockTime, plural, shortDate, toolName } from './format';
import classes from './StepActivity.module.css';
import { useUsageActivity } from './useUsage';

function Section({
  title,
  shown,
  total,
  children,
}: {
  title: string;
  shown: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <Stack gap={8}>
      <Text fz="md" fw={700} lh="normal">
        {shown < total ? `${title} (first ${shown} of ${total})` : title}
      </Text>
      {children}
    </Stack>
  );
}

function When({ at }: { at: number }) {
  return (
    <Text fz="sm" c="dimmed" lh="normal">
      {`${shortDate(at)}, ${clockTime(at)}`}
    </Text>
  );
}

function ActivityBody({ data }: { data: UsageActivityData }) {
  if (!data.transcriptFound)
    return (
      <Text fz="md" c="dimmed" lh="normal">
        This session&apos;s transcript is gone from this Mac.
      </Text>
    );
  const empty =
    data.prompts.length === 0 &&
    data.agents.length === 0 &&
    data.tools.length === 0;
  if (empty)
    return (
      <Text fz="md" c="dimmed" lh="normal">
        No prompts or tools in this window.
      </Text>
    );
  return (
    <Stack gap={20}>
      {data.prompts.length ? (
        <Section
          title="Prompts"
          shown={data.prompts.length}
          total={data.promptCount}
        >
          {data.prompts.map(prompt => (
            <Stack key={`${prompt.ts}${prompt.text}`} gap={2}>
              <When at={prompt.ts} />
              <Text fz="md" lh="normal" className={classes.prompt}>
                {prompt.text}
              </Text>
            </Stack>
          ))}
        </Section>
      ) : null}
      {data.agents.length ? (
        <Section
          title="Subagents"
          shown={data.agents.length}
          total={data.agentCount}
        >
          {data.agents.map(agent => (
            <Stack key={`${agent.ts}${agent.description}`} gap={2}>
              <When at={agent.ts} />
              <Text fz="md" lh="normal">
                {agent.type
                  ? `${agent.description} (${agent.type})`
                  : agent.description}
              </Text>
            </Stack>
          ))}
        </Section>
      ) : null}
      {data.tools.length ? (
        <Section
          title="Tools"
          shown={data.tools.length}
          total={data.tools.length}
        >
          <Stack gap={4}>
            {data.tools.map(tool => (
              <Group key={tool.name} justify="space-between" gap={12}>
                <Text fz="md" lh="normal">
                  {toolName(tool.name)}
                </Text>
                <Text fz="md" c="dimmed" lh="normal">
                  {plural(tool.count, 'call')}
                </Text>
              </Group>
            ))}
          </Stack>
        </Section>
      ) : null}
    </Stack>
  );
}

/** What a step's session was doing, read from its transcript on open. */
export function StepActivity({
  step,
  onClose,
}: {
  step: { label: string; note?: string; activity: UsageActivityQuery } | null;
  onClose: () => void;
}) {
  const activity = useUsageActivity(step?.activity ?? null);
  return (
    <Drawer
      opened={step !== null}
      onClose={onClose}
      position="right"
      size={640}
      padding={24}
      title={
        <Stack gap={2}>
          <Text fz="lg" fw={700} lh="normal">
            {step?.label}
          </Text>
          {step?.note ? (
            <Text fz="sm" c="dimmed" lh="normal">
              {step.note}
            </Text>
          ) : null}
        </Stack>
      }
      data-testid="step-activity"
    >
      {activity.isError ? (
        <Text fz="md" c="dimmed" lh="normal">
          Can&apos;t read this transcript.
        </Text>
      ) : activity.data ? (
        <ActivityBody data={activity.data} />
      ) : activity.isFetching ? (
        <Loader size="sm" />
      ) : (
        <Text fz="md" c="dimmed" lh="normal">
          No prompts or tools in this window.
        </Text>
      )}
    </Drawer>
  );
}
