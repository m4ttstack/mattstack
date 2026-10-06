import { existsSync } from "fs";
import { join } from "path";

/** Where the dev daemon and deck's from-source apps run from; the older folder name stays a fallback for a machine that has not moved it. */
export const SHARED_CHECKOUT_CANDIDATES = ["Documents/GitHub/mattstack", "Documents/GitHub/repo-tools"] as const;

/** The checkout dev mode stores (rt dev setup and rt settings source-path write it) wins when it holds a cli.ts, so a clone outside ~/Documents/GitHub is found; the fixed folders are the fallback. */
export function resolveSharedCheckout(home: string, exists: (p: string) => boolean = existsSync, stored: string | null = null): string {
  if (stored && exists(join(stored, "cli.ts"))) return stored;
  for (const rel of SHARED_CHECKOUT_CANDIDATES) {
    const dir = join(home, rel);
    if (exists(join(dir, "cli.ts"))) return dir;
  }
  return join(home, SHARED_CHECKOUT_CANDIDATES[0]);
}
