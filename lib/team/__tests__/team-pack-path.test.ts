import { describe, expect, test } from "bun:test";
import { UserActionableError } from "../../errors.ts";
import {
  TEAM_PACK_FOLDER,
  isUnconvertedTeamPack,
  nestedTeamPackRel,
  remedySentence,
  teamPackRel,
  teamPackSource,
  unconvertedTeamPackError,
} from "../team-pack-path.ts";

const fsOf = (present: string[]) => ({ exists: (path: string) => present.includes(path) });
const FOLDER = "/h/.mattstack/orgs/acme/mattstack/teams/widgets";

describe("the team pack path", () => {
  test("the pack folder is plugin, and the clone-relative strings follow it", () => {
    expect(TEAM_PACK_FOLDER).toBe("plugin");
    expect(teamPackRel("widgets")).toBe("mattstack/teams/widgets/plugin");
    expect(teamPackSource("widgets")).toBe("./mattstack/teams/widgets/plugin");
    expect(nestedTeamPackRel("widgets")).toBe("mattstack/teams/widgets/packs/widgets");
  });
});

describe("isUnconvertedTeamPack", () => {
  test("true only when the nested manifest is there and the plugin manifest is not", () => {
    expect(isUnconvertedTeamPack(fsOf([`${FOLDER}/packs/widgets/pack/skills.jsonc`]), FOLDER, "widgets")).toBe(true);
  });
  test("false for a converted folder, a half-moved folder, and a settings-only team", () => {
    expect(isUnconvertedTeamPack(fsOf([`${FOLDER}/plugin/pack/skills.jsonc`]), FOLDER, "widgets")).toBe(false);
    expect(isUnconvertedTeamPack(fsOf([`${FOLDER}/plugin/pack/skills.jsonc`, `${FOLDER}/packs/widgets/pack/skills.jsonc`]), FOLDER, "widgets")).toBe(false);
    expect(isUnconvertedTeamPack(fsOf([]), FOLDER, "widgets")).toBe(false);
  });
});

describe("unconvertedTeamPackError", () => {
  test("names the nested path, the new path, the script and rt setup update", () => {
    const err = unconvertedTeamPackError("/h/.mattstack/orgs/acme", "widgets");
    expect(err).toBeInstanceOf(UserActionableError);
    expect(err.code).toBe("team-pack-unconverted");
    expect(err.message).toBe("Your org repo still keeps the widgets pack at mattstack/teams/widgets/packs/widgets");
    expect(err.why).toBe("rt reads a team's pack from mattstack/teams/widgets/plugin now");
    expect(err.next).toBe("bun scripts/move-team-packs-to-plugin.ts /h/.mattstack/orgs/acme --admin <username> --write");
    expect(err.thenRun).toBe("rt setup update");
  });
  test("remedySentence joins the message and both commands into one sentence", () => {
    const err = unconvertedTeamPackError("/h/.mattstack/orgs/acme", "widgets");
    expect(remedySentence(err)).toBe(
      "Your org repo still keeps the widgets pack at mattstack/teams/widgets/packs/widgets. Run bun scripts/move-team-packs-to-plugin.ts /h/.mattstack/orgs/acme --admin <username> --write, then rt setup update",
    );
    expect(remedySentence(new UserActionableError("x", "Plain"))).toBe("Plain");
    expect(remedySentence(new UserActionableError("x", "One", {}, { next: "rt a" }))).toBe("One. Run rt a");
  });
});
