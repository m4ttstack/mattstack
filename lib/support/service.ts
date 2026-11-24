/** Support on this Mac: the relay loops, the host's requests and what the handlers need, built once by the daemon. */

import type { Database } from "bun:sqlite";
import { statSync } from "fs";
import { join } from "path";
import type { Logger } from "pino";
import type { GateRow } from "../../packages/rt-client/src/commands.ts";
import { switchboardUrl } from "../../packages/rt-client/src/switchboard.ts";
import { chatViewerUrl, readChatViewerUrlSetting } from "../chat-viewer-url.ts";
import { createSupportHandlers, expireSent } from "../daemon/handlers/support.ts";
import { readSwitchboardToken } from "../daemon/handlers/secrets.ts";
import type { SlackLifecycleDeps } from "../daemon/slack-lifecycle.ts";
import { orgIdContext } from "../linear/org-ids.ts";
import { readSupportApiKey } from "../linear/support-key.ts";
import { machineKey } from "../rt-paths.ts";
import { rtSelfArgv } from "../rt-self.ts";
import { createRealTeamSecretsSeams, teamSecretsFile } from "../secrets/team-store.ts";
import { storedValue } from "../settings/presence.ts";
import { getSetting } from "../settings/resolve.ts";
import { setSetting } from "../settings/write.ts";
import { createRealProbes } from "../setup/probes.ts";
import { rtVersion } from "../setup/update.ts";
import type { SlackClient } from "../slack/client.ts";
import { slackPersona } from "../slack/persona.ts";
import type { SlackOpenDeps } from "../slack/request.ts";
import { supportRepoFromSetting } from "../slack/trigger-offer.ts";
import { getKvValue, setKvValue } from "../state/kv-blob.ts";
import { listRequests, pruneSupport, type SupportRequest } from "../state/support-store.ts";
import { childEnv } from "../subprocess.ts";
import { readBoardSwitchboardToken } from "../team/board-token.ts";
import { canonicalHandle } from "../team/board-peers.ts";
import { readPingVersions } from "../telemetry/ping.ts";
import { createChain } from "./chain.ts";
import { supportConfig, type SupportConfig } from "./config.ts";
import { answerSupportGate, takeRequests, tickRequests, type HostDeps } from "./host.ts";
import { startSupportLoop, type SupportLoopHandle } from "./loop.ts";
import { readSupportKeys, type SupportKeys } from "./org-key.ts";
import { readiness, type ReadinessDeps } from "./readiness.ts";
import { createSupportRelay, type SupportRelay } from "./relay.ts";
import { stopSlackChat } from "./stop.ts";
import { createSupportSync } from "./sync.ts";

const KV_NS = "support";
const PUBLISH_EVERY_MS = 60_000;
const TOKEN_TTL_MS = 5 * 60_000;
const KEY_RETRY_MS = 60_000;
const SETUP_TTL_MS = 5 * 60_000;
const SETUP_TIMEOUT_MS = 45_000;
const CLI_ENTRY = join(import.meta.dir, "..", "..", "cli.ts");
const UNREADY: readonly string[] = ["missing", "invalid", "needs-you", "error"];

export interface SupportServiceOptions {
  db: Database;
  log: Logger;
  slackOpen: SlackOpenDeps;
  slackClient(): Promise<SlackClient | null>;
  stop: SlackLifecycleDeps;
  emitEvent(topic: string, payload?: unknown): unknown;
  gate(id: string): GateRow | null;
  notify(title: string, message: string, url?: string): void;
  /** Real by default; a test passes its own. */
  seams?: Partial<SupportSeams>;
}

export interface SupportSeams {
  now(): number;
  config(): SupportConfig | null;
  keys(cfg: SupportConfig): Promise<SupportKeys | null>;
  relay(): Promise<SupportRelay | null>;
  boardToken(): Promise<string | null>;
  defaultRepo(): string | null;
  setAccepting(on: boolean): void;
  readiness(deps: ReadinessDeps): Promise<string[]>;
  versions(): Promise<{ rt: string; app: string | null; macos: string | null }>;
  unreadySetupRows(): Promise<string[] | null>;
  loops: boolean;
}

