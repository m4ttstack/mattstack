/**
 * The slice of the Codex app-server protocol Mattstack speaks, checked
 * against the saved schema fixture for CODEX_PROTOCOL_VERSION
 * (`__tests__/fixtures/codex/`). Everything here stays private to `codex/`.
 */

import type { ActiveQuestionHandle } from "../contracts.ts";

/** The release whose generated schema the method and event tables were checked against. */
export const CODEX_PROTOCOL_VERSION = "0.160.0";

export type MethodScope = "discovery" | "create" | "owned";
export type MethodSpec = {
  readonly scope: MethodScope;
  /** The whole method exists only when the connection negotiated experimentalApi. */
  readonly experimental: boolean;
  readonly required: readonly string[];
  readonly fields: readonly string[];
  readonly experimentalFields: readonly string[];
  /** Native fields this connection never sends: they would retarget a thread or loosen its start-time policy. */
  readonly refused: readonly string[];
};

export const CODEX_METHODS: Readonly<Record<string, MethodSpec>> = {
  "thread/loaded/list": {
    scope: "discovery", experimental: false, required: [], fields: ["cursor", "limit"], experimentalFields: [], refused: [],
  },
  "hooks/list": { scope: "discovery", experimental: false, required: [], fields: ["cwds"], experimentalFields: [], refused: [] },
  "config/read": {
    scope: "discovery", experimental: false, required: [], fields: ["cwd", "includeLayers"], experimentalFields: [], refused: [],
  },
  "model/list": {
    scope: "discovery", experimental: false, required: [], fields: ["cursor", "includeHidden", "limit"],
    experimentalFields: [], refused: [],
  },
  "experimentalFeature/list": {
    scope: "discovery", experimental: false, required: [], fields: ["cursor", "limit", "threadId"],
    experimentalFields: [], refused: [],
  },
  "thread/start": {
    scope: "create", experimental: false, required: ["cwd"],
    fields: [
      "allowProviderModelFallback", "approvalPolicy", "approvalsReviewer", "baseInstructions", "config", "cwd",
      "daybreakEnabled", "developerInstructions", "dynamicTools", "environments", "ephemeral", "historyMode", "model",
      "modelProvider", "multiAgentMode", "permissions", "personality", "projectId", "runtimeWorkspaceRoots", "sandbox",
      "selectedCapabilityRoots", "serviceName", "serviceTier", "sessionStartSource", "threadSource",
    ],
    experimentalFields: [
      "allowProviderModelFallback", "daybreakEnabled", "dynamicTools", "environments", "historyMode", "multiAgentMode",
      "permissions", "projectId", "runtimeWorkspaceRoots", "selectedCapabilityRoots",
    ],
    refused: ["experimentalRawEvents", "mockExperimentalField"],
  },
  // A resume reattaches the thread with the settings it was created with; it never re-decides them.
  "thread/resume": {
    scope: "owned", experimental: false, required: ["threadId"],
    fields: ["excludeTurns", "initialTurnsPage", "threadId"],
    experimentalFields: ["initialTurnsPage"],
    refused: [
      "approvalPolicy", "approvalsReviewer", "baseInstructions", "config", "cwd", "developerInstructions", "history",
      "model", "modelProvider", "path", "permissions", "personality", "runtimeWorkspaceRoots", "sandbox", "serviceTier",
    ],
  },
  "thread/read": {
    scope: "owned", experimental: false, required: ["threadId"], fields: ["includeTurns", "threadId"],
    experimentalFields: [], refused: [],
  },
  "thread/unsubscribe": {
    scope: "owned", experimental: false, required: ["threadId"], fields: ["threadId"], experimentalFields: [], refused: [],
  },
  "turn/start": {
    scope: "owned", experimental: false, required: ["input", "threadId"],
    fields: [
      "additionalContext", "clientUserMessageId", "collaborationMode", "disabledPluginIds", "effort", "environments",
      "input", "model", "multiAgentMode", "outputSchema", "personality", "responsesapiClientMetadata", "serviceTier",
      "serviceTierForTurn", "summary", "threadId", "toolOutput", "turnTrigger",
    ],
    experimentalFields: [
      "additionalContext", "collaborationMode", "environments", "multiAgentMode", "responsesapiClientMetadata",
    ],
    refused: [
      "approvalPolicy", "approvalsReviewer", "cwd", "cyberAccessProgram", "permissions", "runtimeWorkspaceRoots",
      "sandboxPolicy",
    ],
  },
  "thread/queue/add": {
    scope: "owned", experimental: true, required: ["clientUserMessageId", "input", "threadId"],
    fields: ["clientUserMessageId", "input", "threadId"],
    experimentalFields: ["clientUserMessageId", "input", "threadId"], refused: [],
  },
  "thread/queue/list": {
    scope: "owned", experimental: true, required: ["threadId"], fields: ["cursor", "limit", "threadId"],
    experimentalFields: ["cursor", "limit", "threadId"], refused: [],
  },
};

