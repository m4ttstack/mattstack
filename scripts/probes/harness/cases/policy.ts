import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Inbound } from "../codex-control";
import type { Evidence } from "../evidence";
import { readJsonl } from "../evidence";
import type { Lab } from "../lab";
import { quote } from "../lab";
import { judgePolicy } from "../verdicts";
import { cli, drive, ready } from "./common";

// This historical probe correlates native turn-bound hook summaries with
// recorder timestamps (ms) inside native intervals (seconds),
// then require actual model continuation between the two stop outcomes.
export function stopContinuationObserved(
  rows: any[],
  events: Inbound[],
  threadId: string
): boolean {
  const matches = (row: any, run: any) =>
    row.event === "Stop" &&
    row.payload?.session_id === threadId &&
    Number.isFinite(row.at) &&
    Number.isFinite(run.startedAt) &&
    Number.isFinite(run.completedAt) &&
    Math.floor(row.at / 1000) >= run.startedAt &&
    Math.floor(row.at / 1000) <= run.completedAt;
  for (let i = 0; i < events.length; i++) {
    const blocked = events[i]!;
    const p = blocked.params;
    const run = p?.run;
    if (
      blocked.method !== "hook/completed" ||
      p.threadId !== threadId ||
      !p.turnId ||
      run?.eventName !== "stop" ||
      run.status !== "blocked" ||
      !run.entries?.some((e: any) =>
        e.text?.includes("Harness spike refused this action.")
      )
    )
      continue;
    if (
      !rows.some(
        r =>
          matches(r, run) &&
          r.decision?.exitCode === 2 &&
          r.decision.consumeOnce === true
      )
    )
      continue;
    let continued = false;
    for (let j = i + 1; j < events.length; j++) {
      const e = events[j]!;
      const q = e.params;
      if (q.threadId !== threadId || q.turnId !== p.turnId) continue;
      if (
        e.method === "item/completed" &&
        q.item?.type === "agentMessage" &&
        q.item.text?.trim() === "CONTINUED"
      )
        continued = true;
      if (e.method !== "hook/completed" || q.run?.eventName !== "stop")
        continue;
      if (
        !continued ||
        q.run.status !== "completed" ||
        q.run.sourcePath !== run.sourcePath ||
        q.run.displayOrder !== run.displayOrder
      )
        break;
      if (!rows.some(r => matches(r, q.run) && r.decision?.exitCode === 0))
        break;
      return events
        .slice(j + 1)
        .some(
          last =>
            last.method === "turn/completed" &&
            last.params.threadId === threadId &&
            last.params.turn?.id === p.turnId &&
            last.params.turn.status === "completed"
        );
    }
  }
  return false;
}

export async function run(lab: Lab, ev: Evidence) {
  const log = join(lab.runDir, "hooks.jsonl");
  const pre = join(lab.runDir, "pre.json");
  const stop = join(lab.runDir, "stop.json");
  writeFileSync(pre, "{}");
  writeFileSync(stop, "{}");
  const hook = (event: string, file: string) =>
    [
      Bun.which("bun") ?? "bun",
      join(lab.repo, "scripts/probes/harness/probe-hook.ts"),
      log,
      event,
      file,
    ]
      .map(quote)
      .join(" ");
  const overrides: Record<string, unknown> = { "features.hooks": true };
  for (const [event, file] of [
    ["PreToolUse", pre],
    ["Stop", stop],
    ["SessionStart", pre],
  ])
    overrides[`hooks.${event}`] = [
      { hooks: [{ type: "command", command: hook(event!, file!) }] },
    ];
  const w = await lab.launchWorker("p1", overrides);
  const c = await lab.connect();
  try {
    await ready(c, w);
    const inventory = await c.call("hooks/list", { cwds: [w.cwd] });
    const hooks = (inventory.data ?? [])
      .flatMap((e: any) => e.hooks ?? [])
      .filter((h: any) => h.command?.includes("probe-hook.ts"));
    ev.record("G5-inventory", {
      hooks,
      errors: (inventory.data ?? []).flatMap((e: any) => e.errors ?? []),
    });
    const listed = hooks.filter(
      (h: any) =>
        h.enabled &&
        ["preToolUse", "stop"].includes(h.eventName) &&
        ["trusted", "managed"].includes(h.trustStatus)
    ).length;
    const file = join(lab.runDir, "policy-cli.jsonl");
    await drive(
      c,
      w,
      `Run exactly: ${cli(lab)} record ${quote(file)} allowed. Reply DONE.`
    );
    const shell = readJsonl(log).find(r => r.event === "PreToolUse")?.payload
      ?.tool_name;
    let toolBlocked = false;
    let toolRan = false;
    let stopContinued = false;
    if (shell) {
      writeFileSync(pre, JSON.stringify({ block: [shell] }));
      const n = readJsonl(log).length;
      await drive(
        c,
        w,
        `Run exactly: ${cli(lab)} record ${quote(file)} forbidden. If refused, reply REFUSED and do not retry.`
      );
      toolBlocked = readJsonl(log)
        .slice(n)
        .some(r => r.event === "PreToolUse" && r.decision.exitCode === 2);
      toolRan = readJsonl(file).some(r => r.marker === "forbidden");
      writeFileSync(pre, "{}");
      writeFileSync(stop, JSON.stringify({ blockOnce: true }));
      const before = readJsonl(log).length;
      const stopEvents = await drive(c, w, "Reply DONE.");
      const stops = readJsonl(log)
        .slice(before)
        .filter(r => r.event === "Stop");
      stopContinued = stopContinuationObserved(stops, stopEvents, w.threadId);
      ev.record("G5-stop-native", stopEvents);
    }
    ev.record("G5-hook-rows", readJsonl(log));
    return [
      judgePolicy({ hooksListed: listed, toolBlocked, toolRan, stopContinued }),
    ];
  } finally {
    c.close();
    writeFileSync(pre, "{}");
    writeFileSync(stop, "{}");
  }
}
