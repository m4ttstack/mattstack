import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import { openStateDb } from "../db.ts";
import { presenceForSession, signIn, type RegistryDeps } from "../presence-store.ts";
import { identityForSession } from "../identity-store.ts";
import {
  beginHandoff,
  cancelHandoff,
  completeHandoff,
  handoffFromSession,
  markOldSessionEnded,
  pendingHandoffFor,
  type HandoffDeps,
} from "../chat-handoff.ts";

const NO_BINDING: RegistryDeps = { resolve: () => null, alive: () => false, resolveAll: () => new Map() };
const PID = 4242;
/** The registry names the old session for the pid, as it does before the clear. */
const ON_OLD: HandoffDeps = { sessionForPid: () => "old", pidAlive: () => true };

let n = 0;
function freshDb(): Database {
  return openStateDb(join(tmpdir(), `chat-handoff-test-${process.pid}-${n++}.db`));
}

function fakeDeps(session: string | null, alive = true): HandoffDeps & { session: string | null; alive: boolean } {
  const d = {
    session,
    alive,
    sessionForPid: () => d.session,
    pidAlive: () => d.alive,
  };
  return d;
}

function signedIn(db: Database, sessionId = "old"): string {
  const r = signIn({ sessionId, baseHandle: "pansy" }, db, NO_BINDING);
  if (!r) throw new Error("sign-in failed");
  return r.handle;
}

test("begin refuses a session that is not signed in", () => {
  const db = freshDb();
  expect(beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD)).toEqual({ refused: "not-signed-in" });
});

test("begin twice refuses the second", () => {
  const db = freshDb();
  signedIn(db);
  expect(beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD)).toMatchObject({ fromSessionId: "old", pid: PID });
  expect(beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD)).toEqual({ refused: "already-handing-off" });
});

test("complete moves the row and identity to the new session", () => {
  const db = freshDb();
  const handle = signedIn(db);
  beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD);
  const deps = fakeDeps("new");
  expect(completeHandoff({ fromSessionId: "old", sessionId: "new" }, db, deps)).toEqual({ handle });
  expect(presenceForSession("new", db)?.handle).toBe(handle);
  expect(presenceForSession("new", db)?.signedOutAt).toBeUndefined();
  expect(presenceForSession("old", db)).toBeNull();
  expect(identityForSession("new", db)?.id).toBe(handle);
  expect(handoffFromSession("old", db)).toBeNull();
});

test("complete refuses a session the pid does not name", () => {
  const db = freshDb();
  signedIn(db);
  beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD);
  expect(completeHandoff({ fromSessionId: "old", sessionId: "intruder" }, db, fakeDeps("new"))).toEqual({ refused: "not-this-session" });
  expect(completeHandoff({ fromSessionId: "nobody", sessionId: "new" }, db, fakeDeps("new"))).toEqual({ refused: "no-handoff" });
});

test("cancel before the clear leaves the row signed in", () => {
  const db = freshDb();
  signedIn(db);
  beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD);
  expect(cancelHandoff({ fromSessionId: "old" }, db, fakeDeps("old"))).toEqual({ signedOut: false });
  expect(presenceForSession("old", db)?.signedOutAt).toBeUndefined();
  expect(handoffFromSession("old", db)).toBeNull();
});

test("cancel after the session moved on signs the row out", () => {
  const db = freshDb();
  signedIn(db);
  beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD);
  expect(cancelHandoff({ fromSessionId: "old" }, db, fakeDeps("new"))).toEqual({ signedOut: true });
  expect(presenceForSession("old", db)?.signedOutAt).toBeNumber();
  expect(cancelHandoff({ fromSessionId: "old" }, db, fakeDeps("new"))).toEqual({ refused: "no-handoff" });
});

test("settle ends the hand-off when the pid dies", () => {
  const db = freshDb();
  const handle = signedIn(db);
  beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD);
  expect(pendingHandoffFor(handle, db, fakeDeps("old", false))).toBeNull();
  expect(presenceForSession("old", db)?.signedOutAt).toBeNumber();
  expect(handoffFromSession("old", db)).toBeNull();
});

test("settle ends the hand-off when the pid names a third session", () => {
  const db = freshDb();
  const handle = signedIn(db);
  beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD);
  const deps = fakeDeps("new");
  expect(pendingHandoffFor(handle, db, deps)?.nextSessionId).toBe("new");
  deps.session = "third";
  expect(pendingHandoffFor(handle, db, deps)).toBeNull();
  expect(presenceForSession("old", db)?.signedOutAt).toBeNumber();
});

test("settle ends the hand-off when the next session signed in on its own", () => {
  const db = freshDb();
  const handle = signedIn(db);
  beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD);
  const deps = fakeDeps("new");
  expect(pendingHandoffFor(handle, db, deps)?.nextSessionId).toBe("new");
  signIn({ sessionId: "new", baseHandle: "other" }, db, NO_BINDING);
  expect(pendingHandoffFor(handle, db, deps)).toBeNull();
  expect(presenceForSession("old", db)?.signedOutAt).toBeNumber();
});

test("settle keeps a hand-off whose pid is still on the old session", () => {
  const db = freshDb();
  const handle = signedIn(db);
  beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD);
  const got = pendingHandoffFor(handle, db, fakeDeps("old"));
  expect(got).toMatchObject({ handle, fromSessionId: "old", pid: PID });
  expect(got?.nextSessionId).toBeUndefined();
});

test("settle keeps a hand-off whose pid moved to its first new session", () => {
  const db = freshDb();
  const handle = signedIn(db);
  beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD);
  expect(pendingHandoffFor(handle, db, fakeDeps("new"))).toMatchObject({ handle, nextSessionId: "new" });
  expect(handoffFromSession("old", db)?.nextSessionId).toBe("new");
  expect(presenceForSession("old", db)?.signedOutAt).toBeUndefined();
});

test("cancel after the old session already ended signs the row out", () => {
  const db = freshDb();
  signedIn(db);
  beginHandoff({ sessionId: "old", pid: PID }, db, ON_OLD);
  expect(markOldSessionEnded("old", db)).toBe(true);
  expect(cancelHandoff({ fromSessionId: "old" }, db, fakeDeps("old"))).toEqual({ signedOut: true });
  expect(presenceForSession("old", db)?.signedOutAt).toBeNumber();
});

test("begin refuses a pid the registry does not show on that session", () => {
  const db = freshDb();
  signedIn(db);
  expect(beginHandoff({ sessionId: "old", pid: PID }, db, fakeDeps("someone-else"))).toEqual({ refused: "not-this-session" });
  expect(handoffFromSession("old", db)).toBeNull();
});
