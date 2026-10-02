import { test, expect } from "bun:test";
import { UserActionableError } from "../../errors.ts";
import type { Probes } from "../../setup/probes.ts";
import { decodeCode } from "../invite-crypto.ts";
import { MembersKeyError, MembersSyncAbortedError } from "../members.ts";
import { scrub } from "../redact.ts";
import { createRelayClient } from "../relay-client.ts";
import { slugify } from "../slug.ts";

async function caught(fn: () => unknown): Promise<UserActionableError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof UserActionableError) return err;
    throw err;
  }
  throw new Error("expected a UserActionableError");
}

const words = (err: UserActionableError) => ({ code: err.code, message: err.message, why: err.why, next: err.next, log: err.log });
const relay = (status: number) => createRelayClient((async () => ({ status, body: "" })) as unknown as Probes["fetch"], "https://relay.example.test");
const ID = "0".repeat(32);

test("a team name with no letter or number", async () => {
  expect(words(await caught(() => slugify("!!!")))).toEqual({
    code: "bad-team-name",
    message: '"!!!" cannot be a team name',
    why: "A team name needs at least one letter or number.",
    next: undefined,
    log: undefined,
  });
});

test("an invite code of the wrong length", async () => {
  expect(words(await caught(() => decodeCode("ABC")))).toEqual({
    code: "invite-malformed",
    message: "That invite code is the wrong length",
    why: "Check that you pasted all of it.",
    next: undefined,
    log: undefined,
  });
});

test("the invite service out of reach, and answering with an error", async () => {
  expect(words(await caught(() => relay(0).fetch(ID)))).toEqual({
    code: "relay-unreachable",
    message: "rt could not reach the invite service",
    why: "Check your network, then try again.",
    next: undefined,
    log: undefined,
  });
  expect(words(await caught(() => relay(500).fetch(ID)))).toEqual({
    code: "relay-error",
    message: "The invite service answered with an error",
    why: undefined,
    next: undefined,
    log: `500 /v1/invites/${ID}`,
  });
});

test("an id that is not one rt made never reaches the service", async () => {
  expect(words(await caught(() => relay(200).fetch("not-an-id")))).toEqual({
    code: "relay-error",
    message: "rt could not read that invite",
    why: undefined,
    next: undefined,
    log: "invite id must be a 32-character hex id",
  });
});

test("no reworded string carries a long dash", async () => {
  const dash = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);
  for (const err of [await caught(() => slugify("!!!")), await caught(() => decodeCode("ABC")), await caught(() => relay(0).fetch(ID))]) {
    expect(`${err.message} ${err.why ?? ""}`).not.toMatch(dash);
  }
});

test("every detail bound for the log has secret keys and the token scrubbed out", () => {
  const key = `AGE-SECRET-KEY-1${"Q".repeat(58)}`;
  expect(scrub(`sops rejected tok-1 and ${key}`, "tok-1")).toBe("sops rejected <token> and AGE-SECRET-KEY-1<redacted>");
  expect(new MembersSyncAbortedError(["age1aaa"], ["carol"], `sops failed on ${key}`).detail).toBe("added age1aaa; pending carol; sops failed on AGE-SECRET-KEY-1<redacted>");
  expect(new MembersKeyError("rt could not read this Mac's secrets key", `age-keygen -y: bad input ${key}`).detail).toBe("age-keygen -y: bad input AGE-SECRET-KEY-1<redacted>");
});
