/**
 * The daemon-vs-local decision for `rt repos reidentify`: a present daemon
 * (live pid or socket file) that does not answer is a hard stop, never a
 * local apply racing the reconciler. Presence and transport are faked the
 * same way repo-locate-dispatch.test.ts fakes them.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { REPO_INDEX_NS } from "../repo-index.ts";
import { reidentifyRepo } from "../repo-reidentify-dispatch.ts";
import { closeStateDb, setKvValue } from "../state/index.ts";

// Captured before any mock.module call; mock.module mutates the live
// namespace in place, so restoring these originals undoes it for every other
// test file sharing this process.
const realDaemonClient = await import("../daemon-client.ts");
const realDaemonSocketQuery = realDaemonClient.daemonSocketQuery;

const realDaemonConfig = await import("../daemon-config.ts");
const realIsDaemonProcessRunning = realDaemonConfig.isDaemonProcessRunning;
const realSockPath = realDaemonConfig.DAEMON_SOCK_PATH;

const NO_SOCKET_PATH = join(tmpdir(), "rt-reidentify-dispatch-test-no-such-socket");

const origHome = process.env.HOME;
let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-reid-dispatch-")));
  process.env.HOME = home;
  closeStateDb();
});

afterEach(() => {
  mock.module("../daemon-client.ts", () => ({
    ...realDaemonClient,
    daemonSocketQuery: realDaemonSocketQuery,
  }));
  mock.module("../daemon-config.ts", () => ({
    ...realDaemonConfig,
    isDaemonProcessRunning: realIsDaemonProcessRunning,
    DAEMON_SOCK_PATH: realSockPath,
  }));
  process.env.HOME = origHome;
  closeStateDb();
  rmSync(home, { recursive: true, force: true });
});

describe("reidentifyRepo", () => {
  test("daemon present but silent is a hard stop, never a local apply", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fold", "/x");
    mock.module("../daemon-config.ts", () => ({
      ...realDaemonConfig,
      isDaemonProcessRunning: () => true,
      DAEMON_SOCK_PATH: NO_SOCKET_PATH,
    }));
    mock.module("../daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonSocketQuery: async () => null,
    }));

    const out = await reidentifyRepo({ from: "github.com/acme/old", to: "github.com/acme/new" });

    expect(out.ok).toBe(false);
    expect(out.via).toBe("daemon");
    expect(!out.ok && out.error).toContain("did not answer repos:reidentify");
  });

  test("a daemon refusal carries its report through", async () => {
    const report = { from: { serialized: "a", raw: "a" }, to: { serialized: "b", raw: "b" }, dryRun: false, stores: [], ok: false };
    mock.module("../daemon-config.ts", () => ({
      ...realDaemonConfig,
      isDaemonProcessRunning: () => true,
      DAEMON_SOCK_PATH: NO_SOCKET_PATH,
    }));
    mock.module("../daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonSocketQuery: async () => ({ ok: false, error: "refused: kv:repo-index", data: report }),
    }));

    const out = await reidentifyRepo({ from: "github.com/acme/old", to: "github.com/acme/new" });

    expect(out).toEqual({ via: "daemon", ok: false, error: "refused: kv:repo-index", report });
  });

  test("no daemon runs locally and returns the report", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Facme%2Fold", "/x");
    let daemonSocketQueryCalled = false;
    mock.module("../daemon-config.ts", () => ({
      ...realDaemonConfig,
      isDaemonProcessRunning: () => false,
      DAEMON_SOCK_PATH: NO_SOCKET_PATH,
    }));
    mock.module("../daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonSocketQuery: async () => {
        daemonSocketQueryCalled = true;
        return null;
      },
    }));

    const out = await reidentifyRepo({ from: "github.com/acme/old", to: "github.com/acme/new" });

    expect(daemonSocketQueryCalled).toBe(false);
    expect(out.ok && out.via).toBe("local");
    expect(out.ok && out.report.stores[0]!.status).toBe("moved");
  });
});
