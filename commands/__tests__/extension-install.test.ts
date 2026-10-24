import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { __test__, installExtension, type ExtensionDeps } from "../extension.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { __test__ as gate } from "../../lib/ui/gate.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { processFlavor } from "../../lib/flavor.ts";
import { DEV_TRAY_APP_BUNDLE, TRAY_APP_BUNDLE } from "../../lib/rt-paths.ts";

describe("finding the bundled extensions", () => {
  const app = join("/Applications", processFlavor() === "dev" ? DEV_TRAY_APP_BUNDLE : TRAY_APP_BUNDLE);
  const resources = join(app, "Contents", "Resources");
  const beside = "/fake-app/Contents/MacOS";

  test("an installed app's Contents/Resources wins over beside the binary and the source tree", () => {
    const p = fakeProbes({
      home: "/nonexistent-extension-find-home",
      dirs: { [app]: [] },
      files: {
        [join(resources, "rt-context.vsix")]: "",
        [join(resources, "skill-blocks.vsix")]: "",
        [join(beside, "rt-context.vsix")]: "",
      },
    });
    const fromSource = (dir: string): string => {
      throw new Error(`unexpected source lookup for ${dir}`);
    };
    expect(__test__.findVsixes(p, beside, fromSource)).toEqual([join(resources, "rt-context.vsix"), join(resources, "skill-blocks.vsix")]);
  });

  test("the source tree fills in only a file the app and the binary's folder lack", () => {
    const p = fakeProbes({ home: "/nonexistent-extension-find-home", dirs: { [app]: [] }, files: { [join(resources, "rt-context.vsix")]: "" } });
    const asked: string[] = [];
    const fromSource = (dir: string): string => (asked.push(dir), `/src/${dir}/${dir}-0.1.0.vsix`);
    expect(__test__.findVsixes(p, beside, fromSource)).toEqual([join(resources, "rt-context.vsix"), "/src/skill-blocks/skill-blocks-0.1.0.vsix"]);
    expect(asked).toEqual(["skill-blocks"]);
  });
});

const SHORT_TIMEOUT_MS = 300;

let io: ReturnType<typeof captureOut>;
let dir: string;

