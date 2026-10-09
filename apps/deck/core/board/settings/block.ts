import type { Row, SettingsBlocks, StatusData } from '../logic.ts';
import type { BoardState } from '../useBoardState.ts';

/** What every settings modal block receives. A block renders nothing when
    its gate in `blocks` is off. */
export interface BlockProps {
  row: Row;
  data: StatusData;
  board: BoardState;
  blocks: SettingsBlocks;
  /** Called once a rename is saved, before the refresh carries the new name. */
  onRenamed?: (name: string) => void;
}
