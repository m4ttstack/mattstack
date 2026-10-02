import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { __test__ } from "../extension.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { __test__ as gate } from "../../lib/ui/gate.ts";

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
  expect(await __test__.installInto(editors, "/x/rt-context.vsix", install)).toBe(1);
  expect(io.lines()).toEqual([
    "[failed] Sample Code did not take the extension  it did not finish within 30 seconds",
    "[ok] Installed in Sample Editor",
    "[ok] RT Context is installed  1 of 2 editors",
    "  next: Restart your editor to turn it on",
  ]);
}, 15_000);
