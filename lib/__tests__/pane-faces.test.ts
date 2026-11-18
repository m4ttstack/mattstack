import { expect, test } from "bun:test";
import { resolveFaces } from "../pane-faces.ts";

test("fast faces all land", async () => {
  const faces = await resolveFaces(["kirk", "ada"], { face: async (h) => `/faces/${h}.png` });
  expect([...faces.entries()].sort()).toEqual([["ada", "/faces/ada.png"], ["kirk", "/faces/kirk.png"]]);
});

test("slow face is left out but keeps rendering", async () => {
  let slow: Promise<string> | undefined;
  const face = (h: string) => {
    if (h !== "fred") return Promise.resolve(`/faces/${h}.png`);
    slow = new Promise<string>((resolve) => setTimeout(() => resolve("/faces/fred.png"), 50));
    return slow;
  };
  const started = Date.now();
  const faces = await resolveFaces(["kirk", "fred"], { budgetMs: 10, face });
  expect(Date.now() - started).toBeLessThan(45);
  expect(faces.get("kirk")).toBe("/faces/kirk.png");
  expect(faces.has("fred")).toBe(false);
  expect(await slow!).toBe("/faces/fred.png");
});

test("a failing face is left out", async () => {
  const faces = await resolveFaces(["nadia", "ada"], {
    face: async (h) => {
      if (h === "nadia") throw new Error("webview gone");
      return `/faces/${h}.png`;
    },
  });
  expect(faces.has("nadia")).toBe(false);
  expect(faces.get("ada")).toBe("/faces/ada.png");
});

test("a face that throws before it starts is left out", async () => {
  const faces = await resolveFaces(["nadia", "ada"], {
    face: (h) => {
      if (h === "nadia") throw new Error("bad seed");
      return Promise.resolve(`/faces/${h}.png`);
    },
  });
  expect(faces.has("nadia")).toBe(false);
  expect(faces.get("ada")).toBe("/faces/ada.png");
});

test("duplicates render once", async () => {
  const calls: string[] = [];
  await resolveFaces(["kirk", "kirk", "ada"], { face: async (h) => { calls.push(h); return `/faces/${h}.png`; } });
  expect(calls.sort()).toEqual(["ada", "kirk"]);
});

test("the size reaches the face renderer", async () => {
  const sizes: number[] = [];
  await resolveFaces(["kirk"], { size: 64, face: async (h, size) => { sizes.push(size); return h; } });
  expect(sizes).toEqual([64]);
});
