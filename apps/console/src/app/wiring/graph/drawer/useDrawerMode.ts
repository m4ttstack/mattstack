import { useLocalStorage } from '@mattstack/app-kit/hooks';

/** Where the skill drawer opens: beside the canvas, or over the whole
    screen. */
export type DrawerMode = 'side' | 'full';

/** The viewer's last choice, kept in step across every caller in the tab by
    the kit's localStorage shadow. */
export function useDrawerMode(): [DrawerMode, (mode: DrawerMode) => void] {
  const [mode, setMode] = useLocalStorage<DrawerMode>({
    key: 'console-skill-drawer-mode',
    defaultValue: 'side',
  });
  return [mode === 'full' ? 'full' : 'side', setMode];
}
