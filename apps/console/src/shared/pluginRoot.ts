const PLUGIN_LAYOUT =
  /^(.*)\/(?:skills|attachments)\/(?:[^/]+\/)?[^/]+\/SKILL\.md$/;

/**
 * rt lays a plugin out as `<root>/skills/<name>` or
 * `<root>/attachments/[<group>/]<name>`; this walks a SKILL.md path back to
 * that root. Greedy on purpose: the root is the longest such prefix, so a
 * plugin that itself sits under some `skills/` directory still resolves.
 */
export function pluginRootOf(sourcePath: string): string | null {
  return PLUGIN_LAYOUT.exec(sourcePath)?.[1] ?? null;
}
