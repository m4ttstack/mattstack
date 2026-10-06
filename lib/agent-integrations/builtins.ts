import { claudeIntegration } from "./claude/integration.ts";
import { codexIntegration } from "./codex/integration.ts";
import type { IntegrationRegistry } from "./contracts.ts";
import { createRegistry } from "./registry.ts";

/** The one composition root for built-in harnesses; claude stays first because refusal text lists IDs in order. */
export function builtinRegistry(): IntegrationRegistry {
  return createRegistry([claudeIntegration, codexIntegration]);
}
