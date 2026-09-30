import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { boardEnvHasSwitchboardToken } from "../board-token.ts";

const HOME = "/fake-home";
const COMPILED_ENV = `${HOME}/.mattstack/board/.env`;

describe("boardEnvHasSwitchboardToken", () => {
  test("the compiled board's .env under ~/.mattstack/board carrying a token counts", () => {
    const p = fakeProbes({ home: HOME, files: { [COMPILED_ENV]: "SLACK_TOKEN=x\nSWITCHBOARD_TOKEN=tok-1\n" } });
    expect(boardEnvHasSwitchboardToken(p, [])).toBe(true);
  });

  test("quoted and exported values count", () => {
    expect(boardEnvHasSwitchboardToken(fakeProbes({ home: HOME, files: { [COMPILED_ENV]: 'export SWITCHBOARD_TOKEN="tok-1"\n' } }), [])).toBe(true);
  });

  test("an empty value, a commented line or another key does not count", () => {
    const body = "SWITCHBOARD_TOKEN=\nOTHER=x\n# SWITCHBOARD_TOKEN=old\nSWITCHBOARD_TOKEN_OLD=x\n";
    expect(boardEnvHasSwitchboardToken(fakeProbes({ home: HOME, files: { [COMPILED_ENV]: body } }), [])).toBe(false);
  });

  test("BOARD_APP_ROOT names the board's root when set, as it does for the board itself", () => {
    const p = fakeProbes({ home: HOME, env: { BOARD_APP_ROOT: "/srv/board/" }, files: { "/srv/board/.env": "SWITCHBOARD_TOKEN=tok-1\n" } });
    expect(boardEnvHasSwitchboardToken(p, [])).toBe(true);
  });

  test("an extra root (a board served from a source checkout) is checked too", () => {
    const p = fakeProbes({ home: HOME, files: { "/src/apps/board/.env": "SWITCHBOARD_TOKEN=tok-1\n" } });
    expect(boardEnvHasSwitchboardToken(p, ["/src/apps/board"])).toBe(true);
  });

  test("no .env anywhere is no token", () => {
    expect(boardEnvHasSwitchboardToken(fakeProbes({ home: HOME }), [])).toBe(false);
  });
});
