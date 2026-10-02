import { useLayoutEffect, useState } from 'react';
import { Box, Group, Transition } from '@mantine/core';

import { useElementSize } from '@mattstack/app-kit/hooks';

export interface PageShellTopNotch {
  content: React.ReactNode;
  opened: boolean;
}

/**
 * The banner slot: stays mounted while closed, and its wrapper animates its
 * height between the measured banner height and 0 so the banner slides away
 * instead of popping out of layout.
 *
 * `onHeight` hears the room a host must leave for the slot: the banner's
 * height from the moment it opens, and 0 once it has finished sliding out or
 * the slot unmounts. A host that sizes its other frames by it never lays one
 * over the band, so for such a host the band moves only as it opens and
 * closes, and a resize in place lands at once, as the reported height does.
 */
export function TopNotchSlot({
  notch,
  onHeight,
}: {
  notch: PageShellTopNotch;
  onHeight?: (height: number) => void;
}) {
  // `height: auto` can't transition, so the wrapper animates to the measured
  // pixel height instead.
  const { ref, height } = useElementSize();
  const [shownOpen, setShownOpen] = useState(notch.opened);
  const [moving, setMoving] = useState(false);
  if (shownOpen !== notch.opened) {
    setShownOpen(notch.opened);
    setMoving(true);
  }

  useLayoutEffect(() => {
    if (notch.opened) onHeight?.(height);
  }, [onHeight, notch.opened, height]);

  useLayoutEffect(() => () => onHeight?.(0), [onHeight]);

  const animated = moving || onHeight === undefined;

  return (
    <Box
      style={{
        height: notch.opened ? height : 0,
        transition: animated ? 'height 200ms linear' : undefined,
      }}
    >
      <Transition
        keepMounted
        mounted={notch.opened}
        transition="slide-down"
        duration={200}
        timingFunction="ease"
        onEntered={() => setMoving(false)}
        onExited={() => {
          setMoving(false);
          onHeight?.(0);
        }}
      >
        {transitionStyle => (
          <div ref={ref} style={transitionStyle}>
            <Group w="100%" justify="center">
              {notch.content}
            </Group>
          </div>
        )}
      </Transition>
    </Box>
  );
}
