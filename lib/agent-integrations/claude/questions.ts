/**
 * Claude Code's gate questions: a gate shown as an AskUserQuestion form in a
 * pane ends with today's doorbell, and an Escape only for a form still on
 * screen. The doorbell carries the gate-store reread guidance, never the
 * answer. A session whose mattstack-mods `gate-form` block is live gets
 * neither: its mod closes the dialog from the gate's own row, and rt only
 * asks it to confirm, ringing the doorbell once when it does not.
 *
 * The form has no durable native question id, so Claude never binds native
 * question ownership: the gate push completes the gate against the session
 * it nudges (`nudgedQuestion`), and the shared question service never sees a
 * Claude gate.
 */

import type { Logger } from "pino";
import type { FaultCode, Outcome, QuestionBinding, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { resolveLiveInbox } from "../../claude-registry.ts";
import type { EscapeInjector, PaneStatusProbe } from "../../daemon/gate-escape.ts";
import { answeredByNudgedPane, answeredBySession, type GateRow } from "../../daemon/gates-store.ts";
import { deliverToInbox, wrapCrossSession } from "../../daemon/inbox.ts";
import type { PaneHints } from "../../daemon/pane-resolve-live.ts";
import type { QuestionAdapter } from "../contracts.ts";
import type { CompletionPath, CompletionState } from "../question-store.ts";
import { installedModLinks, pushModCommand, type ModLinks } from "./mod-links.ts";
import { modPath } from "./mod-path.ts";

const HARNESS = "claude";
const MOD_COMPLETE = "gate-complete";

/** How a completion reaches the mattstack-mods `gate-form` block in the nudged session. */
export type ClaudeModSeam = {
  /** The native id the nudged session continues as now (a /clear moves it), or the id itself. */
  current(sessionId: string): string;
  /** Whether the `gate-form` block is live on the binding's session. */
  owns(binding: SessionBinding): boolean;
  /** Sends `gate-complete` for the gate; true only once that session's mod acked it. */
  complete(sessionId: string, gateId: string): Promise<boolean>;
};

/**
 * The seam over the daemon's mod links: `links` when given, else whatever the
 * daemon has installed at the time of each call (none outside the daemon).
 */
export function claudeModSeam(links?: ModLinks | null, push: typeof pushModCommand = pushModCommand): ClaudeModSeam {
  const registry = () => (links === undefined ? installedModLinks() : links);
  return {
    current: (sessionId) => registry()?.continuedAs(sessionId) ?? sessionId,
    owns: (binding) => modPath(binding, "gate-form", registry()),
    async complete(sessionId, gateId) {
      const out = await push(sessionId, MOD_COMPLETE, { id: gateId });
      return out.ok && out.data.acked;
    },
  };
}

/** Claude Code's AskUserQuestion footer. The navigate hint varies with the
    question count ("↑/↓" for one, "Tab/Arrow keys" for several); the
    folder-trust and relocation dialogs say "Enter to confirm", never
    "Enter to select", so they never match. */
const FORM_FOOTER_RE = /^Enter to select · .+ · Esc to cancel$/;

/** True when the pane's visible screen ends in an AskUserQuestion form.
    herdr's agent status can go stale on a pane whose form has sat through
    a sleep/wake, so the screen is the evidence a form is up. */
export function hasQuestionForm(screen: string): boolean {
  const lines = screen.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    return FORM_FOOTER_RE.test(line);
  }
  return false;
}

