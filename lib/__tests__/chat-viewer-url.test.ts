import { afterEach, beforeEach, expect, test } from "bun:test";
import { chatViewerUrl, readChatViewerUrlSetting } from "../chat-viewer-url.ts";
import * as out from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnings } from "../ui/warn.ts";

beforeEach(() => warnings.reset());
afterEach(() => warnings.reset());

test("no base, no link", () => {
  expect(chatViewerUrl(undefined, "build")).toBeUndefined();
  expect(chatViewerUrl("", "build", 4)).toBeUndefined();
});

test("room link, message anchor, trailing slash trimmed", () => {
  expect(chatViewerUrl("https://chat.example/", "build")).toBe("https://chat.example/r/build");
  expect(chatViewerUrl("https://chat.example", "build", 412)).toBe("https://chat.example/r/build#m-412");
});

test("a DM room's hashed name survives as one path segment", () => {
  expect(chatViewerUrl("https://chat.example", "dm-abc123", 1)).toBe("https://chat.example/r/dm-abc123#m-1");
});

test("a setting that cannot be read is logged, never shown, and the link is dropped", () => {
  const logged: Array<{ module: string; message: string }> = [];
  setWarningLog((module, message) => logged.push({ module, message }));
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    const url = readChatViewerUrlSetting(() => {
      throw new Error("boom");
    });
    expect(url).toBeUndefined();
    expect(logged).toEqual([{ module: "chat", message: "chat.viewerUrl could not be read, posting without a link: boom" }]);
    expect(io.stderr()).toBe("");
    expect(io.stdout()).toBe("");
  } finally {
    io.restore();
  }
});

test("a set value comes back, and an empty one is no link", () => {
  expect(readChatViewerUrlSetting(() => ({ value: "https://chat.example" }))).toBe("https://chat.example");
  expect(readChatViewerUrlSetting(() => ({ value: "" }))).toBeUndefined();
});
