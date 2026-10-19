import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fakeProbes, type ExecScript } from "../../setup/__tests__/fakes.ts";
import { MIGRATIONS } from "../../setup/migrations/index.ts";
import { rtVersion } from "../../setup/update.ts";
import { ENGINE_PACK_REF } from "../../skills/installed-plugins.ts";
import type { PluginListEntry } from "../../skills/sources.ts";
import { collectPing, readPingVersions, type PingSeams } from "../ping.ts";

const HOME = "/h";
const ORGS = `${HOME}/.mattstack/orgs`;

const exec: ExecScript = (argv) => {
  if (argv[0] === "sw_vers") return { code: 0, stdout: "15.1\n", stderr: "" };
  if (argv[0] === "/usr/libexec/PlistBuddy") return { code: 0, stdout: "2.30.1\n", stderr: "" };
  return { code: 1, stdout: "", stderr: "" };
};

interface TeamFixture {
  slug: string;
  layout: number;
  username?: string;
  packs: string[];
}

function teamFiles(t: TeamFixture): Record<string, string> {
  const dir = `${ORGS}/${t.slug}`;
  return {
    [`${dir}/mattstack/org/settings.org.jsonc`]: "{}",
    [`${dir}/mattstack/mattstack.jsonc`]: JSON.stringify({ role: "org", org: t.slug, layout: t.layout }),
    ...(t.username ? { [`${HOME}/.mattstack/rt/teams/${t.slug}.json`]: JSON.stringify({ forgeUsername: t.username }) } : {}),
    [`${dir}/.claude-plugin/marketplace.json`]: JSON.stringify({ name: t.slug, plugins: t.packs.map((name) => ({ name, source: `./${name}` })) }),
  };
}

function world(teams: TeamFixture[], extra: { files?: Record<string, string>; exec?: ExecScript } = {}) {
  const files: Record<string, string> = { ...(extra.files ?? {}) };
  for (const t of teams) Object.assign(files, teamFiles(t));
  return fakeProbes({
    home: HOME,
    files,
    dirs: { [ORGS]: teams.map((t) => t.slug), "/Applications/mattstack.app": [] },
    exec: extra.exec ?? exec,
  });
}

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "telemetry-ping-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The seams for a `claude plugin list` that reports `plugins`, each installed under scratch at the given version. */
function claudeWith(plugins: { id: string; version: string }[]): PingSeams {
  const entries: PluginListEntry[] = plugins.map(({ id, version }) => {
    const installPath = join(scratch, "plugins", id.replace(/\W/g, "_"));
    mkdirSync(join(installPath, ".claude-plugin"), { recursive: true });
    writeFileSync(join(installPath, ".claude-plugin", "plugin.json"), JSON.stringify({ version }));
    return { id, installPath, enabled: true };
  });
  return { listPlugins: () => entries };
}

