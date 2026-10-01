import { describe, expect, test } from "bun:test";
import { join } from "path";
import { fakeProbes } from "./fakes.ts";
import { slackSecretWait, SLACK_AWAITING_OWNER } from "../team-slack-secret.ts";
import { teamLocalPath } from "../../team/team-local.ts";

const HOME = "/fake-home";
const SLUG = "acme";
const MINE = "age1mine0000000000000000000000000000000000000000000000000000000";
const OWNER = "age1owner000000000000000000000000000000000000000000000000000000";
const BOARD = join(HOME, ".mattstack", "teams", SLUG, "mattstack", "secrets", "board.json");
const PERSONAL_SOPS = join(HOME, ".mattstack", "user", ".sops.yaml");

function boardFile(recipients: string[], keys: string[] = ["slackClientSecret"]): string {
  const values = Object.fromEntries(keys.map((k) => [k, "ENC[AES256_GCM,data:x,type:str]"]));
  return JSON.stringify({ ...values, sops: { age: recipients.map((recipient) => ({ recipient, enc: "-----BEGIN AGE ENCRYPTED FILE-----" })), version: "3.13.3" } });
}

function joined(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ createdByRt: false, joinedByRt: true, rtMayManageMembership: false, ...extra });
}

function personalSops(key: string): string {
  return `creation_rules:\n  - path_regex: secrets/.*\n    age: ${key}\n`;
}

describe("slackSecretWait", () => {
  test("a machine that did not join by invite is never told to wait", () => {
    const p = fakeProbes({ home: HOME, files: { [BOARD]: boardFile([OWNER]), [PERSONAL_SOPS]: personalSops(MINE) } });
    expect(slackSecretWait(p, SLUG)).toBeNull();
  });

  test("joined, and the team file is encrypted to this machine's key -> nothing to wait for", () => {
    const p = fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, SLUG)]: joined(), [PERSONAL_SOPS]: personalSops(MINE), [BOARD]: boardFile([OWNER, MINE]) } });
    expect(slackSecretWait(p, SLUG)).toBeNull();
  });

  test("joined, but this machine's key is not a recipient yet -> waiting on the owner", () => {
    const p = fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, SLUG)]: joined(), [PERSONAL_SOPS]: personalSops(MINE), [BOARD]: boardFile([OWNER]) } });
    expect(slackSecretWait(p, SLUG)).toEqual({ kind: "waiting", detail: SLACK_AWAITING_OWNER });
  });

  test("before Install writes the personal recipients file, the key recorded at join is used", () => {
    const files = { [teamLocalPath(HOME, SLUG)]: joined({ agePublicKey: MINE }), [BOARD]: boardFile([OWNER]) };
    expect(slackSecretWait(fakeProbes({ home: HOME, files }), SLUG)).toEqual({ kind: "waiting", detail: SLACK_AWAITING_OWNER });
    const accepted = { ...files, [BOARD]: boardFile([OWNER, MINE]) };
    expect(slackSecretWait(fakeProbes({ home: HOME, files: accepted }), SLUG)).toBeNull();
  });

  test("joined, team clone has no board secrets file yet -> waiting", () => {
    const p = fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, SLUG)]: joined(), [PERSONAL_SOPS]: personalSops(MINE) } });
    expect(slackSecretWait(p, SLUG)?.kind).toBe("waiting");
  });

  test("joined, recipient present but the file holds no Slack client secret -> waiting", () => {
    const p = fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, SLUG)]: joined(), [PERSONAL_SOPS]: personalSops(MINE), [BOARD]: boardFile([OWNER, MINE], ["slackSigningSecret"]) } });
    expect(slackSecretWait(p, SLUG)?.kind).toBe("waiting");
  });

  test("joined, but no key is known on this machine -> cannot tell, so nothing stands in the way", () => {
    const p = fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, SLUG)]: joined(), [BOARD]: boardFile([OWNER]) } });
    expect(slackSecretWait(p, SLUG)).toBeNull();
  });

  test("the team file exists but cannot be read -> unreadable, never waiting", () => {
    const p = fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, SLUG)]: joined(), [PERSONAL_SOPS]: personalSops(MINE), [BOARD]: boardFile([OWNER, MINE]) }, unreadable: [BOARD] });
    const wait = slackSecretWait(p, SLUG);
    expect(wait?.kind).toBe("unreadable");
    expect(wait?.detail).toContain(BOARD);
  });

  test("the team file is not a sops file -> unreadable", () => {
    const p = fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, SLUG)]: joined(), [PERSONAL_SOPS]: personalSops(MINE), [BOARD]: "{not json" } });
    expect(slackSecretWait(p, SLUG)?.kind).toBe("unreadable");
    const noMeta = fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, SLUG)]: joined(), [PERSONAL_SOPS]: personalSops(MINE), [BOARD]: JSON.stringify({ slackClientSecret: "plain" }) } });
    expect(slackSecretWait(noMeta, SLUG)?.kind).toBe("unreadable");
  });

  test("never runs a command: no keychain or sops spawn can prompt", () => {
    const p = fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, SLUG)]: joined(), [PERSONAL_SOPS]: personalSops(MINE), [BOARD]: boardFile([OWNER]) } });
    slackSecretWait(p, SLUG);
    expect(p.calls.exec).toEqual([]);
  });
});
