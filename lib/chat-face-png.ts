/**
 * lib/chat-face-png.ts: a generated face as a PNG on disk.
 *
 * AppKit can't take the SVG: NSImage loads it but draws hair and shading
 * wrong. WebKit draws it as the chat app does, and needs no new dependency.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { chatFacesDir } from "./rt-paths.ts";

const RENDER_TIMEOUT_MS = 15_000;

export type RenderFace = (svg: string, size: number) => Promise<Uint8Array>;

function page(svg: string, size: number): string {
  const html = `<!doctype html><style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;
  return `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
}

async function drawInWebKit(svg: string, size: number): Promise<Uint8Array> {
  await using view = new Bun.WebView({ width: size, height: size });
  await view.navigate(page(svg, size));
  return await view.screenshot({ encoding: "buffer", format: "png" });
}

async function withinTimeout(drawing: Promise<Uint8Array>): Promise<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("WebKit did not finish drawing the face")), RENDER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([drawing, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Keyed on the SVG itself, so a new DiceBear or a changed tile can't serve an old picture. */
export async function chatFacePng(svg: string, size: number, render: RenderFace = drawInWebKit): Promise<string> {
  const digest = createHash("sha256").update(svg).digest("hex").slice(0, 16);
  const path = join(chatFacesDir(), `${digest}-${size}.png`);
  if (existsSync(path)) return path;
  const bytes = await withinTimeout(render(svg, size));
  mkdirSync(chatFacesDir(), { recursive: true });
  const partial = `${path}.${process.pid}.partial`;
  writeFileSync(partial, bytes);
  renameSync(partial, path);
  return path;
}