describe("collectPing", () => {
  test("a Mac in two teams reports both usernames, both org layouts and every served pack with its installed version", async () => {
    const claude = claudeWith([
      { id: ENGINE_PACK_REF, version: "0.31.2" },
      { id: "acme-pack@acme", version: "1.4.0" },
      { id: "shared@beta", version: "2.0.0" },
    ]);
    const p = world([
      { slug: "acme", layout: 4, username: "zed", packs: ["acme-pack", "missing-pack"] },
      { slug: "beta", layout: 3, username: "amy", packs: ["shared"] },
    ]);

    const ping = await collectPing(p, claude);

    expect(ping.usernames).toEqual(["amy", "zed"]);
    expect(ping.orgs).toEqual([
      { org: "acme", layout: 4 },
      { org: "beta", layout: 3 },
    ]);
    expect(ping.packs).toEqual([
      { id: "acme-pack@acme", version: "1.4.0" },
      { id: "missing-pack@acme", version: null },
      { id: "shared@beta", version: "2.0.0" },
    ]);
    expect(ping.pluginVersion).toBe("0.31.2");
    expect(ping.appVersion).toBe("2.30.1");
    expect(ping.macosVersion).toBe("15.1");
    expect(ping.rtVersion).toBe(rtVersion());
    expect(ping.flavor).toBe("prod");
  });

  test("two teams that share a username report it once", async () => {
    const p = world([
      { slug: "acme", layout: 4, username: "amy", packs: [] },
      { slug: "beta", layout: 4, username: "amy", packs: [] },
    ]);
    expect((await collectPing(p, claudeWith([]))).usernames).toEqual(["amy"]);
  });

  test("a Mac in no team reports no usernames, orgs or packs", async () => {
    const ping = await collectPing(world([]), claudeWith([]));
    expect(ping.usernames).toEqual([]);
    expect(ping.orgs).toEqual([]);
    expect(ping.packs).toEqual([]);
  });

  test("an org whose marker is absent reports a null layout", async () => {
    const p = fakeProbes({
      home: HOME,
      files: { [`${ORGS}/acme/mattstack/org/settings.org.jsonc`]: "{}" },
      dirs: { [ORGS]: ["acme"] },
      exec,
    });
    expect((await collectPing(p, claudeWith([]))).orgs).toEqual([{ org: "acme", layout: null }]);
  });

  test("migrationsKnown is the registry and migrationsRecorded is the setup ledger", async () => {
    const p = world([], { files: { [`${HOME}/.mattstack/rt/setup-state.json`]: JSON.stringify({ v: 2, migrations: ["2026-01-01-one", "2026-02-02-two"] }) } });
    const ping = await collectPing(p, claudeWith([]));
    expect(ping.migrationsKnown).toEqual(MIGRATIONS.map((m) => m.id));
    expect(ping.migrationsRecorded).toEqual(["2026-01-01-one", "2026-02-02-two"]);
  });

  test("legacy folders are reported by name, never by path", async () => {
    const legacy = join(process.env.HOME!, ".rt");
    mkdirSync(legacy, { recursive: true });
    try {
      expect((await collectPing(world([]), claudeWith([]))).legacyDirs).toEqual([".rt"]);
    } finally {
      rmSync(legacy, { recursive: true, force: true });
    }
  });

  test("a failing exec nulls the app and macOS versions and leaves the rest", async () => {
    const p = world([{ slug: "acme", layout: 4, username: "amy", packs: [] }], {
      exec: (argv) => (argv[0] === "sw_vers" ? { code: 1, stdout: "", stderr: "boom" } : { code: 0, stdout: "", stderr: "" }),
    });
    const ping = await collectPing(p, claudeWith([{ id: ENGINE_PACK_REF, version: "0.31.2" }]));
    expect(ping.macosVersion).toBeNull();
    expect(ping.appVersion).toBeNull();
    expect(ping.usernames).toEqual(["amy"]);
    expect(ping.pluginVersion).toBe("0.31.2");
  });

  test("a plugin list that throws leaves plugin and pack versions null but still lists the packs", async () => {
    const p = world([{ slug: "acme", layout: 4, packs: ["acme-pack"] }]);
    const ping = await collectPing(p, {
      listPlugins: () => {
        throw new Error("claude exited 3");
      },
    });
    expect(ping.pluginVersion).toBeNull();
    expect(ping.packs).toEqual([{ id: "acme-pack@acme", version: null }]);
  });

  test("probes that throw on every read still yield a ping", async () => {
    const base = world([{ slug: "acme", layout: 4, username: "amy", packs: ["a"] }]);
    const boom = (): never => {
      throw new Error("unreadable");
    };
    const p = {
      ...base,
      exec: boom,
      readDir: boom,
      exists: boom,
      readFile: (path: string) => (path.includes("telemetry-id") ? base.readFile(path) : boom()),
    };

    const ping = await collectPing(p, claudeWith([]));

    expect(ping.installId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ping.usernames).toEqual([]);
    expect(ping.orgs).toEqual([]);
    expect(ping.packs).toEqual([]);
    expect(ping.appVersion).toBeNull();
    expect(ping.macosVersion).toBeNull();
    expect(ping.migrationsRecorded).toEqual([]);
    expect(ping.migrationsKnown).toEqual(MIGRATIONS.map((m) => m.id));
  });

  test("the ping carries exactly the spec's fields", async () => {
    expect(Object.keys(await collectPing(world([]), claudeWith([]))).sort()).toEqual([
      "appVersion",
      "flavor",
      "installId",
      "legacyDirs",
      "macosVersion",
      "migrationsKnown",
      "migrationsRecorded",
      "orgs",
      "packs",
      "pluginVersion",
      "rtVersion",
      "usernames",
    ]);
  });
});

describe("readPingVersions", () => {
  test("reads only the app plist and rt's own version", async () => {
    const p = world([]);
    expect(await readPingVersions(p)).toEqual({ appVersion: "2.30.1", rtVersion: rtVersion() });
    expect(p.calls.exec.map((argv) => argv[0])).toEqual(["/usr/libexec/PlistBuddy"]);
  });

  test("a missing app bundle reads as a null app version", async () => {
    const p = fakeProbes({ home: HOME, exec });
    expect((await readPingVersions(p)).appVersion).toBeNull();
    expect(p.calls.exec).toEqual([]);
  });
});
