import { Icon, type IconName } from '@mattstack/app-kit/icons';

/** An icon in a box the size of the glyph, so it can carry a parity name. */
export function Glyph({
  name,
  size,
  color,
  parity,
  className,
}: {
  name: IconName;
  size: number;
  color: string;
  parity?: string;
  className?: string;
}) {
  return (
    <span
      className={className}
      data-parity={parity}
      style={{
        display: 'inline-flex',
        flexShrink: 0,
        width: size,
        height: size,
        color,
      }}
    >
      <Icon name={name} size={size} color={color} />
    </span>
  );
}
