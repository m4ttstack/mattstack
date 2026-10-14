import { useRef, useState } from 'react';

import { ContextMenu } from '@mattstack/tui-kit';
import type { AskPickerModel, AskSection } from './ask-picker.ts';
import { ArrowOutGlyph, SearchIcon, SlackLogo } from './icons.tsx';
import { MemberInvadr } from './MemberInvadr.tsx';

/** The sections a search keeps: a team whose name matches keeps everyone,
    any other keeps the people whose name or username matches. A Slack row
    has no name of its own, so it stays only on a team match. */
function narrowed(sections: AskSection[], query: string): AskSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  return sections
    .map(s =>
      s.team?.toLowerCase().includes(q)
        ? s
        : {
            ...s,
            slack: undefined,
            people: s.people.filter(
              p =>
                p.name.toLowerCase().includes(q) ||
                p.username.toLowerCase().includes(q)
            ),
          }
    )
    .filter(s => s.people.length > 0 || s.slack);
}

function heading(s: AskSection): string {
  if (s.role === 'mine') return s.team ? `${s.team} · your team` : 'your team';
  return s.role === 'owner' ? `${s.team} · code owner` : s.team!;
}

const APPROVAL = {
  needs: { text: 'needs approval', hue: 'amber' },
  approved: { text: 'approved', hue: 'green' },
} as const;

/** The row menu's "request review from…" stage: one list in the Code Owner
    post's order behind a search over every team. Drawn inside the kit menu,
    in its place. A pick goes on to the board's ask confirm. */
export function AskPicker({
  x,
  y,
  subject,
  model,
  onPick,
  onPostSlack,
  onOpen,
  onClose,
}: {
  x: number;
  y: number;
  subject: string;
  model: AskPickerModel;
  onPick: (username: string) => void;
  /** Open the Code Owner post dialog. */
  onPostSlack: () => void;
  onOpen: (url: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const section = (s: AskSection) => {
    const label = heading(s);
    const badge =
      s.approval && s.approval !== 'checking' && APPROVAL[s.approval];
    return (
      <div
        key={`${s.role}:${s.team ?? ''}`}
        role="group"
        aria-label={
          s.approval === 'checking'
            ? `${label}, checking approval`
            : badge
              ? `${label}, ${badge.text}`
              : label
        }
      >
        <div className="tui-menu-ask-team" aria-hidden="true">
          <span>{label}</span>
          {badge ? (
            <span className="tui-phrase" data-hue={badge.hue}>
              {badge.text}
            </span>
          ) : s.approval === 'checking' ? (
            <span className="tui-menu-ask-state">checking…</span>
          ) : null}
        </div>
        {s.people.map(p => (
          <ContextMenu.Item
            key={p.username}
            label={
              <span className="tui-menu-icon-label">
                <MemberInvadr id={p.username} className="tui-menu-ask-avatar" />
                {p.name}
              </span>
            }
            onClick={() => onPick(p.username)}
          />
        ))}
        {s.slack && (
          <ContextMenu.Item
            label={
              <span className="tui-menu-icon-label">
                <SlackLogo />
                {s.slack.posted
                  ? 'posted in slack'
                  : 'post to codeowners in slack…'}
              </span>
            }
            trailing={s.slack.posted ? <ArrowOutGlyph /> : undefined}
            onClick={() =>
              s.slack!.posted ? onOpen(s.slack!.posted) : onPostSlack()
            }
          />
        )}
      </div>
    );
  };

  const shown = narrowed(model.sections, query);
  return (
    <ContextMenu
      key="asking"
      x={x}
      y={y}
      ariaLabel={`request review for ${subject}`}
      onClose={onClose}
      initialFocusRef={searchRef}
      className="tui-menu-asking"
    >
      <label className="tui-menu-ask-searchbar">
        <SearchIcon />
        <input
          ref={searchRef}
          className="tui-menu-ask-search"
          type="search"
          value={query}
          placeholder="ask someone to review…"
          aria-label="search people and teams"
          onChange={e => setQuery(e.currentTarget.value)}
          onKeyDown={e => {
            const first =
              listRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              first?.focus();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              first?.click();
            }
          }}
        />
      </label>
      <div ref={listRef} className="tui-menu-ask-list">
        {shown.length > 0 ? (
          shown.map(section)
        ) : (
          <div className="tui-menu-ask-empty">
            nobody matches “{query.trim()}”
          </div>
        )}
      </div>
    </ContextMenu>
  );
}
