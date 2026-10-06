import { describe, expect, test } from "bun:test";
import { hasDeveloperIdIdentity, REBUILD_NEEDS_CERT, rebuildGuard } from "../signing-identity.ts";

const run = (stdout: string, exitCode = 0) => async () => ({ stdout, stderr: "", exitCode });

describe("hasDeveloperIdIdentity", () => {
  test("true when a Developer ID Application identity is listed", async () => {
    expect(
      await hasDeveloperIdIdentity(
        run('  1) ABC "Developer ID Application: Someone (TEAM)"\n     1 valid identities found\n'),
      ),
    ).toBe(true);
  });
  test("false with only an Apple Development identity", async () => {
    expect(await hasDeveloperIdIdentity(run('  1) ABC "Apple Development: someone@x (TEAM)"\n'))).toBe(false);
  });
  test("false when security fails", async () => {
    expect(await hasDeveloperIdIdentity(run("", 1))).toBe(false);
  });
  test("the copy names no person", () => {
    expect(REBUILD_NEEDS_CERT).toBe(
      "Rebuilding the dev app needs the maintainers' signing certificate. You only need it for tray changes: your rt, app and skill changes already run from your clone.",
    );
  });
});

describe("rebuildGuard", () => {
  test("no identity: prints and notifies the refusal, runs nothing else, returns false", async () => {
    const execs: string[] = [];
    const notes: string[] = [];
    const printed: string[] = [];
    const ok = await rebuildGuard({
      exec: async (argv) => {
        execs.push(argv.join(" "));
        return { stdout: "0 valid identities found\n", stderr: "", exitCode: 0 };
      },
      notify: (title, message) => notes.push(`${title}: ${message}`),
      print: (line) => printed.push(line),
    });
    expect(ok).toBe(false);
    expect(execs).toEqual(["security find-identity -v -p codesigning"]);
    expect(notes).toEqual([`Dev app not rebuilt: ${REBUILD_NEEDS_CERT}`]);
    expect(printed).toEqual([`✗ ${REBUILD_NEEDS_CERT}`]);
  });
  test("with an identity: silent, returns true", async () => {
    const notes: string[] = [];
    const ok = await rebuildGuard({
      exec: run('"Developer ID Application: X (T)"'),
      notify: (t) => notes.push(t),
      print: () => {},
    });
    expect(ok).toBe(true);
    expect(notes).toEqual([]);
  });
});
