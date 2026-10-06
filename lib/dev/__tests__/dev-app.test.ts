import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { chooseDevRelease, devReleaseCandidates, devZipName, expectedSha, installDevAppFromRelease, readInstalledDevApp } from "../dev-app.ts";

const rel = (tag: string, assets: string[], extra: object = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: assets.map((name) => ({ name, browser_download_url: `https://dl/${tag}/${name}` })),
  ...extra,
});

describe("devReleaseCandidates", () => {
  test("keeps releases that carry a dev zip and SHA256SUMS, newest first", () => {
    const json = JSON.stringify([
      rel("v2.23.0", ["mattstack-2.23.0.dmg", "SHA256SUMS"]),
      rel("v2.22.0", ["mattstack-dev-2.22.0.zip", "SHA256SUMS"]),
      rel("v2.21.1", ["mattstack-dev-2.21.1.zip", "SHA256SUMS"], { prerelease: true }),
      rel("v2.21.0", ["mattstack-dev-2.21.0.zip", "SHA256SUMS"]),
    ]);
    expect(devReleaseCandidates(json).map((r) => r.version)).toEqual(["2.22.0", "2.21.0"]);
  });
});

describe("expectedSha", () => {
  test("finds the file's line", () => {
    const sums = "aaa  mattstack-2.22.0.dmg\nbbb  mattstack-dev-2.22.0.zip\n";
    expect(expectedSha(sums, devZipName("2.22.0"))).toBe("bbb");
    expect(expectedSha(sums, devZipName("2.21.0"))).toBeNull();
  });
});

describe("chooseDevRelease", () => {
  test("skips a release whose SHA256SUMS has no dev zip line yet (Review Focus 4)", async () => {
    const candidates = devReleaseCandidates(
      JSON.stringify([rel("v2.22.0", ["mattstack-dev-2.22.0.zip", "SHA256SUMS"]), rel("v2.21.0", ["mattstack-dev-2.21.0.zip", "SHA256SUMS"])]),
    );
    const p = fakeProbes({
      fetch: async (url) => ({ status: 200, headers: {}, body: url.includes("v2.22.0") ? "aaa  mattstack-2.22.0.dmg\n" : "ccc  mattstack-dev-2.21.0.zip\n" }),
    });
    expect(await chooseDevRelease(p, candidates)).toMatchObject({ release: { version: "2.21.0" }, sha: "ccc" });
  });
  test("none usable is null", async () => {
    expect(await chooseDevRelease(fakeProbes(), [])).toBeNull();
  });
});

describe("readInstalledDevApp", () => {
  test("reads version and the release-build key", async () => {
    const p = fakeProbes({
      files: { "/Applications/mattstack-dev.app/Contents/Info.plist": "" },
      exec: (argv) => {
        if (argv.includes("CFBundleShortVersionString")) return { code: 0, stdout: "2.22.0\n", stderr: "" };
        if (argv.includes("MSDevReleaseBuild")) return { code: 0, stdout: "true\n", stderr: "" };
        return { code: 1, stdout: "", stderr: "" };
      },
    });
    expect(await readInstalledDevApp(p)).toEqual({ version: "2.22.0", releaseBuild: true });
  });
  test("a local build has no key: releaseBuild false", async () => {
    const p = fakeProbes({
      files: { "/Applications/mattstack-dev.app/Contents/Info.plist": "" },
      exec: (argv) => (argv.includes("CFBundleShortVersionString") ? { code: 0, stdout: "2.21.0\n", stderr: "" } : { code: 1, stdout: "", stderr: "not found" }),
    });
    expect(await readInstalledDevApp(p)).toEqual({ version: "2.21.0", releaseBuild: false });
  });
  test("not installed is null", async () => {
    expect(await readInstalledDevApp(fakeProbes())).toBeNull();
  });
});

