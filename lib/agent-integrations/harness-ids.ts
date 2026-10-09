import type { HarnessId } from "../../packages/rt-client/src/agent-integrations.ts";

/**
 * The built-in harness ids in registry order. Kept apart from `builtins.ts`
 * so that settings validation never loads the adapters: Codex's modules must
 * not reach Claude's discovery. `builtinRegistry()` lists exactly these.
 */
export const BUILTIN_HARNESS_IDS: readonly HarnessId[] = ["claude", "codex"];
