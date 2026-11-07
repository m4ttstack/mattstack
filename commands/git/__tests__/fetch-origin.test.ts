import { describe, expect, test } from "bun:test";
import { fetchFailureOf, fetchOrigin, type FetchDeps } from "../shared.ts";

const DENIED = "git@gitlab.com: Permission denied (publickey).\nfatal: Could not read from remote repository.";

function deps(results: ({ ok: true } | { ok: false; output: string })[], found?: { socket: string; preferred: boolean }) {
  const runs: (string | undefined)[] = [];
  const d: FetchDeps = {
    env: { SSH_AUTH_SOCK: "/herdr.sock.agent" },
    run: async (_cwd, env) => (runs.push(env.SSH_AUTH_SOCK), results.shift()!),
    findAgent: async () => found,
  };
  return { d, runs };
}

async function failureOf(p: Promise<void>) {
  try {
    await p;
  } catch (err) {
    return fetchFailureOf(err);
  }
  throw new Error("fetch did not fail");
}

describe("fetchOrigin", () => {
  test("a clean fetch runs once", async () => {
    const { d, runs } = deps([{ ok: true }]);
    await fetchOrigin("/r", d);
    expect(runs).toEqual(["/herdr.sock.agent"]);
  });

  test("an SSH refusal retries through an agent that holds a key", async () => {
    const { d, runs } = deps([{ ok: false, output: DENIED }, { ok: true }], { socket: "/keys/agent.1", preferred: false });
    await fetchOrigin("/r", d);
    expect(runs).toEqual(["/herdr.sock.agent", "/keys/agent.1"]);
  });

  test("an SSH refusal with no agent holding a key says so and names ssh-add", async () => {
    const { d } = deps([{ ok: false, output: DENIED }]);
    const f = await failureOf(fetchOrigin("/r", d));
    expect(f.title).toBe("Could not fetch from origin: no SSH key is loaded");
    expect(JSON.stringify(f.next)).toContain("ssh-add");
    expect(f.details).toBe(DENIED);
  });

  test("an SSH refusal while this shell's agent already holds a key does not retry", async () => {
    const { d, runs } = deps([{ ok: false, output: DENIED }], { socket: "/herdr.sock.agent", preferred: true });
    await failureOf(fetchOrigin("/r", d));
    expect(runs).toEqual(["/herdr.sock.agent"]);
  });

  test("any other failure keeps the plain title and git's words", async () => {
    const { d, runs } = deps([{ ok: false, output: "fatal: unable to access 'https://x/': Could not resolve host" }]);
    const f = await failureOf(fetchOrigin("/r", d));
    expect(f).toEqual({ title: "Could not fetch from origin", details: "fatal: unable to access 'https://x/': Could not resolve host" });
    expect(runs.length).toBe(1);
  });
});
