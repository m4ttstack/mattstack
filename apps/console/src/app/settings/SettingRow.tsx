import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  ActionIcon,
  Box,
  Collapse,
  Group,
  Highlight,
  Stack,
  Text,
  type TextProps,
} from '@mattstack/app-kit/core';
import {
  useReducedMotion,
  useSchemeColors,
  useUncontrolled,
} from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { IssueLines } from './IssueLines';
import type { WireIssue } from './issues';
import {
  KeyPanel,
  notifying,
  whereDraws,
  type PanelStore,
  type PanelTab,
} from './KeyPanel';
import { RepoReach } from './RepoReach';
import { SaveStatus, useRowParts, ValueContent, WriteError } from './rowParts';
import {
  RowProjectScope,
  SettingsSeedRepoContext,
  useRowProject,
} from './RowProject';
import { ScopeBadge } from './ScopeBadge';
import classes from './SettingRow.module.css';
import {
  prefetchKeyExplain,
  useSettingsRepo,
  useSettingsViewTeam,
} from './useConsoleSettings';
import { useRowSave } from './useRowSave';
import {
  APPROVAL_KEY,
  badgeScope,
  ESCAPE_OWNERS,
  firstSentence,
  ROW_CONTROLS,
  sourceText,
  splitKey,
  type StoreScope,
} from './view';

/** The panel's collapse, in ms. The open card's frame
    (SettingRow.module.css) reads it as `--row-motion`, so both move
    together. */
export const ROW_MOTION_MS = 200;

export interface RowOpen {
  tab: PanelTab;
  fix: string | null;
}

function Marked({
  text,
  query,
  ...props
}: { text: string; query: string } & Omit<TextProps, 'color'>) {
  return query.trim() === '' ? (
    <Text {...props}>{text}</Text>
  ) : (
    <Highlight
      {...props}
      highlight={query.trim()}
      highlightStyles={{
        backgroundColor: 'var(--mantine-color-warn-light)',
        color: 'inherit',
      }}
    >
      {text}
    </Highlight>
  );
}

const sameOpen = (a: RowOpen | null, b: RowOpen | null) =>
  a?.tab === b?.tab && a?.fix === b?.fix;

/** The open state the panel draws: the live one while open, the last one
    while the panel collapses, and null once `settle` ends the collapse (at
    once when `instant`). `opening` counts openings, so each one mounts a
    fresh panel, even one that lands before the last collapse ends. */
function usePanelOpen(open: RowOpen | null, instant: boolean) {
  const isOpen = open !== null;
  const [kept, setKept] = useState(open);
  const [wasOpen, setWasOpen] = useState(isOpen);
  const [opening, setOpening] = useState(0);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setOpening(n => n + 1);
  }
  if (isOpen ? !sameOpen(open, kept) : instant && kept !== null) setKept(open);
  return {
    shown: open ?? kept,
    opening,
    settle: () => {
      if (!isOpen) setKept(null);
    },
  };
}

/** Whether a text selection reaches into `el`: the click that ends a drag
    select fires on the header like any other. */
function selectingIn(el: HTMLElement): boolean {
  const sel = window.getSelection();
  return Boolean(
    sel &&
    !sel.isCollapsed &&
    (el.contains(sel.anchorNode) || el.contains(sel.focusNode))
  );
}

interface SettingRowProps {
  def: SettingDefWire;
  store: PanelStore;
  subhead: StoreScope | null;
  query: string;
  suggestions?: string[];
  onFix?: (key: string, issue: WireIssue | null) => void;
  open?: RowOpen | null;
  defaultOpen?: RowOpen | null;
  onOpenChange?: (next: RowOpen | null) => void;
  onPickRepo?: (repo: string) => void;
}

/** A per-project row picks its own project; any other row reads the
    page's. */
export function SettingRow(props: SettingRowProps) {
  const linked = useContext(SettingsSeedRepoContext);
  // A host that is about one repo (run detail) starts its rows there.
  const outer = useSettingsRepo();
  if (!props.def.repoScoped) return <RowBody {...props} />;
  const opened = props.open ?? props.defaultOpen ?? null;
  return (
    <RowProjectScope def={props.def} seed={(opened ? linked : null) ?? outer}>
      {def => <RowBody {...props} def={def} />}
    </RowProjectScope>
  );
}

