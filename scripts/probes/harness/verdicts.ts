import type { CaseResult, QuestionId } from "./evidence";

export function result(
  question: QuestionId,
  verdict: CaseResult["verdict"],
  observations: string[],
  consequence: string
): CaseResult {
  return {
    question,
    verdict,
    observations,
    consequence,
    evidenceRefs: ["events.jsonl"],
  };
}
export function judgeCliAttribution(
  workers: { name: string; threadId: string }[],
  rows: any[]
): CaseResult {
  const calls = workers.map(w => ({
    w,
    row: rows.find(r => r.marker === w.name + "-cli"),
  }));
  if (!workers.length || calls.some(c => !c.row))
    return result(
      "G1",
      "not-run",
      ["missing CLI observation"],
      "Repair the probe and repeat G1"
    );
  const ok = calls.every(c => c.row.env?.CODEX_THREAD_ID === c.w.threadId);
  return result(
    "G1",
    ok ? "proven" : "blocked",
    calls.map(
      c =>
        `${c.w.name}: native id matches=${c.row.env?.CODEX_THREAD_ID === c.w.threadId}; pane hint=${c.row.env?.HERDR_PANE_ID ?? "absent"}`
    ),
    ok
      ? "F4 can bind CLI callers by native thread; pane hints are not identity"
      : "Revise CLI attribution before re-planning F4"
  );
}
function at(obj: any, path: string): unknown {
  return path.split(".").reduce((v, k) => v?.[k], obj);
}
function has(value: unknown, target: string): boolean {
  return (
    value === target ||
    (value !== null &&
      typeof value === "object" &&
      Object.values(value).some(v => has(v, target)))
  );
}
export function judgeMcpAttribution(
  workers: { name: string; threadId: string }[],
  rows: any[],
  verifiedMetaPath?: string
): CaseResult {
  const calls = workers.map(w => ({
    w,
    row: rows.find(r => r.kind === "call" && r.marker === w.name + "-mcp"),
  }));
  if (!workers.length || calls.some(c => !c.row))
    return result(
      "G2",
      "not-run",
      ["missing MCP call"],
      "Repair the probe and repeat G2"
    );
  const viaMeta =
    Boolean(verifiedMetaPath) &&
    calls.every(
      c =>
        at(c.row.meta, verifiedMetaPath!) === c.w.threadId &&
        !workers.some(other => other !== c.w && has(c.row.meta, other.threadId))
    );
  const viaEnv =
    calls.every(
      c =>
        c.row.env?.CODEX_THREAD_ID === c.w.threadId &&
        Number.isInteger(c.row.pid)
    ) && new Set(calls.map(c => c.row.pid)).size === workers.length;
  return result(
    "G2",
    viaMeta || viaEnv ? "proven" : "partial",
    [
      `distinct MCP pids: ${new Set(calls.map(c => c.row.pid)).size}`,
      `host metadata path: ${viaMeta ? verifiedMetaPath : "unproven"}`,
      `per-thread env: ${viaEnv}`,
    ],
    viaMeta
      ? `F4 uses _meta.${verifiedMetaPath}`
      : viaEnv
        ? "F4 binds per-thread MCP processes using CODEX_THREAD_ID"
        : "MCP calls worked without verified caller identity; revise F4"
  );
}
export type QuestionRef = {
  requestId: string | number;
  threadId: string;
  turnId: string;
  itemId: string;
};
export function judgeQuestionRecovery(o: {
  first?: QuestionRef;
  replayed?: QuestionRef;
  completed: boolean;
  answerObserved: boolean;
}): CaseResult {
  if (!o.first)
    return result(
      "G3",
      "not-run",
      ["no initial synchronous request"],
      "Verify question setup"
    );
  const same =
    o.replayed &&
    ["threadId", "turnId", "itemId"].every(
      k =>
        Boolean((o.first as any)[k]) &&
        (o.first as any)[k] === (o.replayed as any)[k]
    );
  const verdict =
    o.replayed && !same
      ? "blocked"
      : same && o.completed && o.answerObserved
        ? "proven"
        : "partial";
  return result(
    "G3",
    verdict,
    [
      `same thread/turn/item: ${Boolean(same)}`,
      `request id changed: ${o.replayed ? o.first.requestId !== o.replayed.requestId : "unobserved"}`,
      `completed: ${o.completed}; answer observed: ${o.answerObserved}`,
    ],
    verdict === "proven"
      ? "M5 correlates by thread/turn/item across connections"
      : "Revise question recovery; response submission alone is insufficient"
  );
}
export function judgeAsyncQuestion(o: {
  async: boolean;
  completed: boolean;
}): CaseResult {
  return result(
    "G4",
    o.async && o.completed ? "proven" : "partial",
    [`native async request: ${o.async}; exact item completion: ${o.completed}`],
    o.async && o.completed
      ? "M5 has a native async path"
      : "Do not enable unattended async gates"
  );
}
export function judgePolicy(o: {
  hooksListed: number;
  toolBlocked: boolean;
  toolRan: boolean;
  stopContinued: boolean;
}): CaseResult {
  const v =
    !o.hooksListed || o.toolRan || !o.toolBlocked
      ? "blocked"
      : o.stopContinued
        ? "proven"
        : "partial";
  return result(
    "G5",
    v,
    [
      `relevant loaded hooks: ${o.hooksListed}`,
      `tool refused: ${o.toolBlocked}; forbidden action ran: ${o.toolRan}`,
      `stop continued: ${o.stopContinued}`,
    ],
    v === "proven"
      ? "M6 can enforce using tested native hooks"
      : "Revise policy enforcement before enabling managed Codex"
  );
}
export function judgeSockets(o: {
  mcp?: boolean;
  restricted: boolean;
}): CaseResult {
  return result(
    "G6",
    o.mcp === undefined
      ? "not-run"
      : o.mcp && o.restricted
        ? "proven"
        : "partial",
    [
      `MCP ping: ${o.mcp ?? "unobserved"}; restricted sandbox verified: ${o.restricted}`,
    ],
    o.mcp && o.restricted
      ? "S4 can route rt through MCP without widening sandbox"
      : "S4 needs a verified socket arrangement"
  );
}
export function judgeDelivery(o: { consumed: boolean }): CaseResult {
  return result(
    "G7",
    "partial",
    [
      `exact consumed client/thread/item: ${o.consumed}`,
      "daemon restart: unobserved; queue/question survival: unobserved",
    ],
    o.consumed
      ? "M1 can report observed consumption; restart remains acceptance work"
      : "M1 reports queued at best; restart remains acceptance work"
  );
}
