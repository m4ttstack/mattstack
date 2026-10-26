import type { ReactNode, Ref } from 'react';
import {
  Alert,
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type { PayloadBlock } from '../../../server/blocksPayload';
import { pluginOf } from '../outline';
import type { SkillsAnatomy } from '../useWiring';
import classes from './graph.module.css';
import { workTypeOf, type FocusItem } from './model/focusModel';
import { splitDescription } from './model/skillDescription';
import { STATUS_TONE, type StatusTone } from './model/statusTone';
import { countOf, type TemplateView } from './model/templateModel';

const MUTED = 'var(--tk-text-3)';

export type HeaderStatus = {
  label: string;
  tone: StatusTone;
  icon: 'checkCircle' | 'circleDot';
};

const GLYPH: Record<StatusTone, string | undefined> = {
  ok: 'var(--tk-text-ok-vivid)',
  quiet: MUTED,
  warn: undefined,
};

/** What kind of skill is in focus, and where it runs. */
export function kindOf(item: FocusItem, pipeline: FocusItem | null): string {
  const workType = pipeline ? workTypeOf(pipeline.key) : null;
  if (pipeline && workType && item.key === pipeline.key)
    return `${workType} pipeline · ${countOf(pipeline.children.length, 'stage', 'stages')}`;
  if (pipeline && workType && item.step !== null)
    return `stage ${item.step} of ${pipeline.children.length} · ${pipeline.skill} · ${workType}`;
  if (item.icon === 'layoutDashboard') return 'board skill';
  return item.icon === 'lock' ? 'internal verb' : 'public verb';
}

/**
 * The status of the rendered file the canvas draws. A view that links to its
 * steps draws no rendered file of its own, so it states none: each step card
 * carries its own.
 */
export function statusOf(
  view: TemplateView | null,
  anatomy: SkillsAnatomy | undefined
): HeaderStatus | null {
  const output = view?.output;
  if (!output || !anatomy) return null;
  const tone = STATUS_TONE[output.status];
  const icon = tone === 'ok' ? 'checkCircle' : 'circleDot';
  switch (output.status) {
    case 'in-sync':
      return {
        label: `in sync with installed ${pluginOf(anatomy.template.ref)} ${anatomy.template.version}`,
        tone,
        icon,
      };
    case 'stale':
      return {
        label: output.reason ? `stale: ${output.reason}` : 'stale',
        tone,
        icon,
      };
    case 'unsynced':
      return { label: 'rebuilt here, not synced yet', tone, icon };
    case 'never-compiled':
      return { label: 'never compiled', tone, icon };
    case 'unknown':
      return { label: 'unmeasured', tone, icon };
  }
}

const BLOCK_KIND_ICON: Record<
  PayloadBlock['kind'],
  'circle' | 'diamond' | 'flag' | 'fileText' | 'package'
> = {
  step: 'circle',
  question: 'diamond',
  gate: 'flag',
  note: 'fileText',
  shared: 'package',
};

/** A tree's top reached through `{{include:…}}`, which rt kinds `shared`,
    is named for the include that brings it in. */
const KIND_WORD: Record<PayloadBlock['kind'], string> = {
  step: 'step',
  question: 'question',
  gate: 'gate',
  note: 'note',
  shared: 'include',
};

/** What the skill is for, then the phrases that call it, when rt's
    description has that shape; otherwise the description whole. */
function Description({ text, inline }: { text: string; inline: boolean }) {
  const { purpose, asks } = splitDescription(text);
  return (
    <Stack gap={6}>
      <Text
        fz={inline ? 15 : 13}
        lh={inline ? 1.5 : 'normal'}
        c={inline ? 'var(--tk-text-2)' : MUTED}
        data-parity="desc"
      >
        {purpose}
      </Text>
      {asks.length > 0 && (
        <div className={classes.asks} data-testid="description-asks">
          <span className={classes.asksLabel}>Asked as</span>
          {asks.map(ask => (
            <span key={ask} className={classes.ask}>
              “{ask}”
            </span>
          ))}
        </div>
      )}
    </Stack>
  );
}

function BlockChips({ block }: { block: HeaderBlock }) {
  const blocks =
    block.blocks === undefined
      ? null
      : `${block.blocks} ${block.blocks === 1 ? 'block' : 'blocks'}`;
  return (
    <>
      <Badge
        variant="panel-outline"
        classNames={{ root: classes.chip, section: classes.pillIcon }}
        leftSection={<Icon name={BLOCK_KIND_ICON[block.kind]} size={10} />}
        data-hue={block.kind}
        data-testid="block-kind"
      >
        {blocks
          ? `${KIND_WORD[block.kind]} · ${blocks}`
          : KIND_WORD[block.kind]}
      </Badge>
      {block.hasProps && (
        <Badge
          variant="panel-outline"
          classNames={{ root: classes.chip, section: classes.pillIcon }}
          leftSection={<Icon name="plug" size={10} />}
          data-testid="block-has-props"
        >
          has props
        </Badge>
      )}
    </>
  );
}

export type HeaderBlock = {
  kind: PayloadBlock['kind'];
  hasProps: boolean;
  /** A parent's count of the blocks inside it. */
  blocks?: number;
};

export function FocusHeader({
  ref,
  title,
  kind,
  description,
  status,
  checkError = null,
  block = null,
  actions = null,
  inline = false,
  meta = null,
}: {
  /** A line under the description: the block view's pack and counts. */
  meta?: ReactNode;
  ref?: Ref<HTMLDivElement>;
  title: string;
  /** The skill's kind in words; null on a block, which shows `block`'s chips. */
  kind: string | null;
  description: string | null;
  status: HeaderStatus | null;
  /** Why `rt skills check` failed; the status it would have given is then
      unknown, so none is drawn. */
  checkError?: string | null;
  block?: HeaderBlock | null;
  actions?: ReactNode;
  /** In the block view's column instead of floating over a canvas. */
  inline?: boolean;
}) {
  const statusBadge = status && checkError === null && (
    <Badge
      variant={status.tone === 'warn' ? 'hue-outline' : 'quiet-outline'}
      color={status.tone === 'warn' ? 'warn' : undefined}
      classNames={{
        root: classes.statusPill,
        section: classes.pillIcon,
      }}
      leftSection={
        <Icon
          name={status.icon}
          size={12}
          color={GLYPH[status.tone]}
          data-parity="i"
        />
      }
      data-parity="status · engine behind"
      data-testid="focus-status"
      attributes={{ label: { 'data-parity': 'l' } }}
    >
      {status.label}
    </Badge>
  );
  return (
    <Paper
      ref={ref}
      withBorder={!inline}
      radius="md"
      bg={inline ? 'transparent' : undefined}
      className={inline ? classes.inlineHeader : classes.header}
      data-parity="Focus header"
      data-testid="focus-header"
    >
      <Stack gap={6}>
        <Group
          gap={10}
          justify="space-between"
          wrap={inline ? 'wrap' : undefined}
        >
          <Group
            gap={10}
            className={inline ? classes.inlineTitleRow : undefined}
          >
            <Title order={3} fz={inline ? 24 : 20} lh="normal">
              <Text span inherit c="var(--tk-text-1)" data-parity="title">
                {title}
              </Text>
            </Title>
            {kind !== null && (
              <Badge
                variant={inline ? 'panel-outline' : 'quiet'}
                classNames={{ root: inline ? classes.chip : classes.pill }}
                data-parity="badge"
                attributes={{ label: { 'data-parity': 'l' } }}
              >
                {kind}
              </Badge>
            )}
            {block && <BlockChips block={block} />}
            {actions !== null && statusBadge}
          </Group>
          {actions ?? statusBadge}
        </Group>
        {description ? (
          <Description text={description} inline={inline} />
        ) : null}
        {meta}
        {checkError !== null && (
          <Alert
            variant="light"
            color="warn"
            icon={<Icon name="warning" size={14} />}
            classNames={{ root: classes.statusAlert }}
            data-testid="status-unavailable"
          >
            <Text size="xs">Status unavailable: {checkError}</Text>
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
