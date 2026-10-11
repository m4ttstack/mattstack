import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { rtSelfArgv } from "../rt-self.ts";

export interface ShimOptions {
  /** Baked in, because a GUI git client runs hooks with a bare PATH. */
  rtArgv?: string[];
  timeoutSecs?: number;
}

const DEFAULT_TIMEOUT_SECS = 5;

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

/**
 * Only an answer of exactly "off" skips the hook: rt missing, failing or too
 * slow runs it. rt gets /dev/null for stdin, because a pre-push hook's stdin
 * belongs to the real hook.
 */
export function shimScript(hookName: string, opts: ShimOptions = {}): string {
  const rt = (opts.rtArgv ?? rtSelfArgv()).map(shellQuote).join(" ");
  const timeout = opts.timeoutSecs ?? DEFAULT_TIMEOUT_SECS;
  const onDeckGuard = hookName === "pre-commit" ? `
# On-deck guard: block commits on on-deck/* branches.
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
if [[ "$CURRENT_BRANCH" == on-deck/* ]]; then
  echo "rt: commits are not allowed on on-deck branches (on \\"$CURRENT_BRANCH\\")"
  echo "rt: switch to a feature branch before committing"
  exit 1
fi
` : "";
  return `#!/bin/bash
# rt hook shim: asks rt whether this hook is on and runs the real hook unless rt says off.
${onDeckGuard}
RT=(${rt})
HOOK_NAME=${shellQuote(hookName)}

# Job control puts rt in its own process group, so the watchdog kills any
# child rt left holding this substitution's pipe open too.
ask_rt() {
  set -m
  RT_BATCH=1 "\${RT[@]}" hooks enabled "$HOOK_NAME" </dev/null 2>/dev/null &
  local pid=$!
  ( sleep ${timeout}; kill -- "-$pid" 2>/dev/null ) >/dev/null 2>&1 &
  local watchdog=$!
  wait "$pid" 2>/dev/null
  kill -- "-$watchdog" 2>/dev/null
}

if [ -x "\${RT[0]}" ] && [ "$(ask_rt)" = "off" ]; then
  echo "rt: $HOOK_NAME skipped (turned off with rt hooks)" >&2
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
REAL_HOOK="$REPO_ROOT/.husky/$HOOK_NAME"

if [ -x "$REAL_HOOK" ]; then
  exec "$REAL_HOOK" "$@"
fi
`;
}

/** pre-commit is always written, so the on-deck guard runs even in a repo with no pre-commit of its own. */
export function generateShims(dataDir: string, hookNames: string[], opts: ShimOptions = {}): void {
  const hooksDir = join(dataDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  for (const hookName of new Set(["pre-commit", ...hookNames])) {
    writeFileSync(join(hooksDir, hookName), shimScript(hookName, opts), { mode: 0o755 });
  }
}
