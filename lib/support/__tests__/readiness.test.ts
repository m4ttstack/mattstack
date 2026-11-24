import { describe, expect, test } from "bun:test";
import { SLACK_SUPPORT_CHAT_SCOPES } from "../../setup/slack-app.ts";
import { readiness, type ReadinessDeps } from "../readiness.ts";

const ready: ReadinessDeps = {
  slackScopes: async () => [...SLACK_SUPPORT_CHAT_SCOPES],
  linearKey: async () => "key",
  defaultRepo: () => "remote:git.example.com%2Facme%2Fapp",
  repoPath: () => "/work/app",
  humanHandle: () => "alex",
  boardToken: async () => "tok",
  relayAnswers: async () => true,
  supportKey: async () => true,
  orgIds: () => ({ forgeHost: "git.example.com", teamKeys: ["ACME"] }),
};
const boom = async () => {
  throw new Error("sops: no key at /Users/alex/.mattstack/x");
};

describe("readiness", () => {
  test("nothing is missing on a Mac that is ready", async () => {
    expect(await readiness(ready)).toEqual([]);
  });

  const cases: [string, Partial<ReadinessDeps>, string][] = [
    ["no Slack connection", { slackScopes: async () => null }, "Connect Slack for support chats in Setup"],
    ["a Slack connection without the support scopes", { slackScopes: async () => ["chat:write"] }, "Connect Slack for support chats in Setup"],
    ["a Slack that does not answer", { slackScopes: boom }, "Slack did not answer"],
    ["no Linear key", { linearKey: async () => null }, "Add the Linear key support tickets are filed with"],
    ["a Linear key that cannot be read", { linearKey: boom }, "Add the Linear key support tickets are filed with"],
    ["no default repo", { defaultRepo: () => null }, "Choose the repo the support agent works in"],
    ["a default repo rt has no folder for", { repoPath: () => null }, "Tell rt where the support agent's repo is on this Mac"],
    [
      "a default repo setting that cannot be read",
      {
        defaultRepo: () => {
          throw new Error("bad");
        },
      },
      "Choose the repo the support agent works in",
    ],
    ["no chat name", { humanHandle: () => "" }, "Set your chat name"],
    ["a chat name rt refuses", { humanHandle: () => "Not A Handle!" }, "Set your chat name"],
    ["no board token", { boardToken: async () => null }, "Connect your board to your team's boards"],
    ["a relay that refuses the token", { relayAnswers: async () => false }, "Your board's connection is not working"],
    ["no support key", { supportKey: async () => false }, "This Mac cannot open the org's support key"],
    ["a support key this Mac cannot open", { supportKey: boom }, "This Mac cannot open the org's support key"],
    ["no forge host", { orgIds: () => ({ forgeHost: null, teamKeys: ["ACME"] }) }, "Your org's settings name no forge host, which tickets need"],
    ["no Linear team", { orgIds: () => ({ forgeHost: "git.example.com", teamKeys: null }) }, "Your org's settings name no Linear team, which tickets need"],
  ];
  for (const [name, patch, sentence] of cases) {
    test(`${name} is named on its own`, async () => {
      expect(await readiness({ ...ready, ...patch })).toEqual([sentence]);
    });
  }

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
      orgIds: () => ({ forgeHost: null, teamKeys: null }),
    });
    expect(all).toHaveLength(8);
    expect(all.join(" ")).not.toContain("sops");
  });
});
