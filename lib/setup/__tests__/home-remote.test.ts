import { describe, expect, test } from "bun:test";
import { join } from "path";
import { UserActionableError } from "../../errors.ts";
import { setHomeRemote } from "../home-remote.ts";
import type { ExecResult } from "../probes.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/fake-home";
const USER_REPO = join(HOME, ".mattstack", "user");
const GIT_DIR = join(USER_REPO, ".git");
const URL = "https://github.com/me/mattstack-home.git";

const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
const fail = (code: number, stderr = ""): ExecResult => ({ code, stdout: "", stderr });

async function refusal(run: () => Promise<unknown>): Promise<UserActionableError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof UserActionableError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("setHomeRemote", () => {
  test("set-home-remote keeps today's refusals", async () => {
    const badUrl = fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] } });
    const notAUrl = await refusal(() => setHomeRemote(badUrl, { url: "not a url" }));
    expect(notAUrl.code).toBe("bad-url");
    expect(badUrl.calls.exec).toEqual([]);

    const old = "https://old.example/x.git";
    const probes = fakeProbes({
      home: HOME,
      dirs: { [GIT_DIR]: [] },
      exec: async (argv) => {
        if (argv.includes("get-url")) return ok(old);
        if (argv.includes("push")) return fail(128, "remote: Permission denied");
        return ok();
      },
    });
    const pushFailed = await refusal(() => setHomeRemote(probes, { url: URL }));
    expect(pushFailed.code).toBe("push-failed");
    expect(pushFailed.message).toContain("origin is back on the previous remote");
    const calls = probes.calls.exec.map((a) => a.join(" "));
    expect(calls[calls.length - 1]).toBe(`git -C ${USER_REPO} remote set-url origin ${old}`);
  });

  test("a pushed remote reports the url, the remote change and created", async () => {
    const probes = fakeProbes({ home: HOME, dirs: { [GIT_DIR]: [] }, exec: async (argv) => (argv.includes("get-url") ? fail(2) : ok()) });
    expect(await setHomeRemote(probes, { url: URL })).toEqual({ url: URL, remote: "added", pushed: true, created: false });
  });
});
