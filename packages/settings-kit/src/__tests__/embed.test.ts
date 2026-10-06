import { describe, expect, test } from "bun:test";
import { consoleOrigin, EMBED_SOURCE, embedMessage, embedSrc, readEmbedMessage } from "../embed.ts";

describe("consoleOrigin", () => {
  test("swaps the app label for console on a deck name", () => {
    expect(consoleOrigin({ protocol: "https:", hostname: "board.mattstack" })).toBe("https://console.mattstack");
    expect(consoleOrigin({ protocol: "https:", hostname: "chat.localhost" })).toBe("https://console.localhost");
  });

  test("a bare localhost dev server gets deck's local name for console", () => {
    expect(consoleOrigin({ protocol: "http:", hostname: "localhost" })).toBe("https://console.localhost");
    expect(consoleOrigin({ protocol: "http:", hostname: "127.0.0.1" })).toBe("https://console.localhost");
  });

  test("any other host gets the canonical console", () => {
    expect(consoleOrigin({ protocol: "https:", hostname: "board.example.dev" })).toBe("https://console.mattstack");
  });
});

describe("embedSrc", () => {
  test("names the group, the scheme and the row to open", () => {
    const src = new URL(
      embedSrc({ origin: "https://console.mattstack", group: "board", scheme: "dark", focusKey: "board.turn" }),
    );
    expect(src.origin).toBe("https://console.mattstack");
    expect(src.pathname).toBe("/embed/settings/board");
    expect(src.searchParams.get("scheme")).toBe("dark");
    expect(src.searchParams.get("explain")).toBe("board.turn");
  });

  test("omits explain when no row is asked for", () => {
    const src = new URL(embedSrc({ origin: "https://console.mattstack", group: "deck", scheme: "light" }));
    expect(src.searchParams.has("explain")).toBe(false);
  });
});

describe("readEmbedMessage", () => {
  test("round-trips every message embedMessage builds", () => {
    for (const msg of [
      embedMessage("height", { height: 420 }),
      embedMessage("saved", { key: "chat.x", group: "chat" }),
      embedMessage("close"),
    ])
      expect(readEmbedMessage(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
  });

  test("ignores anything that is not a well-formed embed message", () => {
    expect(readEmbedMessage(null)).toBeNull();
    expect(readEmbedMessage("close")).toBeNull();
    expect(readEmbedMessage({ type: "close" })).toBeNull();
    expect(readEmbedMessage({ source: EMBED_SOURCE, type: "height", height: "big" })).toBeNull();
    expect(readEmbedMessage({ source: EMBED_SOURCE, type: "saved", key: "x" })).toBeNull();
    expect(readEmbedMessage({ source: EMBED_SOURCE, type: "reload" })).toBeNull();
  });
});
