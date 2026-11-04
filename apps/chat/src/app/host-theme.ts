/** The scheme an embedding app names with `?theme=dark|light`. Forced at mount,
    so it isn't saved over the viewer's own choice in the same browser. */
export function hostTheme(
  path: string,
  search: string
): 'dark' | 'light' | undefined {
  if (!path.startsWith('/embed/')) return undefined;
  const theme = new URLSearchParams(search).get('theme');
  return theme === 'dark' || theme === 'light' ? theme : undefined;
}
