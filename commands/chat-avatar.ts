/**
 * rt chat avatar: the face the chat app shows for a handle, as a file an app
 * can draw.
 *
 *   rt chat avatar <handle> [--size <px>] [--alongside <handles>] --json
 */

import { chatFacePng, type RenderFace } from "../lib/chat-face-png.ts";
import * as out from "../lib/ui/out.ts";
import { generatedFace } from "../packages/rt-client/src/face-avatar.ts";
import { faceSeed, faceTiles } from "../packages/rt-client/src/face-tiles.ts";
import { chatSlackAvatarFile, chatSlackStatus } from "../packages/rt-client/src/index.ts";
import { fail, failUsage, flagValue, positional, sockOpts } from "./chat.ts";

const USAGE = "rt chat avatar <handle> [--size <px>] [--alongside <handles>] --json";
const DEFAULT_SIZE = 64;
const MIN_SIZE = 8;
const MAX_SIZE = 1024;

function parseSize(args: string[]): number {
  if (!args.includes("--size")) return DEFAULT_SIZE;
  const size = Number(flagValue(args, "--size"));
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    failUsage(`The size must be a whole number from ${MIN_SIZE} to ${MAX_SIZE}`, USAGE);
  }
  return size;
}

function parseAlongside(args: string[]): string[] {
  if (!args.includes("--alongside")) return [];
  const value = flagValue(args, "--alongside");
  if (!value || value.startsWith("--")) failUsage("--alongside needs the handles drawn beside this one", USAGE);
  return value.split(",").filter(Boolean);
}

/** A Slack chat that closed keeps its teammate's picture. */
async function slackPhoto(handle: string, args: string[]): Promise<string | undefined> {
  if (!handle.startsWith("slack.")) return undefined;
  const status = await chatSlackStatus(sockOpts(args));
  if (!status.ok || !status.data) return undefined;
  const chat = [...status.data.conversations, ...status.data.closed].find((c) => c.handle === handle);
  if (!chat?.avatarId) return undefined;
  const picture = await chatSlackAvatarFile({ person: chat.avatarId }, sockOpts(args));
  return picture.ok ? picture.data?.file?.path : undefined;
}

export interface AvatarDeps {
  render?: RenderFace;
}

export async function chatAvatarWith(args: string[], deps: AvatarDeps): Promise<void> {
  const json = args.includes("--json");
  const handle = positional(args);
  if (!handle) failUsage("Whose face do you want?", USAGE);
  const size = parseSize(args);
  const tile = faceTiles([handle, ...parseAlongside(args)]).get(handle)!;

  const photo = await slackPhoto(handle, args);
  const kind = photo ? "slack" : "generated";
  const path = await (photo ??
    chatFacePng(generatedFace(faceSeed(handle), tile).toString(), size, deps.render).catch((err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      if (json) {
        out.json({ ok: false, error });
        process.exit(1);
      }
      fail({ title: "The face could not be drawn", why: error });
    }));

  if (json) {
    out.json({ ok: true, kind, path });
    return;
  }
  out.print(out.kv("Face", photo ? "Slack photo" : "Generated"), out.kv("File", path));
}

/** The dispatcher passes its context as a second argument, so the tree can't point at chatAvatarWith itself. */
export function chatAvatar(args: string[]): Promise<void> {
  return chatAvatarWith(args, {});
}
