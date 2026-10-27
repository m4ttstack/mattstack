import type { KeyboardEvent, ReactNode } from 'react';
import {
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import type { MantineColor } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

import { looseEnd, spineRows, type WiringSpine } from './outline';
import { QuietBadge } from './QuietBadge';
import { SOFT_RULE } from './softRule';
import type { SkillsCheckPayload } from './useWiring';

type SkillsCheckAttachment = NonNullable<
  SkillsCheckPayload['attachments']
>[number];

/**
 * `check` and the binder graph answer two independent questions -- "did the
 * source drift" and "does anything bind this" -- so a verb can land in both
 * `staleEntries`/`neverCompiledEntries` AND `unwiredEntries` at once, and
 * nothing here dedupes across that overlap.
 */
export function computeHealthGroups(spine: WiringSpine) {
  const all = spineRows(spine);
  const staleEntries = all.filter(entry => entry.health === 'source-newer');
  const neverCompiledEntries = all.filter(
    entry => entry.health === 'never-compiled'
  );
  const unwiredEntries = spine.outside.filter(looseEnd);

  return {
    inSyncCount: all.filter(entry => entry.health === 'in-sync').length,
    staleEntries,
    neverCompiledEntries,
    unwiredEntries,
    // Fills nothing binds.
    orphanFills: spine.orphans,
  };
}

export function baseCopyWhy(copy: SkillsCheckAttachment): string {
  return copy.base === null
    ? 'orphaned · compile removes it'
    : `from ${copy.base} · ${copy.status}`;
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}

interface HealthIssueRowProps {
  testId: string;
  name: string;
  reference: string | null;
  why?: string;
  /** Free-form text (an rt error with paths or git output) takes the whole
      row and wraps, instead of the fixed-width name column the group's
      `overflow: hidden` would clip. */
  wrapName?: boolean;
  /** A row with somewhere to go opens it; without it the row is a plain,
      non-interactive line (no button, no chevron). */
  onOpen?: () => void;
  /** Only the recompile/never-compiled groups offer this -- Unwired rows
      have nothing to preview compiling. */
  onPreviewCompile?: () => void;
}

export function HealthIssueRow({
  testId,
  name,
  reference,
  why,
  wrapName,
  onOpen,
  onPreviewCompile,
}: HealthIssueRowProps) {
  const { bg, text, border } = useSchemeColors();

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onOpen) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <Group
      gap={11}
      align="center"
      wrap="nowrap"
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? handleKeyDown : undefined}
      aria-label={onOpen ? `open ${name}` : undefined}
      style={{ padding: '11px 16px', cursor: onOpen ? 'pointer' : 'default' }}
      data-testid={`health-row-${testId}`}
    >
      <Text
        fz={13}
        fw={wrapName ? 400 : 700}
        style={
          wrapName
            ? { flex: 1, minWidth: 0, overflowWrap: 'anywhere' }
            : { flex: 'none' }
        }
      >
        {name}
      </Text>
      {reference && (
        <Text fz={11} c={text.muted} truncate style={{ flex: 'none' }}>
          {reference}
        </Text>
      )}
      {!wrapName && <div style={{ flex: 1, minWidth: 0 }} />}
      {why && (
        <Text
          fz={11}
          c={text.muted}
          truncate
          style={{ flex: 'none', maxWidth: 260 }}
        >
          {why}
        </Text>
      )}
      {onPreviewCompile && (
        <UnstyledButton
          type="button"
          onClick={event => {
            event.stopPropagation();
            onPreviewCompile();
          }}
          data-testid={`health-preview-compile-${testId}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 26,
            padding: '0 10px',
            border: `1px solid ${border.default}`,
            borderRadius: 7,
            background: bg.level3,
            fontSize: 11,
            flex: 'none',
          }}
        >
          <Icons.zap size={13} color={text.muted} aria-hidden />
          Preview compile
        </UnstyledButton>
      )}
      {onOpen && (
        <Icons.chevronRight
          size={16}
          color={text.muted}
          aria-hidden
          style={{ flex: 'none' }}
        />
      )}
    </Group>
  );
}

interface HealthGroupCardProps<T> {
  title: string;
  /** `null` renders the neutral pill (Unwired, informational) via
      `QuietBadge` instead of a tinted `Badge`. */
  intent: MantineColor | null;
  caption: string;
  entries: T[];
  getKey: (entry: T) => string;
  renderRow: (entry: T) => ReactNode;
}

export function HealthGroupCard<T>({
  title,
  intent,
  caption,
  entries,
  getKey,
  renderRow,
}: HealthGroupCardProps<T>) {
  const { bg, text } = useSchemeColors();
  const dotColor = intent ? text.highContrast(intent) : text.muted;

  return (
    <Paper
      variant="ground"
      withBorder
      radius="xl"
      style={{ overflow: 'hidden' }}
      data-testid={`health-group-${slugify(title)}`}
    >
      <Group
        gap={9}
        align="center"
        wrap="nowrap"
        bg={bg.level3}
        // Health.dc.html `.grouphead` padding (13px 16px) has no matching
        // spacing step at this theme's scale.
        style={{ padding: '13px 16px', borderBottom: `1px solid ${SOFT_RULE}` }}
      >
        <div
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flex: 'none',
            background: dotColor,
          }}
        />
        <Text fz={12.5} fw={700} style={{ flex: 'none' }}>
          {title}
        </Text>
        {intent ? (
          <Badge
            size="xs"
            variant="light"
            color={intent}
            radius="xl"
            style={{ flex: 'none' }}
            data-testid={`health-group-count-${slugify(title)}`}
          >
            {entries.length}
          </Badge>
        ) : (
          <QuietBadge>{entries.length}</QuietBadge>
        )}
        <div style={{ flex: 1 }} />
        <Text fz={11} c={text.muted} style={{ flex: 'none' }}>
          {caption}
        </Text>
      </Group>
      <Stack gap={0}>
        {entries.map((entry, i) => (
          <div
            key={getKey(entry)}
            style={
              i === 0 ? undefined : { borderTop: `1px solid ${SOFT_RULE}` }
            }
          >
            {renderRow(entry)}
          </div>
        ))}
      </Stack>
    </Paper>
  );
}
