/**
 * The harness acceptance matrix: which scenarios each distributed profile
 * must pass, and the audit rows (A01–A28) each one is evidence for.
 *
 * A scenario with `scope: "harness"` is required once per harness in the
 * profile; one with `scope: "profile"` once per profile. Every scenario
 * listed is required: an optional native feature (an async question form a
 * harness does not offer) is recorded apart, as a native form, and never
 * stands in for one of these.
 */

export const PROFILES = ["claude-only", "codex-only", "mixed"] as const;
export type Profile = (typeof PROFILES)[number];

export const ACCEPTANCE_HARNESSES = ["claude", "codex"] as const;
export type AcceptanceHarness = (typeof ACCEPTANCE_HARNESSES)[number];

export const PROFILE_HARNESSES: Record<Profile, readonly AcceptanceHarness[]> = {
  "claude-only": ["claude"],
  "codex-only": ["codex"],
  mixed: ["claude", "codex"],
};

/** The scenario ids the plan names, verbatim. */
export const PLAN_SCENARIO_IDS = [
  "hook-trust-fresh",
  "hook-trust-changed",
  "hook-script-tampered",
  "hook-timeout",
  "hook-repeated-stop",
  "question-controller-reconnect",
  "question-answer-race",
  "all-clients-disconnect",
  "rt-restart-after-answer",
  "native-restart-pending-question",
  "native-restart-queued-input",
  "consumption-client-id",
  "default-cli-adoption",
] as const;

/** What a scenario needs before it can run at all; without it the runner records it blocked. */
export type Need =
  /** Stops or restarts a service, or installs/removes the app: only an isolated, acceptance-owned environment. */
  | "disruptive"
  /** A person answers, approves (Touch ID) or clicks something rt never answers for them. */
  | "person"
  /** The evidence is a browser capture of an app flow. */
  | "browser";

export type ScenarioDef = {
  id: string;
  title: string;
  scope: "harness" | "profile";
  auditIds: readonly string[];
  needs: readonly Need[];
  /** Absent: every profile. */
  profiles?: readonly Profile[];
  /** A restart scenario must prove what happened to the original operation, not that a replacement worked. */
  restart?: true;
  /** The capture must carry the native event log its identity and timing are checked against. */
  events?: true;
};

