import { describe, expect, test } from "bun:test";
import { mergeSums, publishDevApp, type DevPublishSeams } from "../dev-publish.ts";

describe("mergeSums", () => {
  test("appends a new line", () => {
    expect(mergeSums("aaa  mattstack-2.22.0.dmg\n", "mattstack-dev-2.22.0.zip", "bbb")).toBe("aaa  mattstack-2.22.0.dmg\nbbb  mattstack-dev-2.22.0.zip\n");
  });
  test("replaces a stale line for the same file", () => {
    expect(mergeSums("old  mattstack-dev-2.22.0.zip\naaa  x\n", "mattstack-dev-2.22.0.zip", "new")).toBe("aaa  x\nnew  mattstack-dev-2.22.0.zip\n");
  });
  test("replaces a stale binary-mode line for the same file", () => {
    expect(mergeSums("old *mattstack-dev-2.22.0.zip\n", "mattstack-dev-2.22.0.zip", "new")).toBe("new  mattstack-dev-2.22.0.zip\n");
  });
});

describe("publishDevApp", () => {
  const input = { bundleDir: "/w/rt-dev-bundle", workDir: "/w", tag: "v2.22.0", version: "2.22.0", notaryProfile: "mattstack-notary" };
  function seams(failOn?: string) {
    const cmds: string[] = [];
    const cwds: Record<string, string | undefined> = {};
    const writes: Record<string, string> = {};
    const s: DevPublishSeams = {
      exec: async (argv, opts) => {
        const cmd = argv.join(" ") + (opts?.env?.NOTARY_PROFILE ? ` [NOTARY_PROFILE=${opts.env.NOTARY_PROFILE}]` : "");
        cmds.push(cmd);
        cwds[cmd] = opts?.cwd;
        if (failOn && cmd.includes(failOn)) return { stdout: "", stderr: "nope", exitCode: 1 };
        if (argv[0] === "shasum") return { stdout: "abc  /w/mattstack-dev-2.22.0.zip\n", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      sleep: async () => {},
      readFile: (path) => (path === "/w/sums/SHA256SUMS" ? "aaa  mattstack-2.22.0.dmg\n" : null),
      writeFile: async (path, content) => {
        writes[path] = content;
      },
    };
    return { s, cmds, cwds, writes };
  }

  test("notarizes, zips, uploads the zip, then the merged sums", async () => {
    const { s, cmds, cwds, writes } = seams();
    const r = await publishDevApp(s, input);
    expect(r).toEqual({ ok: true, detail: "mattstack-dev-2.22.0.zip notarized and attached to v2.22.0" });
    const notarize = "scripts/release/notarize.sh rt-tray/mattstack-dev.app [NOTARY_PROFILE=mattstack-notary]";
    const order = [
      notarize,
      "ditto -c -k --keepParent /w/rt-dev-bundle/rt-tray/mattstack-dev.app /w/mattstack-dev-2.22.0.zip",
      "shasum -a 256 /w/mattstack-dev-2.22.0.zip",
      "gh release download v2.22.0 --repo m4ttstack/mattstack --pattern SHA256SUMS --dir /w/sums --clobber",
      "gh release upload v2.22.0 /w/mattstack-dev-2.22.0.zip --repo m4ttstack/mattstack --clobber",
      "gh release upload v2.22.0 /w/sums/SHA256SUMS --repo m4ttstack/mattstack --clobber",
    ];
    let at = -1;
    for (const c of order) {
      const i = cmds.findIndex((x, idx) => idx > at && x === c);
      expect(i).toBeGreaterThan(at);
      at = i;
    }
    expect(cwds[notarize]).toBe("/w/rt-dev-bundle");
    expect(writes["/w/sums/SHA256SUMS"]).toBe(mergeSums("aaa  mattstack-2.22.0.dmg\n", "mattstack-dev-2.22.0.zip", "abc"));
  });

  test("a failed zip upload never touches SHA256SUMS", async () => {
    const { s, cmds, writes } = seams("mattstack-dev-2.22.0.zip --repo");
    const r = await publishDevApp(s, input);
    expect(r.ok).toBe(false);
    expect(cmds.some((c) => c.includes("sums/SHA256SUMS --repo"))).toBe(false);
    expect(writes).toEqual({});
  });

  test("a failed notarization stops before zipping", async () => {
    const { s, cmds } = seams("notarize.sh");
    const r = await publishDevApp(s, input);
    expect(r).toMatchObject({ ok: false });
    expect(cmds.some((c) => c.startsWith("ditto"))).toBe(false);
  });

  test("an unreadable SHA256SUMS stops before uploading anything", async () => {
    const { s, cmds } = seams();
    s.readFile = () => null;
    const r = await publishDevApp(s, input);
    expect(r).toMatchObject({ ok: false });
    expect(cmds.some((c) => c.startsWith("gh release upload"))).toBe(false);
  });

  test("a failed sums upload says the zip is already attached", async () => {
    const { s } = seams("sums/SHA256SUMS --repo");
    const r = await publishDevApp(s, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("mattstack-dev-2.22.0.zip is attached");
  });
});
