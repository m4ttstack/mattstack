import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { DAEMON_ROUTES } from "../../../../packages/rt-client/src/daemon-api/routes.ts";
import type { OpenResult, SealResult } from "../../../../packages/rt-client/src/sealed-text.ts";
import type { SealedText } from "../../../team/sealed-text.ts";
import { createSealedTextHandlers } from "../sealed-text.ts";

const BINDING = { type: "review-request", from: "dev1", subject: "https://forge.example/mr/7 e-1" };
const SEAL = { to: ["ada", "bob"], binding: BINDING, fields: { note: "hello" } };
const OPEN = { sealed: "YWdl", binding: BINDING };

function harness() {
  const calls: unknown[] = [];
  const sealed: SealResult = { ok: true, sealed: "YWdl", unreachable: ["bob"] };
  const opened: OpenResult = { ok: false, reason: "mismatch" };
  const sealedText: SealedText = {
    seal: async (...a) => {
      calls.push(["seal", ...a]);
      return sealed;
    },
    open: async (...a) => {
      calls.push(["open", ...a]);
      return opened;
    },
    holdsKeyOf: async () => true,
    reachable: () => [],
  };
  return { calls, sealed, opened, handlers: createSealedTextHandlers({ sealedText }) };
}

describe("text:seal and text:open", () => {
  test("pass through, refusals included", async () => {
    const h = harness();
    expect(await h.handlers["text:seal"](SEAL)).toEqual({ ok: true, data: h.sealed });
    expect(await h.handlers["text:open"](OPEN)).toEqual({ ok: true, data: h.opened });
    expect(h.calls).toEqual([
      ["seal", SEAL.to, BINDING, SEAL.fields],
      ["open", OPEN.sealed, BINDING],
    ]);
  });

  test("a malformed seal is refused", async () => {
    const h = harness();
    const { from: _from, ...noFrom } = BINDING;
    const bad: unknown[] = [
      null,
      { ...SEAL, to: "ada" },
      { ...SEAL, to: ["ada", 7] },
      { ...SEAL, to: Array.from({ length: 201 }, (_, i) => `dev${i}`) },
      { ...SEAL, binding: noFrom },
      { ...SEAL, binding: { ...BINDING, subject: 7 } },
      { ...SEAL, fields: undefined },
      { ...SEAL, fields: [] },
      { ...SEAL, fields: { note: 7 } },
      { ...SEAL, fields: { note: "x".repeat(16 * 1024 + 1) } },
      { ...SEAL, fields: { note: "é".repeat(8 * 1024 + 1) } },
    ];
    for (const payload of bad) {
      expect(await h.handlers["text:seal"](payload)).toMatchObject({ ok: false, failure: { code: "text-invalid" } });
    }
    expect(h.calls).toEqual([]);
  });

  test("a malformed open is refused", async () => {
    const h = harness();
    for (const payload of [null, { ...OPEN, sealed: 7 }, { ...OPEN, sealed: "a".repeat(256 * 1024 + 1) }, { sealed: "YWdl" }]) {
      expect(await h.handlers["text:open"](payload)).toMatchObject({ ok: false, failure: { code: "text-invalid" } });
    }
    expect(h.calls).toEqual([]);
  });

  test("the limits themselves are allowed", async () => {
    const h = harness();
    const at = { ...SEAL, to: Array.from({ length: 200 }, (_, i) => `dev${i}`), fields: { note: "x".repeat(16 * 1024) } };
    expect((await h.handlers["text:seal"](at)).ok).toBe(true);
    expect((await h.handlers["text:open"]({ ...OPEN, sealed: "a".repeat(256 * 1024) })).ok).toBe(true);
  });
});

describe("who can ask", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "__tests__" || name === "node_modules") return [];
      return statSync(path).isDirectory() ? sources(path) : /\.(ts|mts)$/.test(name) ? [path] : [];
    });
  }

  test("no command tree verb, MCP tool or HTTP route names text:seal or text:open", () => {
    const root = join(import.meta.dir, "..", "..", "..", "..");
    const files = [...sources(join(root, "commands")), ...sources(join(root, "lib", "mcp")), join(root, "lib", "command-tree-def.ts"), join(root, "lib", "module-registry.ts")];
    expect(files.filter((f) => /text:(seal|open)\b|text(Seal|Open)\b/.test(readFileSync(f, "utf8")))).toEqual([]);
    expect(JSON.stringify(DAEMON_ROUTES)).not.toMatch(/text:(seal|open)/);
  });
});