export type ClaudeQuestionDeps = {
  /** Rings the nudged session's doorbell; `dead` when the session no longer resolves. */
  notify(row: GateRow): Promise<{ ok: boolean; dead: boolean }>;
  /** The pane the gate resolves to and its status, a form on screen reading blocked; null when none resolves. */
  paneStatus?(row: GateRow): Promise<{ paneRef: string; status: string } | null>;
  /** Sends Escape only if the gate still resolves to `paneRef`. */
  escape?(row: GateRow, paneRef: string): Promise<{ ok: true; paneRef: string } | { ok: false; error: string }>;
  /** The mod path; absent, the daemon's installed links, read at each completion. */
  mod?: ClaudeModSeam;
  /** Records a completion that took the mod path, or fell back from it, with the path that completed it. */
  record?(row: GateRow, path: CompletionPath, state: CompletionState): void;
  log?: Pick<Logger, "debug" | "warn">;
};

const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });

/**
 * The session a gate nudges, as the binding its completion runs against.
 * Nothing is stored: the nudge is the only reference rt holds, and it names
 * a harness only when the session is not Claude Code's.
 */
export function nudgedQuestion(row: GateRow): { binding: SessionBinding; question: QuestionBinding } | null {
  const session = row.nudge?.session;
  if (!session) return null;
  const binding: SessionBinding = {
    key: session, identity: session,
    native: { harness: row.nudge?.harness ?? HARNESS, profile: "", kind: "id", value: session },
    attachment: { generation: 0, mode: "herdr" },
  };
  const presentation = row.origin?.presentation === "form" ? "form" : "wait";
  return { binding, question: { gateId: row.id, sessionKey: session, generation: 0, presentation } };
}

function staleness(binding: SessionBinding, question: QuestionBinding, row: GateRow): string | null {
  if (binding.native.harness !== HARNESS) return `${binding.native.harness} is not a Claude Code session`;
  if (question.gateId !== row.id) return `the question belongs to gate ${question.gateId}, not ${row.id}`;
  if (question.sessionKey !== binding.key) return "the question was asked by another session";
  if (question.generation !== binding.attachment.generation) {
    return `asked under attachment ${question.generation}; the session is now on ${binding.attachment.generation}`;
  }
  if (binding.native.value !== row.nudge?.session) return `gate ${row.id} does not nudge session ${binding.native.value}`;
  return null;
}

/** The registry's adapter: Claude's own inbox and herdr, with no gates store, so it stamps no delivery. */
function defaultDeps(): ClaudeQuestionDeps {
  type Tools = {
    phrase: (row: GateRow) => string; hints: (row: GateRow) => PaneHints;
    probe: PaneStatusProbe; inject: EscapeInjector;
  };
  let tools: Promise<Tools> | undefined;
  // gate-push and gate-escape import this module, so they load on first use rather than at import.
  const load = () => (tools ??= Promise.all([import("../../daemon/gate-push.ts"), import("../../daemon/gate-escape.ts")])
    .then(([push, escape]) => ({
      phrase: push.gateEndedPhrase, hints: push.gateHints,
      probe: escape.createPaneStatusProbe(), inject: escape.createEscapeInjector(),
    })));
  return {
    async notify(row) {
      const session = row.nudge?.session;
      if (!session) return { ok: false, dead: false };
      const inbox = resolveLiveInbox(session);
      if (!inbox) return { ok: false, dead: true };
      const { phrase } = await load();
      const written = await deliverToInbox(inbox.socketPath, wrapCrossSession("gate-facility", phrase(row)));
      return { ok: written.ok, dead: false };
    },
    paneStatus: async (row) => {
      const { probe, hints } = await load();
      return probe(hints(row));
    },
    escape: async (row, paneRef) => {
      const { inject, hints } = await load();
      return inject(hints(row), { paneRef });
    },
  };
}

