import { describe, expect, test } from "bun:test";
import { DAEMON_UNREACHABLE_PREFIX } from "../../../packages/rt-client/src/index.ts";
import { err, ok, withLandingHint } from "../shared.ts";

const HINT = "; the write may still land, so check the MR's state before retrying";

describe("withLandingHint", () => {
  test("a timeout gets the hint", () => {
    const raw = `${DAEMON_UNREACHABLE_PREFIX}/x.sock: The operation timed out.`;
    expect(withLandingHint(err(raw), "the MR's state")).toEqual(err(`${raw}${HINT}`));
  });

  test("a connection reset the daemon never answered gets the hint", () => {
    const raw = `${DAEMON_UNREACHABLE_PREFIX}/x.sock: The socket connection was closed unexpectedly.`;
    expect(withLandingHint(err(raw), "the MR's state")).toEqual(err(`${raw}${HINT}`));
  });

  test("an answered refusal passes through unchanged", () => {
    expect(withLandingHint(err("GitLab returned 405 Method Not Allowed: not mergeable"), "the MR's state"))
      .toEqual(err("GitLab returned 405 Method Not Allowed: not mergeable"));
  });

  test("a success passes through unchanged", () => {
    expect(withLandingHint(ok({ merged: true }), "the MR's state")).toEqual(ok({ merged: true }));
  });
});
