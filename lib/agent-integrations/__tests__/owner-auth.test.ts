import { describe, expect, test } from "bun:test";
import { confirmOwner, interpretOwnerAuth, OWNER_AUTH_HELPER, ownerAuthHelperPath, type OwnerAuthRun, type OwnerAuthRunner } from "../codex/owner-auth.ts";

function runner(answer: OwnerAuthRun | Error, path: string | null = "/Applications/mattstack.app/Contents/Helpers/rt-owner-auth") {
  const calls: string[][] = [];
  const r: OwnerAuthRunner = {
    locate: () => path,
    run: async (argv) => {
      calls.push(argv);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { r, calls };
}

describe("the owner check", () => {
  test("only exit 0 with the word authenticated is a success", async () => {
    const { r, calls } = runner({ exitCode: 0, stdout: "authenticated\n", stderr: "" });
    expect(await confirmOwner("trust 2 rt hooks in Codex (/h/.codex)", r)).toEqual({ ok: true });
    expect(calls).toEqual([["/Applications/mattstack.app/Contents/Helpers/rt-owner-auth", "--reason", "trust 2 rt hooks in Codex (/h/.codex)"]]);
  });

  test("a cancel, an unavailable Mac and a failed check each refuse with plain copy", () => {
    expect(interpretOwnerAuth({ exitCode: 1, stdout: "cancelled\n", stderr: "" })).toEqual({
      ok: false, outcome: "cancelled", message: "You cancelled the Touch ID check, so rt trusted nothing.",
    });
    expect(interpretOwnerAuth({ exitCode: 3, stdout: "unavailable\n", stderr: "No password is set on this Mac\n" })).toEqual({
      ok: false, outcome: "unavailable", message: "macOS cannot confirm it is you here (No password is set on this Mac), so rt trusted nothing.",
    });
    expect(interpretOwnerAuth({ exitCode: 4, stdout: "failed\n", stderr: "" })).toEqual({
      ok: false, outcome: "failed", message: "macOS did not confirm it was you, so rt trusted nothing.",
    });
  });

  test("anything else is a failure, however it exits", () => {
    for (const run of [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "yes", stderr: "" },
      { exitCode: 0, stdout: "authenticated authenticated", stderr: "" },
      { exitCode: 1, stdout: "authenticated", stderr: "" },
      { exitCode: 124, stdout: "", stderr: "" },
      { exitCode: 64, stdout: "", stderr: "usage" },
      { exitCode: -1, stdout: "", stderr: "" },
    ]) {
      expect(interpretOwnerAuth(run).ok).toBe(false);
      expect((interpretOwnerAuth(run) as { outcome: string }).outcome).toBe("failed");
    }
  });

  test("no helper refuses without running anything", async () => {
    const { r, calls } = runner({ exitCode: 0, stdout: "authenticated", stderr: "" }, null);
    const result = await confirmOwner("trust", r);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ outcome: "unavailable" });
    expect(calls).toEqual([]);
  });

  test("a helper that cannot start refuses", async () => {
    const { r } = runner(new Error("spawn EACCES"));
    expect(await confirmOwner("trust", r)).toMatchObject({ ok: false, outcome: "failed" });
  });

  test("the real runner never runs inside a test", async () => {
    expect(await confirmOwner("trust", undefined, { NODE_ENV: "test" })).toMatchObject({ ok: false, outcome: "unavailable" });
  });

  test("the helper is looked for only inside the app bundle", () => {
    const exists = (p: string) => p === `/Applications/mattstack-dev.app/Contents/Helpers/${OWNER_AUTH_HELPER}`;
    expect(ownerAuthHelperPath("/Applications/mattstack-dev.app", exists)).toBe("/Applications/mattstack-dev.app/Contents/Helpers/rt-owner-auth");
    expect(ownerAuthHelperPath("/Applications/mattstack.app", exists)).toBeNull();
    expect(ownerAuthHelperPath(null, () => true)).toBeNull();
  });
});
