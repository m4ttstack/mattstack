import { Anchor, Code, Group, Spoiler, Text } from '@mattstack/app-kit/core';

import { fieldKind } from '../derive/run';

const SHORT_SHA = 7;

/** The story's value type: 12.5px on an 18px line. */
const VALUE_TYPE = { fz: 12.5, lh: '18px' } as const;

export interface FieldValueProps {
  fieldKey: string;
  value: string;
  /** Where a file path opens, or null to show it as text. */
  pathHref?: (path: string) => string | null;
  'data-parity'?: string;
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/** One run field's value, drawn by what the value is: a link, a file path, a
    list of commit shas, a collapsed JSON block, a gate reference or plain
    text. */
export function FieldValue({
  fieldKey,
  value,
  pathHref,
  'data-parity': parity,
}: FieldValueProps) {
  const kind = fieldKind(fieldKey, value);
  const v = value.trim();

  switch (kind) {
    case 'cleared':
      return (
        <Text {...VALUE_TYPE} c="dimmed" data-kind={kind} data-parity={parity}>
          cleared
        </Text>
      );
    case 'url':
      return (
        <Anchor
          {...VALUE_TYPE}
          c="accent"
          href={v}
          target="_blank"
          rel="noopener noreferrer"
          data-kind={kind}
          data-parity={parity}
        >
          {v}
        </Anchor>
      );
    case 'path': {
      const href = pathHref?.(v) ?? null;
      return href ? (
        <Anchor
          {...VALUE_TYPE}
          c="accent"
          href={href}
          data-kind={kind}
          data-parity={parity}
        >
          {v}
        </Anchor>
      ) : (
        <Text {...VALUE_TYPE} data-kind={kind} data-parity={parity}>
          {v}
        </Text>
      );
    }
    case 'sha-list':
      return (
        <Group gap="xs" data-kind={kind} data-parity={parity}>
          {v.split(/\s+/).map((sha, i) => (
            <Code key={`${sha}-${i}`} title={sha}>
              {sha.slice(0, SHORT_SHA)}
            </Code>
          ))}
        </Group>
      );
    case 'json':
      return (
        <Spoiler
          maxHeight={72}
          showLabel="Show more"
          hideLabel="Show less"
          data-kind={kind}
          data-parity={parity}
        >
          <Code block>{prettyJson(v)}</Code>
        </Spoiler>
      );
    case 'gate-ref':
      return (
        <Text
          {...VALUE_TYPE}
          c="dimmed"
          ff="monospace"
          data-kind={kind}
          data-muted="true"
          data-parity={parity}
        >
          {v}
        </Text>
      );
    case 'text':
      return (
        <Text {...VALUE_TYPE} data-kind={kind} data-parity={parity}>
          {value}
        </Text>
      );
  }
}
