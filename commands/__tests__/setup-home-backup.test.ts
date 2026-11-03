import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupHomeBackup, type HomeBackupDeps } from "../setup.ts";
import type { Probes } from "../../lib/setup/probes.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { readSetupState, updateSetupState } from "../../lib/setup/state.ts";
import { readGitHubSignInRaw, writeGitHubSignIn } from "../../lib/setup/github-signin.ts";
import { capturePlain } from "./helpers/json-line.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

let cap: CapturedOut;
beforeEach(() => {
  cap = capturePlain();
});
afterEach(() => cap.restore());

const HOME = "/fake-home";
const URL = "https://github.com/me/mattstack-home.git";

function deps(over: { fetch?: Probes["fetch"]; token?: string | null; gh?: number } = {}): HomeBackupDeps & { lines: unknown[]; exitCodes: number[] } {
  const lines: unknown[] = [];
  const exitCodes: number[] = [];
  return {
    probes: fakeProbes({
      home: HOME,
      ...(over.fetch ? { fetch: over.fetch } : {}),
      exec: (argv) => (argv[0] === "gh" ? { code: over.gh ?? 1, stdout: "", stderr: "" } : { code: 127, stdout: "", stderr: "" }),
    }),
    githubToken: async () => over.token ?? null,
    json: (v) => lines.push(v),
    exit: (code: number) => {
      exitCodes.push(code);
      throw new Error("exit sentinel");
    },
    lines,
    exitCodes,
  };
}

describe("setupHomeBackup", () => {
  test("backup local clears a staged remote", async () => {
    const d = deps();
    updateSetupState(d.probes, (s) => ({ ...s, homeBackup: { mode: "remote", url: URL } }));

    await setupHomeBackup(["local", "--json"], {}, d);

    expect(readSetupState(d.probes).homeBackup).toEqual({ mode: "local" });
    expect(d.lines[0]).toMatchObject({ homeBackup: { mode: "local" } });
  });

  test("backup local clears a GitHub sign-in in progress", async () => {
    const d = deps();
    writeGitHubSignIn(d.probes, { userCode: "ABCD-1234", url: "https://github.com/login/device", expiresAt: "2026-01-01T00:15:00.000Z", pid: 4242 });

    await setupHomeBackup(["local", "--json"], {}, d);

    expect(readGitHubSignInRaw(d.probes)).toBeNull();
  });

  test("backup remote on a home repo that already has an origin records that origin and stages no create", async () => {
    const origin = "https://github.com/janedoe/mattstack-home.git";
    const d = deps({ gh: 0 });
    const probes = fakeProbes({
      home: HOME,
      dirs: { [`${HOME}/.mattstack/user/.git`]: [] },
      exec: (argv) => (argv.includes("get-url") ? { code: 0, stdout: `${origin}\n`, stderr: "" } : { code: 0, stdout: "", stderr: "" }),
    });
    d.probes = probes;
    updateSetupState(probes, (s) => ({ ...s, homeBackup: { mode: "remote", create: true } }));

    await setupHomeBackup(["remote", "--json"], {}, d);

    const recorded = readSetupState(probes).homeBackup;
    expect(recorded).toMatchObject({ mode: "remote", url: origin });
    expect(recorded && "create" in recorded).toBe(false);
    expect(recorded && "appliedAt" in recorded && typeof recorded.appliedAt).toBe("string");
  });

  test("backup remote keeps a staged url", async () => {
    const d = deps();
    updateSetupState(d.probes, (s) => ({ ...s, homeBackup: { mode: "remote", url: URL } }));

    await setupHomeBackup(["remote", "--json"], {}, d);

    expect(readSetupState(d.probes).homeBackup).toEqual({ mode: "remote", url: URL });
    expect(d.lines[0]).toMatchObject({ homeBackup: { mode: "remote", url: URL } });
  });

  test("backup remote with nothing staged writes the bare choice", async () => {
    const d = deps();

    await setupHomeBackup(["remote"], {}, d);

    expect(readSetupState(d.probes).homeBackup).toEqual({ mode: "remote" });
    expect(cap.stdout()).toContain("remote repo");
  });

  test("an unknown choice is a usage error", async () => {
    const d = deps();

    await expect(setupHomeBackup(["github", "--json"], {}, d)).rejects.toThrow("exit sentinel");

    expect(d.exitCodes).toEqual([2]);
    expect(d.lines[0]).toMatchObject({ error: { code: "usage" } });
    expect(readSetupState(d.probes).homeBackup).toBeUndefined();
  });
});

describe("setupHomeBackup remote with rt's own GitHub token", () => {
  const withScopes = (granted: string): Probes["fetch"] => async () => ({ status: 200, body: '{"login":"janedoe"}', headers: { "x-oauth-scopes": granted } });

  test("gh absent but a token that can create repos stages the create", async () => {
    const d = deps({ token: "tok", fetch: withScopes("repo") });

    await setupHomeBackup(["remote", "--json"], {}, d);

    expect(readSetupState(d.probes).homeBackup).toEqual({ mode: "remote", create: true });
    expect(JSON.stringify(d.lines)).not.toContain("tok");
  });

  test("a token without repo scope stages nothing", async () => {
    const d = deps({ token: "tok", fetch: withScopes("read:org") });

    await setupHomeBackup(["remote"], {}, d);

    expect(readSetupState(d.probes).homeBackup).toEqual({ mode: "remote" });
  });

  test("no token and no gh stages nothing and reads no network", async () => {
    const d = deps();

    await setupHomeBackup(["remote"], {}, d);

    expect(readSetupState(d.probes).homeBackup).toEqual({ mode: "remote" });
    expect((d.probes as unknown as { calls?: { fetch: string[] } }).calls?.fetch ?? []).toEqual([]);
  });

  test("a signed-in gh stages the create without reading the token", async () => {
    let reads = 0;
    const d = deps({ gh: 0 });
    d.githubToken = async () => {
      reads++;
      return "tok";
    };

    await setupHomeBackup(["remote"], {}, d);

    expect(readSetupState(d.probes).homeBackup).toEqual({ mode: "remote", create: true });
    expect(reads).toBe(0);
  });
});
