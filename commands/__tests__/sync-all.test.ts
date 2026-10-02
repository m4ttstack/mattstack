import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { syncAllCommand } from "../sync.ts";
import { ctxFor, exitCodeOf, git, makeRepo, trapExit } from "../git/__tests__/helpers.ts";

// mock.module mutates the live namespace in place: keep the real bindings
// from before any mock to restore with.
const realDaemonClient = await import("../../lib/daemon-client.ts");
const realDaemonQuery = realDaemonClient.daemonQuery;
const realIsDaemonRunning = realDaemonClient.isDaemonRunning;

let io: CapturedOut;
let exit: { restore(): void };
let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-all-")));
  io = captureOut({ console: true });
  out.__test__.reset();
  out.__test__.setHuman(() => false);
  exit = trapExit();
  mock.module("../../lib/daemon-client.ts", () => ({
    ...realDaemonClient,
    isDaemonRunning: async () => true,
    daemonQuery: async () => ({ ok: true, data: { repos: {}, watched: [] } }),
  }));
});
afterEach(() => {
  mock.module("../../lib/daemon-client.ts", () => ({
    ...realDaemonClient,
    isDaemonRunning: realIsDaemonRunning,
    daemonQuery: realDaemonQuery,
  }));
  exit.restore();
  io.restore();
  rmSync(root, { recursive: true, force: true });
});

describe("rt sync all for a repo the daemon does not know", () => {
  test("next names a register command that runs as printed, with this repo's path", async () => {
    const repo = makeRepo(root, "sample app");
    git(repo, "remote", "add", "origin", join(root, "origin.git"));
    expect(await exitCodeOf(() => syncAllCommand([], ctxFor(repo)))).toBe(1);
    expect(io.stderr()).toBe(
      "The rt daemon does not know git.example.test/sample/sample-app yet\n" + `  next: rt repos register '${repo}'\n`,
    );
  });
});
