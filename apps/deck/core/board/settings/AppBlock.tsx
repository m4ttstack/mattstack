import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Button, TextField } from '@mattstack/tui-kit';
import { NAME_PATTERN } from '../logic.ts';
import type { EditModalState } from '../useBoardState.ts';
import type { BlockProps } from './block.ts';

const NAME_RE = new RegExp(`^(?:${NAME_PATTERN})$`, 'u');

function isSaveable(m: EditModalState): boolean {
  if (!NAME_RE.test(m.name.trim())) return false;
  if (m.port.trim() === '') return false;
  if (
    m.kind === 'service' &&
    (m.command.trim() === '' || m.workingDirectory.trim() === '')
  )
    return false;
  return true;
}

/** A user app's own record. The draft is board state (`editModal`), opened
    when the block mounts and discarded by the modal's close. */
export function AppBlock({ row, board, blocks }: BlockProps) {
  const { openEdit, updateEditModal, editModal: m } = board;
  const name = row.name;
  const rowRef = useRef(row);
  rowRef.current = row;
  const mounted = useRef(false);
  const [saving, setSaving] = useState<EditModalState | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (blocks.app) openEdit(rowRef.current);
  }, [blocks.app, name, openEdit]);

  if (!blocks.app) return null;
  // A successful save clears the board's draft before awaiting its refresh,
  // so the saved values stand in until the draft reopens; unmounting the
  // fields there would drop focus to the page.
  const draft = (m && m.original === row.name ? m : null) ?? saving;
  const service = draft?.kind === 'service';
  const saveable = draft != null && isSaveable(draft);

  const save = async () => {
    if (!draft || !saveable || saving) return;
    const saved = draft;
    setSaving(saved);
    const ok = await board.submitEdit();
    if (!mounted.current) return;
    if (ok) {
      openEdit(rowRef.current);
      updateEditModal({
        ...saved,
        original: saved.name.trim(),
        name: saved.name.trim(),
        error: null,
      });
    }
    setSaving(null);
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') save();
  };

  return (
    <section data-block="app" aria-label="App" className="settings-block">
      <div className="settings-block-head">
        <h3 className="settings-heading">App</h3>
        <p className="settings-note">
          Command and directory exist only for supervised services.
        </p>
      </div>
      {draft && (
        <div className="settings-form">
          {/* The API answers with one message, not a per-field map; it
              lands on name, the field every rejection traces back to. */}
          <TextField
            label="Name"
            aria-label="name"
            value={draft.name}
            onChange={ev => board.updateEditModal({ name: ev.target.value })}
            error={draft.error}
            pattern={NAME_PATTERN}
            required
            onKeyDown={onKeyDown}
          />
          <TextField
            label="Base port"
            aria-label="base port"
            value={draft.port}
            onChange={ev => board.updateEditModal({ port: ev.target.value })}
            inputMode="numeric"
            required
            onKeyDown={onKeyDown}
          />
          {service && (
            <>
              <TextField
                label="Command"
                aria-label="command"
                value={draft.command}
                onChange={ev =>
                  board.updateEditModal({ command: ev.target.value })
                }
                required
                onKeyDown={onKeyDown}
              />
              <TextField
                label="Directory"
                aria-label="directory"
                value={draft.workingDirectory}
                onChange={ev =>
                  board.updateEditModal({
                    workingDirectory: ev.target.value,
                  })
                }
                required
                onKeyDown={onKeyDown}
              />
            </>
          )}
          <div className="settings-form-actions">
            <Button disabled={!saveable} onClick={save}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
