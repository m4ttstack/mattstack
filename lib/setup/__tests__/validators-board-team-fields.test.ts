import { describe, expect, test } from "bun:test";
import type { Row } from "../contract.ts";
import { BOARD_TEAM_FIELDS_ROW_ID, boardTeamFieldsRow, boardTeamFieldsRowFor } from "../validators/board-team-fields.ts";
import { fakeProbes } from "./fakes.ts";

const HOME = "/Users/t";
const FILE = `${HOME}/.mattstack/board/config.json.imported`;

function probesWith(content: Record<string, unknown> | null) {
  return fakeProbes({ home: HOME, files: content === null ? {} : { [FILE]: JSON.stringify(content) } });
}

const noneSet = () => false;
const steps = (r: Row): string[] => (r.action as { steps: string[] }).steps;

describe("boardTeamFieldsRow", () => {
  test("no old board file: no row", () => {
    expect(boardTeamFieldsRow(probesWith(null), { solo: false, team: "acme", isSet: noneSet, extraRoots: [] })).toBeNull();
  });

  test("an old file with no team fields: no row", () => {
    const p = probesWith({ defaultMember: "matt", staleAfterDays: 3, triage: { enabled: true } });
    expect(boardTeamFieldsRow(p, { solo: false, team: "acme", isSet: noneSet, extraRoots: [] })).toBeNull();
  });

  test("every team field the file holds is already set: no row", () => {
    const p = probesWith({ gitlabHost: "gitlab.example.com", projects: ["a/b"], members: [{ username: "x" }], triage: { doctorSkill: "d" } });
    expect(boardTeamFieldsRow(p, { solo: false, team: "acme", isSet: () => true, extraRoots: [] })).toBeNull();
  });

  test("team fields not in the settings: needs-you, naming only the missing fields", () => {
    const p = probesWith({ gitlabHost: "gitlab.example.com", projects: ["a/b"], tabs: [], triage: { doctorSkill: "d" } });
    const r = boardTeamFieldsRow(p, { solo: false, team: "acme", isSet: (key) => key === "board.projects", extraRoots: [] })!;
    expect(r.id).toBe(BOARD_TEAM_FIELDS_ROW_ID);
    expect(r.status).toBe("needs-you");
    expect(r.required).toBe(false);
    expect(r.detail).toContain("gitlabHost, tabs, triage.doctorSkill");
    expect(r.detail).not.toContain("projects");
  });

  test("a team member's steps ask a team admin and name the keys the board reads", () => {
    const p = probesWith({ gitlabHost: "gitlab.example.com", members: [{ username: "x" }], triage: { doctorSkill: "d" } });
    const r = boardTeamFieldsRow(p, { solo: false, team: "acme", isSet: noneSet, extraRoots: [] })!;
    expect(r.detail).toContain("A team admin sets them");
    expect(steps(r)).toEqual([
      "Ask your team's owner or an org admin to set these for the acme team",
      "rt settings set board.gitlabHost <value> --scope team --team acme",
      "rt settings set board.triage.doctorSkill <value> --scope team --team acme",
      "For the roster (mattstack.roster), invite each person: rt team invite --handle <username> --teams acme",
      "The old values are in ~/.mattstack/board/config.json.imported",
      "Then run: rt setup status",
    ]);
  });

  test("an org member with no team yet gets a team placeholder", () => {
    const r = boardTeamFieldsRow(probesWith({ title: "Ours" }), { solo: false, team: null, isSet: noneSet, extraRoots: [] })!;
    expect(steps(r)).toContain("rt settings set board.title <value> --scope team --team <team>");
    expect(steps(r)[0]).toBe("Ask your team's owner or an org admin to set these for your team");
  });

  test("a solo Mac is told it needs a team first, then the team-scope commands", () => {
    const r = boardTeamFieldsRow(probesWith({ title: "Ours", slack: { appId: "A1" } }), { solo: true, team: null, isSet: noneSet, extraRoots: [] })!;
    expect(r.detail).toContain("this Mac has no team");
    expect(r.detail).not.toContain("team admin");
    expect(steps(r)).toEqual([
      "Only a team's settings hold these, and this Mac has no team yet",
      "Start one: rt team create <name> --remote <url>",
      "rt settings set board.title <value> --scope team",
      "rt settings set board.slack <value> --scope team",
      "The old values are in ~/.mattstack/board/config.json.imported",
      "Then run: rt setup status",
    ]);
  });

  test("BOARD_APP_ROOT's old file is read first", () => {
    const p = fakeProbes({ home: HOME, env: { BOARD_APP_ROOT: "/srv/board" }, files: { "/srv/board/config.json.imported": JSON.stringify({ doctorSkill: "d" }) } });
    const r = boardTeamFieldsRow(p, { solo: false, team: "acme", isSet: noneSet, extraRoots: [] })!;
    expect(steps(r)).toContain("The old values are in /srv/board/config.json.imported");
  });

  test("an unreadable old file: no row", () => {
    const p = fakeProbes({ home: HOME, files: { [FILE]: "{not json" } });
    expect(boardTeamFieldsRow(p, { solo: false, team: "acme", isSet: noneSet, extraRoots: [] })).toBeNull();
  });
});

describe("boardTeamFieldsRowFor", () => {
  test("a throwing settings read reports an error row instead of taking down the group", () => {
    const r = boardTeamFieldsRowFor(probesWith({ title: "Ours" }), {
      solo: false,
      teamFor: () => "acme",
      isSet: () => {
        throw new Error("bad store");
      },
      extraRoots: [],
    })!;
    expect(r.status).toBe("error");
    expect(r.required).toBe(false);
    expect(r.detail).toContain("bad store");
  });
});
