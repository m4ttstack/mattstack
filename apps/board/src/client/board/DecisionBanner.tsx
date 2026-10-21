import { Button, Icon } from '@mattstack/tui-kit';
import type { BannerCopy } from './decision-queue.ts';

const INBOX =
  'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z';
const ARROW = 'M5 12h14M12 5l7 7-7 7';

function DecisionBanner({
  copy,
  onStart,
}: {
  copy: BannerCopy;
  onStart: () => void;
}) {
  return (
    <section className="tui-dq-banner" aria-label="decision queue">
      <span className="tui-dq-banner-icon">
        <Icon d={INBOX} width="16" height="16" />
      </span>
      <div className="tui-dq-banner-copy">
        <p className="tui-dq-banner-title">{copy.title}</p>
        <p className="tui-dq-banner-detail">{copy.detail}</p>
      </div>
      <Button
        type="button"
        className="tui-dq-open"
        variant="filled"
        intent="accent"
        onClick={onStart}
      >
        Open queue
        <Icon d={ARROW} />
      </Button>
    </section>
  );
}

export { DecisionBanner };
