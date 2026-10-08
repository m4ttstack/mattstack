import { describe, expect, test } from "bun:test";
import { MEMBER_PATH_SENTINEL, memberPath } from "../member-path.ts";
import { fakeProbes, memberShell, ok } from "./fakes.ts";
import type { ExecScript } from "./fakes.ts";

describe("memberPath", () => {
  test("runs the member's $SHELL as an interactive login shell in a clean environment, bounded by a timeout", async () => {
    const seen: Array<{ argv: string[]; timeoutMs?: number }> = [];
    const exec: ExecScript = (argv, opts) => {
      seen.push({ argv, timeoutMs: opts?.timeoutMs });
      return memberShell("/fake-home/.local/bin:/usr/bin")(argv, opts);
    };
    const p = fakeProbes({ env: { SHELL: "/bin/zsh", PATH: "/usr/bin", USER: "member" }, exec });
    await memberPath(p);
    expect(seen).toHaveLength(1);
    const { argv, timeoutMs } = seen[0]!;
    expect(argv.slice(0, 2)).toEqual(["/usr/bin/env", "-i"]);
    expect(argv).toContain("HOME=/fake-home");
    expect(argv).toContain("USER=member");
    expect(argv).toContain("SHELL=/bin/zsh");
    expect(argv.some((arg) => arg.startsWith("PATH=") && !arg.includes(".local/bin"))).toBe(true);
    const shellAt = argv.indexOf("/bin/zsh");
    expect(argv.slice(shellAt, shellAt + 4)).toEqual(["/bin/zsh", "-i", "-l", "-c"]);
    expect(timeoutMs).toBeGreaterThan(0);
  });

  test("reads PATH from between the sentinels, ignoring whatever the rc files printed around it", async () => {
    const p = fakeProbes({ env: { SHELL: "/bin/zsh" }, exec: () => ok(`welcome\n${MEMBER_PATH_SENTINEL}/a:/b/:/c${MEMBER_PATH_SENTINEL}\nbye\n`) });
    expect(await memberPath(p)).toEqual(["/a", "/b", "/c"]);
  });

  test("a shell that printed no sentinel (timed out, exited early) -> null", async () => {
    const p = fakeProbes({ env: { SHELL: "/bin/zsh" }, exec: () => ({ code: 124, stdout: "", stderr: "" }) });
    expect(await memberPath(p)).toBeNull();
  });

  test("no SHELL, or one that is not an absolute path -> null without spawning anything", async () => {
    for (const env of [{}, { SHELL: "zsh" }] as Array<Record<string, string>>) {
      const p = fakeProbes({ env, exec: memberShell("/x") });
      expect(await memberPath(p)).toBeNull();
      expect(p.calls.exec).toHaveLength(0);
    }
  });

  test("probes once per Probes, however many rows ask", async () => {
    const p = fakeProbes({ env: { SHELL: "/bin/zsh" }, exec: memberShell("/fake-home/.local/bin") });
    await Promise.all([memberPath(p), memberPath(p)]);
    await memberPath(p);
    expect(p.calls.exec).toHaveLength(1);
  });
});
