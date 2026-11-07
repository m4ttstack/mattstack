/**
 * rt chat's Slack support verbs.
 *
 *   rt chat slack-open <person> --json     hidden: only the mod runs it
 *   rt chat slack-start <person> --brief - [--requester-pane <pane>] --json
 *                                          hidden: only the mod runs it
 *   rt chat slack-assignment --session <id> --json
 *                                          hidden: only the mod runs it
 *   rt chat slack-request <person> --brief - --json
 *                                          hidden: raises the gate an agent's request waits on
 *   rt chat slack-resume <conversation> [--approved] --json
 *                                          hidden: raises the gate a resume waits on;
 *                                          --approved resumes at once, for the operator's own tap
 *   rt chat slack-people --json            hidden: who a chat can open with
 *   rt chat slack-watch --json             hidden: one JSON line per waiting item
 *   rt chat slack-delivered <id>           hidden: confirms an item reached the session
 *   rt chat slack-close [--pane <pane> | --farewell-file <path>]
 *   rt chat slack-status
 */

import { readFileSync } from "fs";
import {
  chatSlackAssignment,
  chatSlackClose,
  chatSlackDelivered,
  chatSlackOpen,
  chatSlackPeople,
  chatSlackPending,
  chatSlackRequest,
  chatSlackResume,
  chatSlackStart,
  chatSlackStatus,
  chatSlackTicket,
} from "../packages/rt-client/src/index.ts";
import { getRepoRoot } from "../lib/git.ts";
import { getRepoIdentityForRoot } from "../lib/repo.ts";
import { currentSessionId, readChatSession } from "../lib/chat-session.ts";
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
const GRACED_POLL_MS = 10_000;
const UNANSWERED_POLLS = 3;
const START_USAGE = "rt chat slack-start <person> --brief - [--requester-pane <pane>] --json";
const REQUEST_USAGE = "rt chat slack-request <person> --brief - --json";
const RESUME_USAGE = "rt chat slack-resume <conversation> [--approved] --json";
const CLOSE_USAGE = "rt chat slack-close [--pane <pane> | --farewell-file <path>]";

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

export interface SlackStartSeams {
  readBrief: () => Promise<string>;
  repo: () => string | null;
}

const START_SEAMS: SlackStartSeams = {
  readBrief: () => new Response(Bun.stdin.stream()).text(),
  repo: () => {
    const root = getRepoRoot();
    return root ? (getRepoIdentityForRoot(root)?.identity ?? null) : null;
  },
};

/**
 * The brief is read from stdin so its length and quoting never pass through a command line.
 * Only a caller with its own signed-in session is recorded as requester: a native app
 * running from the repo folder must not inherit whichever agent is signed in there.
 */
export async function slackStart(args: string[], seams: SlackStartSeams = START_SEAMS): Promise<void> {
  const person = positional(args);
  if (!person) failUsage("Who is the Slack chat with?", START_USAGE);
  if (flagValue(args, "--brief") !== "-") failUsage("--brief - reads the brief from stdin", START_USAGE);
  const brief = (await seams.readBrief()).trim();
  if (!brief) refuseOpen(args, "A Slack chat needs a brief on stdin");
  const repo = seams.repo();
  if (!repo) refuseOpen(args, "A Slack chat starts from inside a repo, and this folder is not in one");
  const session = readChatSession(currentSessionId(args));
  const res = await chatSlackStart(
    {
      person,
      brief,
      repo,
      requesterPane: flagValue(args, "--requester-pane") || undefined,
      requesterSession: session?.sessionId,
      requesterHandle: session?.handle,
    },
    sockOpts(args),
  );
  if (!res.ok || !res.data) refuseOpen(args, res.failure?.message ?? res.error ?? "The Slack chat did not start");
  if (args.includes("--json")) {
    out.json({ ok: true, ...res.data });
    return;
  }
  say(`Slack chat ${res.data.conversation} is starting`);
}

/** A gate id means the operator now has a form to answer; candidates mean the name matched several people. */
export async function slackRequest(args: string[], seams: SlackStartSeams = START_SEAMS): Promise<void> {
  const person = positional(args);
  if (!person) failUsage("Who is the Slack chat with?", REQUEST_USAGE);
  if (flagValue(args, "--brief") !== "-") failUsage("--brief - reads the brief from stdin", REQUEST_USAGE);
  const brief = (await seams.readBrief()).trim();
  if (!brief) refuseOpen(args, "A Slack chat needs a brief on stdin");
  const repo = seams.repo();
  if (!repo) refuseOpen(args, "A Slack chat starts from inside a repo, and this folder is not in one");
  const { handle, sessionId } = await requireSignedIn(args);
  if (!sessionId) refuseOpen(args, "This session has no id to ask on behalf of");
  const res = await chatSlackRequest({ person, brief, requesterSession: sessionId, requesterHandle: handle, repo }, sockOpts(args));
  if (!res.ok || !res.data) refuseOpen(args, res.failure?.message ?? res.error ?? "The Slack chat was not requested");
  if (args.includes("--json")) {
    out.json({ ok: true, ...res.data });
    return;
  }
  if ("candidates" in res.data) {
    say(`More than one person matches ${person}, so run it again with one of these ids`);
    out.print(out.table(res.data.candidates.map((p) => [p.name, p.person, p.title ?? ""]), ["Name", "Id", "Title"]));
    return;
  }
  say(`Slack chat requested, waiting on the operator (gate ${res.data.gateId})`);
}

