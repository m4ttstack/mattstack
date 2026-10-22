/**
 * inbox:ring / inbox:probe: let the apps (board), which cannot import rt's
 * lib/, push a framed message into one Claude session's inbox and check that
 * the session is reachable. Inbox frame only: nothing is typed into a pane.
 */
import { resolveLiveInbox, type InboxBinding } from "../../claude-registry.ts";
import { deliverToInbox, probeInboxReachability, wrapCrossSession } from "../inbox.ts";
import type { CommandResult } from "./types.ts";

export interface InboxHandlerDeps {
  resolve: (session: string) => InboxBinding | null;
  deliver: typeof deliverToInbox;
  probe: typeof probeInboxReachability;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function createInboxHandlers(deps: Partial<InboxHandlerDeps> = {}): {
  "inbox:ring": (payload: unknown) => Promise<CommandResult<"inbox:ring">>;
  "inbox:probe": (payload: unknown) => Promise<CommandResult<"inbox:probe">>;
} {
  const resolve = deps.resolve ?? ((session: string) => resolveLiveInbox(session));
  const deliver = deps.deliver ?? deliverToInbox;
  const probe = deps.probe ?? probeInboxReachability;
  return {
    "inbox:ring": async (payload: unknown) => {
      const p = (payload ?? {}) as Partial<{ session: string; label: string; text: string }>;
      if (!nonEmpty(p.session) || !nonEmpty(p.label) || !nonEmpty(p.text)) {
        return { ok: false, error: "inbox:ring requires session, label and text" };
      }
      const binding = resolve(p.session);
      if (!binding) return { ok: true, data: { delivered: false, reason: "no-session" } };
      const res = await deliver(binding.socketPath, wrapCrossSession(p.label, p.text));
      return res.ok ? { ok: true, data: { delivered: true } } : { ok: true, data: { delivered: false, reason: "failed" } };
    },
    "inbox:probe": async (payload: unknown) => {
      const p = (payload ?? {}) as Partial<{ session: string }>;
      if (!nonEmpty(p.session)) return { ok: false, error: "inbox:probe requires session" };
      const binding = resolve(p.session);
      if (!binding || (await probe(binding.socketPath)) !== "reachable") return { ok: true, data: { reachable: false } };
      return binding.name && binding.nameSource === "user"
        ? { ok: true, data: { reachable: true, name: binding.name } }
        : { ok: true, data: { reachable: true } };
    },
  };
}
