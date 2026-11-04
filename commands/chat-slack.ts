/**
 * rt chat's Slack support verbs.
 *
 *   rt chat slack-open <person> --json     hidden: only the mod runs it
 *   rt chat slack-watch --json             hidden: one JSON line per waiting item
 *   rt chat slack-delivered <id>           hidden: confirms an item reached the session
 *   rt chat slack-close [--pane <pane>] [--farewell-file <path>]
 *   rt chat slack-status
 */

import { readFileSync } from "fs";
import {
  chatSlackClose,
  chatSlackDelivered,
  chatSlackOpen,
  chatSlackPending,
  chatSlackStatus,
  chatSlackTicket,
} from "../packages/rt-client/src/index.ts";
import * as out from "../lib/ui/out.ts";
import {
  fail,
  failUsage,
  flagValue,
  parseMessageId,
  positional,
  refuse,
  relativeAgo,
  say,
  signedInIdentity,
  sockOpts,
  unwrap,
  type ChatIdentity,
} from "./chat.ts";

const POLL_MS = 2000;
const CLOSE_USAGE = "rt chat slack-close [--pane <pane>] [--farewell-file <path>]";

/** The mod reads a refusal from the envelope, so under --json it stays on stdout. */
function refuseOpen(args: string[], message: string, next?: string): never {
  if (args.includes("--json")) {
    out.json({ ok: false, error: message });
    process.exit(1);
  }
  refuse(out.line("refused", message), ...(next ? [out.callout("next", out.cmd(next))] : []));
}

async function requireSignedIn(args: string[]): Promise<ChatIdentity> {
  return (await signedInIdentity(args)) ?? refuseOpen(args, "This session isn't signed in to rt chat", "rt chat sign-in");
}

export async function slackOpen(args: string[]): Promise<void> {
  const person = positional(args);
  if (!person) failUsage("Who is the Slack chat with?", "rt chat slack-open <person> --json");
  const { handle, sessionId } = await requireSignedIn(args);
  const res = await chatSlackOpen({ agentHandle: handle, sessionId, person }, sockOpts(args));
  if (!res.ok || !res.data) refuseOpen(args, res.failure?.message ?? res.error ?? "The Slack chat did not open");
  if (args.includes("--json")) {
    out.json({ ok: true, ...res.data });
    return;
  }
  say(`Slack chat open with ${res.data.name}`);
}

export interface SlackWatchDeps {
  parentPid: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** A hard-killed session leaves this running, and a watcher that kept polling would read as a live pane. */
export async function slackWatch(args: string[], deps: SlackWatchDeps): Promise<void> {
  const { handle } = await requireSignedIn(args);
  const parent = deps.parentPid();
  const printed = new Set<number>();
  do {
    const res = await chatSlackPending({ agentHandle: handle }, sockOpts(args));
    if (res.ok && res.data) {
      const { open, items, conversation } = res.data;
      if (!open || !conversation) return;
      for (const item of items) {
        if (printed.has(item.id)) continue;
        printed.add(item.id);
        await out.jsonFlushed({
          kind: item.kind,
          conversation: conversation.id,
          id: item.id,
          handle: conversation.handle,
          name: conversation.name,
          operator: conversation.operator,
          marker: conversation.marker,
          text: item.text,
        });
      }
    }
    await deps.sleep(POLL_MS);
  } while (deps.parentPid() === parent);
}

/** The dispatcher passes its context as a second argument, so the tree can't point at slackWatch itself. */
export function slackWatchVerb(args: string[]): Promise<void> {
  return slackWatch(args, { parentPid: () => process.ppid, sleep: (ms) => Bun.sleep(ms) });
}

export async function slackDelivered(args: string[]): Promise<void> {
  const id = parseMessageId(positional(args), "slack-delivered");
  const data = unwrap(await chatSlackDelivered({ id }, sockOpts(args)), "delivery");
  if (args.includes("--json")) {
    out.json({ ok: true, ...data });
    return;
  }
  say(data.delivered ? `Item ${id} is marked delivered` : `Item ${id} is not in an open Slack chat`);
}

function readFarewell(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    fail({ title: "That farewell file could not be read" });
  }
}

function requiredValue(args: string[], flag: string): string | undefined {
  const value = flagValue(args, flag);
  if (args.includes(flag) && (!value || value.startsWith("--"))) failUsage(`${flag} needs a value`, CLOSE_USAGE);
  return value;
}

export async function slackClose(args: string[]): Promise<void> {
  const pane = requiredValue(args, "--pane");
  const file = requiredValue(args, "--farewell-file");
  const farewell = file === undefined ? undefined : readFarewell(file);
  const agentHandle = pane ? undefined : (await requireSignedIn(args)).handle;
  const data = unwrap(await chatSlackClose({ agentHandle, pane, farewell }, sockOpts(args)), "close");
  if (args.includes("--json")) {
    out.json({ ok: true, ...data });
    return;
  }
  say(data.closed ? "Slack chat closed" : "Slack chat is closing");
}

export async function slackStatus(args: string[]): Promise<void> {
  const { conversations } = unwrap(await chatSlackStatus(sockOpts(args)), "status");
  if (args.includes("--json")) {
    out.json({ ok: true, conversations });
    return;
  }
  if (conversations.length === 0) {
    say("No Slack chats are open");
    return;
  }
  const rows = conversations.map((c) => [c.name, c.pane ?? "", `${relativeAgo(c.openedAt)} ago`, `${relativeAgo(c.lastActiveAt)} ago`]);
  out.print(out.table(rows, ["Person", "Pane", "Opened", "Last active"]));
}

const TICKET_USAGE = "rt chat slack-ticket --json < ticket.json";

async function readTicketInput(): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await new Response(Bun.stdin.stream()).text());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // falls through to the usage failure
  }
  return failUsage("The ticket must be a JSON object on stdin", TICKET_USAGE);
}

export async function slackTicket(args: string[]): Promise<void> {
  const input = await readTicketInput();
  const { handle, sessionId } = await requireSignedIn(args);
  const res = await chatSlackTicket(
    { agentHandle: handle, sessionId, kind: input.kind, title: input.title, problem: input.problem, idea: input.idea, acceptance: input.acceptance } as Parameters<typeof chatSlackTicket>[0],
    sockOpts(args),
  );
  if (!res.ok || !res.data) refuseOpen(args, res.failure?.message ?? res.error ?? "The ticket was not written");
  if (args.includes("--json")) {
    out.json({ ok: true, ...res.data });
    return;
  }
  say(`Ticket written to ${res.data.path}`);
}
