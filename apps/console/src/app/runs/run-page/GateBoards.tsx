import { useState } from 'react';
import { Paper, Stack, Text } from '@mattstack/app-kit/core';

import {
  boardName,
  BOARDS_QUESTION,
  type BoardsContext,
  type GateBoard,
} from '../../../shared/gate-boards';
import { Eyebrow } from '../Eyebrow';
import { GateContext } from '../GateContext';
import { EvidenceFrame, EvidenceModal } from './EvidenceCompare';
import { EvidenceImage } from './EvidenceImage';
import classes from './GateBoards.module.css';

export const boardUrl = (gateId: string, path: string): string =>
  `/api/gates/${encodeURIComponent(gateId)}/board?path=${encodeURIComponent(path)}`;

/** Every board an evidence gate is about to attach, so the human sees what
    would go public before answering. */
export function GateBoards({
  gateId,
  boards,
}: {
  gateId: string;
  boards: BoardsContext;
}) {
  const [full, setFull] = useState<GateBoard | null>(null);
  return (
    <Stack
      gap={10}
      className={classes.context}
      data-parity="context"
      data-testid="gate-boards"
    >
      <Eyebrow data-parity="label">Boards to attach</Eyebrow>
      {boards.summary ? (
        <div className={classes.summary}>
          <GateContext text={boards.summary} />
        </div>
      ) : null}
      <Text fz="md" fw={500} lh="normal">
        {BOARDS_QUESTION}
      </Text>
      <div className={classes.grid}>
        {boards.boards.map(b => (
          <Stack key={b.path} gap={4} className={classes.board}>
            <Paper
              variant="panel-outline"
              radius="md"
              className={classes.frame}
            >
              <EvidenceImage
                src={boardUrl(gateId, b.path)}
                name={boardName(b)}
                cover
                onOpen={() => setFull(b)}
              />
            </Paper>
            <Text fz="sm" ff="monospace" c="dimmed" truncate>
              {boardName(b)}
            </Text>
            <Text fz="sm" lh="normal">
              {b.caption}
            </Text>
          </Stack>
        ))}
      </div>
      {full && (
        <EvidenceModal title={boardName(full)} onClose={() => setFull(null)}>
          <EvidenceFrame
            src={boardUrl(gateId, full.path)}
            name={boardName(full)}
            caption={
              <Stack gap={2}>
                <Text fz="md">{full.caption}</Text>
                <Text fz="sm" ff="monospace" c="dimmed">
                  {full.path}
                </Text>
              </Stack>
            }
          />
        </EvidenceModal>
      )}
    </Stack>
  );
}
