import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { compareVersions, installCommandFor, isBundledPath, parseBunPin, parseGoPin, probeDevTools, readPins } from "../tools.ts";

const HOME = "/Users/collab";
const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
const missing = { code: 127, stdout: "", stderr: "ENOENT" };

describe("pins", () => {
  test("parseBunPin reads packageManager", () => {
    expect(parseBunPin(JSON.stringify({ packageManager: "bun@1.4.2" }))).toBe("1.4.2");
    expect(parseBunPin(JSON.stringify({ packageManager: "pnpm@9.0.0" }))).toBeNull();
    expect(parseBunPin("not json")).toBeNull();
  });
  test("parseGoPin reads the go line", () => {
    expect(parseGoPin("module rt-ui\n\ngo 1.26.5\n\nrequire (\n")).toBe("1.26.5");
    expect(parseGoPin("module rt-ui\n")).toBeNull();
  });
  test("readPins prefers the clone's files", async () => {
    const p = fakeProbes({ files: { "/c/package.json": JSON.stringify({ packageManager: "bun@1.5.0" }), "/c/ui/go.mod": "go 1.27.0\n" } });
    expect(await readPins(p, "/c")).toEqual({ bun: "1.5.0", go: "1.27.0" });
    expect(p.calls.fetch).toEqual([]);
  });
  test("readPins fetches main from GitHub before a clone exists", async () => {
    const p = fakeProbes({
      fetch: async (url) =>
        url.endsWith("/package.json")
          ? { status: 200, body: JSON.stringify({ packageManager: "bun@1.4.2" }), headers: {} }
          : { status: 200, body: "go 1.26.5\n", headers: {} },
    });
    expect(await readPins(p, null)).toEqual({ bun: "1.4.2", go: "1.26.5" });
  });
  test("readPins with no network throws a plain error", async () => {
    const p = fakeProbes({ fetch: async () => ({ status: 0, body: "", headers: {} }) });
    await expect(readPins(p, null)).rejects.toMatchObject({ code: "dev-pins-unreadable" });
  });
});

describe("compareVersions", () => {
  test("numeric, not lexical", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.4.2", "1.4.2")).toBe(0);
    expect(compareVersions("1.4", "1.4.1")).toBeLessThan(0);
  });
});

describe("isBundledPath", () => {
  test("any path inside an app bundle", () => {
    expect(isBundledPath("/Applications/mattstack.app/Contents/Helpers/bun")).toBe(true);
    expect(isBundledPath(`${HOME}/.bun/bin/bun`)).toBe(false);
  });
});

describe("probeDevTools", () => {
  const pins = { bun: "1.4.2", go: "1.26.5" };
  function probes(execs: Record<string, ReturnType<typeof ok> | typeof missing>, files: Record<string, string>, links: Record<string, string> = {}) {
    return fakeProbes({
      home: HOME,
      env: { PATH: "/usr/local/bin:/usr/bin" },
      files,
      links,
      exec: (argv) => execs[argv[0]!] ?? missing,
    });
  }

  test("all ready", async () => {
    const p = probes(
      {
        "/usr/bin/git": ok("git version 2.50.1"),
        [`${HOME}/.bun/bin/bun`]: ok("1.4.2\n"),
        "/opt/homebrew/bin/go": ok("go version go1.26.5 darwin/arm64"),
        "/opt/homebrew/bin/node": ok("v22.3.0"),
      },
      { "/usr/bin/git": "", [`${HOME}/.bun/bin/bun`]: "", "/opt/homebrew/bin/go": "", "/opt/homebrew/bin/node": "" },
    );
    const s = await probeDevTools(p, pins);
    expect(s.map((t) => [t.name, t.state])).toEqual([["git", "ready"], ["bun", "ready"], ["go", "ready"], ["node", "ready"]]);
    expect(s.find((t) => t.name === "bun")!.found).toBe(`${HOME}/.bun/bin/bun`);
  });

  test("old bun is too-old, missing go is missing, node is a warning", async () => {
    const p = probes({ "/usr/bin/git": ok("git version 2.50.1"), [`${HOME}/.bun/bin/bun`]: ok("1.3.9") }, { "/usr/bin/git": "", [`${HOME}/.bun/bin/bun`]: "" });
    const s = await probeDevTools(p, pins);
    expect(s.find((t) => t.name === "bun")).toMatchObject({ state: "too-old", version: "1.3.9", wanted: "1.4.2" });
    expect(s.find((t) => t.name === "go")).toMatchObject({ state: "missing", need: "required" });
    expect(s.find((t) => t.name === "node")).toMatchObject({ state: "missing", need: "warning" });
  });

  test("a ready copy in a fallback dir beats an older one earlier on PATH", async () => {
    const p = probes(
      { "/usr/bin/git": ok("git version 2.50.1"), "/usr/local/bin/bun": ok("1.3.0"), [`${HOME}/.bun/bin/bun`]: ok("1.4.2") },
      { "/usr/bin/git": "", "/usr/local/bin/bun": "", [`${HOME}/.bun/bin/bun`]: "" },
    );
    const bun = (await probeDevTools(p, pins)).find((t) => t.name === "bun")!;
    expect(bun).toMatchObject({ state: "ready", version: "1.4.2", found: `${HOME}/.bun/bin/bun` });
  });

  test("when every copy is old, the highest version is reported too-old", async () => {
    const p = probes(
      { "/usr/bin/git": ok("git version 2.50.1"), "/usr/local/bin/bun": ok("1.3.0"), [`${HOME}/.bun/bin/bun`]: ok("1.3.9") },
      { "/usr/bin/git": "", "/usr/local/bin/bun": "", [`${HOME}/.bun/bin/bun`]: "" },
    );
    const bun = (await probeDevTools(p, pins)).find((t) => t.name === "bun")!;
    expect(bun).toMatchObject({ state: "too-old", version: "1.3.9", found: `${HOME}/.bun/bin/bun`, wanted: "1.4.2" });
  });

  test("a bun on PATH that is an app bundle's copy is ignored (Review Focus 3)", async () => {
    const p = probes(
      { "/usr/bin/git": ok("git version 2.50.1"), "/usr/local/bin/bun": ok("1.4.2") },
      { "/usr/bin/git": "", "/Applications/mattstack.app/Contents/Helpers/bun": "" },
      { "/usr/local/bin/bun": "/Applications/mattstack.app/Contents/Helpers/bun" },
    );
    const s = await probeDevTools(p, pins);
    expect(s.find((t) => t.name === "bun")!.state).toBe("missing");
  });
});

describe("installCommandFor", () => {
  test("names the exact command a person runs", () => {
    expect(installCommandFor("bun", "1.4.2")).toBe("curl -fsSL https://bun.sh/install | bash -s bun-v1.4.2");
    expect(installCommandFor("go", "1.26.5")).toBe("brew install go");
    expect(installCommandFor("node", null)).toBe("brew install node");
    expect(installCommandFor("git", null)).toBe("xcode-select --install");
  });
});
