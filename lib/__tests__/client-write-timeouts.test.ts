import { describe, expect, test } from "bun:test";
import { GITLAB_WRITE_RATE_LIMIT_DEADLINE_S } from "@mattstack/glance";
import { DISCUSSIONS_TIMEOUT_MS, MR_ACTION_TIMEOUT_MS } from "../daemon-client.ts";
import { MR_WRITE_TIMEOUT_MS } from "../mcp/shared.ts";
import { RT_VERB_TIMEOUT_MS } from "../mcp/rt-verb.ts";

/**
 * glance waits out a GitLab 429 on a write for up to its write deadline
 * before sending again. A client that gives up first leaves the daemon still
 * writing, and the caller's retry posts the write twice.
 */
describe("client timeouts on a daemon write outlast glance's rate-limit wait", () => {
  const deadlineMs = GITLAB_WRITE_RATE_LIMIT_DEADLINE_S * 1000;
  const headroomMs = 20_000;

  test.each([
    ["MR_WRITE_TIMEOUT_MS", MR_WRITE_TIMEOUT_MS],
    ["MR_ACTION_TIMEOUT_MS", MR_ACTION_TIMEOUT_MS],
    ["DISCUSSIONS_TIMEOUT_MS", DISCUSSIONS_TIMEOUT_MS],
    ["RT_VERB_TIMEOUT_MS", RT_VERB_TIMEOUT_MS],
  ])("%s leaves room for the wait and the write itself", (_name, timeoutMs) => {
    expect(timeoutMs).toBeGreaterThanOrEqual(deadlineMs + headroomMs);
  });
});
