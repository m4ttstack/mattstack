import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";

import { CodexControl } from "../codex-control";

const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.splice(0)) f();
});
function server() {
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  const socketPath = join(dir, "s");
  const seen: any[] = [];
  const srv = Bun.serve({
    unix: socketPath,
    fetch(req, s) {
      return s.upgrade(req) ? undefined : new Response("no");
    },
    websocket: {
      message(ws, raw) {
        const m = JSON.parse(String(raw));
        seen.push(m);
        if (m.method === "initialize") {
          ws.send(JSON.stringify({ id: m.id, result: {} }));
        }
        if (m.method === "initialized") {
          ws.send(
            JSON.stringify({
              id: 0,
              method: "item/tool/requestUserInput",
              params: { threadId: "T1", turnId: "U1", itemId: "I1" },
            })
          );
          ws.send(
            JSON.stringify({
              id: 9,
              method: "item/tool/requestUserInput",
              params: { threadId: "FOREIGN", turnId: "U9", itemId: "I9" },
            })
          );
        }
        if (m.method === "thread/read")
          ws.send(
            JSON.stringify({
              id: m.id,
              error: { code: -32000, message: "read failed" },
            })
          );
      },
    },
  });
  clean.push(() => {
    srv.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });
  return { socketPath, seen };
}
test("buffers early owned requests including zero, drops foreign events and fences responses", async () => {
  const s = server();
  const events: any[] = [];
  const c = await CodexControl.connect({
    socketPath: s.socketPath,
    ownedThreads: new Set(["T1"]),
    experimentalApi: true,
    record: (m: any) => events.push(m),
    timeoutMs: 100,
  });
  clean.push(() => c.close());
  await Bun.sleep(20);
  const r = await c.next(m => m.kind === "request", 100);
  expect(r.id).toBe(0);
  expect(events.every(m => m.params.threadId === "T1")).toBe(true);
  c.respond(r, { answers: {} });
  expect(() =>
    c.respond({ ...r, connection: "other" }, { answers: {} })
  ).toThrow("connection");
  expect(() => c.respond({ ...r, id: 9 }, { answers: {} })).toThrow();
  await expect(
    c.call("thread/resume", { threadId: "FOREIGN" })
  ).rejects.toThrow("owned");
  await expect(
    c.call("thread/read", { threadId: "T1", includeTurns: false })
  ).rejects.toThrow("read failed");
  await expect(c.call("thread/queue/list", { threadId: "T1" })).rejects.toThrow(
    "timed out"
  );
  expect(s.seen.some(m => m.params?.threadId === "FOREIGN")).toBe(false);
  const pending = c.call("thread/queue/list", { threadId: "T1" });
  c.close();
  await expect(pending).rejects.toThrow("closed");
});
