import { describe, test, expect } from "bun:test";
import { macRows } from "../validators/mac.ts";
import { fakeProbes, memberShell, ok, missing } from "./fakes.ts";
import type { ExecScript } from "./fakes.ts";

async function pickRow(rowsP: ReturnType<typeof macRows>, id: string) {
  const rows = await rowsP;
  const r = rows.find((row) => row.id === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
}

const RC = "/fake-home/.zshenv";
const MARKER = "# mattstack — PATH precedence";

describe("macRows — tool.macos", () => {
  const exec = (version: string): ExecScript => (argv) => (argv[0] === "sw_vers" ? ok(`${version}\n`) : ok());

  test("15.6 -> ready", async () => {
    const r = await pickRow(macRows(fakeProbes({ exec: exec("15.6") })), "tool.macos");
    expect(r.status).toBe("ready");
    expect(r.detail).toContain("15.6");
    expect(r.required).toBe(true);
    expect(r.action).toBeNull();
  });

  test("13.7 -> invalid, floor not met", async () => {
    const r = await pickRow(macRows(fakeProbes({ exec: exec("13.7") })), "tool.macos");
    expect(r.status).toBe("invalid");
  });

  test("sw_vers unreachable -> error, never invalid (couldn't determine, not a failed determination)", async () => {
    const execScript: ExecScript = (argv) => (argv[0] === "sw_vers" ? missing("sw_vers") : ok());
    const r = await pickRow(macRows(fakeProbes({ exec: execScript })), "tool.macos");
    expect(r.status).toBe("error");
  });
});

describe("macRows — tool.clt", () => {
  test("xcode-select -p and git --version both succeed -> ready", async () => {
    const execScript: ExecScript = (argv) => {
      if (argv[0] === "sw_vers") return ok("15.6\n");
      if (argv[0] === "xcode-select") return ok("/Library/Developer/CommandLineTools\n");
      if (argv[0] === "git") return ok("git version 2.43.0\n");
      return ok();
    };
    const r = await pickRow(macRows(fakeProbes({ exec: execScript })), "tool.clt");
    expect(r.status).toBe("ready");
    expect(r.detail).toContain("2.43.0");
    expect(r.required).toBe(true);
  });

  test("xcode-select 127 -> missing with install action via apple-clt, and git is NEVER probed — the stub pops Apple's install dialog from a GUI context", async () => {
    const probed: string[] = [];
    const execScript: ExecScript = (argv) => {
      probed.push(argv[0]!);
      if (argv[0] === "sw_vers") return ok("15.6\n");
      if (argv[0] === "xcode-select") return missing("xcode-select");
      if (argv[0] === "git") return ok("git version 2.43.0\n");
      return ok();
    };
    const r = await pickRow(macRows(fakeProbes({ exec: execScript })), "tool.clt");
    expect(r.status).toBe("missing");
    expect(r.detail).toBe("Apple's Command Line Tools are not installed");
    expect(r.action).toEqual({ type: "install", label: "Install…", tool: "apple-clt", via: "apple-clt" });
    expect(probed).not.toContain("git");
  });

  test("xcode-select exiting 2 (no CLT selected) also skips the git probe", async () => {
    const probed: string[] = [];
    const execScript: ExecScript = (argv) => {
      probed.push(argv[0]!);
      if (argv[0] === "sw_vers") return ok("15.6\n");
      if (argv[0] === "xcode-select") return { code: 2, stdout: "", stderr: "unable to get active developer directory" };
      return ok();
    };
    const r = await pickRow(macRows(fakeProbes({ exec: execScript })), "tool.clt");
    expect(r.status).toBe("missing");
    expect(probed).not.toContain("git");
  });

  test("git --version failing even with CLT selected -> missing", async () => {
    const execScript: ExecScript = (argv) => {
      if (argv[0] === "sw_vers") return ok("15.6\n");
      if (argv[0] === "xcode-select") return ok("/Library/Developer/CommandLineTools\n");
      if (argv[0] === "git") return missing("git");
      return ok();
    };
    const r = await pickRow(macRows(fakeProbes({ exec: execScript })), "tool.clt");
    expect(r.status).toBe("missing");
  });
});

describe("macRows: tool.arch", () => {
  test("arm64 -> ready", async () => {
    const execScript: ExecScript = (argv) => (argv[0] === "uname" ? ok("arm64\n") : ok());
    const r = await pickRow(macRows(fakeProbes({ exec: execScript })), "tool.arch");
    expect(r.status).toBe("ready");
    expect(r.detail).toContain("arm64");
    expect(r.required).toBe(true);
  });

  test("x86_64 -> invalid, unsupported architecture", async () => {
    const execScript: ExecScript = (argv) => (argv[0] === "uname" ? ok("x86_64\n") : ok());
    const r = await pickRow(macRows(fakeProbes({ exec: execScript })), "tool.arch");
    expect(r.status).toBe("invalid");
  });

  test("uname unreachable -> error, never invalid (couldn't determine, not a failed determination)", async () => {
    const execScript: ExecScript = (argv) => (argv[0] === "uname" ? missing("uname") : ok());
    const r = await pickRow(macRows(fakeProbes({ exec: execScript })), "tool.arch");
    expect(r.status).toBe("error");
  });
});

describe("macRows — tool.path", () => {
  // The app's own PATH (launchd's) never decides this row: every case below
  // gives the app a PATH that disagrees with the member's shell.
  const APP_ENV = { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" };
  const DIRS = { "/opt/homebrew/bin": [], "/fake-home/.local/bin": [], "/usr/bin": [] };

  test("the member's shell has ~/.local/bin first and the marker is present -> ready, even when the app's PATH lacks it", async () => {
    const p = fakeProbes({
      env: APP_ENV,
      exec: memberShell("/fake-home/.local/bin:/usr/bin"),
      files: { [RC]: `\n${MARKER}\nexport PATH=...\n` },
      dirs: DIRS,
    });
    const r = await pickRow(macRows(p), "tool.path");
    expect(r.status).toBe("ready");
    expect(r.kind).toBe("info");
    expect(r.required).toBe(false);
    expect(r.action).toBeNull();
    expect(r.detail).toContain(".zshenv");
  });

  test("the member's shell has ~/.local/bin first -> ready, even when the app's PATH has it later", async () => {
    const p = fakeProbes({
      env: { ...APP_ENV, PATH: "/opt/homebrew/bin:/fake-home/.local/bin:/usr/bin" },
      exec: memberShell("/fake-home/.local/bin:/opt/homebrew/bin:/usr/bin"),
      files: { [RC]: `${MARKER}\n` },
      dirs: DIRS,
    });
    const r = await pickRow(macRows(p), "tool.path");
    expect(r.status).toBe("ready");
  });

  test("the member's shell has /opt/homebrew/bin first and the marker is present -> needs-you, even when the app's PATH has ~/.local/bin first", async () => {
    const p = fakeProbes({
      env: { ...APP_ENV, PATH: "/fake-home/.local/bin:/usr/bin" },
      exec: memberShell("/opt/homebrew/bin:/fake-home/.local/bin:/usr/bin"),
      files: { [RC]: `${MARKER}\n` },
      dirs: DIRS,
    });
    const r = await pickRow(macRows(p), "tool.path");
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("not first");
    // path.link would no-op here: the marker is already installed.
    expect(r.action).toBeNull();
  });

  test("the member's shell lacks ~/.local/bin entirely and the marker is present -> needs-you saying it is not on PATH, never \"not first\"", async () => {
    const p = fakeProbes({ env: APP_ENV, exec: memberShell("/opt/homebrew/bin:/usr/bin"), files: { [RC]: `${MARKER}\n` }, dirs: DIRS });
    const r = await pickRow(macRows(p), "tool.path");
    expect(r.status).toBe("needs-you");
    expect(r.detail).toBe("~/.local/bin is not on your shell's PATH, so team intercepts will not fire. Check ~/.zshenv");
    expect(r.action).toBeNull();
  });

  test("~/.local/bin first in the member's shell but no marker -> needs-you: precedence holds, rt is not what holds it", async () => {
    const p = fakeProbes({ env: APP_ENV, exec: memberShell("/fake-home/.local/bin:/usr/bin"), dirs: DIRS });
    const r = await pickRow(macRows(p), "tool.path");
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("not through rt's own");
  });

  test("the unowned-precedence row offers the step that makes rt own it", async () => {
    const p = fakeProbes({ env: APP_ENV, exec: memberShell("/fake-home/.local/bin:/usr/bin"), dirs: DIRS });
    const r = await pickRow(macRows(p), "tool.path");
    expect(r.action).toEqual({ type: "run", label: "Add rt's PATH entry", verb: ["setup", "apply", "--only", "path.link"] });
  });

  test("neither first nor marked -> missing", async () => {
    const p = fakeProbes({ env: APP_ENV, exec: memberShell("/opt/homebrew/bin:/fake-home/.local/bin:/usr/bin"), dirs: DIRS });
    const r = await pickRow(macRows(p), "tool.path");
    expect(r.status).toBe("missing");
    expect(r.detail).toContain("Install adds ~/.local/bin");
    expect(r.action).toEqual({ type: "run", label: "Set up PATH", verb: ["setup", "apply", "--only", "path.link"] });
  });

  test("the shell probe fails and the marker is present -> error with a Re-check, never a guess from the app's PATH", async () => {
    const p = fakeProbes({ env: { ...APP_ENV, PATH: "/fake-home/.local/bin:/usr/bin" }, exec: memberShell(null), files: { [RC]: `${MARKER}\n` }, dirs: DIRS });
    const r = await pickRow(macRows(p), "tool.path");
    expect(r.status).toBe("error");
    expect(r.detail).toBe("Could not read your shell's PATH to check its order");
    expect(r.action).toEqual({ type: "run", label: "Re-check", verb: ["setup", "status"] });
  });

  test("the shell probe fails and there is no marker -> missing: Install still adds rt's entry", async () => {
    const p = fakeProbes({ env: APP_ENV, exec: memberShell(null), dirs: DIRS });
    const r = await pickRow(macRows(p), "tool.path");
    expect(r.status).toBe("missing");
    expect(r.action).toEqual({ type: "run", label: "Set up PATH", verb: ["setup", "apply", "--only", "path.link"] });
  });
});
