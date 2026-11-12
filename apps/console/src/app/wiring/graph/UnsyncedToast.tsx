import { ToastPill, useToastOnce } from '../../toast/ToastPill';
import { useUnsyncedSummary } from './UnsyncedBanner';

/**
 * The pack's unsynced changes as one notification over the page: shown once
 * per change list, never again until the list changes, so the History tab's
 * badge carries the state after it. Clicking it opens that list in History.
 */
export function UnsyncedToast({
  pack,
  ready,
  onReview,
}: {
  pack: string;
  /** The page has drawn its content, so the pill never arrives ahead of it. */
  ready: boolean;
  onReview: () => void;
}) {
  const summary = useUnsyncedSummary(pack);
  const toast = useToastOnce({
    storageKey: `console-unsynced-seen-${pack}`,
    signature: summary?.signature ?? null,
    ready,
  });

  const title = summary?.trial
    ? `${summary.count} ${summary.count === 1 ? 'trial change' : 'trial changes'}`
    : `${summary?.count} ${summary?.count === 1 ? 'change' : 'changes'} not synced`;

  return (
    <ToastPill
      mounted={toast.visible && summary !== null}
      title={title}
      meta={summary?.trial ? `${pack} · ${summary.trial}` : pack}
      onReview={() => {
        toast.hide();
        onReview();
      }}
      onDismiss={toast.hide}
      onHoverChange={toast.setHovered}
      testId="unsynced-toast"
    />
  );
}
