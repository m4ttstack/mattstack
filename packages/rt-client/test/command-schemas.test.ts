import { describe, expect, test } from "bun:test";
import * as S from "../src/command-schemas.ts";

describe("SdmReconnectReplySchema", () => {
  const replies = {
    connected: { ok: true, address: "127.0.0.1:5432", verifyAttempts: 2 },
    "needs-access-request": { ok: false, outcome: "needs-access-request", resource: "db-staging" },
    aborted: { ok: false, outcome: "aborted", error: "login declined" },
    failed: { ok: false, outcome: "failed", error: "StrongDM did not open the tunnel." },
    "unknown key": { ok: false, error: "unknown recents key: nope" },
  } as const;
  for (const [branch, reply] of Object.entries(replies)) {
    test(`${branch} reply parses to itself`, () => {
      expect(S.SdmReconnectReplySchema.parse(reply)).toEqual(reply);
    });
  }
});

describe("SecretsReadDataSchema", () => {
  const replies = {
    "nothing set": {},
    extension: { linearApiKey: "lin", gitlabToken: "glpat" },
    deck: { cfApiToken: "cf", cfZoneId: "zone", cfDnsToken: "dns", railwayToken: "rw", railwayApiToken: "rwapi" },
    board: {
      slackToken: "xoxb",
      slackClientSecret: "cs",
      slackSigningSecret: "ss",
      gitlabToken: "glpat",
      switchboardToken: "sw",
      switchboardAdminToken: "swa",
    },
    "board, partly set": { slackToken: "xoxb", gitlabToken: "glpat" },
  } as const;
  for (const [scope, reply] of Object.entries(replies)) {
    test(`${scope} reply parses to itself`, () => {
      expect(S.SecretsReadDataSchema.parse(reply)).toEqual(reply);
    });
  }
});
