import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { buildFlavor } from "../../flavor.ts";
import { DEV_TRAY_APP_BUNDLE, installedTrayAppPath, machineSettingsPath, TRAY_APP_BUNDLE } from "../../rt-paths.ts";
import {
  confirmOwner, interpretOwnerAuth, locateOwnerAuthHelper, OWNER_AUTH_HELPER, ownerAuthRequirement, realOwnerAuthRunner, verifyOwnerAuthHelper,
  type CodesignRun, type OwnerAuthRun, type OwnerAuthRunner,
} from "../codex/owner-auth.ts";

function runner(answer: OwnerAuthRun | Error, path: string | null = "/Applications/mattstack.app/Contents/Helpers/rt-owner-auth", verdict: string | null | Error = null) {
  const calls: string[][] = [];
  const r: OwnerAuthRunner = {
    locate: () => path,
    verify: async () => {
      if (verdict instanceof Error) throw verdict;
      return verdict;
    },
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

  test("a helper that fails its signature check is never run", async () => {
    const { r, calls } = runner({ exitCode: 0, stdout: "authenticated", stderr: "" }, undefined, "not signed by mattstack");
    expect(await confirmOwner("trust", r)).toEqual({ ok: false, outcome: "failed", message: "not signed by mattstack" });
    expect(calls).toEqual([]);
  });

  test("a signature check that throws refuses without running the helper", async () => {
    const { r, calls } = runner({ exitCode: 0, stdout: "authenticated", stderr: "" }, undefined, new Error("spawn ENOENT"));
    expect(await confirmOwner("trust", r)).toMatchObject({ ok: false, outcome: "failed" });
    expect(calls).toEqual([]);
  });

  describe("the prod signature check", () => {
    const helper = "/Applications/mattstack.app/Contents/Helpers/rt-owner-auth";
    const bundle = "/Applications/mattstack.app";
    const signed = (team: string, verifyExit: number) => {
      const calls: string[][] = [];
      const codesign = async (argv: [string, ...string[]]): Promise<CodesignRun> => {
        calls.push(argv);
        if (argv.includes("-d")) return { exitCode: 0, stdout: "", stderr: `Executable=${bundle}/Contents/MacOS/mattstack\nIdentifier=com.mattstack.app\nTeamIdentifier=${team}\n` };
        return { exitCode: verifyExit, stdout: "", stderr: verifyExit === 0 ? "" : "test-requirement: code failed to satisfy specified code requirement(s)" };
      };
      return { codesign, calls };
    };

    test("the requirement anchors to Apple, the team and the helper's identifier", () => {
      expect(ownerAuthRequirement("ABCDE12345")).toBe('anchor apple generic and certificate leaf[subject.OU] = "ABCDE12345" and identifier "com.mattstack.helper.rt-owner-auth"');
    });

    test("passes a helper signed by the running app's own team", async () => {
      const { codesign, calls } = signed("ABCDE12345", 0);
      expect(await verifyOwnerAuthHelper(helper, bundle, codesign)).toBeNull();
      expect(calls).toEqual([
        ["codesign", "-d", "--verbose=2", bundle],
        ["codesign", "--verify", "--strict", "-R", `=${ownerAuthRequirement("ABCDE12345")}`, helper],
      ]);
    });

    test("refuses a helper that does not satisfy the requirement", async () => {
      const { codesign } = signed("ABCDE12345", 3);
      expect(await verifyOwnerAuthHelper(helper, bundle, codesign)).toBe(
        "The Touch ID helper in this app is not the one mattstack signed, so rt did not run it. Nothing was trusted.",
      );
    });

    test("refuses when the running app carries no team, without checking the helper", async () => {
      for (const team of ["not set", "", "abc"]) {
        const { codesign, calls } = signed(team, 0);
        expect(await verifyOwnerAuthHelper(helper, bundle, codesign)).toBe(
          "This copy of mattstack is not signed by its developer, so rt cannot check the Touch ID helper. Nothing was trusted.",
        );
        expect(calls).toHaveLength(1);
      }
    });
  });

  describe("MATTSTACK_FLAVOR", () => {
    const origHome = process.env.HOME;
    const origFlavor = process.env.MATTSTACK_FLAVOR;
    let root = "";
    afterEach(() => {
      process.env.HOME = origHome;
      if (origFlavor === undefined) delete process.env.MATTSTACK_FLAVOR;
      else process.env.MATTSTACK_FLAVOR = origFlavor;
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test("never moves a compiled build's lookup to the user-writable dev app", async () => {
      root = realpathSync(mkdtempSync(join(tmpdir(), "owner-auth-flavor-")));
      process.env.HOME = join(root, "home");
      const fake = join(process.env.HOME, "Applications", DEV_TRAY_APP_BUNDLE, "Contents", "Helpers", OWNER_AUTH_HELPER);
      mkdirSync(dirname(fake), { recursive: true });
      writeFileSync(fake, "#!/bin/sh\necho authenticated\n", { mode: 0o755 });
      process.env.MATTSTACK_FLAVOR = "dev";
      expect(realOwnerAuthRunner({ built: "prod", fromExec: null }).locate()).toBeNull();
      expect(realOwnerAuthRunner({ built: "dev", fromExec: null }).locate()).not.toBeNull();
    });

    test("a compiled build checks the helper's signature and a source run does not", async () => {
      const calls: string[][] = [];
      const codesign = async (argv: [string, ...string[]]): Promise<CodesignRun> => {
        calls.push(argv);
        return { exitCode: 0, stdout: "", stderr: "TeamIdentifier=not set\n" };
      };
      process.env.MATTSTACK_FLAVOR = "dev";
      expect(await realOwnerAuthRunner({ built: "dev", fromExec: null, codesign }).verify("/x")).toBeNull();
      expect(calls).toEqual([]);
      expect(await realOwnerAuthRunner({ built: "prod", fromExec: "/Applications/mattstack.app", codesign }).verify("/x")).not.toBeNull();
      expect(calls).toHaveLength(1);
    });

    test("a compiled build with no bundle of its own refuses the check", async () => {
      const codesign = async (): Promise<CodesignRun> => ({ exitCode: 0, stdout: "", stderr: "" });
      expect(await realOwnerAuthRunner({ built: "prod", fromExec: null, codesign }).verify("/x")).not.toBeNull();
    });
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
      const bundle = buildFlavor() === "prod" ? TRAY_APP_BUNDLE : DEV_TRAY_APP_BUNDLE;
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
