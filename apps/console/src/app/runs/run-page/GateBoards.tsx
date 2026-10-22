import { useState } from 'react';
import { Group, Paper, Stack, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import {
  boardName,
  type BoardsContext,
  type GateBoard,
} from '../../../shared/gate-boards';
import { Eyebrow } from '../Eyebrow';
import { GateContext } from '../GateContext';
import { EvidenceFrame, EvidenceModal, usePager } from './EvidenceCompare';
import { EvidenceImage } from './EvidenceImage';
import classes from './GateBoards.module.css';

export const boardUrl = (gateId: string, path: string): string =>
  `/api/gates/${encodeURIComponent(gateId)}/board?path=${encodeURIComponent(path)}`;

/** Every board an evidence gate is about to attach, large enough to read,
    so the human sees what would go public before answering. */
export function GateBoards({
  gateId,
  boards,
  srcOf = path => boardUrl(gateId, path),
}: {
  gateId: string;
  boards: BoardsContext;
  /** Where a board's image loads from; the gate's board route by default. */
  srcOf?: (path: string) => string;
}) {
  const [full, setFull] = useState<string | null>(null);
  return (
    <Stack
      gap={10}
      className={classes.context}
      data-parity="context"
      data-testid="gate-boards"
    >
      <Group justify="space-between" gap={8}>
        <Eyebrow data-parity="label">Boards to attach</Eyebrow>
        <Group gap={4} c="dimmed">
          <Icon name="maximize" size={12} />
          <Text fz="sm" c="dimmed">
            Click a board to open it full size
          </Text>
        </Group>
      </Group>
      {boards.summary ? (
        <div className={classes.summary}>
          <GateContext text={boards.summary} />
        </div>
      ) : null}
      <div className={classes.grid}>
        {boards.boards.map(b => (
          <Stack key={b.path} gap={4} className={classes.board}>
            <Paper
              variant="panel-outline"
              radius="md"
              className={classes.frame}
            >
              <EvidenceImage
                src={srcOf(b.path)}
                name={boardName(b)}
                maxHeight={360}
                onOpen={() => setFull(b.path)}
              />
            </Paper>
            <Text fz="sm" ff="monospace" c="dimmed" className={classes.name}>
              {boardName(b)}
            </Text>
            <Text fz="sm" lh="normal">
              {b.caption}
            </Text>
          </Stack>
        ))}
      </div>
      {full && (
        <BoardsModal
          srcOf={srcOf}
          boards={boards.boards}
          path={full}
          onShow={setFull}
          onClose={() => setFull(null)}
        />
      )}
    </Stack>
  );
}

/** One board full size, paging through the gate's others. */
function BoardsModal({
  srcOf,
  boards,
  path,
  onShow,
  onClose,
}: {
  srcOf: (path: string) => string;
  boards: GateBoard[];
  path: string;
  onShow: (path: string) => void;
  onClose: () => void;
}) {
  const shown = boards.find(b => b.path === path) ?? boards[0]!;
  const pager = usePager({
    items: boards.map(b => ({ value: b.path, label: boardName(b) })),
    value: shown.path,
    onChange: onShow,
    noun: 'board',
  });
  return (
    <EvidenceModal
      title={pager?.title ?? boardName(shown)}
      pager={pager?.pager}
      onClose={onClose}
    >
      <EvidenceFrame
        src={srcOf(shown.path)}
        name={boardName(shown)}
        caption={
          <Stack gap={2}>
            <Text fz="md">{shown.caption}</Text>
            <Text fz="sm" ff="monospace" c="dimmed">
              {shown.path}
            </Text>
          </Stack>
        }
      />
    </EvidenceModal>
  );
}
