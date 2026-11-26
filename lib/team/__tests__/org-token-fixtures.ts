import { join } from "path";

import { orgsDirUnder } from "../../rt-paths.ts";

/** A token in the relay's org token format; `fill` picks its hex so two tokens differ. */
export function orgToken(fill = "a"): string {
  return `sbo_${fill.repeat(64)}`;
}

/** The dirs and files `discoverOrgs` needs to see `slugs` as this Mac's org clones. */
export function orgClones(home: string, ...slugs: string[]): { dirs: Record<string, string[]>; files: Record<string, string> } {
  const root = orgsDirUnder(home);
  return {
    dirs: { [root]: [...slugs] },
    files: Object.fromEntries(slugs.map((slug) => [join(root, slug, "mattstack", "org", "settings.org.jsonc"), "{}"])),
  };
}
