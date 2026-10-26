import { Code, Group, Stack, Text } from '@mattstack/app-kit/core';

import { failureParts, type FailureBlock } from './failureParts';
import classes from './failureText.module.css';

function Block({ block }: { block: FailureBlock }) {
  if (block.kind === 'text') {
    return (
      <Text size="sm" classNames={{ root: classes.wrap }}>
        {block.text}
      </Text>
    );
  }
  return (
    <Stack gap={4}>
      <Text size="xs" ff="monospace" fw={500} classNames={{ root: classes.wrap }}>
        {block.path}
      </Text>
      <Stack gap={4} classNames={{ root: classes.findings }}>
        {block.findings.map((finding, i) => (
          <Group key={i} gap={8} wrap="nowrap" align="baseline">
            {finding.line !== null && (
              <Text
                size="xs"
                ff="monospace"
                c="dimmed"
                classNames={{ root: classes.lineNo }}
              >
                line {finding.line}
              </Text>
            )}
            <Text size="sm" classNames={{ root: classes.wrap }}>
              {finding.text}
            </Text>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
}

/** rt's failure text inside an alert: plain lines as paragraphs, findings
    grouped under the file they name, and the command it suggests set apart
    as code. */
export function FailureText({
  message,
  testId,
}: {
  message: string;
  testId: string;
}) {
  const { blocks, next } = failureParts(message);
  return (
    <>
      <Stack gap={10} data-testid={`${testId}-message`}>
        {blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </Stack>
      {next && (
        <Code
          classNames={{ root: classes.wrap }}
          data-testid={`${testId}-next`}
        >
          {next}
        </Code>
      )}
    </>
  );
}
