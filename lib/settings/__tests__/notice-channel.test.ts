import { describe, expect, test } from "bun:test";
import { routeSettingsNotices, settingsNoticeChannel } from "../notice-channel.ts";
import { noticeBlocks } from "../notice-blocks.ts";
import { setSettingsNoticeSink } from "../write.ts";
import * as out from "../../ui/out.ts";
import { renderPlain } from "../../ui/out-plain.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";

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

describe("noticeBlocks", () => {
  test("a tip with a command is a tip callout and a next callout", () => {
    expect(renderPlain(noticeBlocks({ text: "Saved rt.logLevel on this Mac only.", next: "rt home remote set" }))).toBe(
      "  tip: Saved rt.logLevel on this Mac only.\n  next: rt home remote set\n",
    );
  });

  test("a tip without a command is one callout", () => {
    expect(renderPlain(noticeBlocks({ text: "Saved rt.logLevel in your user settings, but automatic home sync is off." }))).toBe(
      "  tip: Saved rt.logLevel in your user settings, but automatic home sync is off.\n",
    );
  });

  test("a bare line is a tip with no command", () => {
    expect(renderPlain(noticeBlocks("Saved on this Mac only."))).toBe("  tip: Saved on this Mac only.\n");
  });
});

describe("routeSettingsNotices", () => {
  test("at a terminal the installed sink prints the tip on stdout through out, with or without the notice", async () => {
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const cap = captureOut();
    out.__test__.setHuman(() => false);
    try {
      await routeSettingsNotices(["settings", "set", "rt.logLevel", '"debug"', "--scope", "user"]);
      const installed = setSettingsNoticeSink(null);
      installed("ignored", { text: "Saved rt.logLevel on this Mac only.", next: "rt home remote set" });
      expect(cap.stdout()).toBe("  tip: Saved rt.logLevel on this Mac only.\n  next: rt home remote set\n");
      cap.clear();
      installed("Saved on this Mac only.");
      expect(cap.stdout()).toBe("  tip: Saved on this Mac only.\n");
      expect(cap.stderr()).toBe("");
    } finally {
      cap.restore();
      setSettingsNoticeSink(null);
      if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });

  test("off a terminal nothing is installed, so the library's stderr default stays", async () => {
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    try {
      const before = setSettingsNoticeSink(null);
      setSettingsNoticeSink(before);
      await routeSettingsNotices(["settings", "set", "rt.logLevel", '"debug"', "--scope", "user"]);
      expect(setSettingsNoticeSink(null)).toBe(before);
    } finally {
      if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });
});
