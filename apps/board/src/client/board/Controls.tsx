import { useId, useRef, useState, type ReactNode } from 'react';

import {
  CHECK_ICON,
  ContextMenu,
  Icon,
  ICONS,
  LabeledSeg,
} from '@mattstack/tui-kit';
import { GROUP_KEYS, SORT_KEYS } from '../../view.ts';
import type { GroupKey, ShowItem, ViewState } from '../../view.ts';
import type { ThemeMode } from '../types.ts';
import { GROUP_LABEL, SORT_LABEL } from './format.ts';
import { SlackLogo } from './icons.tsx';

// Lucide path data; tui-kit's ICONS has no layers, sort, eye or chevron-down.
const LAYERS_ICON =
  'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83zM2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17';
const SORT_ICON = 'm21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16';
const EYE_ICON =
  'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0';
const CHEVRON_DOWN_ICON = 'm6 9 6 6 6-6';

export interface ShowMenuModel {
  offered: readonly ShowItem[];
  off: readonly ShowItem[];
  counts: Record<ShowItem, number>;
  channel: string | null;
  shown: number;
  total: number;
  toggle: (item: ShowItem) => void;
  /** Checks every offered item, zero counts included, in one state write:
      `toggle` per item would each start from the same stale `off`. */
  showAll: () => void;
}

const slackPlace = (channel: string | null) =>
  channel ? `#${channel}` : 'team channel';

export function showLabel(item: ShowItem, channel: string | null): string {
  switch (item) {
    case 'posted':
      return `Posted to ${slackPlace(channel)}`;
    case 'notPosted':
      return 'Not Posted';
    case 'authorTurn':
      return 'Waiting on author';
    case 'myDrafts':
      return 'My drafts';
  }
}

export function showDescription(
  item: ShowItem,
  channel: string | null
): string {
  switch (item) {
    case 'posted':
      return 'announced for review';
    case 'notPosted':
      return `not posted to ${slackPlace(channel)} yet`;
    case 'authorTurn':
      return 'comments, red CI, conflicts, ready to merge';
    case 'myDrafts':
      return 'your own draft MRs';
  }
}

