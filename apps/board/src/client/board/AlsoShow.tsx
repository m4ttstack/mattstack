import type { ShowItem } from '../../view.ts';
import { showLabel, type ShowMenuModel } from './Controls.tsx';

/** One pill per unchecked Show item that would bring rows back. */
export function AlsoShow({ show }: { show: ShowMenuModel }) {
  const missing = show.offered.filter(
    i => show.off.includes(i) && show.counts[i] > 0
  );
  if (missing.length === 0) return null;
  return (
    <div className="tui-also-show">
      <span className="tui-also-show-lead">Also show:</span>
      {missing.map((item: ShowItem) => (
        <button
          key={item}
          type="button"
          className="tui-also-show-pill"
          onClick={() => show.toggle(item)}
        >
          + {showLabel(item, show.channel)}{' '}
          <span className="tui-show-count">{show.counts[item]}</span>
        </button>
      ))}
      <button
        type="button"
        className="tui-config-link tui-also-show-all"
        onClick={show.showAll}
      >
        show everything
      </button>
    </div>
  );
}
