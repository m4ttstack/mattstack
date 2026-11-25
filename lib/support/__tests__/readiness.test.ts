import { describe, expect, test } from "bun:test";
import type { SupportMissing } from "../../../packages/rt-client/src/support.ts";
import { SLACK_SUPPORT_CHAT_SCOPES } from "../../setup/slack-app.ts";
import { SlackError } from "../../slack/client.ts";
import { readiness, type ReadinessDeps } from "../readiness.ts";

const ready: ReadinessDeps = {
  slackScopes: async () => [...SLACK_SUPPORT_CHAT_SCOPES],
  linearKey: async () => "key",
  defaultRepo: () => "remote:git.example.com%2Facme%2Fapp",
  repoPath: () => "/work/app",
  humanHandle: () => "alex",
  boardToken: async () => "tok",
  relayAnswers: async () => true,
  supportKey: async () => "ready",
  holdsKey: async () => true,
  orgIds: () => ({ forgeHost: "git.example.com", teamKeys: ["ACME"] }),
};
const CONNECT = "Connect Slack for support chats in Settings > Accounts";
const boom = async () => {
  throw new Error("sops: no key at /Users/alex/.mattstack/x");
};

describe("readiness", () => {
  test("nothing is missing on a Mac that is ready", async () => {
    expect(await readiness(ready)).toEqual([]);
  });

  const cases: [string, Partial<ReadinessDeps>, string, SupportMissing["fix"]][] = [
    ["no Slack connection", { slackScopes: async () => null }, CONNECT, "accounts"],
    ["a Slack connection without the support scopes", { slackScopes: async () => ["chat:write"] }, CONNECT, "accounts"],
    ["a Slack that does not answer", { slackScopes: boom }, "Slack did not answer", null],
    [
      "a Slack connection that no longer works",
      {
        slackScopes: async () => {
          throw new SlackError("token_revoked");
        },
      },
      CONNECT,
      "accounts",
    ],
    ["no Linear key", { linearKey: async () => null }, "Add the Linear key support tickets are filed with", null],
    ["a Linear key that cannot be read", { linearKey: boom }, "Add the Linear key support tickets are filed with", null],
    ["no default repo", { defaultRepo: () => null }, "Choose the repo the support agent works in", "repo"],
    ["a default repo rt has no folder for", { repoPath: () => null }, "Tell rt where the support agent's repo is on this Mac", "repo"],
    [
      "a default repo setting that cannot be read",
      {
        defaultRepo: () => {
          throw new Error("bad");
        },
      },
      "Choose the repo the support agent works in",
      "repo",
    ],
    ["no chat name", { humanHandle: () => "" }, "Set your chat name", "chat-name"],
    ["a chat name rt refuses", { humanHandle: () => "Not A Handle!" }, "Set your chat name", "chat-name"],
    ["no board token", { boardToken: async () => null }, "Connect your board to your team's boards", "accounts"],
    ["a relay that refuses the token", { relayAnswers: async () => false }, "Your board's connection is not working", "accounts"],
    ["an org with no support key", { supportKey: async () => "missing" }, "Your org has no support key yet, so an org admin runs rt team support on", null],
    ["a support key this Mac's own does not open", { supportKey: async () => "unreadable" }, "This Mac cannot open the org's support key", null],
    ["a support key this Mac cannot open", { supportKey: boom }, "This Mac cannot open the org's support key", null],
    ["a Mac whose key is not the roster's", { holdsKey: async () => false }, "This Mac's key is not the one your org has for you", null],
    ["a key that cannot be read", { holdsKey: boom }, "This Mac's key could not be read", null],
    ["no forge host", { orgIds: () => ({ forgeHost: null, teamKeys: ["ACME"] }) }, "Your org's settings name no forge host, which tickets need", null],
    ["no Linear team", { orgIds: () => ({ forgeHost: "git.example.com", teamKeys: null }) }, "Your org's settings name no Linear team, which tickets need", null],
  ];
  for (const [name, patch, text, fix] of cases) {
    test(`${name} is named on its own`, async () => {
      const missing = await readiness({ ...ready, ...patch });
      expect(missing).toHaveLength(1);
      expect(missing[0]).toMatchObject({ text, fix });
    });
  }

  test("the Linear key, which only a terminal can set, names its command", async () => {
    expect((await readiness({ ...ready, linearKey: async () => null }))[0]!.command).toBe("rt secrets set rt linearSupportApiKey");
  });

  test("a key the roster does not hold names the command that records it", async () => {
    expect((await readiness({ ...ready, holdsKey: async () => false }))[0]!.command).toBe("rt team members sync");
    expect((await readiness({ ...ready, holdsKey: boom }))[0]!.command).toBeUndefined();
  });

  test("everything missing is named at once, and no error text reaches a person", async () => {
    const all = await readiness({
      slackScopes: boom,
      linearKey: boom,
      defaultRepo: () => null,
      repoPath: () => null,
      humanHandle: () => "",
      boardToken: boom as never,
      relayAnswers: async () => false,
      supportKey: boom as never,
      holdsKey: boom,
      orgIds: () => ({ forgeHost: null, teamKeys: null }),
    });
    expect(all).toHaveLength(9);
    expect(JSON.stringify(all)).not.toContain("sops");
  });
});
