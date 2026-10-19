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
import { EvidenceFrame, EvidenceModal } from './EvidenceCompare';
import { EvidenceImage } from './EvidenceImage';
import classes from './GateBoards.module.css';

export const boardUrl = (gateId: string, path: string): string =>
  `/api/gates/${encodeURIComponent(gateId)}/board?path=${encodeURIComponent(path)}`;

/** Every board an evidence gate is about to attach, large enough to read,
    so the human sees what would go public before answering. */
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
                src={boardUrl(gateId, b.path)}
                name={boardName(b)}
                maxHeight={360}
                onOpen={() => setFull(b)}
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
