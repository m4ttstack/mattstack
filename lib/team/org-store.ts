import { join } from "path";

/** The org clone's own settings file under `home`: the one place a Probes-seamed reader names it. */
export function orgStoreFile(home: string, org: string): string {
  return join(home, ".mattstack", "teams", org, "mattstack", "org", "settings.org.jsonc");
}
