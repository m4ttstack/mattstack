import { describe, expect, test } from "bun:test";
import {
  CODEX_PLUGIN_LIST_TIMEOUT_MS,
  codexHomeFor as boardCodexHomeFor,
  parseCodexPluginList as boardParse,
} from "../../../../apps/board/src/skill-path.ts";
import { PLUGIN_LIST_TIMEOUT_MS } from "../../../skills/installed-plugins.ts";
import { codexHomeFor, parseCodexPluginList } from "../skills.ts";

/** The board copies rt's Codex listing parser and home rule because it reaches rt only through rt-client. */
const HOME = "/codex-home";

const row = (over: Record<string, unknown>) => ({
  name: "acme", marketplaceName: "market", version: "1.2.0", installed: true, ...over,
});

const FIXTURES: Record<string, string> = {
  "installed rows with and without a plugin id": JSON.stringify({
    installed: [row({ pluginId: "acme@market", enabled: true }), row({ name: "beta", version: "0.3.0", enabled: false }), row({ name: "gamma" })],
  }),
  "a row not installed is skipped": JSON.stringify({ installed: [row({ installed: false }), row({ name: "kept" })] }),
  "an empty listing": JSON.stringify({ installed: [] }),
  "a row missing its version": JSON.stringify({ installed: [row({ version: undefined })] }),
  "a row whose name is not a string": JSON.stringify({ installed: [row({ name: 7 })] }),
  "no installed list": JSON.stringify({ available: [] }),
  "not JSON": "codex: something went wrong",
  "null": "null",
};

describe("the board's Codex plugin listing matches rt's", () => {
  for (const [name, stdout] of Object.entries(FIXTURES)) {
    test(name, () => {
      const rt = parseCodexPluginList(stdout, HOME, "default");
      const board = boardParse(stdout, HOME);
      if (!rt.ok) {
        expect(board).toBeNull();
        return;
      }
      expect(board).toEqual(rt.data.map((e) => ({
        id: e.id, installPath: e.installPath, ...(e.enabled !== undefined && { enabled: e.enabled }),
      })));
    });
  }

  test("the listing timeout is the same", () => {
    expect(CODEX_PLUGIN_LIST_TIMEOUT_MS).toBe(PLUGIN_LIST_TIMEOUT_MS);
  });

  for (const codexHome of [undefined, "", "~", "~/.codex", "~/other", "/abs/codex", "/abs/../codex", "relative/codex"]) {
    test(`the Codex home for CODEX_HOME=${JSON.stringify(codexHome)}`, () => {
      const env = { HOME: "/u", ...(codexHome !== undefined && { CODEX_HOME: codexHome }) };
      const rt = codexHomeFor(undefined, env);
      const board = boardCodexHomeFor(env);
      expect(board.ok).toBe(rt.ok);
      if (rt.ok && board.ok) expect(board.data).toBe(rt.data.home);
    });
  }
});
