import type { Probes } from "./probes.ts";

/** Where macOS installs Google Chrome, for every user or for this one. */
export const CHROME_PATHS = (home: string): string[] => ["/Applications/Google Chrome.app", `${home}/Applications/Google Chrome.app`];

export function chromeInstalled(p: Pick<Probes, "home" | "exists">): boolean {
  return CHROME_PATHS(p.home).some((path) => p.exists(path));
}