function RowBody({
  def,
  store,
  subhead,
  query,
  suggestions,
  onFix,
  open: openProp,
  defaultOpen = null,
  onOpenChange,
  onPickRepo,
}: SettingRowProps) {
  const { text } = useSchemeColors();
  const repo = useSettingsRepo();
  const viewTeam = useSettingsViewTeam();
  const project = useRowProject();
  const [writes, setWrites] = useState(0);
  const header = useMemo(
    () => notifying(store, () => setWrites(n => n + 1)),
    [store]
  );
  const row = useRowSave(header, def);
  const [open, setOpen] = useUncontrolled<RowOpen | null>({
    value: openProp,
    defaultValue: defaultOpen,
    finalValue: null,
    onChange: onOpenChange,
  });
  const isOpen = open !== null;
  const reduceMotion = useReducedMotion();
  const { shown, opening, settle } = usePanelOpen(open, reduceMotion);
  // Form mode belongs to the opening it was chosen in: it holds while that
  // panel collapses, and the next opening starts in JSON. A closed row keeps
  // its inline control.
  const [formIn, setFormIn] = useState<number | null>(null);
  const asJson = formIn !== opening && shown !== null;
  const setAsJson = (on: boolean) => setFormIn(on ? null : opening);
  const parts = useRowParts(def, row, { suggestions, asJson, setAsJson });
  const chevron = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // With no transition the collapse never reports its end, so under reduced
  // motion an opened card scrolls into view as soon as it renders.
  useEffect(() => {
    if (isOpen && reduceMotion)
      card.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [isOpen, reduceMotion]);
  const [ns, name] = splitKey(def.key);
  const badge = badgeScope(def, subhead);
  // A global source label ("unset", "default") says nothing about a key
  // that only lives in repo sections; the repo reach carries it instead.
  const plain = parts.perRepo ? null : sourceText(def);
  const onWhere = shown?.tab === 'where';
  const drawnBelow = onWhere
    ? (issue: WireIssue) => whereDraws(def, issue, repo)
    : undefined;
  // The winning layer's own line shows its rejected value on Where it's set.
  const rejected =
    def.issues === undefined && !onWhere ? def.effective.invalid : undefined;

  // An unset key has no value to show, so it opens on where it could be set.
  // A per-project key's Value tab is its project picker, so it keeps that.
  const firstTab =
    def.effective.scope === null && !def.repoOnly ? 'where' : 'value';
  const toggle = () => setOpen(isOpen ? null : { tab: firstTab, fix: null });
  const warmPanel = () => {
    if (!isOpen) void prefetchKeyExplain(def, repo, viewTeam);
  };

  const onHeader = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // A portalled dropdown's clicks reach here through the React tree.
    if (!e.currentTarget.contains(target)) return;
    if (target.closest(ROW_CONTROLS)) return;
    // A double-click selects a word; its first click already toggled.
    if (e.detail > 1 || selectingIn(e.currentTarget)) return;
    toggle();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen || e.key !== 'Escape' || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest(ESCAPE_OWNERS)) return;
    e.preventDefault();
    setOpen(null);
    chevron.current?.focus();
  };

  return (
    <Box
      ref={card}
      data-key={def.key}
      style={{ '--row-motion': `${ROW_MOTION_MS}ms` }}
      className={classes.item}
      mod={{ open: isOpen }}
      onKeyDown={onKey}
    >
      <Group
        gap={24}
        wrap="nowrap"
        className={classes.header}
        onClick={onHeader}
        onPointerEnter={warmPanel}
        onFocus={warmPanel}
      >
        {/* A leading disclosure chevron: › closed, turning to ⌄ open. */}
        <ActionIcon
          ref={chevron}
          size="sm"
          variant="subtle"
          color="gray"
          className={classes.disclosure}
          aria-expanded={isOpen}
          // Under reduced motion a closed collapse renders nothing.
          aria-controls={isOpen || !reduceMotion ? panelId : undefined}
          aria-label={`${isOpen ? 'close' : 'open'} ${def.key}`}
          onClick={toggle}
        >
          <Icons.chevronRight size={16} />
        </ActionIcon>
        <Stack gap={4} className={classes.text}>
          <Group gap={8} wrap="nowrap">
            <Text fz={14} lh="18px" ff="monospace" span>
              <Text span inherit c={text.muted}>
                {ns}
              </Text>
              <Marked text={name} query={query} span inherit fw={500} />
            </Text>
            {badge ? (
              <ScopeBadge scope={badge} />
            ) : plain ? (
              <Text fz={12} lh="15px" c={text.muted}>
                {plain}
              </Text>
            ) : null}
            <RepoReach def={def} />
          </Group>
          {def.key === APPROVAL_KEY ? (
            <Text fz={12} lh="15px" c={text.muted} data-testid="approval-note">
              {"approves the team's worktree "}
              <Text span inherit ff="monospace">
                ready
              </Text>
              {' commands by their hash; approve with '}
              <Text span inherit ff="monospace">
                rt worktree ready-approve
              </Text>
            </Text>
          ) : (
            <Marked
              text={firstSentence(def.description)}
              query={query}
              fz={12}
              lh="15px"
              c={text.muted}
              lineClamp={1}
            />
          )}
        </Stack>
        <Group w={260} gap={8} wrap="nowrap" className={classes.control}>
          {parts.control}
          <SaveStatus row={row} />
        </Group>
      </Group>
      {(row.error || rejected) && (
        <Stack gap={4} pb={12} className={classes.inset}>
          <WriteError row={row} />
          {rejected && (
            <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
              stored value rejected: {rejected}
            </Text>
          )}
        </Stack>
      )}
      <Box className={classes.inset}>
        <IssueLines
          def={def}
          onFix={onFix && (issue => onFix(def.key, issue))}
          hide={drawnBelow}
        />
      </Box>
      <Collapse
        expanded={isOpen}
        keepMounted={false}
        transitionDuration={reduceMotion ? 0 : ROW_MOTION_MS}
        onTransitionEnd={() => {
          settle();
          // A card taller than the frame lines its top up with the frame's.
          if (isOpen)
            card.current?.scrollIntoView({
              block: 'nearest',
              behavior: 'smooth',
            });
        }}
        id={panelId}
        role="region"
        aria-label={`${def.key} settings`}
      >
        {shown && (
          <Box key={opening} className={classes.panel}>
            <KeyPanel
              def={def}
              store={store}
              tab={shown.tab}
              onTab={tab => setOpen({ tab, fix: null })}
              value={<ValueContent def={def} parts={parts} />}
              fix={shown.fix}
              externalWrites={writes}
              onPickRepo={
                project
                  ? r => {
                      project.pick(r);
                      setOpen({ tab: 'value', fix: null });
                    }
                  : onPickRepo
              }
            />
          </Box>
        )}
      </Collapse>
    </Box>
  );
}
