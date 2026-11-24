import { describe, expect, test } from "bun:test";
import {
  compareForkVersions,
  fetchHerdrBuilds,
  HERDR_ASSET_PREFIX,
  HERDR_BUILDS_URL,
  herdrVerdict,
  newestBuild,
  parseHerdrBuilds,
  parseHerdrVersion,
  serverNeedsMove,
} from "../herdr-builds.ts";
import { fakeProbes } from "./fakes.ts";

const sha = (c: string) => c.repeat(64);

function build(version: string, revision: number) {
  return {
    version,
    herdr: "0.9.5",
    revision,
    changesServer: true,
    assets: {
      arm64: { url: `${HERDR_ASSET_PREFIX}v${version}/herdr-macos-aarch64`, sha256: sha("a") },
      x86_64: { url: `${HERDR_ASSET_PREFIX}v${version}/herdr-macos-x86_64`, sha256: sha("b") },
    },
    supersedes: [],
  };
}

function listJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema: 1, newest: "0.9.5-ms.2", builds: [build("0.9.5-ms.1", 1), build("0.9.5-ms.2", 2)], flockPatchSha256: [], ...overrides };
}

const list = parseHerdrBuilds(JSON.stringify(listJson()))!;
const v = parseHerdrVersion;

describe("parseHerdrVersion", () => {
  test("parses herdr's version line", () => {
    expect(parseHerdrVersion("herdr 0.9.5-ms.2\n")).toEqual({ version: "0.9.5-ms.2", fork: { herdr: "0.9.5", revision: 2 } });
    expect(parseHerdrVersion("herdr 0.9.5")).toEqual({ version: "0.9.5", fork: null });
  });
});

describe("compareForkVersions", () => {
  test("orders base before revision", () => {
    expect(compareForkVersions({ herdr: "0.9.6", revision: 1 }, { herdr: "0.9.5", revision: 9 })).toBeGreaterThan(0);
    expect(compareForkVersions({ herdr: "0.9.5", revision: 2 }, { herdr: "0.9.5", revision: 10 })).toBeLessThan(0);
    expect(compareForkVersions({ herdr: "0.9.5", revision: 2 }, { herdr: "0.9.5", revision: 2 })).toBe(0);
  });
});

describe("parseHerdrBuilds", () => {
  test("reads a valid list and ignores unknown fields", () => {
    expect(list.newest).toBe("0.9.5-ms.2");
    expect(list.builds).toHaveLength(2);
    expect(newestBuild(list).version).toBe("0.9.5-ms.2");
  });

  test("rejects an asset url outside the fork", () => {
    const bad = build("0.9.5-ms.2", 2);
    bad.assets.arm64.url = "https://herdr.dev/x";
    expect(parseHerdrBuilds(JSON.stringify(listJson({ builds: [build("0.9.5-ms.1", 1), bad] })))).toBeNull();
  });

  test("rejects an asset url that climbs out of the fork with dot segments", () => {
    const bad = build("0.9.5-ms.2", 2);
    bad.assets.arm64.url = `${HERDR_ASSET_PREFIX}../../../evil/herdr/releases/download/x`;
    expect(parseHerdrBuilds(JSON.stringify(listJson({ builds: [build("0.9.5-ms.1", 1), bad] })))).toBeNull();
  });

  test("rejects a build whose version is not fork-shaped or disagrees with herdr and revision", () => {
    const stock = { ...build("0.9.5-ms.2", 2), version: "0.9.5" };
    expect(parseHerdrBuilds(JSON.stringify(listJson({ newest: "0.9.5", builds: [stock] })))).toBeNull();
    const wrongBase = { ...build("0.9.5-ms.2", 2), herdr: "0.9.6" };
    expect(parseHerdrBuilds(JSON.stringify(listJson({ builds: [build("0.9.5-ms.1", 1), wrongBase] })))).toBeNull();
    const wrongRevision = { ...build("0.9.5-ms.2", 2), revision: 3 };
    expect(parseHerdrBuilds(JSON.stringify(listJson({ builds: [build("0.9.5-ms.1", 1), wrongRevision] })))).toBeNull();
  });

  test("rejects schema 2, a missing newest, a short sha256", () => {
    expect(parseHerdrBuilds(JSON.stringify(listJson({ schema: 2 })))).toBeNull();
    expect(parseHerdrBuilds(JSON.stringify(listJson({ newest: "0.9.5-ms.9" })))).toBeNull();
    const short = build("0.9.5-ms.2", 2);
    short.assets.x86_64.sha256 = "abc";
    expect(parseHerdrBuilds(JSON.stringify(listJson({ builds: [short] })))).toBeNull();
  });

  test("rejects text that is not JSON", () => {
    expect(parseHerdrBuilds("<html>")).toBeNull();
  });
});

