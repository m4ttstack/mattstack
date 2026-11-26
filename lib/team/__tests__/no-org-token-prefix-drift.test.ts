import { expect, test } from "bun:test";

import { ORG_TOKEN_PREFIX as RELAY_PREFIX, ORG_TOKEN_RE } from "../../../apps/board/switchboard/orgs.ts";
import { ORG_TOKEN_PREFIX, isOrgToken } from "../../../packages/rt-client/src/switchboard.ts";

test("rt's ORG_TOKEN_PREFIX matches the relay's", () => {
  expect(ORG_TOKEN_PREFIX).toBe(RELAY_PREFIX);
  for (const sample of [`sbo_${"0f".repeat(32)}`, `sbo_${"A".repeat(64)}`, `sbo_${"a".repeat(63)}`, `sbo_${"a".repeat(65)}`, "a-master-the-operator-picked", "", ` sbo_${"a".repeat(64)}`]) {
    expect(isOrgToken(sample)).toBe(ORG_TOKEN_RE.test(sample));
  }
  expect(isOrgToken(null)).toBe(false);
  expect(isOrgToken(undefined)).toBe(false);
});
