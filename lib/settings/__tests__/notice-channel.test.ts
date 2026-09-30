import { describe, expect, test } from "bun:test";
import { settingsNoticeChannel } from "../notice-channel.ts";

describe("settingsNoticeChannel", () => {
  test("a person at a terminal reads a share tip on stdout, like any other information", () => {
    expect(settingsNoticeChannel(["settings", "set", "chat.humanHandle", "acme-dev"], true)).toBe("stdout");
  });

  test("--json keeps stdout for the envelope, so the tip stays on stderr", () => {
    expect(settingsNoticeChannel(["setup", "pack", "--json"], true)).toBe("stderr");
  });

  test("a pipe or an app reading stdout keeps it for its own contract, so the tip stays on stderr", () => {
    expect(settingsNoticeChannel(["settings", "set", "chat.humanHandle", "acme-dev"], false)).toBe("stderr");
  });
});
