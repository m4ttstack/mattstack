import { describe, expect, test } from "bun:test";
import { join } from "path";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { approvalState } from "../approval.ts";
import { teamLocalPath } from "../team-local.ts";
import { orgDirUnder } from "../../rt-paths.ts";
import { renderSopsYamlRules } from "../../home/age-key.ts";
import { ADMIN_PATH_REGEX, TEAM_PATH_REGEX } from "../../secrets/team-store.ts";

const HOME = "/fake-home";
const SLUG = "acme";
const MINE = "age1mine0000000000000000000000000000000000000000000000000000000";
const OWNER = "age1owner000000000000000000000000000000000000000000000000000000";
const JOINED_AT = "2026-10-29T09:00:00.000Z";
const RECORD = teamLocalPath(HOME, SLUG);
const SOPS = join(orgDirUnder(HOME, SLUG), ".sops.yaml");
const PERSONAL_SOPS = join(HOME, ".mattstack", "user", ".sops.yaml");

function record(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ createdByRt: false, joinedByRt: true, rtMayManageMembership: false, joinedAt: JOINED_AT, ...extra });
}

function teamSops(members: string[], admins: string[] = [OWNER]): string {
  return renderSopsYamlRules([{ pathRegex: TEAM_PATH_REGEX, recipients: members }, { pathRegex: ADMIN_PATH_REGEX, recipients: admins }]);
}

function joined(files: Record<string, string>) {
  return fakeProbes({ home: HOME, files: { [RECORD]: record(), [PERSONAL_SOPS]: `creation_rules:\n  - path_regex: secrets/.*\n    age: ${MINE}\n`, ...files } });
}

describe("approvalState", () => {
  test("a Mac that did not join by invite has nothing to wait on", () => {
    const p = fakeProbes({ home: HOME, files: { [SOPS]: teamSops([OWNER]), [PERSONAL_SOPS]: `age: ${MINE}\n` } });
    expect(approvalState(p, SLUG)).toEqual({ kind: "not-joined" });
  });

  test("joined, and this Mac's key is a members recipient -> approved", () => {
    expect(approvalState(joined({ [SOPS]: teamSops([OWNER, MINE]) }), SLUG)).toEqual({ kind: "approved" });
  });

  test("joined, key only in the admins rule -> still waiting", () => {
    expect(approvalState(joined({ [SOPS]: teamSops([OWNER], [OWNER, MINE]) }), SLUG)).toEqual({ kind: "waiting", since: JOINED_AT });
  });

  test("joined, no .sops.yaml in the clone -> unreadable, naming the file", () => {
    expect(approvalState(joined({}), SLUG)).toEqual({ kind: "unreadable", path: SOPS, reason: "is missing" });
  });

  test("a .sops.yaml rt did not write -> unreadable", () => {
    const handEdited = `creation_rules:\n  - age: ${MINE}\n`;
    expect(approvalState(joined({ [SOPS]: handEdited }), SLUG)).toEqual({ kind: "unreadable", path: SOPS, reason: "has a rule rt did not write" });
  });

  test("the key recorded at join counts before Install writes the personal recipients file", () => {
    const files = { [RECORD]: record({ agePublicKey: MINE }), [SOPS]: teamSops([OWNER, MINE]) };
    expect(approvalState(fakeProbes({ home: HOME, files }), SLUG)).toEqual({ kind: "approved" });
    const waiting = { ...files, [SOPS]: teamSops([OWNER]) };
    expect(approvalState(fakeProbes({ home: HOME, files: waiting }), SLUG)).toEqual({ kind: "waiting", since: JOINED_AT });
  });

  test("an org with no Slack secret still resolves approved", () => {
    const p = joined({ [SOPS]: teamSops([OWNER, MINE]) });
    expect(p.readFile(join(orgDirUnder(HOME, SLUG), "mattstack", "org", "secrets", "board.json"))).toBeNull();
    expect(approvalState(p, SLUG)).toEqual({ kind: "approved" });
  });

  test("a record from before joinedAt was stamped waits with no start time", () => {
    const files = { [RECORD]: record({ joinedAt: undefined, agePublicKey: MINE }), [SOPS]: teamSops([OWNER]) };
    expect(approvalState(fakeProbes({ home: HOME, files }), SLUG)).toEqual({ kind: "waiting", since: null });
  });
});
