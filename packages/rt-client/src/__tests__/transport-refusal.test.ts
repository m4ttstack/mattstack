import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Server } from "bun";
import { rtCommand } from "../transport.ts";

let server: Server<any> | undefined;
let dir: string | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function serve(respond: () => Response): string {
  dir = mkdtempSync(join(tmpdir(), "rtc-"));
  const sock = join(dir, "d.sock");
  server = Bun.serve({ unix: sock, fetch: respond } as any);
  return sock;
}

describe("rtCommand: non-envelope replies", () => {
  test("a 413 with a null body becomes an ok:false error naming the size and the gate limit", async () => {
    const sockPath = serve(() => new Response("null", { status: 413 }));
    const res = await rtCommand("gate:ask", { context: "x".repeat(2 * 1024 * 1024) }, { sockPath });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/gate:ask refused: request too large \(2\.0 MB sent.*16 MiB/);
  });

  test("a 413 with the daemon's envelope keeps the daemon's message", async () => {
    const sockPath = serve(() => Response.json({ ok: false, error: "over the 16 MiB limit" }, { status: 413 }));
    const res = await rtCommand("gate:ask", {}, { sockPath });
    expect(res).toEqual({ ok: false, error: "over the 16 MiB limit" });
  });

  test("an empty 500 becomes an ok:false error with the status", async () => {
    const sockPath = serve(() => new Response("", { status: 500 }));
    const res = await rtCommand("gate:ask", {}, { sockPath });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("HTTP 500");
  });

  test("a 2xx reply with raw JSON and no ok field passes through unchanged", async () => {
    const sockPath = serve(() => Response.json({ rows: [1, 2] }));
    const res = await rtCommand("gate:list", {}, { sockPath });
    expect(res as unknown).toEqual({ rows: [1, 2] });
  });

  test("a non-gate 413 carries no gate hint", async () => {
    const sockPath = serve(() => new Response("null", { status: 413 }));
    const res = await rtCommand("cache:refresh", { x: 1 }, { sockPath });
    expect(res.error).not.toContain("16 MiB");
  });
});
