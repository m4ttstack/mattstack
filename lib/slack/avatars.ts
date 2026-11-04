/**
 * lib/slack/avatars.ts: Slack profile pictures, read once and kept on disk so
 * the apps serve them without reaching Slack. The directory refreshes hourly;
 * a picture is fetched the first time someone needs it, and again only when
 * Slack gives that person a new URL.
 */

import { createHash } from "crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import type { Logger } from "pino";
import { slackAvatarsDir } from "../rt-paths.ts";
import type { SlackClient } from "./client.ts";

const DIRECTORY_FRESH_MS = 60 * 60_000;
const RETRY_MS = 5 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_PICTURE_BYTES = 2 * 1024 * 1024;
const SLACK_USER_ID = /^[UW][A-Z0-9]+$/;
/** Gravatar's default picture redirects through wp.com. */
const PICTURE_HOSTS = ["slack-edge.com", "slack.com", "gravatar.com", "wp.com"];
/** The apps serve these from their own origin, so SVG, which can carry script, stays out. */
const PICTURE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export interface SlackPerson {
  id: string;
  displayName: string;
  realName: string;
  /** Changes with the picture, so an app's URL can be cached for good. */
  version: string;
}

export interface SlackPicture {
  path: string;
  contentType: string;
}

export interface SlackAvatars {
  /** Never waits on Slack: a person read for the first time shows up on a later call. */
  version(userId: string): string | undefined;
  /** Everyone with a picture, after any read in progress. */
  people(): Promise<SlackPerson[]>;
  picture(userId: string): Promise<SlackPicture | null>;
}

function pictureVersion(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function allowedHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && PICTURE_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function createSlackAvatars(opts: {
  client: () => Promise<SlackClient | null>;
  log: Pick<Logger, "warn">;
  now: () => number;
  fetchImpl?: typeof fetch;
  dir?: () => string;
}): SlackAvatars {
  const fetchPicture = opts.fetchImpl ?? fetch;
  const dir = opts.dir ?? slackAvatarsDir;
  let people: SlackPerson[] = [];
  let urls = new Map<string, string>();
  let dueAt = 0;
  let reading: Promise<void> | undefined;
  const downloads = new Map<string, Promise<SlackPicture | null>>();
  const failedUntil = new Map<string, number>();

  function refresh(): Promise<void> {
    if (reading) return reading;
    if (opts.now() < dueAt) return Promise.resolve();
    dueAt = opts.now() + RETRY_MS;
    reading = opts
      .client()
      .then((client) => client?.listUsers())
      .then((users) => {
        if (!users) return;
        const shown = users.filter((u) => u.avatar && !u.deleted && !u.isBot);
        urls = new Map(shown.map((u) => [u.id, u.avatar!]));
        people = shown.map(({ id, displayName, realName, avatar }) => ({ id, displayName, realName, version: pictureVersion(avatar!) }));
        dueAt = opts.now() + DIRECTORY_FRESH_MS;
      })
      .catch((err) => opts.log.warn({ err }, "slack: the people directory could not be read"))
      .finally(() => {
        reading = undefined;
      });
    return reading;
  }

  async function onDisk(prefix: string): Promise<string | undefined> {
    const names = await readdir(dir()).catch(() => [] as string[]);
    return names.find((n) => n.startsWith(prefix));
  }

  async function download(userId: string, url: string, prefix: string): Promise<SlackPicture | null> {
    const res = await fetchPicture(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    const extension = PICTURE_TYPES[contentType];
    if (!res.ok || !extension || !allowedHost(res.url || url)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_PICTURE_BYTES) return null;
    await mkdir(dir(), { recursive: true });
    const path = join(dir(), `${prefix}${extension}`);
    const partial = `${path}.${process.pid}.partial`;
    await writeFile(partial, bytes);
    await rename(partial, path);
    const names = await readdir(dir());
    await Promise.all(names.filter((n) => n.startsWith(`${userId}-`) && !n.startsWith(prefix)).map((n) => rm(join(dir(), n), { force: true })));
    return { path, contentType };
  }

  async function picture(userId: string, url: string): Promise<SlackPicture | null> {
    const prefix = `${userId}-${pictureVersion(url)}.`;
    const kept = await onDisk(prefix);
    if (kept) {
      const contentType = Object.entries(PICTURE_TYPES).find(([, ext]) => ext === kept.slice(prefix.length))?.[0];
      if (contentType && (await stat(join(dir(), kept)).catch(() => null))) return { path: join(dir(), kept), contentType };
    }
    if (opts.now() < (failedUntil.get(userId) ?? 0)) return null;
    const found = await download(userId, url, prefix).catch((err) => {
      opts.log.warn({ err }, "slack: a profile picture could not be read");
      return null;
    });
    if (found) failedUntil.delete(userId);
    else failedUntil.set(userId, opts.now() + RETRY_MS);
    return found;
  }

  return {
    version(userId) {
      void refresh();
      const url = urls.get(userId);
      return url ? pictureVersion(url) : undefined;
    },
    async people() {
      await refresh();
      return people;
    },
    async picture(userId) {
      if (!SLACK_USER_ID.test(userId)) return null;
      await refresh();
      const url = urls.get(userId);
      if (!url || !allowedHost(url)) return null;
      const running = downloads.get(userId);
      if (running) return running;
      const started = picture(userId, url).finally(() => downloads.delete(userId));
      downloads.set(userId, started);
      return started;
    },
  };
}
