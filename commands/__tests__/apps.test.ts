import * as ui from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { appsListBlocks, appsDisable, appsEnable, appsList, type AppsDeps } from "../apps.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";

let io: CapturedOut;
beforeEach(() => {
  io = captureOut();
  ui.__test__.setHuman(() => false);
});
afterEach(() => io.restore());

const ROWS = [
  { name: "board", managedBy: "rt", displayName: "Board", description: "Open MRs ready for review.", enabled: false, requiresTeam: true },
  { name: "chat", managedBy: "rt", displayName: "Chat", enabled: true, requiresTeam: false },
  { name: "mine", managedBy: "user", displayName: "mine", enabled: true, requiresTeam: false },
];

function deps(overrides: { patchStatus?: number; running?: boolean; listBody?: string } = {}): AppsDeps & { out: string[]; patches: string[] } {
  const home = "/fake-home";
  const running = overrides.running ?? true;
  const out: string[] = [];
  const patches: string[] = [];
  const p = fakeProbes({
    home,
    files: running ? { [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) } : {},
    fetch: async (url, init) => {
      if (url.endsWith("/healthz")) return { status: 200, body: "ok", headers: {} };
      if (url.endsWith("/api/v1/apps")) return { status: 200, body: overrides.listBody ?? JSON.stringify({ apps: ROWS }), headers: {} };
      if (init?.method === "PATCH") {
        patches.push(`${url} ${init.body} ${init.headers?.["x-local-caller"]}`);
        return { status: overrides.patchStatus ?? 200, body: "{}", headers: {} };
      }
      return { status: 404, body: "", headers: {} };
    },
  });
  return { probes: p, print: (s) => out.push(s), exit: (c) => { throw new Error(`exit ${c}`); }, out, patches };
}

describe("rt apps", () => {
  test("list --json prints only rt-managed rows", async () => {
    const d = deps();
    await appsList(["--json"], {}, d);
    expect(JSON.parse(d.out[0]!).apps).toEqual([
      { name: "board", displayName: "Board", description: "Open MRs ready for review.", enabled: false, requiresTeam: true },
      { name: "chat", displayName: "Chat", enabled: true, requiresTeam: false },
    ]);
  });

  test("enable and disable PATCH deck as the registrar", async () => {
    const d = deps();
    await appsEnable(["board", "--json"], {}, d);
    await appsDisable(["chat", "--json"], {}, d);
    expect(d.patches).toEqual([
      'http://127.0.0.1:4100/api/v1/apps/board {"enabled":true} rt',
      'http://127.0.0.1:4100/api/v1/apps/chat {"enabled":false} rt',
    ]);
    expect(JSON.parse(d.out[0]!)).toMatchObject({ name: "board", enabled: true });
  });

  test("deck not running -> deck-not-running, exit 2", async () => {
    const d = deps({ running: false });
    await expect(appsList(["--json"], {}, d)).rejects.toThrow(/exit 2/);
    expect(JSON.parse(d.out[0]!).error.code).toBe("deck-not-running");
  });

  test("a 404 from deck -> unknown-app; a 409 -> not-managed", async () => {
    const d404 = deps({ patchStatus: 404 });
    await expect(appsEnable(["nope", "--json"], {}, d404)).rejects.toThrow(/exit 2/);
    expect(JSON.parse(d404.out[0]!).error.code).toBe("unknown-app");
    const d409 = deps({ patchStatus: 409 });
    await expect(appsEnable(["mine", "--json"], {}, d409)).rejects.toThrow(/exit 2/);
    expect(JSON.parse(d409.out[0]!).error).toMatchObject({
      code: "not-managed",
      message: "mine is not one of the apps mattstack ships",
    });
  });

  test("the PATCH URL encodes the app name", async () => {
    const d = deps();
    await appsEnable(["a b/c", "--json"], {}, d);
    expect(d.patches[0]).toStartWith("http://127.0.0.1:4100/api/v1/apps/a%20b%2Fc ");
  });

  test("an unreadable list body -> deck-error, exit 2", async () => {
    for (const listBody of ["nope", JSON.stringify({ apps: "nope" })]) {
      const d = deps({ listBody });
      await expect(appsList(["--json"], {}, d)).rejects.toThrow(/exit 2/);
      expect(d.out).toHaveLength(1);
      expect(JSON.parse(d.out[0]!).error).toMatchObject({ code: "deck-error", message: "deck gave an answer rt could not read" });
    }
  });

  test("text list with no rt-managed rows says so in one line", async () => {
    const d = deps({ listBody: JSON.stringify({ apps: [ROWS[2]] }) });
    await appsList([], {}, d);
    expect(io.stdout()).toBe(renderPlain(appsListBlocks([])));
    expect(io.stdout()).toBe("[skipped] No mattstack apps are registered\n");
  });

  describe("enable with no name", () => {
    const setTTY = (value: boolean | undefined) => Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
    let savedTTY: boolean | undefined;
    let savedBatch: string | undefined;
    beforeEach(() => {
      savedTTY = process.stdin.isTTY;
      savedBatch = process.env.RT_BATCH;
      delete process.env.RT_BATCH;
    });
    afterEach(() => {
      setTTY(savedTTY);
      if (savedBatch === undefined) delete process.env.RT_BATCH;
      else process.env.RT_BATCH = savedBatch;
    });

    test("--json prints one usage line and exits 2, even on a TTY", async () => {
      setTTY(true);
      const d = deps();
      await expect(appsEnable(["--json"], {}, d)).rejects.toThrow(/exit 2/);
      expect(d.out).toHaveLength(1);
      expect(JSON.parse(d.out[0]!).error.code).toBe("usage");
    });

    test("text on a TTY lists the apps before the usage line", async () => {
      setTTY(true);
      const d = deps();
      await expect(appsEnable([], {}, d)).rejects.toThrow(/exit 2/);
      expect(io.stdout()).toContain("Board");
      expect(io.stderr()).toBe("Which app?\n  next: rt apps enable <name>\n");
      expect(d.out).toEqual([]);
    });

    test("text without a TTY prints only the usage line", async () => {
      setTTY(false);
      const noTty = deps();
      await expect(appsEnable([], {}, noTty)).rejects.toThrow(/exit 2/);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("Which app?\n  next: rt apps enable <name>\n");
    });

    test("text under RT_BATCH prints only the usage line", async () => {
      setTTY(true);
      process.env.RT_BATCH = "1";
      const batch = deps();
      await expect(appsEnable([], {}, batch)).rejects.toThrow(/exit 2/);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("Which app?\n  next: rt apps enable <name>\n");
    });
  });
});

test("apps list shows on, off and needs a team", () => {
  const blocks = appsListBlocks([
    { name: "board", displayName: "Board", enabled: true, requiresTeam: true },
    { name: "chat", displayName: "Chat", enabled: false, requiresTeam: false },
  ]);
  expect(renderPlain(blocks)).toMatch(/^on +board +Board +needs a team\noff +chat +Chat *\n$/);
});

test("an unmanaged app is a refusal on stderr", async () => {
  const d = deps({ patchStatus: 409 });
  await expect(appsEnable(["deck"], {}, d)).rejects.toThrow("exit 2");
  expect(io.stdout()).toBe("");
  expect(d.out).toEqual([]);
  expect(io.stderr()).toBe("[refused] rt leaves deck alone  it is not one of the apps mattstack ships\n");
});
