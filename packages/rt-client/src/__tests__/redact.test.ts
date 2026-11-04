import { describe, expect, test } from "bun:test";
import { redactCredentials } from "../redact.ts";

describe("redactCredentials", () => {
  test("masks Slack tokens of every prefix", () => {
    for (const p of ["xoxa", "xoxb", "xoxp", "xoxo", "xoxs", "xoxr"]) {
      expect(redactCredentials(`slack said ${p}-1234567890-abcdefABCDEF done`)).toBe("slack said [redacted] done");
    }
  });

  test("masks Anthropic API keys", () => {
    expect(redactCredentials(`key sk-ant-api03-${"Z".repeat(40)} rejected`)).toBe("key [redacted] rejected");
  });

  test("masks the value of a secret-named env assignment, quoted or bare", () => {
    expect(redactCredentials("ACME_TOKEN=abc123 DB_PASSWORD='p w' OPENAI_API_KEY=\"k\" MY_SECRET=s claude")).toBe(
      "ACME_TOKEN=[redacted] DB_PASSWORD=[redacted] OPENAI_API_KEY=[redacted] MY_SECRET=[redacted] claude",
    );
  });

  test("leaves ordinary assignments and lowercase words alone", () => {
    expect(redactCredentials("HERDR_SOCKET_PATH=/tmp/h.sock token is fine PAGE=2")).toBe("HERDR_SOCKET_PATH=/tmp/h.sock token is fine PAGE=2");
  });

  test("masks a bare Bearer value anywhere, keeping the word", () => {
    expect(redactCredentials("sent bearer abcDEF1234567890xyzFAKE.tok-en/part== to api")).toBe("sent bearer [redacted] to api");
    expect(redactCredentials("BEARER FAKE0123456789abcdef")).toBe("BEARER [redacted]");
    expect(redactCredentials("curl failed: Bearer ghp_FAKEFAKEFAKEFAKEFAKE1234 was rejected (401)")).toBe("curl failed: Bearer [redacted] was rejected (401)");
  });

  test("leaves prose and a tokenless Bearer alone", () => {
    for (const s of ["the bearer of this note", "Bearer", "Bearer token required", "a Bearer: none"]) {
      expect(redactCredentials(s)).toBe(s);
    }
  });
});
