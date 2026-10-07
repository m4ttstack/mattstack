import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { boardPeering, readBoardSwitchboardToken } from "../board-token.ts";

const HOME = "/fake-home";
const COMPILED_ENV = `${HOME}/.mattstack/board/.env`;
const TEAMS = `${HOME}/.mattstack/orgs`;

/** One team this machine joined by invite, so only the token sources decide the verdict. */
function joined(files: Record<string, string> = {}, env: Record<string, string> = {}) {
  return fakeProbes({
    home: HOME,
    env,
    dirs: { [TEAMS]: ["acme"] },
    files: {
      [`${TEAMS}/acme/mattstack/org/settings.org.jsonc`]: "{}",
      [`${HOME}/.mattstack/rt/teams/acme.json`]: JSON.stringify({ joinedByRt: true }),
      ...files,
    },
  });
}

const noSecret = async () => null;
const verdict = (p: ReturnType<typeof fakeProbes>, extraRoots: string[] = []) => boardPeering(p, noSecret, true, extraRoots);

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
    expect(await boardPeering(joined(), has, true, [])).toEqual({ kind: "peered" });
  });

  test("a presence check that throws is unreadable, never no token", async () => {
    const has = async () => {
      throw new Error("keychain locked");
    };
    expect(await boardPeering(joined(), has, true, [])).toEqual({ kind: "unreadable", error: "keychain locked" });
  });
});

describe("boardPeering: which Macs it applies to", () => {
  test("a Mac in no team is not applicable", async () => {
    const p = fakeProbes({ home: HOME, dirs: { [TEAMS]: [] } });
    expect(await verdict(p)).toEqual({ kind: "not-applicable" });
  });

  test("a team that tracks no board projects is not applicable", async () => {
    const p = fakeProbes({
      home: HOME,
      dirs: { [TEAMS]: ["acme"] },
      files: { [`${TEAMS}/acme/mattstack/org/settings.org.jsonc`]: "{}" },
    });
    expect(await boardPeering(p, async () => null, false, [])).toEqual({ kind: "not-applicable" });
  });

  test("a board whose legacy config.json tracks projects still applies", async () => {
    const p = fakeProbes({
      home: HOME,
      dirs: { [TEAMS]: ["acme"] },
      files: {
        [`${TEAMS}/acme/mattstack/org/settings.org.jsonc`]: "{}",
        [`${HOME}/.mattstack/board/config.json`]: JSON.stringify({ projects: ["group/app"] }),
      },
    });
    expect(await boardPeering(p, async () => null, false, [])).toEqual({ kind: "unpeered", teams: ["acme"] });
  });

  test("a team created on this Mac applies too", async () => {
    const p = fakeProbes({
      home: HOME,
      dirs: { [TEAMS]: ["acme"] },
      files: {
        [`${TEAMS}/acme/mattstack/org/settings.org.jsonc`]: "{}",
        [`${HOME}/.mattstack/rt/teams/acme.json`]: JSON.stringify({ createdByRt: true, joinedByRt: false }),
      },
    });
    expect(await verdict(p)).toEqual({ kind: "unpeered", teams: ["acme"] });
  });

  test("a joined team with no switchboard declaration still applies", async () => {
    expect(await verdict(joined())).toEqual({ kind: "unpeered", teams: ["acme"] });
  });
});

describe("readBoardSwitchboardToken: the token the board peers with", () => {
  const secret = (value: string | null) => async () => value;

  test("the board's .env wins over rt's secret, as it does for the board itself", async () => {
    const p = joined({ [COMPILED_ENV]: 'export SWITCHBOARD_TOKEN="tok-env"\n' });
    expect(await readBoardSwitchboardToken(p, secret("tok-secret"), [])).toBe("tok-env");
  });

  test("with no .env token it falls back to rt's secret", async () => {
    expect(await readBoardSwitchboardToken(joined(), secret("tok-secret"), [])).toBe("tok-secret");
  });

  test("an empty or commented .env line falls through to the secret", async () => {
    const p = joined({ [COMPILED_ENV]: "SWITCHBOARD_TOKEN=\n# SWITCHBOARD_TOKEN=old\n" });
    expect(await readBoardSwitchboardToken(p, secret(null), [])).toBeNull();
  });
});