/**
 * Methods the saved schema fixture does not carry, with the evidence that
 * 0.160.0 takes them. Only what that evidence sent is allowed: the thread id.
 */
export const CODEX_METHODS_OUTSIDE_FIXTURE: Readonly<Record<string, string>> = {
  "thread/unsubscribe": "sent as { threadId } to 0.160.0 by .harness-spike/hooks-review-01/effective.ts and "
    + "hooks-followup-01/config-probe.ts; docs/superpowers/spikes/2026-10-05-codex-hooks-followup.md: "
    + "\"the final inspection connection unsubscribed\"",
};

export const CODEX_STATUS_ENUMS = {
  thread: ["notLoaded", "idle", "systemError", "active"],
  activeFlag: ["waitingOnApproval", "waitingOnUserInput"],
  turn: ["completed", "interrupted", "failed", "inProgress"],
  hookEvent: [
    "preToolUse", "permissionRequest", "postToolUse", "preCompact", "postCompact", "sessionStart", "sessionEnd",
    "userPromptSubmit", "subagentStart", "subagentStop", "stop", "interrupt",
  ],
  hookRun: ["running", "completed", "failed", "blocked", "stopped"],
} as const;

/** The top-level params each validated event reads; the fixture test checks every one exists natively. */
export const CODEX_EVENT_FIELDS: Readonly<Record<CodexEvent["method"], readonly string[]>> = {
  "thread/started": ["thread"],
  "thread/status/changed": ["threadId", "status"],
  "thread/closed": ["threadId"],
  "thread/queue/changed": ["threadId"],
  "turn/started": ["threadId", "turn"],
  "turn/completed": ["threadId", "turn"],
  "item/started": ["threadId", "turnId", "item"],
  "item/completed": ["threadId", "turnId", "item"],
  "serverRequest/resolved": ["threadId", "requestId"],
  "hook/started": ["threadId", "turnId", "run"],
  "hook/completed": ["threadId", "turnId", "run"],
  "item/tool/requestUserInput": ["threadId", "turnId", "itemId", "isBlocking", "questions"],
};

type Enum<K extends keyof typeof CODEX_STATUS_ENUMS> = (typeof CODEX_STATUS_ENUMS)[K][number];
export type CodexRequestId = string | number;
export type CodexThreadStatus =
  | { type: Exclude<Enum<"thread">, "active"> }
  | { type: "active"; activeFlags: Enum<"activeFlag">[] };
/** Item bodies are omitted: consumers correlate on identity, never on transcript text. */
export type CodexItem =
  | { type: "userMessage"; id: string; clientId: string | null }
  | { type: "agentMessage"; id: string; delivery: "async" | null; questionCount: number }
  | { type: "other"; nativeType: string; id: string };
export type CodexQuestion = {
  id: string; header: string; question: string; isOther: boolean; isSecret: boolean;
  options: { label: string; description: string }[] | null;
};
export type CodexQuestionRequest = {
  method: "item/tool/requestUserInput"; connection: string; threadId: string; turnId: string; itemId: string;
  handle: ActiveQuestionHandle; isBlocking: boolean; questions: CodexQuestion[];
};
type Notification<M extends string, T> = { method: M; connection: string; threadId: string } & T;
export type CodexEvent =
  | CodexQuestionRequest
  | Notification<"thread/started" | "thread/status/changed", { status: CodexThreadStatus }>
  | Notification<"thread/closed" | "thread/queue/changed", {}>
  | Notification<"turn/started" | "turn/completed", { turnId: string; status: Enum<"turn"> }>
  | Notification<"item/started" | "item/completed", { turnId: string; item: CodexItem }>
  | Notification<"serverRequest/resolved", { requestId: CodexRequestId }>
  | Notification<"hook/started" | "hook/completed", {
    turnId: string | null; run: { id: string; eventName: Enum<"hookEvent">; status: Enum<"hookRun"> };
  }>;

export type ParsedEvent =
  | { kind: "event"; event: CodexEvent }
  | { kind: "ignored" }
  | { kind: "malformed"; reason: string };

type Fields = Record<string, unknown>;

export function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRequestId(value: unknown): value is CodexRequestId {
  return typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
}

/** The native thread an inbound message concerns; `thread/started` names it only inside its thread object. */
export function nativeThreadOf(message: Fields): string | undefined {
  const params = message.params;
  if (!isRecord(params)) return undefined;
  if (message.method === "thread/started") {
    return isRecord(params.thread) && typeof params.thread.id === "string" ? params.thread.id : undefined;
  }
  return typeof params.threadId === "string" ? params.threadId : undefined;
}

class Malformed extends Error {}

