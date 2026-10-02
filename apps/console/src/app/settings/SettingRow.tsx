import {
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
  Tooltip,
  type TextProps,
} from '@mattstack/app-kit/core';
import { useSchemeColors, useUncontrolled } from '@mattstack/app-kit/hooks';
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
import { ScopeBadge } from './ScopeBadge';
import classes from './SettingRow.module.css';
import { useSettingsRepo } from './useConsoleSettings';
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

export function SettingRow({
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
}: {
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
}) {
  const { text } = useSchemeColors();
  const repo = useSettingsRepo();
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
  const [asJson, setAsJson] = useState(false);
  // A closed row starts fresh: JSON mode chosen in one opening must not
  // resurface on the next.
  useEffect(() => {
    if (!isOpen) setAsJson(false);
  }, [isOpen]);
  const parts = useRowParts(def, row, { suggestions, asJson, setAsJson });
  const chevron = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [ns, name] = splitKey(def.key);
  const badge = badgeScope(def, subhead);
  // A global source label ("unset", "default") says nothing about a key
  // that only lives in repo sections; the repo reach carries it instead.
  const plain = parts.perRepo ? null : sourceText(def);
  const onWhere = open?.tab === 'where';
  const drawnBelow = onWhere
    ? (issue: WireIssue) => whereDraws(def, issue, repo)
    : undefined;
  // The winning layer's own line shows its rejected value on Where it's set.
  const rejected =
    def.issues === undefined && !onWhere ? def.effective.invalid : undefined;

  const toggle = () =>
    setOpen(isOpen ? null : { tab: parts.body ? 'value' : 'where', fix: null });
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
      data-key={def.key}
      className={classes.item}
      mod={{ open: isOpen }}
      onKeyDown={onKey}
    >
      <Group
        gap={24}
        wrap="nowrap"
        className={classes.header}
        onClick={onHeader}
      >
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
        <Tooltip label={isOpen ? 'Close' : 'Open'}>
          <ActionIcon
            ref={chevron}
            variant="subtle"
            color="gray"
            aria-expanded={isOpen}
            aria-controls={panelId}
            aria-label={`${isOpen ? 'close' : 'open'} ${def.key}`}
            onClick={toggle}
          >
            {isOpen ? (
              <Icons.chevronUp size={16} />
            ) : (
              <Icons.chevronDown size={16} />
            )}
          </ActionIcon>
        </Tooltip>
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
        id={panelId}
        role="region"
        aria-label={`${def.key} settings`}
      >
        {open && (
          <Box className={classes.panel}>
            <KeyPanel
              def={def}
              store={store}
              tab={open.tab}
              onTab={tab => setOpen({ tab, fix: null })}
              value={<ValueContent def={def} parts={parts} />}
              fix={open.fix}
              externalWrites={writes}
              onPickRepo={onPickRepo}
            />
          </Box>
        )}
      </Collapse>
    </Box>
  );
}
