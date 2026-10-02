import { useLocalStorage } from '@mattstack/app-kit/hooks';

/** Whether the drawer's text wraps long lines, the viewer's last choice. */
export function useDrawerWrap(): [boolean, (wrap: boolean) => void] {
  const [wrap, setWrap] = useLocalStorage<boolean>({
    key: 'console-skill-drawer-wrap',
    defaultValue: false,
  });
  return [wrap === true, setWrap];
}
