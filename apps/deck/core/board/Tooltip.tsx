import { Tooltip as KitTooltip, type TooltipProps } from '@mattstack/tui-kit';

/** Deck's hover reveal is slower than the kit's default; focus still shows at once. */
export const TOOLTIP_DELAY_MS = 750;

export function Tooltip(props: TooltipProps) {
  return <KitTooltip delay={TOOLTIP_DELAY_MS} {...props} />;
}