export interface SupportService {
  handlers: ReturnType<typeof createSupportHandlers>;
  answerGate(row: GateRow): Promise<void>;
  /** Every few seconds: requests, waiting statuses, and the accepting flag. */
  tick(): Promise<void>;
  prune(): void;
  start(): void;
  stop(): void;
}

/** Re-read only when the org's secrets file changes, or a minute after a failure: each read decrypts it, and can raise a keychain dialog. */
function orgKeys(log: Logger, now: () => number): SupportSeams["keys"] {
  let held: { file: string; stamp: string; at: number; keys: SupportKeys | null } | null = null;
  return async (cfg) => {
    const file = teamSecretsFile(cfg.org, "support");
    let stamp: string;
    try {
      const s = statSync(file);
      stamp = `${s.mtimeMs}:${s.size}`;
    } catch {
      return null;
    }
    if (held?.file === file && held.stamp === stamp && (held.keys || now() - held.at < KEY_RETRY_MS)) return held.keys;
    try {
      const keys = await readSupportKeys(cfg.org, createRealTeamSecretsSeams(cfg.org));
      held = { file, stamp, at: now(), keys };
      return keys;
    } catch (err) {
      if (held?.file !== file || held.stamp !== stamp) log.warn({ err }, "support: the org's key could not be opened");
      held = { file, stamp, at: now(), keys: null };
      return null;
    }
  };
}

/** A null answer is not kept: it is what a person is about to fix. */
function cached<T>(ttlMs: number, now: () => number, read: () => Promise<T>): () => Promise<T> {
  let at = 0;
  let value: Promise<T> | null = null;
  return () => {
    if (value === null || now() - at >= ttlMs) {
      at = now();
      value = read();
      value.then(
        (v) => {
          if (v === null) value = null;
        },
        () => (value = null),
      );
    }
    return value;
  };
}

async function readVersions(): Promise<{ rt: string; app: string | null; macos: string | null }> {
  const p = createRealProbes();
  const macos = await p.exec(["sw_vers", "-productVersion"], { timeoutMs: 10_000 }).catch(() => null);
  const { appVersion } = await readPingVersions(p);
  return { rt: rtVersion(), app: appVersion, macos: macos?.code === 0 && macos.stdout.trim() ? macos.stdout.trim() : null };
}

/** cli.ts named explicitly: the plain self argv here is the daemon's own entry point and would start a competing daemon. */
async function readUnreadyRows(): Promise<string[] | null> {
  const res = await createRealProbes()
    .exec([...rtSelfArgv({ main: CLI_ENTRY }), "setup", "status", "--json"], { timeoutMs: SETUP_TIMEOUT_MS, env: childEnv() as Record<string, string> })
    .catch(() => null);
  try {
    const { groups } = JSON.parse(res?.stdout ?? "") as { groups: { rows: { id: string; status: string }[] }[] };
    return groups.flatMap((g) => g.rows).filter((r) => UNREADY.includes(r.status)).map((r) => r.id);
  } catch {
    return null;
  }
}

/** What the teammate who asked reads on their desk. */
export function statusNotice(r: Pick<SupportRequest, "state" | "reason">, host: string, persona: string): string {
  const direct = `Message ${host} directly.`;
  switch (r.state) {
    case "received":
      return `${host}'s Mac has it and ${persona} is starting`;
    case "opened":
      return `${persona} messaged you in Slack`;
    case "waiting":
      return `${host} needs to OK this one; it will wait`;
    case "already-waiting":
      return "You already have a request waiting";
    case "already-open":
      return `You already have a chat open with ${persona} in Slack`;
    case "declined":
      return `${host} declined this one. ${direct}`;
    case "not-accepting":
      return `${host} is not taking requests now. ${direct}`;
    case "failed":
      return `It did not open${r.reason ? `: ${r.reason}` : ""}. ${direct}`;
    case "expired":
      return `It was never picked up. ${direct}`;
    default:
      return `Asked ${host}'s agent`;
  }
}

