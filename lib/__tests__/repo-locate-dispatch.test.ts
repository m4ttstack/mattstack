/**
 * lib/repo-locate-dispatch.ts's whole reason to exist is the daemon-vs-local
 * decision: a present daemon must hard-stop rather than fall through to a
 * local apply that would race the worktree reconciler holding the registry,
 * and "present" must come from liveness evidence (a live pid in `rt.pid`, or
 * the `rt.sock` file existing), not a ping: an event-loop-stalled daemon fails
 * a ping the same way a dead one does, and treating that as "absent" would
 * race the very daemon still holding the registry. No real daemon process is
 * there to exercise these branches, so each test points `RT_DIR` at a scratch
 * dir holding the presence files it needs and fakes the transport.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { locateMovedRepo } from "../repo-locate-dispatch.ts";
import type { LocatePlan } from "../repo-locate.ts";

// Captured before any mock.module call: mock.module mutates the live
// namespace object in place, so restoring with the ORIGINAL bindings (not a
// re-import) is what undoes it for every other test file sharing this process.
const realDaemonClient = await import("../daemon-client.ts");
const realDaemonSocketQuery = realDaemonClient.daemonSocketQuery;

const realDaemonConfig = await import("../daemon-config.ts");
const realRtDir = realDaemonConfig.RT_DIR;

const realRepoLocate = await import("../repo-locate.ts");
const realPlanLocate = realRepoLocate.planLocate;

let scratch: string | null = null;

/** Points `RT_DIR` at a fresh scratch dir holding a live `rt.pid` (this process) and/or an `rt.sock` file. */
function presence(opts: { pid?: boolean; sock?: boolean }): void {
  const dir = mkdtempSync(join(tmpdir(), "rt-locate-dispatch-"));
  scratch = dir;
  if (opts.pid) writeFileSync(join(dir, "rt.pid"), `${process.pid}\n`);
  // Presence is decided by the socket file existing, not by connecting to it.
  if (opts.sock) writeFileSync(join(dir, "rt.sock"), "");
  mock.module("../daemon-config.ts", () => ({ ...realDaemonConfig, RT_DIR: dir }));
}

afterEach(() => {
  mock.module("../daemon-client.ts", () => ({
    ...realDaemonClient,
    daemonSocketQuery: realDaemonSocketQuery,
  }));
  mock.module("../daemon-config.ts", () => ({ ...realDaemonConfig, RT_DIR: realRtDir }));
  mock.module("../repo-locate.ts", () => ({
    ...realRepoLocate,
    planLocate: realPlanLocate,
  }));
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe("locateMovedRepo: presence by pid, no answer", () => {
  test("a live pid with an unresponsive daemon hard-stops — planLocate never runs", async () => {
    let planLocateCalled = false;
    mock.module("../repo-locate.ts", () => ({
      ...realRepoLocate,
      planLocate: async () => {
        planLocateCalled = true;
        throw new Error("must not run planLocate — the daemon is holding the registry");
      },
    }));
    presence({ pid: true });
    mock.module("../daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonSocketQuery: async () => null, // event-loop stalled, or otherwise not answering
    }));

    const outcome = await locateMovedRepo({ newPath: "/wherever" });

    expect(planLocateCalled).toBe(false);
    expect(outcome).toEqual({
      via: "daemon",
      ok: false,
      error: "The rt daemon is running but did not answer",
      why: "rt will not move the repo itself while the daemon holds its records: the two would race.",
      next: "rt daemon status",
    });
  });
});

describe("locateMovedRepo: presence by socket file, no answer", () => {
  test("a socket file with no live pid still hard-stops", async () => {
    presence({ sock: true });
    let planLocateCalled = false;
    mock.module("../repo-locate.ts", () => ({
      ...realRepoLocate,
      planLocate: async () => {
        planLocateCalled = true;
        throw new Error("must not run planLocate: the daemon is holding the registry");
      },
    }));
    mock.module("../daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonSocketQuery: async () => null,
    }));

    const outcome = await locateMovedRepo({ newPath: "/wherever" });

    expect(planLocateCalled).toBe(false);
    expect(outcome).toEqual({
      via: "daemon",
      ok: false,
      error: "The rt daemon is running but did not answer",
      why: "rt will not move the repo itself while the daemon holds its records: the two would race.",
      next: "rt daemon status",
    });
  });
});

describe("locateMovedRepo: daemon transport, present and answering", () => {
  test("a daemon refusal surfaces its error verbatim", async () => {
    presence({ pid: true });
    mock.module("../daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonSocketQuery: async () => ({ ok: false, error: "not-a-git-repo: /wherever is not a git repository" }),
    }));

    const outcome = await locateMovedRepo({ newPath: "/wherever" });

    expect(outcome).toEqual({ via: "daemon", ok: false, error: "not-a-git-repo: /wherever is not a git repository" });
  });

  test("a dry-run success unwraps the plan from the envelope", async () => {
    const plan: LocatePlan = {
      identity: "path:%2Fx",
      oldPath: "/old",
      newPath: "/new",
      indexKeys: ["path:%2Fx"],
      legacyKeys: [],
      registryRewrites: [],
      claimRewrites: [],
      gitRepairPaths: [],
    };
    let sentPayload: Record<string, unknown> | undefined;
    presence({ pid: true });
    mock.module("../daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonSocketQuery: async (_cmd: string, payload?: Record<string, unknown>) => {
        sentPayload = payload;
        return { ok: true, data: { dryRun: true, plan } };
      },
    }));

    const outcome = await locateMovedRepo({ newPath: "/new", repo: "path:%2Fx", dryRun: true });

    expect(outcome).toEqual({ via: "daemon", ok: true, dryRun: true, plan });
    expect(sentPayload).toEqual({ newPath: "/new", repo: "path:%2Fx", dryRun: true });
  });
});

describe("locateMovedRepo: daemon absent (no live pid, no socket file)", () => {
  test("takes the local path without ever calling the daemon transport", async () => {
    let daemonSocketQueryCalled = false;
    presence({});
    mock.module("../daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonSocketQuery: async () => {
        daemonSocketQueryCalled = true;
        return null;
      },
    }));
    mock.module("../repo-locate.ts", () => ({
      ...realRepoLocate,
      planLocate: async () => ({ refusal: "not-a-git-repo" as const, message: "/wherever is not a git repository" }),
    }));

    const outcome = await locateMovedRepo({ newPath: "/wherever" });

    expect(daemonSocketQueryCalled).toBe(false);
    expect(outcome).toEqual({ via: "local", ok: false, error: "not-a-git-repo: /wherever is not a git repository" });
  });
});
