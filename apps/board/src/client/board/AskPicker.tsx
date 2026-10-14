import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ContextMenu, LabeledSeg } from '@mattstack/tui-kit';
import type { AskGroup, AskPerson, AskPickerModel } from './ask-picker.ts';

type View = AskPickerModel['opensOn'];

const VIEWS: readonly View[] = ['owners', 'all'];
const VIEW_LABELS: Record<View, string> = {
  owners: 'code owners',
  all: 'all teams',
};

/** The groups a search keeps: a team whose name matches keeps everyone, any
    other team keeps the people whose name or username matches. */
function narrowed(groups: AskGroup[], query: string): AskGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map(g =>
      g.team.toLowerCase().includes(q)
        ? g
        : {
            ...g,
            people: g.people.filter(
              p =>
                p.name.toLowerCase().includes(q) ||
                p.username.toLowerCase().includes(q)
            ),
          }
    )
    .filter(g => g.people.length > 0);
}

function noBoardLine(teams: string[]): string {
  const names =
    teams.length > 1
      ? `${teams.slice(0, -1).join(', ')} and ${teams.at(-1)}`
      : teams[0];
  return teams.length > 1
    ? `${names} own sections here but have no board connected.`
    : `${names} owns a section here but has no board connected.`;
}

/** The row menu's "request review from…" stage on a board where another
    team can be asked: the seat's teammates and the MR's owning teams, or
    every team behind a search. Drawn inside the kit menu, in its place.
    A person takes a second click, since the ask lands in their inbox. */
export function AskPicker({
  x,
  y,
  subject,
  model,
  personLabel,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  subject: string;
  model: AskPickerModel;
  /** A person's row label, with the menu's own leading glyph. */
  personLabel: (name: string) => ReactNode;
  onPick: (username: string) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>(model.opensOn);
  const [query, setQuery] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view === 'all') searchRef.current?.focus();
  }, [view]);

  const person = (p: AskPerson, indented: boolean) => (
    <ContextMenu.Item
      key={p.username}
      label={personLabel(
        armed === p.username ? `really ask ${p.name}?` : p.name
      )}
      className={indented ? 'tui-menu-ask-member' : undefined}
      onClick={() =>
        armed === p.username ? onPick(p.username) : setArmed(p.username)
      }
    />
  );
  const team = (g: AskGroup) => (
    <div
      key={g.team}
      role="group"
      aria-label={g.note ? `${g.team}, ${g.note}` : g.team}
    >
      <div className="tui-menu-ask-team" aria-hidden="true">
        <span>{g.team}</span>
        {g.note && <span className="tui-menu-ask-state">{g.note}</span>}
      </div>
      {g.people.map(p => person(p, true))}
    </div>
  );

  const shown = narrowed(model.all, query);
  const body =
    view === 'all' ? (
      shown.length > 0 ? (
        shown.map(team)
      ) : (
        <div className="tui-menu-ask-empty">nobody matches</div>
      )
    ) : (
      <>
        {model.teammates.map(p => person(p, false))}
        {model.owners.length > 0 && (
          <div className="tui-menu-ask-divider" role="separator">
            <span>code owners</span>
          </div>
        )}
        {model.owners.map(team)}
        {model.teammates.length === 0 && model.owners.length === 0 && (
          <div className="tui-menu-ask-empty">nobody left to ask here</div>
        )}
      </>
    );

  return (
    <ContextMenu
      key="asking"
      x={x}
      y={y}
      ariaLabel={`request review for ${subject}`}
      onClose={onClose}
      className="tui-menu-asking"
    >
      <ContextMenu.Label>request review from</ContextMenu.Label>
      <LabeledSeg
        soft
        className="tui-menu-ask-views"
        legend="who to list"
        options={VIEWS}
        labels={VIEW_LABELS}
        value={view}
        onChange={setView}
      />
      {view === 'all' && (
        <input
          ref={searchRef}
          className="tui-menu-ask-search"
          type="search"
          value={query}
          placeholder="name or team"
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
      )}
      <div ref={listRef} className="tui-menu-ask-list">
        {body}
      </div>
      {view === 'owners' && model.noBoard.length > 0 && (
        <div className="tui-menu-ask-foot">{noBoardLine(model.noBoard)}</div>
      )}
    </ContextMenu>
  );
}
