import { useEffect, useRef, type RefObject } from 'react';

import { Modal } from '@mattstack/tui-kit';
import {
  settingsBlocks,
  settingsFormFor,
  type Row,
  type SettingsBlocks,
  type StatusData,
} from '../logic.ts';
import type { BoardState } from '../useBoardState.ts';
import { AppBlock } from './AppBlock.tsx';
import type { BlockProps } from './block.ts';
import { CodeBlock } from './CodeBlock.tsx';
import { DangerFooter } from './DangerFooter.tsx';
import { GatesBlock } from './GatesBlock.tsx';
import { IssuesBlock, SettingsHeader } from './Header.tsx';
import { LiveProcessesBlock } from './LiveProcessesBlock.tsx';
import { PortBlock } from './PortBlock.tsx';
import { ReachBlock } from './ReachBlock.tsx';
import { RecentErrors } from './RecentErrors.tsx';
import { ServiceForm } from './ServiceForm.tsx';
import { TunnelForm } from './TunnelForm.tsx';

export interface AppSettingsModalProps {
  /** The open row, or null once a poll has dropped it. */
  row: Row | null;
  data: StatusData;
  board: BoardState;
  onClose: () => void;
  onRenamed: (name: string) => void;
  /** The gear or tunnel badge that opened the modal, resolved at close. */
  returnFocusTo: () => HTMLElement | null;
  /** Where focus lands when the row vanishes, or its opener has. */
  fallbackFocusRef: RefObject<HTMLElement | null>;
}

/** Who can reach it and who gets in: both need canManage. */
function hasRightColumn(blocks: SettingsBlocks): boolean {
  return blocks.reach || blocks.gates;
}

function AppForm(props: BlockProps) {
  return (
    <>
      <div className="settings-grid">
        <div className="settings-col">
          <CodeBlock {...props} />
          <LiveProcessesBlock {...props} />
          <AppBlock {...props} />
          <PortBlock {...props} />
          <RecentErrors {...props} />
        </div>
        {hasRightColumn(props.blocks) && (
          <div className="settings-col">
            <ReachBlock {...props} />
            <GatesBlock {...props} />
          </div>
        )}
      </div>
      <DangerFooter {...props} />
    </>
  );
}

function focusAfterClose(target: HTMLElement | null) {
  requestAnimationFrame(() => target?.focus());
}

/** One app's settings. The kit Modal handles Escape (one document listener
    for the whole layer stack), the backdrop and the close button; this adds
    the focus contract the kit lacks. An input that wants Escape for itself
    calls `stopPropagation()` in its React `onKeyDown`: React listens at the
    root container, below `document`, so the kit's listener never sees it. */
export function AppSettingsModal({
  row,
  data,
  board,
  onClose,
  onRenamed,
  returnFocusTo,
  fallbackFocusRef,
}: AppSettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef(row);
  rowRef.current = row;
  const name = row?.name ?? null;
  const { openAccess, closeAccess, cancelEdit, closeEdit } = board;

  useEffect(() => {
    dialogRef.current
      ?.querySelector<HTMLElement>('[data-part="modal-close"]')
      ?.focus();
  }, []);

  // Drafts live in board state, and a dev port draft pauses polling, so
  // every way out of the modal releases them.
  useEffect(() => {
    if (name == null) return;
    if (rowRef.current) openAccess(rowRef.current);
    return () => {
      closeAccess();
      cancelEdit();
      closeEdit();
    };
  }, [name, openAccess, closeAccess, cancelEdit, closeEdit]);

  useEffect(() => {
    if (row) return;
    onClose();
    focusAfterClose(fallbackFocusRef.current);
  }, [row, onClose, fallbackFocusRef]);

  if (!row) return null;

  const close = () => {
    const opener = returnFocusTo();
    onClose();
    focusAfterClose(opener?.isConnected ? opener : fallbackFocusRef.current);
  };

  const form = settingsFormFor(row);
  const props: BlockProps = {
    row,
    data,
    board,
    blocks: settingsBlocks(row, data),
    onRenamed,
  };
  return (
    <Modal
      ref={dialogRef}
      title={<SettingsHeader {...props} />}
      ariaLabel={`settings for ${row.name}`}
      onClose={close}
      className={
        form === 'app' && hasRightColumn(props.blocks)
          ? 'app-settings-modal'
          : 'app-settings-modal app-settings-reduced'
      }
      overlayClassName="app-settings-overlay"
    >
      <IssuesBlock {...props} />
      {form === 'tunnel' && <TunnelForm {...props} />}
      {form === 'service' && <ServiceForm {...props} />}
      {form === 'app' && <AppForm {...props} />}
    </Modal>
  );
}
