import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Divider,
  Group,
  Menu,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useHotkeys } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type {
  EvidenceCase,
  EvidenceTheme,
} from '@mattstack/rt-client/evidence';
import { useLocation, useSearch } from 'wouter';

import classes from './EvidenceCompare.module.css';
import { EvidenceImage } from './EvidenceImage';
import {
  addressOf,
  evidenceTitle,
  evidenceUrl,
  headLabel,
  isCompareMode,
  isTheme,
  MODE_LABEL,
  PHASE_LABEL,
  shotIn,
  shotLine,
  shownName,
  slotsOf,
  themesIn,
  type CompareMode,
  type EvidenceCases,
  type EvidencePhase,
  type EvidenceVariant,
  type ShotAddress,
} from './evidenceImages';
import { ShotLine } from './ShotLine';

/** Where the compare modal opens: the mode, the variant a thumbnail showed,
    and the case and theme. Empty opens the first case side by side, annotated. */
export interface CompareOpen {
  mode?: CompareMode;
  variant?: EvidenceVariant;
  caseId?: string;
  theme?: EvidenceTheme;
}

/** What the modal shows now, which the page writes back into the link. */
export interface CompareShown {
  caseId: string;
  mode: CompareMode;
  theme?: EvidenceTheme;
}

const COMPARE_PARAM = 'compare';
const CASE_PARAM = 'case';
const THEME_PARAM = 'theme';

/** `?compare=<mode>&case=<id>&theme=<theme>` on a record: what a link asks
    for, a way to keep the link in step with the modal, and a way to drop it
    once the modal closes. */
export function useCompareLink() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const asked = params.get(COMPARE_PARAM);
  const theme = params.get(THEME_PARAM);
  const open: CompareOpen | null = isCompareMode(asked)
    ? {
        mode: asked,
        caseId: params.get(CASE_PARAM) ?? undefined,
        theme: isTheme(theme) ? theme : undefined,
      }
    : null;
  const write = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      navigate(qs ? `${location}?${qs}` : location, { replace: true });
    },
    [location, navigate]
  );
  const clear = useCallback(() => {
    const next = new URLSearchParams(search);
    if (!next.has(COMPARE_PARAM)) return;
    for (const k of [COMPARE_PARAM, CASE_PARAM, THEME_PARAM]) next.delete(k);
    write(next);
  }, [search, write]);
  const sync = useCallback(
    (shown: CompareShown) => {
      const next = new URLSearchParams(search);
      if (!next.has(COMPARE_PARAM)) return;
      next.set(COMPARE_PARAM, shown.mode);
      next.set(CASE_PARAM, shown.caseId);
      if (shown.theme) next.set(THEME_PARAM, shown.theme);
      else next.delete(THEME_PARAM);
      if (next.toString() !== new URLSearchParams(search).toString())
        write(next);
    },
    [search, write]
  );
  return { open, asked, clear, sync };
}

/** Evidence full size: the kit modal less a margin; a pager and the title
    on the left of its head, any control beside the close button, and the
    images on an inset stage. */
