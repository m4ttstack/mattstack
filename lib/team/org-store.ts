import { join } from "path";
import { orgDirUnder } from "../rt-paths.ts";

/** The org clone's own settings file under `home`: the one place a Probes-seamed reader names it. */
export function orgStoreFile(home: string, org: string): string {
  return join(orgDirUnder(home, org), "mattstack", "org", "settings.org.jsonc");
}
