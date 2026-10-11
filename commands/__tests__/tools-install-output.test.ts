import { expect, spyOn, test } from "bun:test";
import * as toolsInstallModule from "../../lib/setup/tools-install.ts";
import * as selectionModule from "../../lib/setup/integration-selection.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { toolsInstall } from "../tools.ts";

for (const reason of ["user-copy", "dev-mode-owns-rt", "occupied", "no-bundle"] as const) {
  test(`bundled ${reason} preserves the envelope and exit code`, async () => {
    const detail = "a copy you installed is in the way";
    const install = spyOn(toolsInstallModule, "installTool").mockResolvedValue({ via: "bundled-link", ok: false, detail, reason });
    const exit = spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit ${c}`); }) as typeof process.exit);
    const io = captureOut();
    out.__test__.setHuman(() => false);
    try {
      for (const json of [false, true]) {
        io.clear();
        io.reset();
        out.__test__.setHuman(() => false);
        await expect(toolsInstall(["fast-browser", ...(json ? ["--json"] : [])], {}, fakeProbes({ home: "/home/x" }))).rejects.toThrow("exit 1");
        if (json) {
          const env = JSON.parse(io.stdout());
          expect(Object.keys(env)).toEqual(["contract", "at", "via", "ok", "detail"]);
          expect(env).toMatchObject({ via: "bundled-link", ok: false, detail });
        } else expect(io.stdout()).toBe("");
        if (reason === "no-bundle") {
          expect(io.stderr()).toBe(json ? `${detail}\n` : `fast-browser was not installed\n  why: ${detail}\n`);
        } else {
          expect(io.stderr()).toContain("[refused] rt left your fast-browser alone  a copy you installed is in the way");
          expect(io.stderr()).not.toContain("[failed]");
        }
      }
    } finally {
      exit.mockRestore();
      install.mockRestore();
      io.restore();
    }
  });
}

test("rt tools install codex reaches the release install and reports via vendor", async () => {
  const { RELEASE_BINARIES } = toolsInstallModule;
  const dest = "/home/x/.local/bin/codex";
  const p = fakeProbes({
    home: "/home/x",
    env: { TMPDIR: "/tmp/t" },
    exec: (argv) => {
      if (argv[0] === "uname") return { code: 0, stdout: "arm64\n", stderr: "" };
      if (argv[0] === "shasum") return { code: 0, stdout: `${argv.at(-1)!.endsWith(".tar.gz") ? RELEASE_BINARIES.codex!.sha256 : "b".repeat(64)}  x\n`, stderr: "" };
      if (["curl", "tar", "install", dest].includes(argv[0]!)) return { code: 0, stdout: "", stderr: "" };
      return { code: 127, stdout: "", stderr: `ENOENT: ${argv[0]}` };
    },
  });
  const selection = spyOn(selectionModule, "readIntegrationSelection").mockReturnValue({ switchOn: true, enabled: ["codex"] });
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    await toolsInstall(["codex", "--json"], {}, p);
    expect(JSON.parse(io.stdout())).toMatchObject({ via: "vendor", ok: true, detail: `Installed Codex 0.160.0 at ${dest}` });
    expect(p.calls.exec.some((argv) => argv[0] === "brew")).toBe(false);
  } finally {
    io.restore();
    selection.mockRestore();
  }
});

test("with the integrations switch off, rt tools install codex fails as it did before", async () => {
  const p = fakeProbes({ home: "/home/x", exec: (argv) => ({ code: 127, stdout: "", stderr: `ENOENT: ${argv[0]}` }) });
  const selection = spyOn(selectionModule, "readIntegrationSelection").mockReturnValue({ switchOn: false });
  const exit = spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit ${c}`); }) as typeof process.exit);
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    await expect(toolsInstall(["codex", "--json"], {}, p)).rejects.toThrow("exit 2");
    expect(io.stdout()).toContain("no install method known for codex");
    expect(p.calls.exec.map((argv) => argv[0])).toEqual(["brew"]);
  } finally {
    io.restore();
    exit.mockRestore();
    selection.mockRestore();
  }
});
