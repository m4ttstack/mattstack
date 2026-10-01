import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { boardPeering } from "../board-token.ts";

const HOME = "/fake-home";
const COMPILED_ENV = `${HOME}/.mattstack/board/.env`;
const TEAMS = `${HOME}/.mattstack/teams`;

/** One team this machine joined by invite, declaring an https switchboard, so only the token sources decide the verdict. */
function joined(files: Record<string, string> = {}, env: Record<string, string> = {}) {
  return fakeProbes({
    home: HOME,
    env,
    dirs: { [TEAMS]: ["acme"] },
    files: {
      [`${TEAMS}/acme/mattstack/settings.team.jsonc`]: JSON.stringify({ "mattstack.integrations": { switchboard: { url: "https://sb.test" } } }),
      [`${HOME}/.mattstack/rt/teams/acme.json`]: JSON.stringify({ joinedByRt: true }),
      ...files,
    },
  });
}

const noSecret = async () => null;
const verdict = (p: ReturnType<typeof fakeProbes>, extraRoots: string[] = []) => boardPeering(p, noSecret, extraRoots);

describe("boardPeering: the board's .env", () => {
  test("the compiled board's .env under ~/.mattstack/board carrying a token counts", async () => {
    expect(await verdict(joined({ [COMPILED_ENV]: "SLACK_TOKEN=x\nSWITCHBOARD_TOKEN=tok-1\n" }))).toEqual({ kind: "peered" });
  });

  test("quoted and exported values count", async () => {
    expect(await verdict(joined({ [COMPILED_ENV]: 'export SWITCHBOARD_TOKEN="tok-1"\n' }))).toEqual({ kind: "peered" });
  });

  test("an empty value, a commented line or another key does not count", async () => {
    const body = "SWITCHBOARD_TOKEN=\nOTHER=x\n# SWITCHBOARD_TOKEN=old\nSWITCHBOARD_TOKEN_OLD=x\n";
    expect(await verdict(joined({ [COMPILED_ENV]: body }))).toEqual({ kind: "unpeered", teams: ["acme"] });
  });

  test("BOARD_APP_ROOT names the board's root when set, as it does for the board itself", async () => {
    expect(await verdict(joined({ "/srv/board/.env": "SWITCHBOARD_TOKEN=tok-1\n" }, { BOARD_APP_ROOT: "/srv/board/" }))).toEqual({ kind: "peered" });
  });

  test("an extra root (a board served from a source checkout) is checked too", async () => {
    expect(await verdict(joined({ "/src/apps/board/.env": "SWITCHBOARD_TOKEN=tok-1\n" }), ["/src/apps/board"])).toEqual({ kind: "peered" });
  });
});

describe("boardPeering: rt's secret", () => {
  test("a stored switchboardToken counts when no .env has one", async () => {
    const has = async (domain: string, key: string) => (domain === "rt" && key === "switchboardToken" ? "tok-1" : null);
    expect(await boardPeering(joined(), has, [])).toEqual({ kind: "peered" });
  });

  test("a presence check that throws is unreadable, never no token", async () => {
    const has = async () => {
      throw new Error("keychain locked");
    };
    expect(await boardPeering(joined(), has, [])).toEqual({ kind: "unreadable", error: "keychain locked" });
  });
});