export async function slackResume(args: string[]): Promise<void> {
  const raw = positional(args);
  if (!raw) failUsage("Which Slack chat?", RESUME_USAGE);
  const conversation = Number(raw);
  if (!Number.isSafeInteger(conversation) || conversation <= 0) failUsage(`"${raw}" is not a Slack chat id`, RESUME_USAGE);
  let payload: Parameters<typeof chatSlackResume>[0] = { conversation, approved: true };
  if (!args.includes("--approved")) {
    const { handle, sessionId } = await requireSignedIn(args);
    payload = { conversation, requesterSession: sessionId, requesterHandle: handle };
  }
  const res = await chatSlackResume(payload, sockOpts(args));
  if (!res.ok || !res.data) refuseOpen(args, res.failure?.message ?? res.error ?? "The Slack chat did not resume");
  if (args.includes("--json")) {
    out.json({ ok: true, ...res.data });
    return;
  }
  say("gateId" in res.data ? `Resume requested, waiting on the operator (gate ${res.data.gateId})` : `Slack chat ${res.data.conversation} resumed`);
}

export async function slackAssignment(args: string[]): Promise<void> {
  const sessionId = currentSessionId(args);
  if (!sessionId) refuseOpen(args, "A Slack assignment needs a session");
  const res = await chatSlackAssignment({ sessionId }, sockOpts(args));
  if (!res.ok || !res.data) refuseOpen(args, res.failure?.message ?? res.error ?? "The Slack assignment could not be read");
  if (args.includes("--json")) {
    out.json({ ok: true, conversation: res.data.conversation });
    return;
  }
  say(res.data.conversation === null ? "No Slack chat is assigned to this session" : `Slack chat ${res.data.conversation} is assigned to this session`);
}

/** Unavailable is an answer the caller reads from the envelope, so under --json it exits zero. */
export async function slackPeople(args: string[]): Promise<void> {
  const res = await chatSlackPeople(sockOpts(args));
  if (!res.ok || !res.data) {
    const error = res.failure?.message ?? res.error ?? "Slack people could not be read";
    if (args.includes("--json")) {
      out.json({ ok: false, reason: "unavailable", error });
      return;
    }
    refuse(out.line("refused", error));
  }
  if (args.includes("--json")) {
    out.json({ ok: true, people: res.data.people });
    return;
  }
  out.print(out.table(res.data.people.map((p) => [p.name, p.person, p.title ?? ""]), ["Name", "Id", "Title"]));
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
  let seenOpen = false;
  let failedPolls = 0;
  do {
    let waitMs = POLL_MS;
    const res = await chatSlackPending({ agentHandle: handle }, sockOpts(args));
    if (res.ok && res.data) {
      const { open, items, conversation, graced } = res.data;
      if (!open || !conversation) {
        // A closed chat inside its grace window can reopen on this very session, so the watcher stays.
        if (!graced) return;
        waitMs = GRACED_POLL_MS;
      } else {
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
      seenOpen = true;
    } else if (!seenOpen && ++failedPolls >= UNANSWERED_POLLS) {
      // The mod starts this in every interactive session, so with no chat to wait
      // for a daemon that can't answer must not leave a process polling. A chat
      // this run has seen waits out a daemon restart.
      refuseOpen(args, "The daemon isn't answering, so there is no Slack chat to watch");
    }
    await deps.sleep(waitMs);
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
  if (pane && file !== undefined) failUsage("--pane can't carry a farewell", CLOSE_USAGE, "Only the session holding the chat can speak to the teammate.");
  const farewell = file === undefined ? undefined : readFarewell(file);
  const own = pane ? undefined : await requireSignedIn(args);
  const data = unwrap(await chatSlackClose({ agentHandle: own?.handle, sessionId: own?.sessionId, pane, farewell }, sockOpts(args)), "close");
  if (args.includes("--json")) {
    out.json({ ok: true, ...data });
    return;
  }
  say(data.closed ? "Slack chat closed" : "Slack chat is closing");
  if (data.redacted) say("redacted: something shaped like a credential was removed before this went to Slack");
}

export async function slackStatus(args: string[]): Promise<void> {
  const caller = await signedInIdentity(args);
  const { conversations } = unwrap(await chatSlackStatus(sockOpts(args), caller ? { agentHandle: caller.handle, sessionId: caller.sessionId } : {}), "status");
  if (args.includes("--json")) {
    out.json({ ok: true, conversations });
    return;
  }
  if (conversations.length === 0) {
    say("No Slack chats are open");
    return;
  }
  const rows = conversations.map((c) => [
    c.displayName,
    c.pane ?? c.assignedPane ?? "",
    `${relativeAgo(c.openedAt)} ago`,
    `${relativeAgo(c.lastActiveAt)} ago`,
    c.assignedSession ?? "",
    c.tickets.map((t) => t.id).join(", "),
  ]);
  out.print(out.table(rows, ["Person", "Pane", "Opened", "Last active", "Session", "Tickets"]));
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

export async function slackTicket(args: string[], readInput: () => Promise<Record<string, unknown>> = readTicketInput): Promise<void> {
  const input = await readInput();
  const { handle, sessionId } = await requireSignedIn(args);
  const res = await chatSlackTicket(
    { agentHandle: handle, sessionId, kind: input.kind, title: input.title, problem: input.problem, idea: input.idea, acceptance: input.acceptance } as Parameters<typeof chatSlackTicket>[0],
    sockOpts(args),
  );
  if (!res.ok || !res.data) refuseOpen(args, res.failure?.message ?? res.error ?? "The ticket was not filed");
  if (args.includes("--json")) {
    out.json({ ok: true, ...res.data });
    return;
  }
  say(`Ticket ${res.data.id} filed: ${res.data.url}`);
}
