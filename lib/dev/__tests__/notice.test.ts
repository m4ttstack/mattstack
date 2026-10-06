import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { devAppNotice } from "../notice.ts";

function probes(installed: string | null, releaseBuild: boolean, latest: string, sumsLine = true) {
  const files: Record<string, string> = installed ? { "/Applications/mattstack-dev.app/Contents/Info.plist": "" } : {};
  return fakeProbes({
    files,
    fetch: async () => ({ status: 200, headers: {}, body: sumsLine === false ? "aaa  mattstack.dmg\n" : `abc123  mattstack-dev-${latest}.zip\n` }),
    exec: (argv) => {
      const a = argv.join(" ");
      if (a.includes("CFBundleShortVersionString")) return { code: 0, stdout: `${installed}\n`, stderr: "" };
      if (a.includes("MSDevReleaseBuild")) return releaseBuild ? { code: 0, stdout: "true\n", stderr: "" } : { code: 1, stdout: "", stderr: "" };
      if (a.includes("releases")) {
        return { code: 0, stderr: "", stdout: JSON.stringify([{ tag_name: `v${latest}`, draft: false, prerelease: false, assets: [{ name: `mattstack-dev-${latest}.zip`, browser_download_url: "u" }, { name: "SHA256SUMS", browser_download_url: "s" }] }]) };
      }
      return { code: 1, stdout: "", stderr: "" };
    },
  });
}

describe("devAppNotice", () => {
  test("a release-built dev app behind the newest release gets a notice naming rt dev update", async () => {
    const n = await devAppNotice({ probes: probes("2.22.0", true, "2.23.0"), flavor: "dev", gh: () => ["gh"] });
    expect(n).toEqual({ id: "dev_app:2.23.0", title: "A newer dev app is ready", message: "mattstack-dev 2.23.0 is out. Run rt dev update to install it." });
  });
  test("current: no notice", async () => {
    expect(await devAppNotice({ probes: probes("2.23.0", true, "2.23.0"), flavor: "dev", gh: () => ["gh"] })).toBeNull();
  });
  test("a newer release whose SHA256SUMS lacks the dev zip: no notice, since rt dev update would skip it", async () => {
    expect(await devAppNotice({ probes: probes("2.22.0", true, "2.23.0", false), flavor: "dev", gh: () => ["gh"] })).toBeNull();
  });
  test("a locally built dev app: no notice", async () => {
    expect(await devAppNotice({ probes: probes("2.22.0", false, "2.23.0"), flavor: "dev", gh: () => ["gh"] })).toBeNull();
  });
  test("prod: no notice and no network", async () => {
    const p = probes("2.22.0", true, "2.23.0");
    expect(await devAppNotice({ probes: p, flavor: "prod", gh: () => ["gh"] })).toBeNull();
    expect(p.calls.exec).toEqual([]);
  });
  test("GitHub unreachable: no notice, no throw", async () => {
    const p = fakeProbes({ files: { "/Applications/mattstack-dev.app/Contents/Info.plist": "" }, exec: (argv) => (argv.join(" ").includes("Short") ? { code: 0, stdout: "2.22.0", stderr: "" } : argv.join(" ").includes("MSDev") ? { code: 0, stdout: "true", stderr: "" } : { code: 1, stdout: "", stderr: "offline" }) });
    expect(await devAppNotice({ probes: p, flavor: "dev", gh: () => ["gh"] })).toBeNull();
  });
});
