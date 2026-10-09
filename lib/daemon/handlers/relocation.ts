/**
 * worktree:registered and worktree:entered: what the mattstack-mods
 * `relocation` block asks over its session's link to answer EnterWorktree's
 * relocation prompt inside the session.
 *
 * rt.sock does not say who calls, so the caller is only ever what the live
 * link recorded: the link must be `sessionId`'s current one and carry the
 * `relocation` block. worktree:registered permits only the same sessions
 * the key-pressing seams stand down for (a bound binding with the block
 * live), so a session the mod does not answer for keeps today's seams.
 */

import type { Database } from "bun:sqlite";
import { isAbsolute, resolve } from "node:path";
import type { CallerContext } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import { resolveCallerContextNow } from "../../agent-integrations/context.ts";
import { UNKNOWN_LINK, type ModLinks, type ModLinkView } from "../../agent-integrations/claude/mod-links.ts";
import { modContext, modPath } from "../../agent-integrations/claude/mod-path.ts";
import type { RelocationInSession } from "../../agent-integrations/claude/relocation.ts";
import {
  applyWorktreeEvent, findManagedTreeByPath, liveHolder, worktreeOwner, type WorktreeDeps,
} from "../../agent-integrations/worktrees.ts";
import { canon } from "../../fs-canon.ts";

type Verb = "worktree:registered" | "worktree:entered";
/** CommandResult's shape, spelled here because ./types.ts reaches setup modules through the daemon's snapshot types. */
type Result<K extends Verb> =
  | { ok: true; data: Commands[K]["data"] }
  | { ok: false; error: string; failure: { code: string; message: string } };

export type RelocationHandlerDeps = {
  links: ModLinks;
  db: Database;
  /** panes.relocationAutoAccept, read on every call. */
  autoAccept: () => boolean;
  /** Registry and holder reads; the daemon's own state.db and registry by default. */
  worktrees?: WorktreeDeps;
  /** Where each answer is recorded, so the screen-reading seams stand down only for a session the mod asked about. */
  inSession?: RelocationInSession;
};

const declined = (code: string, message: string, error = message) => ({ ok: false as const, error, failure: { code, message } });
const invalid = (message: string) => declined("invalid", message);
const refused = (message: string) => declined("refused", message);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isAbsolutePath = (v: unknown): v is string => isText(v) && isAbsolute(v) && !/[\u0000-\u001f\u007f]/.test(v);
const record = (payload: unknown): Record<string, unknown> =>
  payload !== null && typeof payload === "object" ? payload as Record<string, unknown> : {};

type Caller = { link: ModLinkView; context: CallerContext | null; unbound?: string };

export function createRelocationHandlers(deps: RelocationHandlerDeps): { [K in Verb]: (payload: unknown) => Promise<Result<K>> } {
  const { links, db } = deps;
  const worktrees: WorktreeDeps = deps.worktrees ?? { db };

  function callerOf(linkId: unknown, sessionId: unknown): Caller | ReturnType<typeof declined> {
    if (!isText(linkId)) return invalid("linkId must be a non-empty string");
    if (!isText(sessionId)) return invalid("sessionId must be a non-empty string");
    const link = links.view(linkId);
    if (!link) return declined("unknown-link", UNKNOWN_LINK, "unknown link");
    if (link.sessionId !== sessionId) return refused(`link ${linkId} belongs to another session than ${sessionId}`);
    if (!link.blocks.includes("relocation")) return refused(`link ${linkId} carries no live relocation block`);
    const resolved = resolveCallerContextNow(
      { native: { harness: "claude", kind: "id", value: link.sessionId } },
      { db, modContext: (id) => modContext(id, links) },
    );
    return resolved.ok ? { link, context: resolved.data } : { link, context: null, unbound: resolved.error.message };
  }

  return {
    "worktree:registered": async (payload) => {
      const { linkId, sessionId, path, cwd } = record(payload);
      if (!isText(path) || /[\u0000-\u001f\u007f]/.test(path)) return invalid("path must be a non-empty string with no control characters");
      if (!isAbsolutePath(cwd)) return invalid("cwd must be an absolute path with no control characters");
      const caller = callerOf(linkId, sessionId);
      if ("failure" in caller) return caller;
      if (!caller.context) return refused(`this session is not bound (${caller.unbound}); the person answers the prompt`);
      if (!modPath(caller.context.binding, "relocation", links)) return refused("this session's relocation block is not live; the person answers the prompt");
      if (!deps.autoAccept()) return refused("relocation auto-accept is off; the person answers the prompt");
      const target = resolve(cwd, path);
      const tree = findManagedTreeByPath(target, worktrees);
      deps.inSession?.noteAnswer(caller.link.sessionId, tree?.path ?? canon(target));
      const holder = liveHolder(target, worktrees);
      if (holder !== null && holder.owner !== worktreeOwner(caller.context)) return refused(`${holder.tree} belongs to another session`);
      return { ok: true, data: { registered: tree !== null } };
    },

    "worktree:entered": async (payload) => {
      const { linkId, sessionId, path } = record(payload);
      if (!isAbsolutePath(path)) return invalid("path must be an absolute path with no control characters");
      const caller = callerOf(linkId, sessionId);
      if ("failure" in caller) return caller;
      if (!caller.context) return { ok: true, data: { recorded: false, reason: caller.unbound } };
      if (liveHolder(path, worktrees) === null) return { ok: true, data: { recorded: false, reason: `no session holds ${path} through rt` } };
      const moved = await applyWorktreeEvent(caller.context, { kind: "relocate", path }, worktrees);
      if (moved.ok) return { ok: true, data: { recorded: true } };
      if (moved.error.code === "transient") return declined("transient", moved.error.message);
      return { ok: true, data: { recorded: false, reason: moved.error.message } };
    },
  };
}
