import type { Capability, CapabilityReport, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";

/** Admit only against the supplied report; no probes, fallbacks or option routing. */
export function admit(report: CapabilityReport, required: readonly Capability[]): Outcome<void> {
  if (!report.readiness.ready) {
    return {
      ok: false,
      error: { code: "not-ready", message: report.readiness.reason || "The integration is not ready" },
    };
  }
  const supported = new Set(report.supported);
  const missing = [...new Set(required)].filter((capability) => !supported.has(capability));
  if (missing.length > 0) {
    return {
      ok: false,
      error: { code: "unsupported", message: `The integration does not support: ${missing.join(", ")}` },
    };
  }
  return { ok: true, data: undefined };
}