export const SCENARIOS: readonly ScenarioDef[] = [
  // The plan's named recovery and policy scenarios.
  { id: "hook-trust-fresh", title: "A fresh install's policy hooks load only after the person approves them", scope: "harness", auditIds: ["A12", "A14", "A21"], needs: ["person"] },
  { id: "hook-trust-changed", title: "A changed hook definition withdraws readiness until approved again", scope: "harness", auditIds: ["A12", "A14", "A21"], needs: ["person"] },
  { id: "hook-script-tampered", title: "A tampered hook program is refused and never treated as proof", scope: "harness", auditIds: ["A12", "A14"], needs: [] },
  { id: "hook-timeout", title: "A hook that times out fails closed and the gate still holds", scope: "harness", auditIds: ["A12", "A14"], needs: [] },
  { id: "hook-repeated-stop", title: "Repeated Stop attempts cannot end a run past a required gate", scope: "harness", auditIds: ["A14"], needs: [] },
  { id: "question-controller-reconnect", title: "A pending question survives its controller reconnecting", scope: "harness", auditIds: ["A11"], needs: ["disruptive"], events: true },
  { id: "question-answer-race", title: "Competing answers: one stored winner, completed once natively", scope: "harness", auditIds: ["A11"], needs: ["person", "browser"] },
  { id: "all-clients-disconnect", title: "Every client disconnects; owed deliveries and gates recover", scope: "harness", auditIds: ["A09", "A11"], needs: ["disruptive"], events: true },
  { id: "rt-restart-after-answer", title: "rt restarts after an answer and before native completion", scope: "harness", auditIds: ["A11"], needs: ["disruptive"], restart: true, events: true },
  { id: "native-restart-pending-question", title: "The harness restarts with a question pending", scope: "harness", auditIds: ["A06", "A11"], needs: ["disruptive"], restart: true, events: true },
  { id: "native-restart-queued-input", title: "The harness restarts with peer input queued", scope: "harness", auditIds: ["A09"], needs: ["disruptive"], restart: true, events: true },
  { id: "consumption-client-id", title: "Consumption is attributed by the native client id, not by transport acceptance", scope: "harness", auditIds: ["A09"], needs: [] },
  { id: "default-cli-adoption", title: "rt agent starts the configured default harness", scope: "harness", auditIds: ["A01", "A26"], needs: [] },

  // The workflows the spec's live acceptance names.
  { id: "install", title: "Clean install from the distributed app", scope: "profile", auditIds: ["A20", "A21", "A26"], needs: ["disruptive", "person"] },
  { id: "release-artifact", title: "The installed bundle carries this profile's skills and helpers", scope: "profile", auditIds: ["A17", "A28"], needs: [] },
  { id: "skills-mcp", title: "Skills load and the Mattstack MCP tools answer", scope: "harness", auditIds: ["A16", "A17", "A19", "A21"], needs: [] },
  { id: "skills-maintenance", title: "Skills init, list, sync, update, link, audit and writing style", scope: "harness", auditIds: ["A18"], needs: [] },
  { id: "launch-headless", title: "Headless launch and resume resolve the native session", scope: "harness", auditIds: ["A01", "A02", "A07"], needs: [] },
  { id: "launch-herdr", title: "Herdr pane launch and resume resolve the native session", scope: "harness", auditIds: ["A01", "A02", "A07", "A10"], needs: [] },
  { id: "chat", title: "Sign-in, delivery, reply attribution, sign-out", scope: "harness", auditIds: ["A08", "A09", "A24"], needs: [] },
  { id: "gates-external-answer", title: "A gate answered in the browser completes the native question", scope: "harness", auditIds: ["A11", "A12"], needs: ["person", "browser"] },
  { id: "pipeline", title: "A pipeline run attributes its stages and holds at its gates", scope: "harness", auditIds: ["A13", "A14"], needs: [] },
  { id: "ci-lease", title: "CI lease acquire, release and replacement", scope: "harness", auditIds: ["A15"], needs: [] },
  { id: "shepherd-workers", title: "shepherdr spawns, supervises, retries and closes workers", scope: "harness", auditIds: ["A03", "A04", "A05", "A19"], needs: [] },
  { id: "board-actions", title: "Board review, respond and doctor launch and report", scope: "harness", auditIds: ["A23"], needs: ["browser"] },
  { id: "gitq-actions", title: "gitq agent actions launch and report their job", scope: "harness", auditIds: ["A25"], needs: [] },
  { id: "chat-app", title: "The chat app finds, creates, invites and messages sessions", scope: "harness", auditIds: ["A10", "A24"], needs: ["browser"] },
  { id: "worktrees", title: "Enter, create, remove and relocate rt-owned worktrees", scope: "harness", auditIds: ["A27"], needs: [] },
  { id: "state-idle", title: "Runtime state: idle", scope: "harness", auditIds: ["A05", "A06"], needs: [] },
  { id: "state-working", title: "Runtime state: working", scope: "harness", auditIds: ["A05", "A06"], needs: [] },
  { id: "state-question-blocked", title: "Runtime state: blocked on a question", scope: "harness", auditIds: ["A06", "A11"], needs: [] },
  { id: "state-background", title: "Runtime state: foreground idle with background work", scope: "harness", auditIds: ["A06"], needs: [] },
  { id: "state-disconnected", title: "Runtime state: disconnected", scope: "harness", auditIds: ["A05", "A07"], needs: ["disruptive"], events: true },
  { id: "state-resumed", title: "Runtime state: resumed", scope: "harness", auditIds: ["A07", "A08"], needs: [] },
  { id: "state-confirmed-dead", title: "Runtime state: confirmed dead, distinct from unknown", scope: "harness", auditIds: ["A05"], needs: ["disruptive"] },
  { id: "update", title: "An app update keeps every choice and re-runs only update-safe steps", scope: "profile", auditIds: ["A22"], needs: ["disruptive"] },
  { id: "restore", title: "Team restore materializes this profile's harness skills", scope: "profile", auditIds: ["A22"], needs: ["disruptive"] },
  { id: "uninstall", title: "Uninstall removes what rt added and leaves the rest", scope: "profile", auditIds: ["A22"], needs: ["disruptive"] },

  // Profile-specific.
  { id: "codex-only-no-claude", title: "Nothing in a Codex-only installation ran Claude or wrote its configuration", scope: "profile", auditIds: ["A20", "A28"], needs: [], profiles: ["codex-only"] },
  { id: "mixed-shepherd-claude", title: "A Claude shepherd runs a Claude and a Codex worker", scope: "profile", auditIds: ["A03", "A04", "A09"], needs: [], profiles: ["mixed"] },
  { id: "mixed-shepherd-codex", title: "A Codex shepherd runs a Claude and a Codex worker", scope: "profile", auditIds: ["A03", "A04", "A09"], needs: [], profiles: ["mixed"] },
];

/** Optional native features: recorded per harness as supported or not, never counted toward a required scenario. */
export const NATIVE_FORM_FEATURES = ["questions-async"] as const;
export type NativeFormFeature = (typeof NATIVE_FORM_FEATURES)[number];

export const AUDIT_IDS: readonly string[] = Array.from({ length: 28 }, (_, i) => `A${String(i + 1).padStart(2, "0")}`);

export type RequiredSlot = { scenario: ScenarioDef; harness?: AcceptanceHarness };

/** Every (scenario, harness) a profile must record, in matrix order. */
export function requiredSlots(profile: Profile): RequiredSlot[] {
  const slots: RequiredSlot[] = [];
  for (const scenario of SCENARIOS) {
    if (scenario.profiles && !scenario.profiles.includes(profile)) continue;
    if (scenario.scope === "profile") slots.push({ scenario });
    else for (const harness of PROFILE_HARNESSES[profile]) slots.push({ scenario, harness });
  }
  return slots;
}

export function slotKey(scenario: string, harness?: string): string {
  return harness === undefined ? scenario : `${scenario}@${harness}`;
}

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
