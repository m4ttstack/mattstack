import { describe, expect, test } from "bun:test";
import { SLACK_PREFIX, closingLine, hasPrefix, holdingLine, redactSecrets, withPrefix } from "../format.ts";

describe("withPrefix", () => {
  test("adds the prefix once", () => {
    expect(withPrefix("hello")).toBe("[Claude 🤖]: hello");
    expect(hasPrefix(withPrefix("hello"))).toBe(true);
  });

  test("strips a copy the pane wrote", () => {
    expect(withPrefix(`${SLACK_PREFIX}hello`)).toBe("[Claude 🤖]: hello");
    expect(withPrefix(`  ${SLACK_PREFIX}${SLACK_PREFIX}hello`)).toBe("[Claude 🤖]: hello");
  });
});

describe("emoji shortcode form", () => {
  const shortcode = "[Claude :robot_face:]: ";

  test("hasPrefix accepts both forms", () => {
    expect(hasPrefix(`${shortcode}hi`)).toBe(true);
    expect(hasPrefix("[Claude 🤖]: hi")).toBe(true);
    expect(hasPrefix("Claude said hi")).toBe(false);
  });

  test("withPrefix strips the shortcode form and sends the emoji form", () => {
    expect(withPrefix(`${shortcode}hello`)).toBe("[Claude 🤖]: hello");
  });
});

describe("fixed lines", () => {
  test("holding line names the operator", () => {
    expect(holdingLine("alex")).toBe("[Claude 🤖]: Claude is tied up for a moment. Your message is safe, and alex has been told.");
  });

  test("closing line, with and without the pane gone", () => {
    expect(closingLine("alex", false)).toBe("[Claude 🤖]: This chat with Claude is closed. Anything you send now goes to alex.");
    expect(closingLine("alex", true)).toBe("[Claude 🤖]: This chat with Claude is closed. Anything you send now goes to alex. alex will follow up.");
  });
});

describe("redactSecrets", () => {
  test("catches each token shape and leaves ordinary text alone", () => {
    const shapes = ["xoxp-1234-abcd", "xoxb-1234-abcd", "xoxa-1234-abcd", "glpat-abcDEF123_x", "ghp_abcDEF123", "AKIAABCDEFGHIJKLMNOP", "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----"];
    for (const s of shapes) {
      const r = redactSecrets(`before ${s} after`);
      expect(r.redacted).toBe(true);
      expect(r.text).toBe("before [redacted] after");
    }
    const plain = redactSecrets("nothing secret here, just ghp and AKIA words");
    expect(plain).toEqual({ text: "nothing secret here, just ghp and AKIA words", redacted: false });
  });
});
