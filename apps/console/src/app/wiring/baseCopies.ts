/** A link is written relative to the verb that holds it, so only the part from `attachments/` on is the pack-relative path. */
const ATTACHMENTS = /(^|\/)attachments\//;

export function baseCopyOf(
  path: string,
  attachments: { name: string; base: string | null }[] | undefined
): string | null {
  const match = ATTACHMENTS.exec(path);
  if (!match || !attachments) return null;
  const rel = path.slice(match.index + match[0].length);
  return (
    attachments.find(row => row.base !== null && rel.startsWith(`${row.name}/`))
      ?.base ?? null
  );
}
