import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { chatFacePng } from "../chat-face-png.ts";
import { chatFacesDir } from "../rt-paths.ts";

const PIXELS = new Uint8Array([137, 80, 78, 71]);

let home = "";
let savedHome: string | undefined;
let drawn: Array<[string, number]> = [];

const render = async (svg: string, size: number) => {
  drawn.push([svg, size]);
  return PIXELS;
};

beforeEach(() => {
  savedHome = process.env.HOME;
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-chat-face-")));
  process.env.HOME = home;
  drawn = [];
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

test("keeps the picture under rt's directory", async () => {
  const path = await chatFacePng("<svg/>", 44, render);
  expect(dirname(path)).toBe(chatFacesDir());
  expect(path.startsWith(join(home, ".mattstack", "rt"))).toBe(true);
  expect(readFileSync(path)).toEqual(Buffer.from(PIXELS));
  expect(drawn).toEqual([["<svg/>", 44]]);
});

test("a second ask for the same face and size draws nothing", async () => {
  const first = await chatFacePng("<svg/>", 44, render);
  const second = await chatFacePng("<svg/>", 44, render);
  expect(second).toBe(first);
  expect(drawn).toHaveLength(1);
});

test("a new size or a new SVG is a new picture", async () => {
  const base = await chatFacePng("<svg/>", 44, render);
  expect(await chatFacePng("<svg/>", 88, render)).not.toBe(base);
  expect(await chatFacePng("<svg id='b'/>", 44, render)).not.toBe(base);
  expect(drawn).toHaveLength(3);
});

test("leaves no partial file behind", async () => {
  await chatFacePng("<svg/>", 44, render);
  expect(readdirSync(chatFacesDir()).filter((name) => name.endsWith(".partial"))).toEqual([]);
});

test.skipIf(process.platform !== "darwin" || Boolean(process.env.CI))("WebKit draws a real PNG at the size asked for", async () => {
  const path = await chatFacePng('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#a4eec0"/></svg>', 24);
  expect(await new Bun.Image(path).metadata()).toMatchObject({ width: 24, height: 24, format: "png" });
}, 20_000);

test("a failed draw keeps nothing, so the next ask draws again", async () => {
  await expect(chatFacePng("<svg/>", 44, () => Promise.reject(new Error("no window server")))).rejects.toThrow("no window server");
  expect(existsSync(chatFacesDir())).toBe(false);
  await chatFacePng("<svg/>", 44, render);
  expect(drawn).toHaveLength(1);
});
