/**
 * rt skills lsp -- the skill blocks language server, over stdio.
 *
 *   rt skills lsp [--root <dir>]... [--stdio]
 *
 * Stdout is the LSP channel from the first byte, so every human line goes to stderr.
 * The verb never resolves: the library ends the process on `exit`, and resolving would log a 0ms ok.
 */

import { resolve } from "node:path";
import { startServer } from "../lib/skills/lsp/server.ts";
import * as out from "../lib/ui/out.ts";
import { usageFailure } from "../lib/ui/usage.ts";

const USAGE = "rt skills lsp --root <dir>";

export async function skillsLsp(args: string[]): Promise<void> {
  out.payloadOnStdout();
  const roots: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--stdio") continue;
    if (a === "--root") {
      const value = args[++i];
      if (!value || value.startsWith("--")) {
        out.fail(usageFailure("Which folder should the language server look in?", USAGE));
        process.exit(1);
      }
      roots.push(resolve(value));
      continue;
    }
    out.fail({ title: "rt skills lsp does not take that option", hint: a });
    process.exit(1);
  }
  startServer({ roots });
  return new Promise<never>(() => {});
}
