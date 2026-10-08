import { describe, expect, test } from "bun:test";
import { MOD_BLOCKS } from "../../../packages/rt-client/src/agent-integrations.ts";
import { MOD_BLOCKS as PLUGIN_MOD_BLOCKS } from "../../../plugins/mattstack-mods/src/core/blocks.ts";
import { PLUGIN_VERSION } from "../../../plugins/mattstack-mods/src/core/version.ts";
import manifest from "../../../plugins/mattstack-mods/.claude-plugin/plugin.json";

describe("mattstack-mods plugin parity", () => {
  test("the plugin's block list is rt's block list", () => {
    expect([...PLUGIN_MOD_BLOCKS]).toEqual([...MOD_BLOCKS]);
  });

  test("the version the plugin registers with is plugin.json's", () => {
    expect(PLUGIN_VERSION).toBe(manifest.version);
  });
});
