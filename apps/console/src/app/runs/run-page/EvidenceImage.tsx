import { useState } from 'react';
import { Image, Stack, Text, UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import classes from './EvidenceImage.module.css';

export interface EvidenceImageProps {
  src: string;
  /** The file name; also the accessible name of the open-full-size button. */
  name: string;
  onOpen?: () => void;
  /** Caps the image height; the compare modal and thumbnails differ. */
  maxHeight?: number | string;
  /** A thumbnail: fills its frame edge to edge, cropped from the top. */
  cover?: boolean;
}

/** An image the run's evidence route serves. A failed load is remembered per
    `src`, so a broken file shows its placeholder once and never re-requests. */
export function EvidenceImage({
  src,
  name,
  onOpen,
  maxHeight,
  cover = false,
}: EvidenceImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) {
    return (
      <Stack
        align="center"
        justify="center"
        gap={4}
        className={classes.missing}
        data-testid="evidence-image-unavailable"
      >
        <Icon name="imageOff" size={20} />
        <Text size="sm" c="dimmed">
          image unavailable
        </Text>
      </Stack>
    );
  }

  const image = (
    <Image
      src={src}
      alt={name}
      fit={cover ? 'cover' : 'contain'}
      h={cover ? '100%' : undefined}
      mah={cover ? undefined : maxHeight}
      className={cover ? classes.cover : undefined}
      onError={() => setFailedSrc(src)}
    />
  );
  if (!onOpen) return image;
  return (
    <UnstyledButton
      className={classes.open}
      data-cover={cover || undefined}
      onClick={onOpen}
      aria-label={`Open ${name} full size`}
    >
      {image}
    </UnstyledButton>
  );
}