function launcher(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function readPid(name: string): number | null {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  const pid = Number(readFileSync(path, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    if (!alive(pid)) return true;
    await Bun.sleep(50);
  }
  return false;
}

/** A launcher that, like the macOS `code` script, leaves a child holding its stdout and stderr. */
const hanging = () =>
  launcher("hanging", `echo $$ > "${join(dir, "hanging.pgid")}"\necho "Installing extensions..."\nsleep 30 &\necho $! > "${join(dir, "hanging.child")}"\nwait`);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-extension-install-"));
  io = captureOut();
  ui.__test__.reset();
  ui.__test__.setHuman(() => false);
});
afterEach(() => {
  io.restore();
  gate.setInteractive(undefined);
  for (const [file, group] of [
    ["hanging.pgid", true],
    ["hanging.child", false],
    ["escaped.pid", false],
  ] as const) {
    const pid = readPid(file);
    if (pid === null) continue;
    try {
      process.kill(group ? -pid : pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a timed-out install stops the launcher's whole process group and returns", async () => {
  const started = Date.now();
  const result = await __test__.installWithCli(hanging(), "/x/rt-context.vsix", SHORT_TIMEOUT_MS);
  expect(Date.now() - started).toBeLessThan(3_000);
  expect(result).toEqual({ ok: false, output: "Installing extensions...", timedOut: true });
  expect(await gone(readPid("hanging.child")!)).toBe(true);
}, 15_000);

test("a timed-out install returns after the grace period even when a child outside the group holds the pipes", async () => {
  const escaping = launcher(
    "escaping",
    `perl -MPOSIX -e 'POSIX::setsid(); open(my $f, ">", "${join(dir, "escaped.pid")}") or die; print $f $$; close $f; exec "sleep", "30"' &\nsleep 30 &\nwait`,
  );
  const started = Date.now();
  const result = await __test__.installWithCli(escaping, "/x/rt-context.vsix", SHORT_TIMEOUT_MS);
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(result).toMatchObject({ ok: false, timedOut: true });
  expect(alive(readPid("escaped.pid")!)).toBe(true);
}, 15_000);

test("an editor that timed out says so and the next editor is still installed", async () => {
  gate.setInteractive(() => false);
  const ok = launcher("ok", "exit 0");
  const editors = [
    { name: "Sample Code", cliPath: hanging() },
    { name: "Sample Editor", cliPath: ok },
  ];
  const install = (cliPath: string, vsixPath: string) => __test__.installWithCli(cliPath, vsixPath, SHORT_TIMEOUT_MS);
  expect(await __test__.installInto(editors, ["/x/rt-context.vsix"], install)).toBe(1);
  expect(io.lines()).toEqual([
    "[failed] Sample Code did not take the extension  it did not finish within 30 seconds",
    "[ok] Installed in Sample Editor",
    "[ok] The editor extensions are installed  1 of 2 editors",
    "  next: Restart your editor to turn it on",
  ]);
}, 15_000);

describe("installExtension's exit code", () => {
  const EDITORS = [
    { name: "Sample Code", cliPath: "/apps/sample-code", appPath: "/Applications/Sample Code.app" },
    { name: "Sample Editor", cliPath: "/apps/sample-editor", appPath: "/Applications/Sample Editor.app" },
  ];
  const deps = (over: Partial<ExtensionDeps>): ExtensionDeps => ({
    findVsixes: () => ["/x/rt-context.vsix", "/x/skill-blocks.vsix"],
    detectEditors: () => EDITORS,
    pick: async () => EDITORS.map((e) => e.cliPath),
    install: async () => ({ ok: true }),
    ...over,
  });
  const run = async (d: ExtensionDeps): Promise<number> => {
    const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
      throw new Error(`exit ${c}`);
    }) as unknown as typeof process.exit);
    try {
      await installExtension([], {}, d);
      return 0;
    } catch (err) {
      const m = /^exit (\d+)$/.exec((err as Error).message);
      if (!m) throw err;
      return Number(m[1]);
    } finally {
      exit.mockRestore();
    }
  };

  test("a missing extension exits 1", async () => {
    expect(await run(deps({ findVsixes: () => [] }))).toBe(1);
    expect(io.stderr()).toStartWith("rt could not find its editor extension");
  });

  test("both files go into every picked editor", async () => {
    const calls: string[][] = [];
    expect(await run(deps({ install: async (cliPath, vsix) => (calls.push([cliPath, vsix]), { ok: true }) }))).toBe(0);
    expect(calls).toEqual([
      ["/apps/sample-code", "/x/rt-context.vsix"],
      ["/apps/sample-code", "/x/skill-blocks.vsix"],
      ["/apps/sample-editor", "/x/rt-context.vsix"],
      ["/apps/sample-editor", "/x/skill-blocks.vsix"],
    ]);
  });

  test("an editor that takes one file but not the other counts as failed", async () => {
    expect(await run(deps({ install: async (cliPath, vsix) => (cliPath === "/apps/sample-code" && vsix.endsWith("skill-blocks.vsix") ? { ok: false, output: "boom" } : { ok: true }) }))).toBe(0);
    expect(io.lines()).toContain("[failed] Sample Code did not take the extension  boom");
    expect(io.lines()).toContain("[ok] Installed in Sample Editor");
  });

  test("nothing installed exits 1", async () => {
    expect(await run(deps({ install: async () => ({ ok: false, output: "boom" }) }))).toBe(1);
    expect(io.lines()).toEqual([
      "[failed] Sample Code did not take the extension  boom",
      "[failed] Sample Editor did not take the extension  boom",
    ]);
  });

  test("a partial install exits 0", async () => {
    expect(await run(deps({ install: async (cliPath) => (cliPath === "/apps/sample-code" ? { ok: true } : { ok: false, output: "boom" }) }))).toBe(0);
  });

  test("no detected editor exits 0 without picking or installing", async () => {
    expect(await run(deps({ detectEditors: () => [], pick: async () => { throw new Error("unexpected picker"); }, install: async () => { throw new Error("unexpected install"); } }))).toBe(0);
  });

  for (const selected of [null, []]) {
    test(`${selected === null ? "a cancelled" : "an empty"} selection exits 0 without installing`, async () => {
      expect(await run(deps({ pick: async () => selected, install: async () => { throw new Error("unexpected install"); } }))).toBe(0);
      expect(io.lines()).toEqual(["[skipped] No editors selected"]);
    });
  }
});
