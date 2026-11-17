/** One plain string from several fragments, for strings no element can
    sit in (titles, tooltips, markdown, button labels). */
export function joinBullet(
  parts: readonly (string | null | undefined | false)[]
): string {
  return parts.filter(Boolean).join(' • ');
}
