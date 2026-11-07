import { describe, expect, test } from "bun:test";
import { closingLine, decodeSlackText, escapeSlackText, hasPrefix, holdingLine, namesTicket, redactSecrets, slackPrefix, withPrefix } from "../format.ts";

const MAUDE = { name: "Maude", emoji: "🤖" };
const ADA = { name: "Ada", emoji: "🦊", trigger: "!!ada" };

describe("the prefix", () => {
  test("names the persona", () => {
    expect(slackPrefix(MAUDE)).toBe("[Maude 🤖]: ");
    expect(slackPrefix(ADA)).toBe("[Ada 🦊]: ");
  });

  test("withPrefix adds it once", () => {
    expect(withPrefix("hello", MAUDE)).toBe("[Maude 🤖]: hello");
    expect(hasPrefix(withPrefix("hello", ADA), ADA)).toBe(true);
  });

  test("withPrefix strips a copy the pane wrote", () => {
    expect(withPrefix("[Maude 🤖]: hello", MAUDE)).toBe("[Maude 🤖]: hello");
    expect(withPrefix("  [Maude 🤖]: [Maude 🤖]: hello", MAUDE)).toBe("[Maude 🤖]: hello");
  });
});

describe("our own earlier messages", () => {
  test.each(["[Claude 🤖]: ", "[Claude :robot_face:]: ", "[Maude :robot_face:]: ", "[Maude 🤖]: "])("hasPrefix recognises %s", (prefix) => {
    expect(hasPrefix(`${prefix}hi`, MAUDE)).toBe(true);
  });

  test("a legacy prefix is still ours under another persona", () => {
    expect(hasPrefix("[Claude 🤖]: hi", ADA)).toBe(true);
  });

  test("withPrefix strips every form and sends the current one", () => {
    expect(withPrefix("[Claude 🤖]: hello", MAUDE)).toBe("[Maude 🤖]: hello");
    expect(withPrefix("[Claude :robot_face:]: hello", MAUDE)).toBe("[Maude 🤖]: hello");
    expect(withPrefix("[Maude :robot_face:]: hello", MAUDE)).toBe("[Maude 🤖]: hello");
  });

  test("plain text that merely mentions the name is not ours", () => {
    expect(hasPrefix("Maude said hi", MAUDE)).toBe(false);
    expect(hasPrefix("[Maude]: hi", MAUDE)).toBe(false);
  });

  test.each(["[Ada :fox_face:]: hi", "[Claude 🤖]: hi", "[Old Name 🦊]: hi", "[Maude 👩🏽‍💻]: hi", "[Maude 🇨🇦]: hi", "[Dr. Who :+1:]: hi"])(
    "any persona prefix shape is recognised: %s",
    (text) => {
      expect(hasPrefix(text, MAUDE)).toBe(true);
    },
  );

  test.each(["[note] hi", "[x]: hi", "[Maude]: hi", "[Maude 🤖] hi", "[ 🤖]: hi", `[${"n".repeat(41)} 🤖]: hi`, "see [Maude 🤖]: hi"])(
    "ordinary text is not ours: %s",
    (text) => {
      expect(hasPrefix(text, MAUDE)).toBe(false);
    },
  );

  test("withPrefix strips repeated known and generic prefixes before adding the current one", () => {
    expect(withPrefix("[Old Name 🦊]: [Ada :fox_face:]: [Claude 🤖]: hello", MAUDE)).toBe("[Maude 🤖]: hello");
  });
});

describe("Slack's control characters", () => {
  test.each([
    ["Promise<void>", "Promise&lt;void&gt;"],
    ["cmd 2>&1", "cmd 2&gt;&amp;1"],
    ["a && b", "a &amp;&amp; b"],
    ["<@U0TEST>", "&lt;@U0TEST&gt;"],
    ["&lt; stays literal", "&amp;lt; stays literal"],
  ])("%s survives the trip both ways", (plain, wire) => {
    expect(escapeSlackText(plain)).toBe(wire);
    expect(decodeSlackText(wire)).toBe(plain);
  });

  test("a prefixed line keeps its prefix through the escape", () => {
    const wire = escapeSlackText(withPrefix("Promise<void>", MAUDE));
    expect(hasPrefix(wire, MAUDE)).toBe(true);
    expect(wire).toBe(`${slackPrefix(MAUDE)}Promise&lt;void&gt;`);
  });

  test("decoding leaves Slack's own markup and other entities alone", () => {
    expect(decodeSlackText("<@U0TEST> &quot;hi&quot;")).toBe("<@U0TEST> &quot;hi&quot;");
  });
});

describe("the closing and holding lines", () => {
  test("closingLine for the default persona", () => {
    expect(closingLine("alex", false, MAUDE)).toBe(
      "[Maude 🤖]: This chat with Maude is closed. Anything you send now goes to alex. To add something for Maude in the next hour, start your message with @Maude",
    );
  });

  test("the pane-gone variant adds the follow-up sentence where it sat before", () => {
    expect(closingLine("alex", true, MAUDE)).toBe(
      "[Maude 🤖]: This chat with Maude is closed. Anything you send now goes to alex. alex will follow up. To add something for Maude in the next hour, start your message with @Maude",
    );
  });

  test("a custom persona names itself and its own trigger", () => {
    expect(closingLine("alex", false, ADA)).toBe(
      "[Ada 🦊]: This chat with Ada is closed. Anything you send now goes to alex. To add something for Ada in the next hour, start your message with !!ada",
    );
  });

  test("holdingLine", () => {
    expect(holdingLine("alex", MAUDE)).toBe("[Maude 🤖]: Maude is tied up for a moment. Your message is safe, and alex has been told.");
    expect(holdingLine("alex", ADA)).toBe("[Ada 🦊]: Ada is tied up for a moment. Your message is safe, and alex has been told.");
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

describe("namesTicket", () => {
  const tickets = [{ id: "SUP-7", url: "https://tracker.example.com/acme/issue/SUP-7/export-hangs" }];

  test("finds a chat ticket by id in any case, or by url, or any Linear url", () => {
    expect(namesTicket("I filed SUP-7 for this", tickets)).toBe(true);
    expect(namesTicket("see (sup-7).", tickets)).toBe(true);
    expect(namesTicket("here: https://tracker.example.com/acme/issue/SUP-7/export-hangs", tickets)).toBe(true);
    expect(namesTicket("https://linear.app/acme/issue/OTHER-1", [])).toBe(true);
  });

  test("leaves a longer id and plain text alone", () => {
    expect(namesTicket("SUP-70 is someone else's", tickets)).toBe(false);
    expect(namesTicket("I wrote it up for the team", tickets)).toBe(false);
  });
});
