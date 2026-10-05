import { expect, spyOn, test } from "bun:test";
import * as toolsInstallModule from "../../lib/setup/tools-install.ts";
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
