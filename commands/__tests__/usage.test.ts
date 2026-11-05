import { expect, test } from "bun:test";
import type { AgentRecord } from "../../lib/state/agents-store.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import type { SweepResult } from "../../lib/usage/sweep.ts";
import { agentLink, sweepBlock } from "../usage.ts";

const result: SweepResult = {
  ran: true,
  files: 3,
  messages: 12,
  skippedLines: 0,
  conflicts: 0,
  durationMs: 40,
};

test("a finished sweep prints one line", () => {
  expect(renderPlain([sweepBlock(result)])).toBe(
    "[ok] Checked 3 transcripts and updated 12 messages\n",
  );
});

test("a sweep that found another one running says so", () => {
  expect(renderPlain([sweepBlock({ ...result, ran: false })])).toBe(
    "[skipped] Another usage sweep is already running\n",
  );
});

test("an agent record maps to a link, with missing fields as null", () => {
  const record: AgentRecord = {
    id: "ag-1",
    repo: "acme/widgets",
    cwd: "/tmp/widgets",
    provider: "claude",
    surface: "herdr",
    sessionId: "s-1",
    subject: "mr:https://github.com/acme/widgets/pull/7",
    createdAt: 1,
  };
  expect(agentLink(record)).toEqual({
    id: "ag-1",
    sessionId: "s-1",
    subject: "mr:https://github.com/acme/widgets/pull/7",
    label: null,
    caller: null,
  });
});
