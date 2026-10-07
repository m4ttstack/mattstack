/**
 * packages/rt-client/src/settings/paths.ts — the rt-client mirror of
 * lib/rt-paths.ts's settings-store constructors (see that module's docblock
 * for the "change there first, mirror here" convention). Parity between the
 * two is covered separately by lib/__tests__/settings-paths-parity.test.ts;
 * this file exercises the rt-client side's own behavior in isolation.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import * as osReal from "os";
import { tmpdir } from "os";
import { join } from "path";
import {
  machineKey,
  legacyTeamsDir,
  machineSettingsPath,
  orgDir,
  orgMarkerPath,
  orgPacksDir,
  orgSecretsDir,
  orgSettingsPath,
  orgsDir,
  teamFolderDir,
  teamFoldersDir,
  teamPackDir,
  teamSettingsPath,
  userSettingsPath,
} from "../paths.ts";

// `mock.module` mutates the live "os" namespace object in place, so
// `osReal.hostname` itself becomes the mock the moment it's installed —
// restoring with `() => osReal` would restore the mock to itself. Capture
// the real function BEFORE any test can call mock.module("os", ...).
const realHostname = osReal.hostname;

describe("settings/paths", () => {
  const origHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = origHome;
  });

  describe("path shapes", () => {
    test("userSettingsPath nests under user/settings.user.jsonc", () => {
      process.env.HOME = "/tmp/fake-home-client-1";
      expect(userSettingsPath()).toBe("/tmp/fake-home-client-1/.mattstack/user/settings.user.jsonc");
    });

    test("machineSettingsPath nests under user/local/<machineKey()>/settings.local.jsonc", () => {
      const home = mkdtempSync(join(tmpdir(), "rt-client-machine-store-"));
      process.env.HOME = home;
      expect(machineSettingsPath()).toBe(join(home, ".mattstack", "user", "local", machineKey(), "settings.local.jsonc"));
      rmSync(home, { recursive: true, force: true });
    });

    test("teamSettingsPath nests under orgs/<org>/mattstack/teams/<team>/settings.team.jsonc", () => {
      process.env.HOME = "/tmp/fake-home-client-2";
      expect(teamSettingsPath("acme", "widgets")).toBe("/tmp/fake-home-client-2/.mattstack/orgs/acme/mattstack/teams/widgets/settings.team.jsonc");
    });

    test("orgsDir resolves at call-time HOME", () => {
      process.env.HOME = "/tmp/fake-home-client-3";
      expect(orgsDir()).toBe("/tmp/fake-home-client-3/.mattstack/orgs");
    });

    test("orgsDir and orgDir sit under ~/.mattstack/orgs", () => {
      const home = "/tmp/fake-home-client-4";
      process.env.HOME = home;
      expect(orgsDir()).toBe(join(home, ".mattstack", "orgs"));
      expect(orgDir("acme")).toBe(join(home, ".mattstack", "orgs", "acme"));
      expect(orgMarkerPath("acme")).toBe(join(home, ".mattstack", "orgs", "acme", "mattstack", "mattstack.jsonc"));
    });

    test("legacyTeamsDir is the old root and nothing else derives from it", () => {
      const home = "/tmp/fake-home-client-5";
      process.env.HOME = home;
      expect(legacyTeamsDir()).toBe(join(home, ".mattstack", "teams"));
      expect(orgDir("acme").startsWith(legacyTeamsDir())).toBe(false);
    });
  });

  describe("machineKey", () => {
    const makeKeyHome = () => mkdtempSync(join(tmpdir(), "rt-client-machine-key-"));

    afterEach(() => {
      mock.module("os", () => ({ ...osReal, hostname: realHostname }));
    });

    test("an override file wins, trimmed", () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mkdirSync(join(home, ".mattstack"), { recursive: true });
      writeFileSync(join(home, ".mattstack", "machine-key"), "  my-custom-key  \n");
      expect(machineKey()).toBe("my-custom-key");
      rmSync(home, { recursive: true, force: true });
    });

    test("an override file that is empty after trim falls through to the hostname slug", () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mkdirSync(join(home, ".mattstack"), { recursive: true });
      writeFileSync(join(home, ".mattstack", "machine-key"), "   \n");
      mock.module("os", () => ({ ...osReal, hostname: () => "Real-Host" }));
      expect(machineKey()).toBe("real-host");
      rmSync(home, { recursive: true, force: true });
    });

    // An override becomes a directory name directly under user/local/, so a
    // value that isn't a safe single path segment must not be honored — it
    // would escape that directory (a separator) or resolve to a no-op/parent
    // segment (".", "..") instead of a distinct machine's namespace.
    test.each([
      ["a forward slash", "evil/key"],
      ["a backslash", "evil\\key"],
      ["exactly \".\"", "."],
      ["exactly \"..\"", ".."],
    ])("an override value containing %s is rejected — falls through to the hostname slug", (_label, unsafe) => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mkdirSync(join(home, ".mattstack"), { recursive: true });
      writeFileSync(join(home, ".mattstack", "machine-key"), unsafe);
      mock.module("os", () => ({ ...osReal, hostname: () => "Safe-Host" }));
      expect(machineKey()).toBe("safe-host");
      rmSync(home, { recursive: true, force: true });
    });

    test("no override file at all: falls through to the hostname slug", () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mock.module("os", () => ({ ...osReal, hostname: () => "Some-Host" }));
      expect(machineKey()).toBe("some-host");
      rmSync(home, { recursive: true, force: true });
    });

    test("hostname slug: lowercased, trailing .local stripped", () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mock.module("os", () => ({ ...osReal, hostname: () => "Matts-MacBook-Pro.local" }));
      expect(machineKey()).toBe("matts-macbook-pro");
      rmSync(home, { recursive: true, force: true });
    });

    test("hostname slug: illegal characters collapse to single dashes, edges trimmed", () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mock.module("os", () => ({ ...osReal, hostname: () => "  weird_host!!name@@ " }));
      expect(machineKey()).toBe("weird-host-name");
      rmSync(home, { recursive: true, force: true });
    });

    test('hostname slug: an all-illegal hostname slugs to empty and falls back to "default"', () => {
      const home = makeKeyHome();
      process.env.HOME = home;
      mock.module("os", () => ({ ...osReal, hostname: () => "!!!" }));
      expect(machineKey()).toBe("default");
      rmSync(home, { recursive: true, force: true });
    });
  });

  describe("org and team folder paths", () => {
    test("every org path hangs off orgs/<org>", () => {
      process.env.HOME = "/tmp/fake-home-org";
      const root = "/tmp/fake-home-org/.mattstack/orgs/acme";
      expect(orgDir("acme")).toBe(root);
      expect(orgMarkerPath("acme")).toBe(`${root}/mattstack/mattstack.jsonc`);
      expect(orgSettingsPath("acme")).toBe(`${root}/mattstack/org/settings.org.jsonc`);
      expect(orgSecretsDir("acme")).toBe(`${root}/mattstack/org/secrets`);
      expect(orgPacksDir("acme")).toBe(`${root}/mattstack/org/packs`);
      expect(teamFoldersDir("acme")).toBe(`${root}/mattstack/teams`);
      expect(teamFolderDir("acme", "widgets")).toBe(`${root}/mattstack/teams/widgets`);
      expect(teamPackDir("acme", "widgets")).toBe(`${root}/mattstack/teams/widgets/packs/widgets`);
    });
  });
});
