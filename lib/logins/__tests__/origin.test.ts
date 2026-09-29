import { describe, expect, test } from "bun:test";
import { InvalidOriginError, normalizeOrigin, parsePlaceholder, placeholderName } from "../origin.ts";

describe("normalizeOrigin", () => {
  test("https host keys to the bare host", () => {
    expect(normalizeOrigin("https://login.example.com")).toEqual({ origin: "https://login.example.com", key: "login.example.com" });
  });

  test("case, trailing slash and an explicit default port collapse to one login", () => {
    expect(normalizeOrigin("https://Login.Example.com:443/")).toEqual(normalizeOrigin("https://login.example.com"));
  });

  test("non-default port and http localhost get distinct keys", () => {
    expect(normalizeOrigin("http://localhost:3000").key).toBe("localhost_3000_http");
    expect(normalizeOrigin("https://localhost:3000").key).toBe("localhost_3000");
    expect(normalizeOrigin("http://127.0.0.1:8080").key).toBe("127.0.0.1_8080_http");
  });

  test("an international host is stored as punycode", () => {
    expect(normalizeOrigin("https://bücher.example").key).toBe("xn--bcher-kva.example");
  });

  test.each([
    ["http for a non-local host", "http://login.example.com"],
    ["a path", "https://login.example.com/u/login"],
    ["a query", "https://login.example.com/?state=x"],
    ["a fragment", "https://login.example.com/#x"],
    ["user info", "https://dev:pw@login.example.com"],
    ["an underscore host", "https://log_in.example.com"],
    ["an IPv6 host", "https://[::1]"],
    ["another scheme", "ftp://login.example.com"],
    ["no scheme", "login.example.com"],
    ["an empty string", ""],
    ["a special character in a label", "https://a!b.example"],
    ["a label with a leading hyphen", "https://-a.example"],
    ["a leading dot", "https://.a.example"],
    ["a trailing dot", "https://login.example.com."],
  ])("refuses %s", (_label, input) => {
    expect(() => normalizeOrigin(input)).toThrow(InvalidOriginError);
  });

  test("shorthand IPv4 and an explicit http default port normalize", () => {
    expect(normalizeOrigin("http://127.1").key).toBe("127.0.0.1_http");
    expect(normalizeOrigin("http://localhost:80").key).toBe("localhost_http");
  });

  test.each([
    "https://login.example.com",
    "https://Login.Example.com:443/",
    "http://localhost:3000",
    "https://localhost:3000",
    "http://127.0.0.1:8080",
    "https://bücher.example",
    "http://127.1",
    "http://localhost:80",
  ])("every accepted origin's key resolves as a placeholder: %s", (origin) => {
    const { key } = normalizeOrigin(origin);
    expect(parsePlaceholder(placeholderName(key, "password"))).toEqual({ key, kind: "password" });
  });

  test("a refusal never echoes user info from the input", () => {
    try {
      normalizeOrigin("https://dev:hunter2@login.example.com");
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidOriginError);
      expect(String((err as Error).message)).not.toContain("hunter2");
    }
  });
});

describe("placeholders", () => {
  test("round-trip", () => {
    expect(placeholderName("localhost_3000_http", "password")).toBe("devlogin:localhost_3000_http:password");
    expect(parsePlaceholder("devlogin:login.example.com:email")).toEqual({ key: "login.example.com", kind: "email" });
  });

  test.each(["login.example.com:password", "devlogin:login.example.com", "devlogin:a/b:password", "devlogin:x:token", "DEVLOGIN:x:email"])(
    "rejects %s",
    (name) => expect(parsePlaceholder(name)).toBeNull(),
  );
});