function text(fields: Fields, key: string): string {
  const value = fields[key];
  if (typeof value !== "string" || value === "") throw new Malformed(`${key} is not a non-empty string`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new Malformed(`${key} is not recognised`);
  return value as T;
}

function record(value: unknown, key: string): Fields {
  if (!isRecord(value)) throw new Malformed(`${key} is not an object`);
  return value;
}

function threadStatus(value: unknown): CodexThreadStatus {
  const status = record(value, "status");
  const type = oneOf(status.type, CODEX_STATUS_ENUMS.thread, "status.type");
  if (type !== "active") return { type };
  if (!Array.isArray(status.activeFlags)) throw new Malformed("status.activeFlags is not a list");
  return { type, activeFlags: status.activeFlags.map((flag) => oneOf(flag, CODEX_STATUS_ENUMS.activeFlag, "activeFlags")) };
}

function item(value: unknown): CodexItem {
  const fields = record(value, "item");
  const type = text(fields, "type");
  const id = text(fields, "id");
  if (type === "userMessage") {
    const clientId = fields.clientId ?? null;
    if (clientId !== null && typeof clientId !== "string") throw new Malformed("item.clientId is not a string");
    return { type, id, clientId };
  }
  if (type === "agentMessage") {
    const delivery = fields.delivery ?? null;
    if (delivery !== null && delivery !== "async") throw new Malformed("item.delivery is not recognised");
    const questions = fields.questions ?? null;
    if (questions !== null && !Array.isArray(questions)) throw new Malformed("item.questions is not a list");
    return { type, id, delivery, questionCount: questions?.length ?? 0 };
  }
  return { type: "other", nativeType: type, id };
}

function question(value: unknown): CodexQuestion {
  const fields = record(value, "question");
  const options = fields.options ?? null;
  if (options !== null && !Array.isArray(options)) throw new Malformed("question.options is not a list");
  if (typeof fields.header !== "string" || typeof fields.question !== "string") throw new Malformed("question is incomplete");
  return {
    id: text(fields, "id"),
    header: fields.header,
    question: fields.question,
    isOther: fields.isOther === true,
    isSecret: fields.isSecret === true,
    options: options?.map((option) => {
      const o = record(option, "option");
      if (typeof o.label !== "string" || typeof o.description !== "string") throw new Malformed("option is incomplete");
      return { label: o.label, description: o.description };
    }) ?? null,
  };
}

function parse(message: Fields, connection: string): CodexEvent | undefined {
  const method = message.method;
  const params = record(message.params, "params");
  const base = { connection };
  switch (method) {
    case "item/tool/requestUserInput": {
      if (!isRequestId(message.id)) throw new Malformed("request id is not a string or integer");
      const threadId = text(params, "threadId");
      const turnId = text(params, "turnId");
      const itemId = text(params, "itemId");
      if (typeof params.isBlocking !== "boolean") throw new Malformed("isBlocking is not a boolean");
      if (!Array.isArray(params.questions) || params.questions.length === 0) throw new Malformed("questions is empty");
      const questions = params.questions.map(question);
      if (new Set(questions.map((q) => q.id)).size !== questions.length) throw new Malformed("question ids repeat");
      return {
        method, ...base, threadId, turnId, itemId, isBlocking: params.isBlocking, questions,
        handle: { connection, requestId: message.id, threadId, turnId, itemId },
      };
    }
    case "thread/started": {
      const thread = record(params.thread, "thread");
      return { method, ...base, threadId: text(thread, "id"), status: threadStatus(thread.status) };
    }
    case "thread/status/changed":
      return { method, ...base, threadId: text(params, "threadId"), status: threadStatus(params.status) };
    case "thread/closed":
    case "thread/queue/changed":
      return { method, ...base, threadId: text(params, "threadId") };
    case "turn/started":
    case "turn/completed": {
      const turn = record(params.turn, "turn");
      return {
        method, ...base, threadId: text(params, "threadId"), turnId: text(turn, "id"),
        status: oneOf(turn.status, CODEX_STATUS_ENUMS.turn, "turn.status"),
      };
    }
    case "item/started":
    case "item/completed":
      return { method, ...base, threadId: text(params, "threadId"), turnId: text(params, "turnId"), item: item(params.item) };
    case "serverRequest/resolved":
      if (!isRequestId(params.requestId)) throw new Malformed("requestId is not a string or integer");
      return { method, ...base, threadId: text(params, "threadId"), requestId: params.requestId };
    case "hook/started":
    case "hook/completed": {
      const run = record(params.run, "run");
      const turnId = params.turnId ?? null;
      if (turnId !== null && typeof turnId !== "string") throw new Malformed("turnId is not a string");
      return {
        method, ...base, threadId: text(params, "threadId"), turnId,
        run: {
          id: text(run, "id"),
          eventName: oneOf(run.eventName, CODEX_STATUS_ENUMS.hookEvent, "run.eventName"),
          status: oneOf(run.status, CODEX_STATUS_ENUMS.hookRun, "run.status"),
        },
      };
    }
    default:
      return undefined;
  }
}

/** Validates one inbound native message; methods outside the union are ignored, never passed through. */
export function parseCodexEvent(message: Fields, connection: string): ParsedEvent {
  try {
    const event = parse(message, connection);
    return event ? { kind: "event", event } : { kind: "ignored" };
  } catch (error) {
    if (error instanceof Malformed) return { kind: "malformed", reason: error.message };
    throw error;
  }
}