function MenuButton({
  icon,
  label,
  value,
  ariaLabel,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  ariaLabel: string;
  children: (close: () => void) => ReactNode;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setAt(null);
    triggerRef.current?.focus();
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="tui-menu-button"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-controls={at ? menuId : undefined}
        data-open={at ? true : undefined}
        // The open menu closes on any outside mousedown, which would reopen it
        // on this same click; swallowing it here makes the trigger a toggle.
        onMouseDown={e => {
          if (at) e.nativeEvent.stopImmediatePropagation();
        }}
        onClick={e => {
          if (at) return setAt(null);
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <span className="tui-menu-button-icon">{icon}</span>
        <span className="tui-menu-button-label">{label}</span>
        <span className="tui-menu-button-value">{value}</span>
        <span className="tui-menu-button-chevron">
          <Icon d={CHEVRON_DOWN_ICON} />
        </span>
      </button>
      {at && (
        <ContextMenu
          id={menuId}
          x={at.x}
          y={at.y}
          ariaLabel={ariaLabel}
          onClose={close}
        >
          {children(close)}
        </ContextMenu>
      )}
    </>
  );
}

const TURN_SETTINGS_LABEL = 'Whose turn settings…';

export function ShowMenuItems({
  show,
  onOpenTurnSettings,
  close,
}: {
  show: ShowMenuModel;
  onOpenTurnSettings?: () => void;
  /** Kit items never close the menu on click; the settings link must. */
  close?: () => void;
}) {
  return (
    <>
      <ContextMenu.Label>Show on the board</ContextMenu.Label>
      {show.offered.map(item => {
        const on = !show.off.includes(item);
        return (
          <ContextMenu.Item
            key={item}
            role="menuitemcheckbox"
            aria-checked={on}
            className="tui-show-menu-item"
            label={
              <span className="tui-show-item">
                <span className="tui-show-check" data-on={on || undefined}>
                  {on && <Icon d={CHECK_ICON} />}
                </span>
                <span className="tui-show-text">
                  <span className="tui-show-label" data-on={on || undefined}>
                    {showLabel(item, show.channel)}
                  </span>
                  <span className="tui-show-desc">
                    {showDescription(item, show.channel)}
                  </span>
                </span>
              </span>
            }
            trailing={
              <span className="tui-show-count">{show.counts[item]}</span>
            }
            onClick={() => show.toggle(item)}
          />
        );
      })}
      {onOpenTurnSettings && (
        <>
          <ContextMenu.Separator />
          <ContextMenu.Item
            className="tui-show-settings"
            label={TURN_SETTINGS_LABEL}
            onClick={() => {
              close?.();
              onOpenTurnSettings();
            }}
          />
        </>
      )}
    </>
  );
}

// ── controls (shared: desktop header + mobile drawer) ───────────────────────

function Controls({
  state,
  update,
  theme,
  pickTheme,
  onRefresh,
  refreshing,
  onPostSummary,
  canPostSummary,
  postingSummary,
  show,
  onOpenTurnSettings,
  groupKeys = GROUP_KEYS,
  stacked = false,
}: {
  state: ViewState;
  update: (patch: Partial<ViewState>) => void;
  /** The groupings this tab offers (the seat tab alone offers "needs"). */
  groupKeys?: readonly GroupKey[];
  theme: ThemeMode;
  pickTheme: (m: ThemeMode) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onPostSummary?: () => void;
  canPostSummary?: boolean;
  postingSummary?: boolean;
  /** Null when this board offers no Show items at all. */
  show: ShowMenuModel | null;
  onOpenTurnSettings?: () => void;
  stacked?: boolean;
}) {
  // Drawer: labeled full-width rows, so a mobile user can tell what each does.
  if (stacked) {
    return (
      <>
        <div className="tui-ctl-row">
          <span className="tui-ctl-label">group</span>
          <LabeledSeg
            legend="group"
            options={groupKeys}
            labels={GROUP_LABEL}
            value={state.group}
            onChange={g => update({ group: g })}
          />
        </div>
        <div className="tui-ctl-row">
          <span className="tui-ctl-label">sort</span>
          <LabeledSeg
            legend="sort"
            options={SORT_KEYS}
            labels={SORT_LABEL}
            value={state.sort}
            onChange={s => update({ sort: s })}
          />
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
        {show && (
          <div className="tui-ctl-row tui-ctl-show">
            <span className="tui-ctl-label">show</span>
            <div className="tui-ctl-show-items">
              {show.offered.map(item => {
                const on = !show.off.includes(item);
                return (
                  <button
                    key={item}
                    className="tui-drawer-action"
                    role="checkbox"
                    aria-checked={on}
                    data-active={on || undefined}
                    onClick={() => show.toggle(item)}
                  >
                    {on ? '✓' : '+'} {showLabel(item, show.channel)} ·{' '}
                    {show.counts[item]}
                  </button>
                );
              })}
              {onOpenTurnSettings && (
                <button
                  className="tui-drawer-action tui-show-settings"
                  onClick={onOpenTurnSettings}
                >
                  {TURN_SETTINGS_LABEL}
                </button>
              )}
            </div>
          </div>
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

  return (
    <>
      <MenuButton
        icon={<Icon d={LAYERS_ICON} />}
        label="Group"
        value={GROUP_LABEL[state.group]}
        ariaLabel="group by"
      >
        {close =>
          groupKeys.map(k => (
            <ContextMenu.Item
              key={k}
              role="menuitemradio"
              aria-checked={state.group === k}
              label={GROUP_LABEL[k]}
              trailing={state.group === k ? <Icon d={CHECK_ICON} /> : null}
              onClick={() => {
                update({ group: k });
                close();
              }}
            />
          ))
        }
      </MenuButton>
      <MenuButton
        icon={<Icon d={SORT_ICON} />}
        label="Sort"
        value={SORT_LABEL[state.sort]}
        ariaLabel="sort by"
      >
        {close =>
          SORT_KEYS.map(k => (
            <ContextMenu.Item
              key={k}
              role="menuitemradio"
              aria-checked={state.sort === k}
              label={SORT_LABEL[k]}
              trailing={state.sort === k ? <Icon d={CHECK_ICON} /> : null}
              onClick={() => {
                update({ sort: k });
                close();
              }}
            />
          ))
        }
      </MenuButton>
      {show && (
        <MenuButton
          icon={<Icon d={EYE_ICON} />}
          label="Showing"
          value={`${show.shown} of ${show.total}`}
          ariaLabel="show on the board"
        >
          {close => (
            <ShowMenuItems
              show={show}
              onOpenTurnSettings={onOpenTurnSettings}
              close={close}
            />
          )}
        </MenuButton>
      )}
    </>
  );
}

/** The header's quiet refresh glyph, beside the scheme control. */
function RefreshControl({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <button
      type="button"
      className={`tui-theme-control tui-refresh${refreshing ? ' spinning' : ''}`}
      onClick={onRefresh}
      disabled={refreshing}
      title="refresh now"
      aria-label="refresh now"
    >
      {ICONS.refresh}
    </button>
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
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const checkedRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setAt(null);
    triggerRef.current?.focus();
  };
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
        ref={triggerRef}
        type="button"
        className="tui-theme-control"
        aria-label="Color scheme"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-controls={at ? menuId : undefined}
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
          id={menuId}
          x={at.x}
          y={at.y}
          ariaLabel="color scheme"
          onClose={close}
          initialFocusRef={checkedRef}
          onPositioned={alignRight}
          style={{ transformOrigin: 'top right' }}
        >
          {THEME_OPTIONS.map(o => (
            <ContextMenu.Item
              key={o.value}
              ref={theme === o.value ? checkedRef : undefined}
              role="menuitemradio"
              aria-checked={theme === o.value}
              label={o.label}
              trailing={theme === o.value ? <Icon d={CHECK_ICON} /> : null}
              onClick={() => {
                pickTheme(o.value);
                close();
              }}
            />
          ))}
        </ContextMenu>
      )}
    </>
  );
}

export { Controls, RefreshControl, ThemeControl };