describe("herdrVerdict", () => {
  test("newest fork build is current", () => expect(herdrVerdict(v("herdr 0.9.5-ms.2"), list)).toEqual({ kind: "current", version: "0.9.5-ms.2", checked: true }));

  test("a fork build newer than newest is current", () => expect(herdrVerdict(v("herdr 0.9.5-ms.7"), list).kind).toBe("current"));

  test("an older fork build is outdated", () =>
    expect(herdrVerdict(v("herdr 0.9.5-ms.1"), list)).toEqual({ kind: "outdated", version: "0.9.5-ms.1", target: "0.9.5-ms.2", belowMinimum: false }));

  test("stock herdr newer than the fork still needs the fork", () =>
    expect(herdrVerdict(v("herdr 0.9.9"), list)).toEqual({ kind: "stock", version: "0.9.9", target: "0.9.5-ms.2" }));

  test("without the list, the minimum decides", () => {
    expect(herdrVerdict(v("herdr 0.9.5-ms.1"), null)).toEqual({ kind: "current", version: "0.9.5-ms.1", checked: false });
    expect(herdrVerdict(v("herdr 0.9.5"), null)).toEqual({ kind: "stock", version: "0.9.5", target: "0.9.5-ms.1" });
  });

  test("a build below the minimum is outdated and says so", () => {
    expect(herdrVerdict(v("herdr 0.9.5-ms.1"), null, "0.9.5-ms.2")).toEqual({ kind: "outdated", version: "0.9.5-ms.1", target: "0.9.5-ms.2", belowMinimum: true });
    expect(herdrVerdict(v("herdr 0.9.5-ms.1"), list, "0.9.5-ms.2")).toEqual({ kind: "outdated", version: "0.9.5-ms.1", target: "0.9.5-ms.2", belowMinimum: true });
  });
});

describe("serverNeedsMove", () => {
  const withServerChanges = (changes: Record<string, boolean>) =>
    parseHerdrBuilds(
      JSON.stringify(listJson({ newest: Object.keys(changes).at(-1), builds: Object.entries(changes).map(([version, changesServer], i) => ({ ...build(version, i + 1), changesServer })) })),
    )!;

  test("a server already on the installed build never moves", () => {
    expect(serverNeedsMove("0.9.5-ms.2", "0.9.5-ms.2", null)).toBe(false);
    expect(serverNeedsMove("0.9.5-ms.2", "0.9.5-ms.2", list)).toBe(false);
  });

  test("a stock server always moves, whatever the builds say", () => {
    expect(serverNeedsMove("0.9.5", "0.9.5-ms.2", withServerChanges({ "0.9.5-ms.1": false, "0.9.5-ms.2": false }))).toBe(true);
  });

  test("a fork server moves only when a build after it, up to the installed one, changes the server", () => {
    const keep = withServerChanges({ "0.9.5-ms.1": true, "0.9.5-ms.2": false });
    expect(serverNeedsMove("0.9.5-ms.1", "0.9.5-ms.2", keep)).toBe(false);
    const between = withServerChanges({ "0.9.5-ms.1": false, "0.9.5-ms.2": true, "0.9.5-ms.3": false });
    expect(serverNeedsMove("0.9.5-ms.1", "0.9.5-ms.3", between)).toBe(true);
    expect(serverNeedsMove("0.9.5-ms.2", "0.9.5-ms.3", between)).toBe(false);
  });

  test("an installed build the list does not name moves every server not on it", () => {
    const keep = withServerChanges({ "0.9.5-ms.1": false, "0.9.5-ms.2": false });
    expect(serverNeedsMove("0.9.5-ms.2", "0.9.5-ms.7", keep)).toBe(true);
    expect(serverNeedsMove("0.9.5-ms.7", "0.9.5-ms.7", keep)).toBe(false);
  });

  test("without the list, any other version moves", () => {
    expect(serverNeedsMove("0.9.5-ms.1", "0.9.5-ms.2", null)).toBe(true);
  });
});

describe("fetchHerdrBuilds", () => {
  test("fetchHerdrBuilds reads the fork's url and returns null on 404", async () => {
    const found = fakeProbes({ fetch: async () => ({ status: 200, body: JSON.stringify(listJson()), headers: {} }) });
    expect((await fetchHerdrBuilds(found))?.newest).toBe("0.9.5-ms.2");
    expect(found.calls.fetch[0]).toBe(HERDR_BUILDS_URL);
    expect(found.calls.fetchInits[0]?.init?.timeoutMs).toBe(10_000);

    const gone = fakeProbes({ fetch: async () => ({ status: 404, body: "Not Found", headers: {} }) });
    expect(await fetchHerdrBuilds(gone)).toBeNull();
  });

  test("a fetch that throws is null", async () => {
    const offline = fakeProbes({
      fetch: async () => {
        throw new Error("offline");
      },
    });
    expect(await fetchHerdrBuilds(offline)).toBeNull();
  });
});
