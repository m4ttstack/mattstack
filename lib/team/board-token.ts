/**
 * Whether this machine's board already holds a switchboard token of its own.
 * The board reads SWITCHBOARD_TOKEN from its .env before rt's secrets, and
 * its own peer-join writes only there, so rt checks the same files.
 */

import { join, resolve } from "path";
import type { Probes } from "../setup/probes.ts";
import { isCompiledRt } from "../rt-self.ts";

const TOKEN_LINE = /^[ \t]*(?:export[ \t]+)?SWITCHBOARD_TOKEN[ \t]*=[ \t]*["']?([^"'\s#]+)/m;

/** Mirrors apps/board/src/app-root.ts: BOARD_APP_ROOT wins, the compiled board lives under ~/.mattstack/board. */
function boardRoots(p: Pick<Probes, "home" | "env">, extraRoots: string[]): string[] {
  const override = p.env.BOARD_APP_ROOT;
  return [...(override ? [resolve(override)] : []), join(p.home, ".mattstack", "board"), ...extraRoots];
}

/** A dev-mode board runs from this same checkout, so an rt running from source also checks the checkout's board. */
export function sourceBoardRoots(): string[] {
  return isCompiledRt() ? [] : [join(import.meta.dir, "..", "..", "apps", "board")];
}

export function boardEnvHasSwitchboardToken(p: Pick<Probes, "home" | "env" | "readFile">, extraRoots: string[] = sourceBoardRoots()): boolean {
  return boardRoots(p, extraRoots).some((root) => {
    const raw = p.readFile(join(root, ".env"));
    return raw !== null && TOKEN_LINE.test(raw);
  });
}