export function EvidenceModal({
  title,
  pager,
  controls,
  onClose,
  parityRoot,
  children,
}: {
  title: ReactNode;
  pager?: ReactNode;
  controls?: ReactNode;
  onClose: () => void;
  /** The parity root this modal is compared as, when a board draws it. */
  parityRoot?: string;
  children: ReactNode;
}) {
  return (
    <Modal.Root opened onClose={onClose} size="calc(100vw - 48px)">
      <Modal.Overlay />
      <Modal.Content data-parity={parityRoot}>
        <div data-parity={parityRoot ? 'modal' : undefined}>
          <Modal.Header className={classes.head} data-parity="head">
            <Group gap={10} wrap="nowrap" miw={0}>
              {pager}
              <Modal.Title className={classes.title} data-parity="t">
                {title}
              </Modal.Title>
            </Group>
            <Group gap={10} wrap="nowrap">
              {controls}
              <Modal.CloseButton aria-label="Close" />
            </Group>
          </Modal.Header>
          <Divider />
          <Modal.Body className={classes.body}>
            <div className={classes.stage} tabIndex={-1} data-autofocus>
              {children}
            </div>
          </Modal.Body>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}

/** One image full size at its own aspect ratio, framed by its own edge so it
    never meets the stage's border; a caption below wraps to its width. */
export function EvidenceFrame({
  src,
  name,
  caption,
}: {
  src: string;
  name: string;
  caption?: ReactNode;
}) {
  return (
    <div className={classes.figure}>
      <div className={classes.shot} data-parity="img">
        <EvidenceImage
          src={src}
          name={name}
          maxHeight={caption ? 'var(--shot-max-captioned)' : 'var(--shot-max)'}
        />
      </div>
      {caption ? <div className={classes.caption}>{caption}</div> : null}
    </div>
  );
}

export interface PagerItem {
  value: string;
  label: string;
}

/** Several items one at a time in an evidence modal: previous and next
    around the count, and a title that names the item shown and opens a list
    of every item to jump to, after an optional prefix. The arrow keys step
    too. Null for a single item. */
export function usePager({
  items,
  value,
  onChange,
  noun,
  prefix,
}: {
  items: PagerItem[];
  value: string;
  onChange: (value: string) => void;
  noun: string;
  prefix?: string | null;
}) {
  const at = Math.max(
    0,
    items.findIndex(x => x.value === value)
  );
  const count = items.length;
  const step = (by: number) => {
    const next = items[at + by];
    if (next) onChange(next.value);
  };
  useHotkeys([
    ['ArrowLeft', () => step(-1)],
    ['ArrowRight', () => step(1)],
  ]);
  if (count < 2) return null;
  const shown = items[at]!;
  return {
    pager: (
      <ActionIcon.Group data-parity="pager">
        <ActionIcon
          variant="default"
          size="input-xs"
          aria-label={`Previous ${noun}`}
          disabled={at === 0}
          onClick={() => step(-1)}
        >
          <Icon name="chevronLeft" size={16} />
        </ActionIcon>
        <ActionIcon.GroupSection
          variant="default"
          size="input-xs"
          className={classes.count}
        >
          {at + 1} / {count}
        </ActionIcon.GroupSection>
        <ActionIcon
          variant="default"
          size="input-xs"
          aria-label={`Next ${noun}`}
          disabled={at === count - 1}
          onClick={() => step(1)}
        >
          <Icon name="chevronRight" size={16} />
        </ActionIcon>
      </ActionIcon.Group>
    ),
    title: (
      <Group gap={8} wrap="nowrap" miw={0}>
        {prefix ? (
          <>
            <Text span fz="sm" fw={500} c="dimmed" data-parity="ticket">
              {prefix}
            </Text>
            <Text span fz="sm" c="dimmed" data-parity="sep">
              /
            </Text>
          </>
        ) : null}
        <Menu position="bottom-start" withinPortal>
          <Menu.Target>
            <UnstyledButton className={classes.pick}>
              <Text span className={classes.pickLabel} data-parity="case">
                {shown.label}
              </Text>
              <Icon name="chevronsUpDown" size={14} />
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown className={classes.pickList}>
            {items.map(x => (
              <Menu.Item
                key={x.value}
                onClick={() => onChange(x.value)}
                rightSection={
                  x.value === shown.value ? (
                    <Icon name="check" size={14} />
                  ) : null
                }
              >
                {x.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Group>
    ),
  };
}

export interface EvidenceCompareProps extends CompareOpen {
  repo: string;
  runId: string;
  record: EvidenceCases;
  /** The run's ticket, which heads the modal. */
  ticket?: string | null;
  onClose: () => void;
  /** Called with what the modal shows, on open and on every change. */
  onShow?: (shown: CompareShown) => void;
  /** Where a shot's image loads from; the run's evidence route by default. */
  srcOf?: (address: ShotAddress) => string;
}

function modesOf(c: EvidenceCase): CompareMode[] {
  const phases = slotsOf(c);
  return phases.length > 1 ? [...phases, 'side'] : phases;
}

/** The evidence full size: one case at a time, Before, After, or both side
    by side, in the theme asked for when the case has both. Side by side when
    both phases exist and none is asked for. */
export function EvidenceCompare({
  repo,
  runId,
  record,
  ticket,
  mode: askedMode,
  caseId: askedCase,
  theme: askedTheme,
  variant = 'annotated',
  onClose,
  onShow,
  srcOf = address => evidenceUrl(repo, runId, address),
}: EvidenceCompareProps) {
  const first = record.cases[0]!;
  const [caseId, setCaseId] = useState(
    record.cases.some(x => x.id === askedCase) ? askedCase! : first.id
  );
  const c = record.cases.find(x => x.id === caseId) ?? first;
  const modes = modesOf(c);
  const [mode, setMode] = useState<CompareMode>(
    askedMode && modes.includes(askedMode)
      ? askedMode
      : (modes.at(-1) ?? 'before')
  );
  const themes = themesIn(c);
  const [theme, setTheme] = useState<EvidenceTheme | undefined>(
    askedTheme && themes.includes(askedTheme) ? askedTheme : themes[0]
  );
  const shownMode = modes.includes(mode) ? mode : (modes.at(-1) ?? 'before');
  const shownTheme = theme && themes.includes(theme) ? theme : themes[0];

  useEffect(() => {
    onShow?.({
      caseId: c.id,
      mode: shownMode,
      ...(shownTheme ? { theme: shownTheme } : {}),
    });
  }, [c.id, shownMode, shownTheme, onShow]);

  const pager = usePager({
    items: record.cases.map(x => ({ value: x.id, label: x.label })),
    value: c.id,
    onChange: setCaseId,
    noun: 'case',
    prefix: ticket,
  });
  const phases: EvidencePhase[] =
    shownMode === 'side' ? slotsOf(c) : [shownMode];

  return (
    <EvidenceModal
      title={
        pager?.title ?? evidenceTitle(ticket, headLabel(record, c) ?? undefined)
      }
      pager={pager?.pager}
      onClose={onClose}
      parityRoot="Compare modal"
      controls={
        <>
          {themes.length === 2 ? (
            <SegmentedControl
              aria-label="Theme"
              value={shownTheme}
              onChange={v => setTheme(v as EvidenceTheme)}
              data={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              data-parity="theme"
            />
          ) : null}
          {modes.length > 1 ? (
            <SegmentedControl
              aria-label="Before, after or side by side"
              value={shownMode}
              onChange={v => setMode(v as CompareMode)}
              data={modes.map(m => ({ value: m, label: MODE_LABEL[m] }))}
              data-parity="seg"
            />
          ) : null}
        </>
      }
    >
      <div
        className={classes.images}
        data-side={shownMode === 'side' ? 'true' : 'false'}
      >
        {phases.map(p => {
          const shot = shotIn(c, p, shownTheme);
          if (!shot) return null;
          const line = shotLine(c, shot);
          return (
            <div key={p} className={classes.column}>
              <EvidenceFrame
                src={srcOf(addressOf(c, p, shot, variant))}
                name={shownName(shot, variant)}
                caption={
                  <Stack gap={2} data-parity="cap">
                    <Text
                      fz="md"
                      fw={500}
                      lh="normal"
                      truncate
                      data-parity="phase"
                    >
                      {shownMode === 'side'
                        ? PHASE_LABEL[p]
                        : shownName(shot, variant)}
                    </Text>
                    <ShotLine line={line} size="md" />
                  </Stack>
                }
              />
            </div>
          );
        })}
      </div>
    </EvidenceModal>
  );
}
