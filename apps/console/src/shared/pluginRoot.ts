const SKILL_DIRS = ['skills', 'attachments'] as const;

const PLUGIN_LAYOUT = new RegExp(
  `^(.*)/(?:${SKILL_DIRS.join('|')})/(?:[^/]+/)?[^/]+/SKILL\\.md$`
);

/**
 * rt lays a plugin out as `<root>/skills/<name>` or
 * `<root>/attachments/[<group>/]<name>`; this walks a SKILL.md path back to
 * that root. Greedy on purpose: the root is the longest such prefix, so a
 * plugin that itself sits under some `skills/` directory still resolves.
 */
export function pluginRootOf(sourcePath: string): string | null {
  return PLUGIN_LAYOUT.exec(sourcePath)?.[1] ?? null;
}

/** The folders of a plugin root that hold every skill file it ships. */
export function pluginSkillDirs(root: string): string[] {
  return SKILL_DIRS.map(dir => `${root}/${dir}`);
}
