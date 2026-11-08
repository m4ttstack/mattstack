import { Drawer, Group, Loader, Stack, Text } from '@mattstack/app-kit/core';
import type {
  UsageActivityData,
  UsageActivityQuery,
  UsageTotals,
} from '@mattstack/rt-client';

import { clockTime, plural, shortDate, toolName, usd } from './format';
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
      <Text fz="md" fw={500} lh="normal">
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

function Gone({ children }: { children: React.ReactNode }) {
  return (
    <Text fz="md" c="dimmed" lh="normal" data-testid="transcript-gone">
      {children}
    </Text>
  );
}

/** Claude Code deletes old transcripts, so a row's cost can outlive the
    record of what it did. */
export function ActivityBody({ data }: { data: UsageActivityData }) {
  if (!data.transcriptFound)
    return (
      <Gone>
        This step&apos;s transcript is no longer on this Mac, so what it did
        can&apos;t be shown. Its cost and token counts still stand.
      </Gone>
    );
  const missing = data.sessionsMissing;
  const partial =
    missing > 0 ? (
      <Gone>
        {`${plural(missing, 'session')} in this step ${missing === 1 ? 'has' : 'have'} no transcript left, so this list may be short.`}
      </Gone>
    ) : null;
  const empty =
    data.prompts.length === 0 &&
    data.agents.length === 0 &&
    data.tools.length === 0;
  if (empty)
    return (
      <Stack gap={12}>
        {partial}
        <Text fz="md" c="dimmed" lh="normal" data-testid="activity-empty">
          No prompts or tools in this window.
        </Text>
      </Stack>
    );
  return (
    <Stack gap={20}>
      {partial}
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
  opened,
  onClose,
}: {
  step: {
    label: string;
    note?: string;
    activity: UsageActivityQuery;
    totals: UsageTotals;
  } | null;
  opened: boolean;
  onClose: () => void;
}) {
  const activity = useUsageActivity(step?.activity ?? null);
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={640}
      padding={24}
      title={
        <Stack gap={2}>
          <Text fz="lg" fw={500} lh="normal">
            {step?.label}
          </Text>
          {step ? (
            <Text fz="sm" c="dimmed" lh="normal" data-testid="step-figures">
              {`${usd(step.totals.cost)}, ${plural(step.totals.messages, 'message')}`}
            </Text>
          ) : null}
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
