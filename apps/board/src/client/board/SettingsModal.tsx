import { useEffect, useState } from 'react';

import { Modal } from '@mattstack/tui-kit';
import { isPeered } from '../../view.ts';
import type { ConfigMember } from '../types.ts';
import { MemberInvadr } from './MemberInvadr.tsx';

/** Check members in/out, and show which teammates have a board on the
    switchboard. Toggling persists the hidden flag to config.json, so it is
    offered only to a local viewer. Inviting and removing teammates belong to
    `rt team invite` and `rt team members remove`, not this modal. */
function SettingsModal({
  members,
  canInvite,
  local,
  defaultMember,
  onToggle,
  onClose,
}: {
  members: ConfigMember[];
  /** This board holds the switchboard admin token, the only thing that lets
      GET /peer/boards answer. */
  canInvite: boolean;
  local: boolean;
  defaultMember: string;
  onToggle: (username: string, hidden: boolean) => void;
  onClose: () => void;
}) {
  // null until GET /peer/boards answers, and it stays null if that fetch
  // fails, so no row claims a peering state nobody confirmed.
  const [peered, setPeered] = useState<string[] | null>(null);

  useEffect(() => {
    if (!canInvite) return;
    let live = true;
    fetch('/peer/boards')
      .then(r =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status)))
      )
      .then(b => {
        if (!live) return;
        const boards = (b as { boards?: { username: string }[] }).boards ?? [];
        setPeered(boards.map(x => x.username));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [canInvite]);

  return (
    <Modal
      title="❯ team members"
      ariaLabel="team settings"
      onClose={onClose}
      closeGlyph="✕"
    >
      {local && (
        <p className="tui-modal-sub">
          # check people out to hide them from the board
        </p>
      )}
      <ul className="tui-modal-list">
        {members.map(m => {
          const peeredBadge =
            m.username !== defaultMember && isPeered(m.username, peered);
          return (
            <li
              key={m.username}
              className={m.hidden ? 'tui-modal-row out' : 'tui-modal-row'}
            >
              <label className="tui-modal-name">
                {local && (
                  <input
                    type="checkbox"
                    className="tui-check-box"
                    checked={!m.hidden}
                    aria-label={`${m.name ?? m.username} checked in`}
                    onChange={() => onToggle(m.username, !m.hidden)}
                  />
                )}
                <MemberInvadr id={m.username} className="tui-avatar" />{' '}
                {m.name ?? m.username}
                {peeredBadge && (
                  <span className="tui-phrase" data-hue="accent" data-peered="">
                    peered
                  </span>
                )}
              </label>
              <span className="tui-modal-right">
                <span
                  className="tui-modal-count"
                  title={
                    m.count === null
                      ? 'checked out -- MR count not fetched'
                      : undefined
                  }
                >
                  {m.count ?? '—'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

export { SettingsModal };
