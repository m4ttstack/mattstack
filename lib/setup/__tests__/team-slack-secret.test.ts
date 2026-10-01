import { describe, expect, test } from "bun:test";
import { join } from "path";
import { fakeProbes } from "./fakes.ts";
import { slackSecretWait, slackWaitCliMessage, slackWaitRowDetail } from "../team-slack-secret.ts";
import { teamLocalPath } from "../../team/team-local.ts";

const HOME = "/fake-home";
const SLUG = "acme";
const MINE = "age1mine0000000000000000000000000000000000000000000000000000000";
const OLD = "age1old00000000000000000000000000000000000000000000000000000000";
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

function personalSops(keys: string): string {
  return `creation_rules:\n  - path_regex: secrets/.*\n    age: ${keys}\n`;
}

function member(files: Record<string, string>, unreadable: string[] = []) {
  return fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, SLUG)]: joined(), [PERSONAL_SOPS]: personalSops(MINE), ...files }, unreadable });
}

describe("slackSecretWait", () => {
  test("a machine that did not join by invite is never told to wait", () => {
    const p = fakeProbes({ home: HOME, files: { [BOARD]: boardFile([OWNER]), [PERSONAL_SOPS]: personalSops(MINE) } });
    expect(slackSecretWait(p, SLUG)).toBeNull();
  });

  test("joined, and the team file is encrypted to this machine's key -> nothing to wait for", () => {
    expect(slackSecretWait(member({ [BOARD]: boardFile([OWNER, MINE]) }), SLUG)).toBeNull();
  });

  test("joined, but this machine's key is not a recipient yet -> awaiting acceptance", () => {
    expect(slackSecretWait(member({ [BOARD]: boardFile([OWNER]) }), SLUG)).toEqual({ kind: "awaiting-acceptance" });
  });

  test("not a recipient and no Slack secret in the file -> still awaiting acceptance first", () => {
    expect(slackSecretWait(member({ [BOARD]: boardFile([OWNER], ["other"]) }), SLUG)).toEqual({ kind: "awaiting-acceptance" });
  });

  test("before Install writes the personal recipients file, the key recorded at join is used", () => {
    const files = { [teamLocalPath(HOME, SLUG)]: joined({ agePublicKey: MINE }), [BOARD]: boardFile([OWNER]) };
    expect(slackSecretWait(fakeProbes({ home: HOME, files }), SLUG)).toEqual({ kind: "awaiting-acceptance" });
    const accepted = { ...files, [BOARD]: boardFile([OWNER, MINE]) };
    expect(slackSecretWait(fakeProbes({ home: HOME, files: accepted }), SLUG)).toBeNull();
  });

  test("this machine's keys are a set: the personal file and the join record may disagree, and either one being a recipient passes", () => {
    const files = { [teamLocalPath(HOME, SLUG)]: joined({ agePublicKey: OLD }), [PERSONAL_SOPS]: personalSops(MINE) };
    expect(slackSecretWait(fakeProbes({ home: HOME, files: { ...files, [BOARD]: boardFile([OWNER, OLD]) } }), SLUG)).toBeNull();
    expect(slackSecretWait(fakeProbes({ home: HOME, files: { ...files, [BOARD]: boardFile([OWNER, MINE]) } }), SLUG)).toBeNull();
    expect(slackSecretWait(fakeProbes({ home: HOME, files: { ...files, [BOARD]: boardFile([OWNER]) } }), SLUG)).toEqual({ kind: "awaiting-acceptance" });
  });

  test("every age1 recipient in the personal file counts, comma-separated, and non-age values are ignored", () => {
    const p = member({ [PERSONAL_SOPS]: personalSops(`ssh-ed25519AAAA, ${OLD},${MINE}`), [BOARD]: boardFile([OWNER, MINE]) });
    expect(slackSecretWait(p, SLUG)).toBeNull();
  });

  test("a recipient whose clone has no board secrets file -> the owner has not shared the secret", () => {
    expect(slackSecretWait(member({}), SLUG)).toEqual({ kind: "not-shared" });
  });

  test("a recipient whose file holds no Slack client secret -> the owner has not shared the secret", () => {
    expect(slackSecretWait(member({ [BOARD]: boardFile([OWNER, MINE], ["slackSigningSecret"]) }), SLUG)).toEqual({ kind: "not-shared" });
  });

  test("joined, but no key is known on this machine -> cannot tell, so nothing stands in the way", () => {
    const p = fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, SLUG)]: joined(), [BOARD]: boardFile([OWNER]) } });
    expect(slackSecretWait(p, SLUG)).toBeNull();
  });

  test("the team file exists but cannot be read -> unreadable, never waiting", () => {
    const wait = slackSecretWait(member({ [BOARD]: boardFile([OWNER, MINE]) }, [BOARD]), SLUG);
    expect(wait?.kind).toBe("unreadable");
    expect(wait && slackWaitRowDetail(wait, SLUG)).toContain(BOARD);
  });

  test("the team file is not a sops file -> unreadable", () => {
    expect(slackSecretWait(member({ [BOARD]: "{not json" }), SLUG)?.kind).toBe("unreadable");
    expect(slackSecretWait(member({ [BOARD]: JSON.stringify({ slackClientSecret: "plain" }) }), SLUG)?.kind).toBe("unreadable");
  });

  test("never runs a command: no keychain or sops spawn can prompt", () => {
    const p = member({ [BOARD]: boardFile([OWNER]) });
    slackSecretWait(p, SLUG);
    expect(p.calls.exec).toEqual([]);
  });
});

describe("slack wait wording", () => {
  test("awaiting acceptance: the row says Re-check pulls now", () => {
    expect(slackWaitRowDetail({ kind: "awaiting-acceptance" }, SLUG)).toBe("Waiting for your team owner to accept you. Slack connects a few minutes after they do; Re-check pulls now.");
  });

  test("awaiting acceptance: the CLI names both sides", () => {
    const msg = slackWaitCliMessage({ kind: "awaiting-acceptance" }, SLUG);
    expect(msg).toContain("rt team members sync");
    expect(msg).toContain("rt team pull");
    expect(msg[0]).toBe(msg[0]!.toLowerCase());
  });

  test("not shared: names the owner's missing step, never acceptance", () => {
    const row = slackWaitRowDetail({ kind: "not-shared" }, SLUG);
    expect(row).toContain("Your team owner hasn't shared the Slack app's secret yet");
    expect(row).not.toContain("accept");
    const cli = slackWaitCliMessage({ kind: "not-shared" }, SLUG);
    expect(cli).toContain("rt team pull");
    expect(cli).not.toContain("accept");
    expect(cli[0]).toBe(cli[0]!.toLowerCase());
  });

  test("unreadable: lowercase and names rt team pull", () => {
    const wait = { kind: "unreadable" as const, path: BOARD, reason: "could not be read" };
    for (const text of [slackWaitRowDetail(wait, SLUG), slackWaitCliMessage(wait, SLUG)]) {
      expect(text[0]).toBe(text[0]!.toLowerCase());
      expect(text).toContain("rt team pull");
    }
  });
});