export function createSupportService(o: SupportServiceOptions): SupportService {
  const { db, log } = o;
  const now = o.seams?.now ?? Date.now;
  const flag = (key: string) => getKvValue<boolean>(KV_NS, key, false, db);
  const setFlag = (key: string, on: boolean) => setKvValue(KV_NS, key, on, db);
  const readConfig = o.seams?.config ?? (() => supportConfig());
  /** The org a person tapped accept for on this Mac. The setting alone can be written by anything, so it counts only with this. */
  const tappedFor = () => getKvValue<string | null>(KV_NS, "accepted", null, db);
  const setTapped = (orgRemote: string | null) => setKvValue(KV_NS, "accepted", orgRemote, db);
  const config = (): SupportConfig | null => {
    const cfg = readConfig();
    return cfg && cfg.accepts && tappedFor() !== cfg.orgRemote ? { ...cfg, accepts: false, acceptHere: false } : cfg;
  };
  const writeSetting = o.seams?.setAccepting ?? ((on: boolean) => setSetting("support.acceptRequests", on, "machine"));
  const keysFor = o.seams?.keys ?? orgKeys(log, now);
  const keys = async () => {
    const cfg = config();
    return cfg ? keysFor(cfg) : null;
  };
  const boardToken = o.seams?.boardToken ?? cached(TOKEN_TTL_MS, now, () => readBoardSwitchboardToken(createRealProbes(), () => readSwitchboardToken()));
  const relay =
    o.seams?.relay ??
    (async () => {
      const token = await boardToken().catch(() => null);
      return token ? createSupportRelay({ url: switchboardUrl(), token, machine: machineKey() }) : null;
    });
  const defaultRepo = o.seams?.defaultRepo ?? (() => supportRepoFromSetting(getSetting<string | undefined>("chat.slackSupport.defaultRepo").value));
  const unreadySetupRows = o.seams?.unreadySetupRows ?? cached(SETUP_TTL_MS, now, readUnreadyRows);

  const host: HostDeps = {
    ...o.slackOpen,
    now,
    config,
    defaultRepo,
    notifyOpening(r, room) {
      o.notify("Help request", `${r.peer} asked for help, and ${slackPersona().name} is answering`, chatViewerUrl(readChatViewerUrlSetting(), room));
    },
    posted: (room, id) => void o.emitEvent(`chat/${room}/msg`, { id }),
    async dmLink() {
      const client = await o.slackClient();
      if (!client) return null;
      const { teamId, userId } = await client.authTest();
      return teamId && userId ? `slack://user?team=${encodeURIComponent(teamId)}&id=${encodeURIComponent(userId)}` : null;
    },
    gate: o.gate,
    chain: createChain(),
  };

  function noticeStatus(r: SupportRequest): void {
    const name = config()?.roster.find((e) => canonicalHandle(e.username) === r.peer)?.name ?? r.peer;
    o.notify("Help request", statusNotice(r, name, slackPersona().name), r.dmLink ?? undefined);
  }

  const takes = createChain();
  let taking = false;
  /** A page of requests is one pass: each pass reads Slack for every request still waiting on it. */
  function takeSoon(): void {
    if (taking) return;
    taking = true;
    takes
      .run(async () => {
        taking = false;
        await takeRequests(host);
        await sync.flush();
      })
      .catch((err: unknown) => log.warn({ err }, "support: a request could not be taken"));
  }

  const sync = createSupportSync({
    db,
    relay,
    config,
    keys,
    now,
    log,
    onRequest: takeSoon,
    onStatus: noticeStatus,
  });

  const readinessDeps: ReadinessDeps = {
    slackScopes: async () => (await o.slackClient())?.authTest().then((a) => a.scopes) ?? null,
    linearKey: readSupportApiKey,
    defaultRepo,
    repoPath: o.slackOpen.repoPath,
    humanHandle: () => storedValue<string>("chat.humanHandle") ?? "",
    boardToken,
    async relayAnswers() {
      const cfg = config();
      const r = await relay();
      return cfg?.me != null && r !== null && (await r.host(cfg.me)) !== null;
    },
    supportKey: async () => (await keys()) !== null,
    orgIds: orgIdContext,
  };

  let loops: SupportLoopHandle[] = [];

  /** The queue of a Mac that stopped accepting is read until it is empty, so nobody waits on a request no one will take. */
  async function drain(): Promise<void> {
    setFlag("draining", true);
    if (await sync.pull("request", { drain: true })) setFlag("draining", false);
    await takeRequests(host);
    await sync.flush();
  }

  const handlers = createSupportHandlers({
    db,
    log,
    now,
    config,
    keys,
    relay,
    slackUserId: async () => {
      const client = await o.slackClient();
      return client ? (await client.authTest()).userId : null;
    },
    readiness: () => (o.seams?.readiness ?? readiness)(readinessDeps),
    setAccepting(on) {
      writeSetting(on);
      setTapped(on ? (readConfig()?.orgRemote ?? null) : null);
      if (on) setFlag("draining", false);
    },
    published: (on) => setFlag("published", on),
    holdsRole: () => flag("published"),
    drain,
    poke: () => loops.forEach((l) => l.poke()),
    stop: (conversation) => stopSlackChat(conversation, o.stop),
    versions: o.seams?.versions ?? readVersions,
    unreadySetupRows,
  });

  let publishedAt = Number.NEGATIVE_INFINITY;

  /** Claimed again every minute: the relay gives the role to another Mac after 10 minutes of silence, and forgets it with the board. */
  async function publish(): Promise<void> {
    if (now() - publishedAt < PUBLISH_EVERY_MS) return;
    publishedAt = now();
    const raw = readConfig();
    if (!raw || raw.roster.length === 0) return;
    if (!raw.accepts && tappedFor() !== null) setTapped(null);
    const cfg = config();
    if (!cfg || (!cfg.acceptHere && !flag("published"))) return;
    const result = await (await relay())?.setHost(cfg.acceptHere);
    if (!result || result === "failed") return;
    if (!cfg.acceptHere) {
      setFlag("published", false);
      if (result === "ok") setFlag("draining", true);
      return;
    }
    if (result === "ok") return setFlag("published", true);
    // The newest tap wins: kept, this Mac would take the role back the moment the other was turned off.
    setFlag("published", false);
    setTapped(null);
    writeSetting(false);
    o.notify("Help requests", "Another of your Macs answers help requests now, so this one stopped");
  }

  let drainedAt = Number.NEGATIVE_INFINITY;
  async function keepDraining(): Promise<void> {
    if (!flag("draining") || now() - drainedAt < PUBLISH_EVERY_MS) return;
    drainedAt = now();
    await drain();
  }

  function expire(): Promise<void> {
    for (const r of expireSent(db, now())) noticeStatus({ ...r, state: "expired" });
    return Promise.resolve();
  }

  async function tickOnce(): Promise<void> {
    for (const step of [publish, keepDraining, expire, () => tickRequests(host), () => sync.flush()]) {
      try {
        await step();
      } catch (err) {
        log.warn({ err }, "support: a step of the tick failed");
      }
    }
  }
  let ticking: Promise<void> | null = null;

  return {
    handlers,
    answerGate: async (row) => {
      await answerSupportGate(host, row);
      await sync.flush();
    },
    /** One at a time: ticks that queue behind a slow open would each read Slack when it ends. */
    tick() {
      ticking ??= tickOnce().finally(() => (ticking = null));
      return ticking;
    },
    prune: () => pruneSupport(now(), db),
    start() {
      const loop = (kind: "request" | "status", active: () => boolean) => startSupportLoop({ kind, active, relay, pull: () => sync.pull(kind), log });
      loops = [
        loop("request", () => config()?.accepts === true),
        loop("status", () => listRequests("out", ["sent", "received", "waiting"], db).length > 0),
      ];
      for (const l of loops) l.done.catch((err) => log.warn({ err }, "support: a relay loop stopped"));
    },
    stop() {
      for (const l of loops) l.stop();
    },
  };
}
