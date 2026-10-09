import { useState } from 'react';

import {
  Alert,
  Button,
  Chip,
  ICONS,
  LabeledSeg,
  TextField,
} from '@mattstack/tui-kit';
import { KEY_ROUND, SHIELD } from '../icons.ts';
import type { Row } from '../logic.ts';
import { OptimisticSwitch } from '../optimistic.tsx';
import type { AccessModalState, BoardState } from '../useBoardState.ts';
import type { BlockProps } from './block.ts';
import { escapeClearsDraft } from './escape.ts';
import { Help } from './Help.tsx';
import { SettingsItem } from './ReachBlock.tsx';

const PASSWORD_TIP =
  'Tunnel visitors enter this before the gateway lets them through.';
const SIGN_IN_TIP =
  "Visitors sign in with Google at Cloudflare's edge before they reach the app. Choose the people or domains allowed in.";

type Mode = AccessModalState['mode'];
const MODES: readonly Mode[] = ['emails', 'domains'];
const MODE_LABELS: Record<Mode, string> = {
  emails: 'These people',
  domains: 'Anyone at these domains',
};

function PasswordInput({
  m,
  board,
  onSaved,
}: {
  m: AccessModalState | null;
  board: BoardState;
  onSaved: () => void;
}) {
  const value = m?.password ?? '';
  const busy = m?.pwBusy ?? false;
  const clear = () => board.updateAccessModal({ password: '' });
  const save = async () => {
    if (value.trim() === '' || busy) return;
    if (await board.savePassword()) onSaved();
  };
  return (
    <span className="settings-inline-form settings-grow">
      <TextField
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={ev => board.updateAccessModal({ password: ev.target.value })}
        onKeyDown={ev => {
          if (ev.key === 'Enter') save();
          else escapeClearsDraft(ev, value, clear);
        }}
        placeholder="New password"
        aria-label="new password"
      />
      <Button disabled={value.trim() === '' || busy} onClick={save}>
        Save
      </Button>
    </span>
  );
}

/** Not set: the input and Save. Set: replace reveals the input, remove
    clears it at once (a password is recoverable by setting a new one). */
function PasswordItem({
  row,
  m,
  board,
}: {
  row: Row;
  m: AccessModalState | null;
  board: BoardState;
}) {
  const [replacing, setReplacing] = useState(false);
  const set = row.hasPassword;
  const busy = m?.pwBusy ?? false;
  return (
    <SettingsItem
      icon={KEY_ROUND}
      label={
        <>
          Password <Help tip={PASSWORD_TIP} />
        </>
      }
      end={
        set ? (
          <span className="settings-item-actions">
            <span className="t-ok">set</span>
            <Button
              variant="subtle"
              aria-label="replace password"
              aria-expanded={replacing}
              onClick={() => setReplacing(v => !v)}
            >
              replace
            </Button>
            <Button
              variant="subtle"
              intent="bad"
              aria-label="remove password"
              disabled={busy}
              onClick={() => board.removePassword()}
            >
              remove
            </Button>
          </span>
        ) : (
          <span className="settings-note">not set</span>
        )
      }
    >
      {(!set || replacing) && (
        <PasswordInput
          m={m}
          board={board}
          onSaved={() => setReplacing(false)}
        />
      )}
      {m?.pwError && <Alert intent="bad">{m.pwError}</Alert>}
    </SettingsItem>
  );
}

function EntryChip({ entry, onRemove }: { entry: string; onRemove(): void }) {
  return (
    <Chip intent="muted" className="settings-chip">
      {entry}
      <button
        type="button"
        className="settings-chip-remove"
        aria-label={`remove ${entry}`}
        onClick={onRemove}
      >
        {ICONS.close}
      </button>
    </Chip>
  );
}

/** Turning sign-in on is local intent until Apply; turning it off calls the
    API at once. The error shows whatever the switch reads, so a teardown
    failure stays visible after the switch is already off. */
function SignInItem({ m, board }: { m: AccessModalState; board: BoardState }) {
  const busy = m.oauthBusy;
  const draft = m.entryDraft;
  const commitDraft = () => board.addAccessEntry(draft);
  const selectMode = (next: Mode) => {
    if (next === m.mode) return;
    board.updateAccessModal({ mode: next });
    board.onOauthMode();
  };
  return (
    <SettingsItem
      icon={SHIELD}
      label={
        <>
          Google sign-in <Help tip={SIGN_IN_TIP} />
        </>
      }
      end={
        <OptimisticSwitch
          checked={m.oauthOn}
          mutate={() => board.onOauthSwitch()}
          aria-label={
            m.oauthOn ? 'turn google sign-in off' : 'require google sign-in'
          }
        />
      }
    >
      {m.oauthOn && (
        <>
          <LabeledSeg
            legend="who can sign in"
            options={MODES}
            labels={MODE_LABELS}
            value={m.mode}
            onChange={selectMode}
          />
          {m.entries.length > 0 && (
            <span className="settings-chips">
              {m.entries.map((entry, i) => (
                <EntryChip
                  key={entry}
                  entry={entry}
                  onRemove={() => board.removeAccessEntry(i)}
                />
              ))}
            </span>
          )}
          <span className="settings-inline-form settings-grow">
            <TextField
              value={draft}
              onChange={ev =>
                board.updateAccessModal({ entryDraft: ev.target.value })
              }
              onKeyDown={ev => {
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  commitDraft();
                  return;
                }
                escapeClearsDraft(ev, draft, () =>
                  board.updateAccessModal({ entryDraft: '' })
                );
              }}
              onBlur={commitDraft}
              placeholder={
                m.mode === 'emails' ? 'Add an email' : 'Add a domain'
              }
              aria-label={m.mode === 'emails' ? 'add email' : 'add domain'}
            />
            <Button
              disabled={m.entries.length === 0 || busy}
              onClick={() => board.applyOauth()}
            >
              Apply
            </Button>
          </span>
        </>
      )}
      {m.oauthError && <Alert intent="bad">{m.oauthError}</Alert>}
    </SettingsItem>
  );
}

/** Who gets in: the password and Google sign-in gates. The access draft is
    board state, opened when the modal opens and released when it closes. */
export function GatesBlock({ row, board, blocks }: BlockProps) {
  if (!blocks.gates) return null;
  const m = board.accessModal?.app === row.name ? board.accessModal : null;
  const open = m != null && !row.hasPassword && !m.oauthOn;
  return (
    <section
      data-block="gates"
      aria-label="Who gets in"
      className="settings-block"
    >
      <div className="settings-block-head">
        <h3 className="settings-heading">Who gets in</h3>
        <p className="settings-note">
          Gates tunnel visitors. Railway needs Google sign-in; a password alone
          does not gate it.
        </p>
      </div>
      <ul className="settings-list">
        <PasswordItem row={row} m={m} board={board} />
        {m && <SignInItem m={m} board={board} />}
      </ul>
      {open && (
        <p className="settings-open-note">
          {ICONS['triangle-alert']}
          {row.name} is open: anyone who can reach the tunnel gets in.
        </p>
      )}
    </section>
  );
}
