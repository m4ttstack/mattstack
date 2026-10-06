import { describe, expect, test } from "bun:test";
import { DEV_APP_PATH, swapDevApp, type AppSwapSeams } from "../app-swap.ts";

function seams(script: (cmd: string) => { exitCode: number; stdout?: string }) {
  const cmds: string[] = [];
  const s: AppSwapSeams = {
    exec: async (argv) => {
      const cmd = argv.join(" ");
      cmds.push(cmd);
      const r = script(cmd);
      return { stdout: r.stdout ?? "", stderr: "", exitCode: r.exitCode };
    },
    sleep: async () => {},
  };
  return { s, cmds };
}

describe("swapDevApp", () => {
  test("not running: swaps without killing or opening", async () => {
    const { s, cmds } = seams(() => ({ exitCode: 0 }));
    const r = await swapDevApp(s, "/tmp/x/mattstack-dev.app");
    expect(r).toEqual({ ok: true, wasRunning: false, pid: null });
    expect(cmds.some((c) => c.startsWith("kill"))).toBe(false);
    expect(cmds).toContain(`ditto /tmp/x/mattstack-dev.app ${DEV_APP_PATH}`);
    expect(cmds.some((c) => c.includes("/usr/bin/open"))).toBe(false);
  });

  test("running: kills, swaps, reopens and reports the new pid", async () => {
    let opened = false;
    let killed = false;
    const { s } = seams((cmd) => {
      if (cmd.startsWith("pgrep")) return { exitCode: 0, stdout: !killed ? "111\n" : opened ? "222\n" : "" };
      if (cmd.startsWith("kill")) {
        killed = true;
        return { exitCode: 0 };
      }
      if (cmd.includes("/usr/bin/open")) {
        opened = true;
        return { exitCode: 0 };
      }
      return { exitCode: 0 };
    });
    expect(await swapDevApp(s, "/tmp/x/mattstack-dev.app")).toEqual({ ok: true, wasRunning: true, pid: 222 });
  });

  test("a failed ditto restores the previous app and reports it", async () => {
    const { s } = seams((cmd) => ({ exitCode: cmd.startsWith("ditto") ? 1 : 0 }));
    const r = await swapDevApp(s, "/tmp/x/mattstack-dev.app");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("restored the previous app");
  });
});
