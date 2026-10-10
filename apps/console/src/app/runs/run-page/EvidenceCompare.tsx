import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
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

/** Evidence full size: the kit modal less a margin, its title, any control
    beside the close button, and the frames. */
export function EvidenceModal({
  title,
  controls,
  onClose,
  parityRoot,
  children,
}: {
  title: string;
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
          <Modal.Header data-parity="head">
            <Modal.Title data-parity="t">{title}</Modal.Title>
            <Group gap="sm" wrap="nowrap">
              {controls}
              <Modal.CloseButton aria-label="Close" data-autofocus />
            </Group>
          </Modal.Header>
          <Modal.Body>{children}</Modal.Body>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}

/** One image full size, kept to its aspect ratio inside the frame. */
export function EvidenceFrame({ src, name }: { src: string; name: string }) {
  return (
    <Paper
      variant="panel-outline"
      radius="md"
      className={classes.frame}
      data-parity="img"
    >
      <EvidenceImage src={src} name={name} maxHeight="100%" />
    </Paper>
  );
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

  const several = record.cases.length > 1;
  const title = several
    ? (ticket ?? 'Evidence')
    : evidenceTitle(ticket, headLabel(record, c) ?? undefined);
  const phases: EvidencePhase[] =
    shownMode === 'side' ? slotsOf(c) : [shownMode];

  return (
    <EvidenceModal
      title={title}
      onClose={onClose}
      parityRoot="Compare modal"
      controls={
        <>
          {several ? (
            <Select
              aria-label="Case"
              value={c.id}
              onChange={v => v && setCaseId(v)}
              data={record.cases.map(x => ({ value: x.id, label: x.label }))}
              allowDeselect={false}
              classNames={{ root: classes.caseSelect }}
              data-parity="case select"
            />
          ) : null}
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
            <Stack key={p} gap={6} className={classes.column}>
              <EvidenceFrame
                src={evidenceUrl(repo, runId, addressOf(c, p, shot, variant))}
                name={shownName(shot, variant)}
              />
              <Stack gap={2} data-parity="cap">
                <Text fz="md" fw={500} lh="normal" truncate data-parity="phase">
                  {shownMode === 'side'
                    ? PHASE_LABEL[p]
                    : shownName(shot, variant)}
                </Text>
                <ShotLine line={line} size="md" />
              </Stack>
            </Stack>
          );
        })}
      </div>
    </EvidenceModal>
  );
}
