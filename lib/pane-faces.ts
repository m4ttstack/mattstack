/**
 * Chat face PNG paths for the pane attach picker. A face not yet cached is
 * drawn by WebKit (up to 15 s), so the picker waits a short budget and opens
 * with whatever landed; stragglers keep rendering and are cached for next time.
 */
import { chatFacePng } from "./chat-face-png.ts";
import { generatedFace } from "../packages/rt-client/src/face-avatar.ts";
import { faceSeed, ownTile } from "../packages/rt-client/src/face-tiles.ts";

/** The face `rt chat avatar <handle>` draws when nothing is drawn beside it. */
function ownFace(handle: string, size: number): Promise<string> {
  const seed = faceSeed(handle);
  return chatFacePng(generatedFace(seed, ownTile(seed)).toString(), size);
}

export async function resolveFaces(
  handles: string[],
  opts: { budgetMs?: number; size?: number; face?: (handle: string, size: number) => Promise<string> } = {},
): Promise<Map<string, string>> {
  const { budgetMs = 1000, size = 128, face = ownFace } = opts;
  const faces = new Map<string, string>();
  const renders = [...new Set(handles)].map((handle) =>
    face(handle, size).then((path) => { faces.set(handle, path); }, () => {}),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); });
  await Promise.race([Promise.all(renders), budget]);
  clearTimeout(timer);
  return new Map(faces);
}
