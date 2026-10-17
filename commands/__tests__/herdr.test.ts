import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "path";
import { herdrStart } from "../herdr.ts";
import { UserActionableError } from "../../lib/errors.ts";
import type { HerdrStartResult } from "../../lib/herdr/start.ts";
import { dispatch } from "../../lib/command-tree.ts";
import { TREE } from "../../lib/command-tree-def.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

const fake = (result: HerdrStartResult) => ({ start: async () => result });

let io: ReturnType<typeof captureOut>;

beforeEach(() => {
  io = captureOut();
  ui.__test__.setHuman(() => false);
});

afterEach(() => {
  io.restore();
  process.exitCode = 0;
});

describe("rt herdr start", () => {
  test("a running server prints that it is running", async () => {
    await herdrStart([], {}, fake({ state: "running", bin: "/opt/acme/herdr" }));
    expect(io.stdout()).toContain("herdr is running");
    expect(process.exitCode ?? 0).toBe(0);
  });

  test("a fresh start prints that it started", async () => {
    await herdrStart([], {}, fake({ state: "started", bin: "/opt/acme/herdr" }));
    expect(io.stdout()).toContain("Started herdr");
  });

  test("not installed throws a failure pointing at Setup", async () => {
    const err = await herdrStart([], {}, fake({ state: "not-installed", bin: "/opt/acme/herdr" })).catch((e) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect((err as UserActionableError).message).toBe("herdr isn't installed");
    expect((err as UserActionableError).next).toBe("Open mattstack Setup");
  });

  test("a failed start throws its detail", async () => {
    const err = await herdrStart([], {}, fake({ state: "failed", bin: "/opt/acme/herdr", detail: "herdr did not answer" })).catch((e) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect((err as UserActionableError).message).toBe("herdr did not answer");
  });

  test("--json prints the envelope with the result and exits 0 when running", async () => {
    await herdrStart(["--json"], {}, fake({ state: "running", bin: "/opt/acme/herdr" }));
    const env = JSON.parse(io.stdout());
    expect(Object.keys(env).sort()).toEqual(["at", "bin", "contract", "state"]);
    expect(env).toMatchObject({ contract: 1, state: "running", bin: "/opt/acme/herdr" });
    expect(typeof env.at).toBe("string");
    expect(io.stderr()).toBe("");
    expect(process.exitCode ?? 0).toBe(0);
  });

  test("--json on a failure prints the envelope with its detail and sets exit 2", async () => {
    await herdrStart(["--json"], {}, fake({ state: "failed", bin: "/opt/acme/herdr", detail: "herdr did not answer" }));
    expect(JSON.parse(io.stdout())).toMatchObject({ contract: 1, state: "failed", detail: "herdr did not answer" });
    expect(process.exitCode).toBe(2);
  });

  test("--json when not installed sets exit 2", async () => {
    await herdrStart(["--json"], {}, fake({ state: "not-installed", bin: "/opt/acme/herdr" }));
    expect(JSON.parse(io.stdout())).toMatchObject({ state: "not-installed" });
    expect(process.exitCode).toBe(2);
  });
});

describe("rt herdr start through dispatch", () => {
  const saved = { bin: process.env.HERDR_BIN, sock: process.env.HERDR_SOCKET_PATH };

  test("the verb receives the context second and its starter third", async () => {
    // A starter that slipped past the mock would find no binary and no socket.
    process.env.HERDR_BIN = "/nonexistent/acme/herdr";
    process.env.HERDR_SOCKET_PATH = "/nonexistent/acme/herdr.sock";
    const real = { ...(await import("../../lib/herdr/start.ts")) };
    mock.module("../../lib/herdr/start.ts", () => ({
      ...real,
      startHerdr: async (): Promise<HerdrStartResult> => ({ state: "started", bin: "/opt/acme/herdr" }),
    }));
    try {
      await dispatch(TREE, ["herdr", "start", "--json"], ["rt"], join(import.meta.dir, "..", ".."));
    } finally {
      mock.module("../../lib/herdr/start.ts", () => real);
      if (saved.bin === undefined) delete process.env.HERDR_BIN; else process.env.HERDR_BIN = saved.bin;
      if (saved.sock === undefined) delete process.env.HERDR_SOCKET_PATH; else process.env.HERDR_SOCKET_PATH = saved.sock;
    }
    const line = io.stdout().split("\n").find((l) => l.startsWith("{"));
    expect(JSON.parse(line!)).toMatchObject({ contract: 1, state: "started", bin: "/opt/acme/herdr" });
  });
});
