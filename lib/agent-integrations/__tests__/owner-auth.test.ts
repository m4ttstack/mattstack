import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { processFlavor } from "../../flavor.ts";
import { DEV_TRAY_APP_BUNDLE, installedTrayAppPath, machineSettingsPath, TRAY_APP_BUNDLE } from "../../rt-paths.ts";
import {
  confirmOwner, interpretOwnerAuth, locateOwnerAuthHelper, OWNER_AUTH_HELPER, realOwnerAuthRunner, type OwnerAuthRun, type OwnerAuthRunner,
} from "../codex/owner-auth.ts";

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

  test("prod uses only the bundle rt runs from", () => {
    const all = () => true;
    expect(locateOwnerAuthHelper({ flavor: "prod", fromExec: "/Applications/mattstack.app", home: "/h", exists: all })).toBe(`/Applications/mattstack.app/Contents/Helpers/${OWNER_AUTH_HELPER}`);
    expect(locateOwnerAuthHelper({ flavor: "prod", fromExec: null, home: "/h", exists: all })).toBeNull();
  });

  test("dev and source runs use only the dev app's two fixed install locations", () => {
    const user = `/h/Applications/mattstack-dev.app/Contents/Helpers/${OWNER_AUTH_HELPER}`;
    expect(locateOwnerAuthHelper({ flavor: "dev", fromExec: null, home: "/h", exists: () => true })).toBe(`/Applications/mattstack-dev.app/Contents/Helpers/${OWNER_AUTH_HELPER}`);
    expect(locateOwnerAuthHelper({ flavor: "dev", fromExec: null, home: "/h", exists: (p) => p === user })).toBe(user);
    expect(locateOwnerAuthHelper({ flavor: "dev", fromExec: "/tmp/elsewhere/mattstack-dev.app", home: "/h", exists: (p) => p.startsWith("/tmp/") })).toBeNull();
  });

  describe("a repointed mattstack.appPath", () => {
    const origHome = process.env.HOME;
    let root = "";
    afterEach(() => {
      process.env.HOME = origHome;
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test("is never where the helper comes from", () => {
      root = realpathSync(mkdtempSync(join(tmpdir(), "owner-auth-")));
      process.env.HOME = join(root, "home");
      const bundle = processFlavor() === "prod" ? TRAY_APP_BUNDLE : DEV_TRAY_APP_BUNDLE;
      const planted = join(root, "planted", bundle);
      const fake = join(planted, "Contents", "Helpers", OWNER_AUTH_HELPER);
      mkdirSync(dirname(fake), { recursive: true });
      writeFileSync(fake, "#!/bin/sh\necho authenticated\n", { mode: 0o755 });
      mkdirSync(dirname(machineSettingsPath()), { recursive: true });
      writeFileSync(machineSettingsPath(), JSON.stringify({ "mattstack.appPath": planted }));
      expect(installedTrayAppPath(bundle, existsSync)).toBe(planted);
      expect(realOwnerAuthRunner().locate()).not.toBe(fake);
      for (const flavor of ["dev", "prod"] as const) {
        expect(locateOwnerAuthHelper({ flavor, fromExec: null, home: process.env.HOME, exists: existsSync })).not.toBe(fake);
      }
    });
  });
});
