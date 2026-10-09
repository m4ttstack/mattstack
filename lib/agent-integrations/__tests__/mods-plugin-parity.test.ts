import { describe, expect, test } from "bun:test";
import { MOD_BLOCKS } from "../../../packages/rt-client/src/agent-integrations.ts";
import { MOD_BLOCKS as PLUGIN_MOD_BLOCKS } from "../../../plugins/mattstack-mods/src/core/blocks.ts";
import { CLAUDE_ONLY_TAIL, REPLY_RULE_SECTION, trimClaudeOnlyReply } from "../../../plugins/mattstack-mods/src/blocks/sections.ts";
import { PLUGIN_VERSION } from "../../../plugins/mattstack-mods/src/core/version.ts";
import manifest from "../../../plugins/mattstack-mods/.claude-plugin/plugin.json";
import { MATTSTACK_TOOL_PREFIX, RUN_TOOL } from "../../../plugins/mattstack-mods/src/blocks/tool-names.ts";
import mattstackManifest from "../../../plugins/mattstack/.claude-plugin/plugin.json";
import mattstackMcp from "../../../plugins/mattstack/.mcp.json";
import { runToolDefs } from "../../mcp/run-tools.ts";
import { renderWelcome } from "../../daemon/handlers/chat.ts";
import { replySteer, wrapCrossSession, type HintSender } from "../../daemon/inbox.ts";

describe("mattstack-mods plugin parity", () => {
  test("the plugin's block list is rt's block list", () => {
    expect([...PLUGIN_MOD_BLOCKS]).toEqual([...MOD_BLOCKS]);
  });

  test("the version the plugin registers with is plugin.json's", () => {
    expect(PLUGIN_VERSION).toBe(manifest.version);
  });

  test("the reply rule section is the rule rt's sign-in frame states", () => {
    expect(renderWelcome("max", ["general"], []).split("\n")).toContain(REPLY_RULE_SECTION);
  });

  test("the policy block's run-tool matcher names the mattstack plugin's own MCP server and its run tools", () => {
    expect(Object.keys(mattstackMcp.mcpServers)).toEqual(["mattstack"]);
    expect(MATTSTACK_TOOL_PREFIX).toBe(`mcp__plugin_${mattstackManifest.name}_${Object.keys(mattstackMcp.mcpServers)[0]}__`);
    const guarded = runToolDefs().map((t) => t.name).filter((name) => RUN_TOOL.test(`${MATTSTACK_TOOL_PREFIX}${name}`));
    expect(guarded.sort()).toEqual(["run_decision", "run_field_set", "run_stage", "run_status"]);
  });

  test("trim removes exactly replySteer's tail from a real inbox envelope", () => {
    const shapes: HintSender[][] = [
      [{ handle: "remy.k3f9", name: "remy" }],
      [{ handle: "kai", name: "kai", room: "dm-1a2b", passedOn: true }],
      [{ handle: "remy.k3f9", name: "remy" }, { handle: "kai.cd34", name: "kai" }],
    ];
    for (const senders of shapes) {
      const steer = replySteer(senders);
      expect(steer.split(` ${CLAUDE_ONLY_TAIL}`)).toHaveLength(2);
      const body = `[#general] remy #530: ship it\n${steer}`;
      const sent = wrapCrossSession("remy (#general)", body, "d-530-max");
      const trimmed = wrapCrossSession("remy (#general)", trimClaudeOnlyReply(body), "d-530-max");
      expect(trimmed).toBe(sent.replace(` ${CLAUDE_ONLY_TAIL}`, ""));
      expect(trimmed).toContain(steer.replace(` ${CLAUDE_ONLY_TAIL}`, ""));
    }
  });
});
