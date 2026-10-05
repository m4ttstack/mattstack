import { expect, test } from "bun:test";

import { envSnapshot } from "../probe-cli";
import { decideHook, hookRow } from "../probe-hook";
import { handleMcpMessage } from "../probe-mcp";

const token = "https://x.test/?private_token=glpat-abcdefghijklmnopqrst";
test("recorders omit secret env and redact nested metadata and hook input", () => {
  expect(
    envSnapshot({
      CODEX_THREAD_ID: "T1",
      PATH: "secret",
      OPENAI_API_KEY: "secret",
    })
  ).toEqual({ CODEX_THREAD_ID: "T1" });
  const rows: any[] = [];
  const state = {};
  handleMcpMessage(
    state,
    {
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", clientInfo: { url: token } },
    },
    r => rows.push(r),
    {}
  );
  handleMcpMessage(
    state,
    {
      id: 2,
      method: "tools/call",
      params: {
        name: "probe_whoami",
        arguments: { marker: "w1" },
        _meta: { threadId: "T1", url: token },
      },
    },
    r => rows.push(r),
    { CODEX_THREAD_ID: "T1" }
  );
  expect(JSON.stringify(rows)).not.toContain("glpat-abcdefghijklmnopqrst");
  expect(rows[1].meta.threadId).toBe("T1");
  expect(
    JSON.stringify(
      hookRow("PreToolUse", { tool_input: { command: token } }, {}, {})
    )
  ).not.toContain("glpat-abcdefghijklmnopqrst");
});
test("hook blocks a selected command and one stop, without blocking other tools", () => {
  expect(
    decideHook("PreToolUse", { tool_name: "Bash" }, { block: ["Bash"] })
      .exitCode
  ).toBe(2);
  expect(
    decideHook("PreToolUse", { tool_name: "Read" }, { block: ["Bash"] })
      .exitCode
  ).toBe(0);
  expect(decideHook("Stop", {}, { blockOnce: true })).toMatchObject({
    exitCode: 2,
    consumeOnce: true,
  });
  expect(decideHook("Stop", {}, { blockOnce: false }).exitCode).toBe(0);
});
