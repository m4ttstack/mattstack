import { useRef, useState } from 'react';

import {
  CHECK_ICON,
  ContextMenu,
  CopyButton,
  Icon,
  ICONS,
  LabeledSeg,
} from '@mattstack/tui-kit';
import { GROUP_KEYS, SORT_KEYS } from '../../view.ts';
import type { GroupKey, ViewState } from '../../view.ts';
import type { ThemeMode } from '../types.ts';
import { SlackPostedMark } from './chips.tsx';
import { GROUP_LABEL, SORT_LABEL } from './format.ts';
import { FlagGlyph, SlackLogo } from './icons.tsx';

// ── controls (shared: desktop header + mobile drawer) ───────────────────────

function Controls({
  state,
  update,
  theme,
  pickTheme,
  canCopy,
  summaryText,
  onRefresh,
  refreshing,
  onPostSummary,
  canPostSummary,
  postingSummary,
  slackFilter,
  draftFilter,
  groupKeys = GROUP_KEYS,
  stacked = false,
}: {
  state: ViewState;
  update: (patch: Partial<ViewState>) => void;
  /** The groupings this tab offers (the seat tab alone offers "needs"). */
  groupKeys?: readonly GroupKey[];
  theme: ThemeMode;
  pickTheme: (m: ThemeMode) => void;
  canCopy: boolean;
  summaryText: string;
  onRefresh: () => void;
  refreshing: boolean;
  onPostSummary?: () => void;
  canPostSummary?: boolean;
  postingSummary?: boolean;
  /** Null when slack isn't configured: there are no refs to filter on. */
  slackFilter?: { active: boolean; toggle: () => void } | null;
  /** Null on an "all" board: drafts never appear there (buildBoard drops
      every draft when there's no single defaultMember to own one). */
  draftFilter?: { active: boolean; toggle: () => void } | null;
  stacked?: boolean;
}) {
  const group = (
    <LabeledSeg
      legend="group"
      options={groupKeys}
      labels={GROUP_LABEL}
      value={state.group}
      onChange={g => update({ group: g })}
    />
  );
  const sort = (
    <LabeledSeg
      legend="sort"
      options={SORT_KEYS}
      labels={SORT_LABEL}
      value={state.sort}
      onChange={s => update({ sort: s })}
    />
  );
  const slackFilterLabel = slackFilter?.active
    ? 'showing only MRs posted in slack'
    : 'only MRs posted in slack';
  const draftFilterLabel = draftFilter?.active
    ? 'showing your draft MRs, click to hide them'
    : 'draft MRs hidden, click to show them';

  // Drawer: labeled full-width rows, so a mobile user can tell what each does.
  if (stacked) {
    return (
      <>
        <div className="tui-ctl-row">
          <span className="tui-ctl-label">group</span>
          {group}
        </div>
        <div className="tui-ctl-row">
          <span className="tui-ctl-label">sort</span>
          {sort}
        </div>
        <div className="tui-ctl-row">
          <span className="tui-ctl-label">theme</span>
          <ThemeControl theme={theme} pickTheme={pickTheme} />
        </div>
        <button
          className="tui-drawer-action"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {ICONS.refresh} {refreshing ? 'refreshing…' : 'refresh now'}
        </button>
        {slackFilter && (
          <button
            className="tui-drawer-action"
            data-active={slackFilter.active || undefined}
            aria-pressed={slackFilter.active}
            onClick={slackFilter.toggle}
          >
            <SlackPostedMark mono />{' '}
            {slackFilter.active
              ? 'showing only posted in slack'
              : 'only posted in slack'}
          </button>
        )}
        {draftFilter && (
          <button
            className="tui-drawer-action"
            data-active={draftFilter.active || undefined}
            aria-pressed={draftFilter.active}
            onClick={draftFilter.toggle}
          >
            <FlagGlyph kind="draft" />{' '}
            {draftFilter.active ? 'showing drafts' : 'drafts hidden'}
          </button>
        )}
        {canCopy && (
          <CopyButton
            text={summaryText}
            className="tui-drawer-action"
            title="copy summary for Slack"
            label="copy summary"
          />
        )}
        {canPostSummary && onPostSummary && (
          <button
            className="tui-drawer-action"
            onClick={onPostSummary}
            disabled={postingSummary}
            title="post this summary to slack"
          >
            <SlackLogo />{' '}
            {postingSummary ? 'posting…' : 'post summary to slack'}
          </button>
        )}
      </>
    );
  }

  // Header: compact inline row.
  return (
    <>
      <button
        className={`tui-copy tui-refresh${refreshing ? ' spinning' : ''}`}
        onClick={onRefresh}
        disabled={refreshing}
        title="refresh now"
        aria-label="refresh now"
      >
        {ICONS.refresh}
      </button>
      {/* No `className="tui-copy"`: the CopyButton recipe's own stylesheet IS
          that rule now. `.tui-copy` survives in style.css only to dress the
          board's own plain buttons (the refresh button above, the selection
          bar's post/clear), which are not CopyButton instances. */}
      {canCopy && (
        <CopyButton text={summaryText} title="copy summary for Slack" />
      )}
      {slackFilter && (
        <button
          className="tui-copy tui-slack-filter"
          data-active={slackFilter.active || undefined}
          aria-pressed={slackFilter.active}
          aria-label={slackFilterLabel}
          title={slackFilterLabel}
          onClick={slackFilter.toggle}
        >
          <SlackPostedMark mono />
        </button>
      )}
      {draftFilter && (
        <button
          className="tui-copy tui-draft-filter"
          data-active={draftFilter.active || undefined}
          aria-pressed={draftFilter.active}
          aria-label={draftFilterLabel}
          title={draftFilterLabel}
          onClick={draftFilter.toggle}
        >
          <FlagGlyph kind="draft" />
        </button>
      )}
      {group}
      {sort}
    </>
  );
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** The suite's one scheme switcher, in board's own kit: the app-kit
    ColorSchemeControl's System/Light/Dark menu behind an icon that shows the
    stored choice. */
function ThemeControl({
  theme,
  pickTheme,
}: {
  theme: ThemeMode;
  pickTheme: (m: ThemeMode) => void;
}) {
  // `right` is the trigger's right edge; `x` becomes right minus the menu's
  // measured width, so the menu hangs bottom-end under the icon.
  const [at, setAt] = useState<{ right: number; x: number; y: number } | null>(
    null
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const alignRight = () => {
    const width = menuRef.current?.offsetWidth;
    if (!width) return;
    setAt(a =>
      a && a.x !== a.right - width ? { ...a, x: a.right - width } : a
    );
  };
  return (
    <>
      <button
        type="button"
        className="tui-theme-control"
        aria-label="Color scheme"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        title="color scheme"
        // The open menu closes on any outside mousedown, which would reopen it
        // on this same click; swallowing it here makes the trigger a toggle.
        onMouseDown={e => {
          if (at) e.nativeEvent.stopImmediatePropagation();
        }}
        onClick={e => {
          if (at) return setAt(null);
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ right: r.right, x: r.right, y: r.bottom + 4 });
        }}
      >
        {ICONS[theme]}
      </button>
      {at && (
        <ContextMenu
          ref={menuRef}
          x={at.x}
          y={at.y}
          ariaLabel="color scheme"
          onClose={() => setAt(null)}
          onPositioned={alignRight}
          style={{ transformOrigin: 'top right' }}
        >
          {THEME_OPTIONS.map(o => (
            <ContextMenu.Item
              key={o.value}
              role="menuitemradio"
              aria-checked={theme === o.value}
              label={o.label}
              trailing={theme === o.value ? <Icon d={CHECK_ICON} /> : null}
              onClick={() => {
                pickTheme(o.value);
                setAt(null);
              }}
            />
          ))}
        </ContextMenu>
      )}
    </>
  );
}

export { Controls, ThemeControl };
