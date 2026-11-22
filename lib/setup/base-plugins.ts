/**
 * rt's own baseline plugin set. Lives apart from `steps/plugins.ts` so the
 * `tool.plugins` validator can watch exactly what `plugins.install` installs
 * without a validator importing a step (or a second copy of the list drifting
 * from the first).
 */
/** mattstack's superpowers fork: the baseline copy, and what every superseded stock copy gives way to. */
export const SUPERPOWERS_FORK = "superpowers@mattstack";

export const BASE_PLUGINS: string[] = [
  "mattstack@mattstack",
  "fast-browser@mattstack",
  "chat@mattstack",
  "gate-form@mattstack",
  "human-todos@mattstack",
  "fresh-context@mattstack",
  // The mattstack skills and every compiled team pack invoke superpowers:*
  // skills; without it a pipeline dies mid-run on a missing skill. This is
  // mattstack's fork (task groups, Native with reviews), listed in the
  // mattstack marketplace under the same plugin name.
  SUPERPOWERS_FORK,
];

/**
 * Stock copies the mattstack fork replaces. Two enabled plugins named
 * `superpowers` serve the same skill names from either copy, so these are
 * never installed from a team list, and the one-time swap migration turns
 * them off. An explicit list, never a name match.
 */
export const SUPERSEDED_PLUGINS: Readonly<Record<string, string>> = {
  "superpowers@claude-plugins-official": SUPERPOWERS_FORK,
  "superpowers@superpowers-marketplace": SUPERPOWERS_FORK,
};

export function isSuperseded(id: string): boolean {
  return Object.hasOwn(SUPERSEDED_PLUGINS, id);
}

/**
 * Other ids that ARE the same plugin. Installing the baseline id beside one
 * would register a second plugin under the same skill namespace. An explicit
 * list, never a name match: a lookalike marketplace must not satisfy a
 * baseline entry.
 */
const BASE_PLUGIN_ALTERNATES: Record<string, string[]> = {};

/** The id to install, update, and check for a baseline entry: itself when present or when nothing equivalent is, else the installed alternate. */
export function resolveBasePlugin(id: string, installed: (id: string) => boolean): string {
  if (installed(id)) return id;
  return (BASE_PLUGIN_ALTERNATES[id] ?? []).find(installed) ?? id;
}