describe("installDevAppFromRelease", () => {
  const chosen = { release: { tag: "v2.22.0", version: "2.22.0", zipUrl: "https://dl/z", sumsUrl: "https://dl/s" }, sha: "good" };
  test("a checksum mismatch stops before anything is unpacked or swapped", async () => {
    const p = fakeProbes({
      exec: (argv) => (argv[0] === "shasum" ? { code: 0, stdout: "bad  /scratch/mattstack-dev-2.22.0.zip\n", stderr: "" } : { code: 0, stdout: "", stderr: "" }),
    });
    const swaps: string[] = [];
    const s = {
      probes: p,
      swap: {
        exec: async (a: string[]) => {
          swaps.push(a.join(" "));
          return { stdout: "", stderr: "", exitCode: 0 };
        },
        sleep: async () => {},
      },
      download: async () => {},
      scratchDir: () => "/scratch",
    };
    await expect(installDevAppFromRelease(s as never, chosen)).rejects.toMatchObject({ code: "dev-zip-checksum" });
    expect(p.calls.exec.some((a) => a[0] === "ditto")).toBe(false);
    expect(swaps).toEqual([]);
  });
  function swapSeams(p: ReturnType<typeof fakeProbes>, failOn?: string) {
    const swaps: string[] = [];
    const s = {
      probes: p,
      swap: {
        exec: async (a: string[]) => {
          const cmd = a.join(" ");
          swaps.push(cmd);
          if (failOn && cmd.startsWith(failOn)) return { stdout: "", stderr: "Operation not permitted", exitCode: 1 };
          return { stdout: "", stderr: "", exitCode: a[0] === "pgrep" ? 1 : 0 };
        },
        sleep: async () => {},
      },
      download: async () => {},
      scratchDir: () => "/scratch",
    };
    return { s, swaps };
  }
  const shaOk = (argv: string[]) => (argv[0] === "shasum" ? { code: 0, stdout: "good  x\n", stderr: "" } : { code: 0, stdout: "", stderr: "" });
  const directCopy = ["ditto", "/scratch/unpacked/mattstack-dev.app", "/Applications/mattstack-dev.app"];

  test("a bundle with no readable Info.plist is swapped, never copied over in place", async () => {
    const p = fakeProbes({ dirs: { "/Applications/mattstack-dev.app": ["Contents"] }, exec: shaOk });
    const { s, swaps } = swapSeams(p);
    expect(await installDevAppFromRelease(s as never, chosen)).toEqual({ swapped: true, relaunchedPid: null });
    expect(p.calls.exec).not.toContainEqual(directCopy);
    expect(swaps).toContain("mv /Applications/mattstack-dev.app /Applications/mattstack-dev.app.update-machine-old");
  });
  test("an older installed version goes through the swap", async () => {
    const p = fakeProbes({ files: { "/Applications/mattstack-dev.app/Contents/Info.plist": "" }, dirs: { "/Applications/mattstack-dev.app": ["Contents"] }, exec: shaOk });
    const { s, swaps } = swapSeams(p);
    expect(await installDevAppFromRelease(s as never, chosen)).toEqual({ swapped: true, relaunchedPid: null });
    expect(p.calls.exec).not.toContainEqual(directCopy);
    expect(swaps).toContain("ditto /scratch/unpacked/mattstack-dev.app /Applications/mattstack-dev.app");
  });
  test("a failed swap is dev-app-swap", async () => {
    const p = fakeProbes({ dirs: { "/Applications/mattstack-dev.app": ["Contents"] }, exec: shaOk });
    const { s } = swapSeams(p, "mv /Applications/mattstack-dev.app");
    await expect(installDevAppFromRelease(s as never, chosen)).rejects.toMatchObject({ code: "dev-app-swap" });
  });
  test("a failed fresh copy names no path and keeps ditto's output in the log", async () => {
    const p = fakeProbes({
      exec: (argv) => (argv[0] === "ditto" && argv[2] === "/Applications/mattstack-dev.app" ? { code: 1, stdout: "", stderr: "ditto: Permission denied" } : shaOk(argv)),
    });
    const { s } = swapSeams(p);
    await expect(installDevAppFromRelease(s as never, chosen)).rejects.toMatchObject({
      code: "dev-app-swap",
      message: "Copying the dev app into Applications failed",
      log: "ditto: Permission denied",
    });
  });
  test("not installed: unpacks and copies straight into /Applications without a swap", async () => {
    const p = fakeProbes({ exec: (argv) => (argv[0] === "shasum" ? { code: 0, stdout: "good  x\n", stderr: "" } : { code: 0, stdout: "", stderr: "" }) });
    const s = { probes: p, swap: { exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }), sleep: async () => {} }, download: async () => {}, scratchDir: () => "/scratch" };
    const r = await installDevAppFromRelease(s as never, chosen);
    expect(r).toEqual({ swapped: false, relaunchedPid: null });
    expect(p.calls.exec).toContainEqual(["ditto", "-x", "-k", "/scratch/mattstack-dev-2.22.0.zip", "/scratch/unpacked"]);
    expect(p.calls.exec).toContainEqual(["ditto", "/scratch/unpacked/mattstack-dev.app", "/Applications/mattstack-dev.app"]);
  });
});
