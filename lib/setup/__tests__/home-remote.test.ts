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

  describe("create", () => {
    const RT_LINK = join(HOME, ".local", "bin", "rt");
    const CLONE = "https://github.com/janedoe/mattstack-home.git";
    const created = { status: 201, body: JSON.stringify({ clone_url: CLONE }), headers: {} };

    function setup(token: string | null) {
      const envs: Array<Record<string, string> | undefined> = [];
      const probes = fakeProbes({
        home: HOME,
        dirs: { [GIT_DIR]: [] },
        files: { [RT_LINK]: "" },
        fetch: async () => created,
        exec: async (argv, opts) => {
          envs.push(opts?.env);
          if (argv.includes("get-url")) return fail(2);
          if (argv[0] === "gh") return ok("https://github.com/janedoe/mattstack-home\n");
          return ok();
        },
      });
      return { probes, envs, hooks: { githubToken: async () => token } };
    }

    test("creates over REST with rt's token and pushes through it", async () => {
      const { probes, envs, hooks } = setup("tok-123");
      const seen: string[] = [];
      const result = await setHomeRemote(probes, { create: true }, { ...hooks, onCreated: (u) => seen.push(u) });
      expect(result).toEqual({ url: CLONE, remote: "added", pushed: true, created: true });
      expect(seen).toEqual([CLONE]);
      expect(probes.calls.exec.some((a) => a[0] === "gh")).toBe(false);
      const key = "credential.https://github.com.helper";
      const configs = probes.calls.exec.filter((a) => a.includes("config"));
      expect(configs.map((a) => a.slice(-2))).toEqual([[key, ""], [key, `!'${RT_LINK}' git credential`]]);
      expect(configs[0]!.slice(0, 3)).toEqual(["git", "-C", USER_REPO]);
      const push = probes.calls.exec.findIndex((a) => a.includes("push"));
      expect(push).toBeGreaterThan(probes.calls.exec.indexOf(configs[1]!));
      expect(probes.calls.exec.flat().join(" ")).not.toContain("tok-123");
      expect(envs[push]?.RT_GIT_TOKEN).toBe("tok-123");
      expect(envs[push]?.GIT_TERMINAL_PROMPT).toBe("0");
    });

    test("names the repo after input.name", async () => {
      const { probes, hooks } = setup("tok");
      await setHomeRemote(probes, { create: true, name: "acme-home" }, hooks);
      expect(probes.calls.fetchInits[0]!.init?.body).toBe('{"name":"acme-home","private":true}');
    });

    test("without a token it still runs gh repo create", async () => {
      const { probes, hooks } = setup(null);
      const result = await setHomeRemote(probes, { create: true }, hooks);
      expect(result.url).toBe(CLONE);
      expect(probes.calls.exec.some((a) => a.slice(0, 3).join(" ") === "gh repo create")).toBe(true);
      expect(probes.calls.fetch).toEqual([]);
      expect(probes.calls.exec.some((a) => a.includes("config"))).toBe(false);
    });
  });
});
