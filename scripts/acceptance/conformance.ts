/**
 * Whether an integration can do what its capability report says. The
 * contract types stop a typed implementation from advertising a capability
 * with no factory behind it; this checks the declaration at run time, where a
 * report is only data: each advertised capability's adapter must load and
 * carry the operations that capability uses.
 */

import type { Capability, Mode } from "../../packages/rt-client/src/agent-integrations.ts";
import type { HarnessIntegration } from "../../lib/agent-integrations/contracts.ts";

type Factory = "loadSessions" | "loadMessaging" | "loadQuestions" | "loadPolicy" | "loadSkills";

const SESSION_OPS = ["launch", "resume", "discover", "observe", "startWork"];

/** The adapter each capability is served by, and the operations it needs there. */
export const CAPABILITY_ADAPTERS: Record<Capability, { factory: Factory; ops: readonly string[] } | null> = {
  launch: { factory: "loadSessions", ops: SESSION_OPS },
  resume: { factory: "loadSessions", ops: SESSION_OPS },
  observe: { factory: "loadSessions", ops: ["observe"] },
  "caller-context": { factory: "loadSessions", ops: ["discover"] },
  "background-state": { factory: "loadSessions", ops: ["observe"] },
  "peer-idle": { factory: "loadMessaging", ops: ["submit"] },
  "peer-working": { factory: "loadMessaging", ops: ["submit"] },
  "questions-form": { factory: "loadQuestions", ops: ["complete"] },
  "questions-wait": { factory: "loadQuestions", ops: ["complete"] },
  "question-recovery": { factory: "loadQuestions", ops: ["complete"] },
  "questions-async": { factory: "loadQuestions", ops: ["complete"] },
  "gate-policy": { factory: "loadPolicy", ops: ["prepare", "verify"] },
  "continuation-policy": { factory: "loadPolicy", ops: ["prepare", "verify"] },
  skills: { factory: "loadSkills", ops: ["inventory", "resourceRoots", "resolveResource", "skillsDir", "maintain"] },
  worktrees: null,
};

/** Every capability the integration advertises in `mode` that its adapters cannot serve; empty when the declaration holds. */
export async function declarationProblems(integration: HarnessIntegration, mode: Mode): Promise<string[]> {
  let supported: Capability[];
  try {
    supported = (await integration.capabilities(mode)).supported;
  } catch (err) {
    return [`${integration.id}: its ${mode} capabilities cannot be read (${(err as Error).message})`];
  }
  const problems: string[] = [];
  const loaded = new Map<Factory, Record<string, unknown> | string>();
  for (const capability of new Set(supported)) {
    if (!(capability in CAPABILITY_ADAPTERS)) {
      problems.push(`${integration.id}: advertises ${capability}, which is not a capability`);
      continue;
    }
    const rule = CAPABILITY_ADAPTERS[capability];
    if (!rule) continue;
    if (!loaded.has(rule.factory)) {
      const factory = (integration as Record<string, unknown>)[rule.factory];
      if (typeof factory !== "function") {
        loaded.set(rule.factory, `has no ${rule.factory}`);
      } else {
        try {
          const adapter = await (factory as () => Promise<unknown>).call(integration);
          loaded.set(rule.factory, adapter && typeof adapter === "object" ? adapter as Record<string, unknown> : `${rule.factory} returned no adapter`);
        } catch (err) {
          loaded.set(rule.factory, `${rule.factory} failed (${(err as Error).message})`);
        }
      }
    }
    const adapter = loaded.get(rule.factory)!;
    if (typeof adapter === "string") {
      problems.push(`${integration.id}: advertises ${capability} in ${mode} mode but ${adapter}`);
      continue;
    }
    const missing = rule.ops.filter((op) => typeof adapter[op] !== "function");
    if (missing.length > 0) problems.push(`${integration.id}: advertises ${capability} in ${mode} mode but its adapter has no ${missing.join(", ")}`);
  }
  return problems;
}
