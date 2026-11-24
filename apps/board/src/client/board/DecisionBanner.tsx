import { useId } from 'react';

import { Button, Icon } from '@mattstack/tui-kit';
import type { BannerCopy } from './decision-queue.ts';
import { AgentGlyph } from './icons.tsx';
import { QUEUE_KEY, useQueueKey } from './queue-key.ts';
import { KeyCap } from './SheetParts.tsx';

const ARROW = 'M5 12h14M12 5l7 7-7 7';

function DecisionBanner({
  copy,
  onStart,
}: {
  copy: BannerCopy;
  onStart: () => void;
}) {
  const titleId = useId();
  useQueueKey(onStart);
  return (
    <section className="tui-dq-banner" aria-labelledby={titleId}>
      <span className="tui-dq-banner-icon">
        <AgentGlyph size={16} />
      </span>
      <div className="tui-dq-banner-copy">
        <p id={titleId} className="tui-dq-banner-title">
          {copy.title}
        </p>
        <p className="tui-dq-banner-detail">{copy.detail}</p>
      </div>
      <span className="tui-dq-key" aria-hidden="true">
        press <KeyCap keys={QUEUE_KEY} />
      </span>
      <Button
        type="button"
        className="tui-dq-open"
        variant="filled"
        intent="accent"
        aria-keyshortcuts={QUEUE_KEY}
        onClick={onStart}
      >
        Open queue
        <Icon d={ARROW} />
      </Button>
    </section>
  );
}

export { DecisionBanner };