export function createClaudeQuestions(deps: ClaudeQuestionDeps = defaultDeps()): QuestionAdapter {
  const { log } = deps;
  const mod = deps.mod ?? claudeModSeam();

  /** Escape exists to dismiss an in-pane form. A herd worker ends its turn
      instead of drawing one, and an Escape sent to an idle prompt interrupts
      the turn the doorbell just started (RT-357), so it needs the pane to
      read blocked. The reading is taken before the doorbell: afterwards an
      idle pane is mid-flip to working and the reading races. Returns the
      paneRef that read blocked, or null for doorbell-only. */
  async function formOnScreen(row: GateRow): Promise<string | null> {
    if (!deps.escape || !deps.paneStatus || !row.nudge?.session) return null;
    if (row.origin?.presentation !== "form") return null;
    // Same self-answer test as the doorbell: a form the nudged pane answered
    // itself has already dismissed. A foreign surface's `by: "pane"` must not
    // gate this off -- session wins.
    if (answeredByNudgedPane(row)) return null;
    // A consumed answer was read: the pane may already be on its NEXT form,
    // and an Escape now would cancel that one.
    if (row.consumedAt != null) return null;
    try {
      const reading = await deps.paneStatus(row);
      if (reading?.status === "blocked") return reading.paneRef;
      log?.debug({ gateId: row.id, status: reading?.status ?? null }, "gate-push: no form on screen; doorbell-only");
      return null;
    } catch (err) {
      log?.warn({ err, gateId: row.id }, "gate-push: pane status probe threw; doorbell-only");
      return null;
    }
  }

  /** Today's path: the doorbell, then an Escape for a form still on screen. */
  async function doorbell(row: GateRow): Promise<Outcome<"completed" | "pending" | "gone">> {
    const paneRef = await formOnScreen(row);
    const rung = await deps.notify(row);
    // Escape only ever follows an ACCEPTED doorbell: the dismissed form's
    // next input must be the queued frame, and a dead pane has nothing
    // queued to find.
    if (!rung.ok) return { ok: true, data: rung.dead ? "gone" : "pending" };
    if (paneRef !== null && deps.escape) {
      const injected = await deps.escape(row, paneRef);
      if (injected.ok) {
        log?.debug({ gateId: row.id, paneRef: injected.paneRef }, "gate-push: escape injected");
      } else {
        log?.warn({ gateId: row.id, paneRef, error: injected.error }, "gate-push: escape injection failed; doorbell-only");
      }
    }
    return { ok: true, data: "completed" };
  }

  function record(row: GateRow, path: CompletionPath, state: CompletionState): void {
    try {
      deps.record?.(row, path, state);
    } catch (err) {
      log?.warn({ err, gateId: row.id, path }, "gate-push: the completion record was not written");
    }
  }

  async function confirmed(sessionId: string, row: GateRow): Promise<boolean> {
    try {
      return await mod.complete(sessionId, row.id);
    } catch (err) {
      log?.warn({ err, gateId: row.id, sessionId }, "gate-push: the gate-complete push failed");
      return false;
    }
  }

  return {
    async complete(binding, question, row) {
      const stale = staleness(binding, question, row);
      if (stale) return fail("stale-binding", stale);
      // A /clear moved the binding off the session the nudge names; the
      // continued session is the one to complete on, by either path.
      const session = mod.current(binding.native.value);
      const target = session === row.nudge!.session ? row : { ...row, nudge: { ...row.nudge!, session } };
      // Self-answer rule: no doorbell back to the pane that recorded it, and
      // no delivery stamp either, so the row never enters the dead-pane pass.
      if (row.status === "answered" && (answeredByNudgedPane(row) || answeredBySession(row, session))) {
        return { ok: true, data: "completed" };
      }
      if (!mod.owns({ ...binding, native: { ...binding.native, value: session } })) return doorbell(target);
      // The gate-form block closes its dialog from the gate's own events; the
      // ack only confirms it owns the gate, so no doorbell or Escape follows.
      if (await confirmed(session, row)) {
        record(row, "mod-result", "completed");
        return { ok: true, data: "completed" };
      }
      log?.warn({ gateId: row.id, session }, "gate-push: the mod did not confirm gate-complete; ringing the doorbell once");
      const rung = await doorbell(target);
      if (rung.ok) record(row, "doorbell", rung.data);
      return rung;
    },
  };
}
