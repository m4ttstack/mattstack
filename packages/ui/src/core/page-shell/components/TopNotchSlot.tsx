import { useLayoutEffect } from 'react';
import { Box, Group, Transition } from '@mantine/core';

import { useElementSize } from '@mattstack/app-kit/hooks';

export interface PageShellTopNotch {
  content: React.ReactNode;
  opened: boolean;
}

/**
 * The banner slot: stays mounted while closed, and its wrapper animates its
 * height between the measured banner height and 0 so the banner slides away
 * instead of popping out of layout. `onHeight` hears the height the slot
 * takes up (0 while closed), for a host whose height math must leave room.
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
  const taken = notch.opened ? height : 0;

  useLayoutEffect(() => {
    onHeight?.(taken);
  }, [onHeight, taken]);

  return (
    <Box style={{ height: taken, transition: 'height 200ms linear' }}>
      <Transition
        keepMounted
        mounted={notch.opened}
        transition="slide-down"
        duration={200}
        timingFunction="ease"
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
