import { describe, expect, test } from "bun:test";
import { MOD_BLOCKS } from "../../../packages/rt-client/src/agent-integrations.ts";
import { MOD_BLOCKS as PLUGIN_MOD_BLOCKS } from "../../../plugins/mattstack-mods/src/core/blocks.ts";

describe("mattstack-mods plugin parity", () => {
  test("the plugin's block list is rt's block list", () => {
    expect([...PLUGIN_MOD_BLOCKS]).toEqual([...MOD_BLOCKS]);
  });
});
