import { describe, expect, test } from "bun:test";
import { SWITCHBOARD_URL, switchboardUrl } from "../src/index.ts";

function collector(): { warn: (message: string) => void; seen: string[] } {
  const seen: string[] = [];
  return { warn: (message) => seen.push(message), seen };
}

describe("switchboardUrl", () => {
  test("defaults to the built-in switchboard", () => {
    expect(SWITCHBOARD_URL).toBe("https://switchboard.mattstack.dev");
    expect(switchboardUrl({})).toBe(SWITCHBOARD_URL);
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "" })).toBe(SWITCHBOARD_URL);
  });

  test("honours an https override and strips a trailing slash", () => {
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "https://relay.example.test/" })).toBe("https://relay.example.test");
  });

  test("trims surrounding whitespace from an accepted override", () => {
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: " https://relay.example.test/ \n" })).toBe("https://relay.example.test");
  });

  test("honours plain http only on this machine", () => {
    const { warn, seen } = collector();
    for (const url of ["http://localhost:7940", "http://127.0.0.1:7940", "http://[::1]:7940"]) {
      expect(switchboardUrl({ RT_SWITCHBOARD_URL: `${url}/` }, warn)).toBe(url);
    }
    expect(seen).toEqual([]);
  });

  test("refuses plain http to another host, warns once, and falls back", () => {
    const { warn, seen } = collector();
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "http://relay.example.test" }, warn)).toBe(SWITCHBOARD_URL);
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "http://relay.example.test" }, warn)).toBe(SWITCHBOARD_URL);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("RT_SWITCHBOARD_URL");
  });

  test("refuses an override that is not a url, carries credentials, or is not http(s), without echoing it", () => {
    const { warn, seen } = collector();
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "not a url" }, warn)).toBe(SWITCHBOARD_URL);
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "https://user:hunter2@relay.example.test" }, warn)).toBe(SWITCHBOARD_URL);
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "ftp://relay.example.test" }, warn)).toBe(SWITCHBOARD_URL);
    expect(seen).toHaveLength(3);
    expect(seen.join("\n")).not.toContain("hunter2");
  });
});
