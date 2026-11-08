const test = require("node:test");
const assert = require("node:assert/strict");
const { extractInviteCode, buildDeepLink, resolveJoinState } = require("./join.js");

// Real invite codes are 77-char Crockford base32 (see rt's invite-crypto.ts
// decodeCode) -- built here rather than hand-typed so the length is exact.
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const VALID_CODE = (CROCKFORD_ALPHABET + CROCKFORD_ALPHABET + CROCKFORD_ALPHABET).slice(0, 77);
const withDashes = (s) => s.match(/.{1,5}/g).join("-");
// A messy-but-valid input: dash-chunked, lowercased, and with the digits
// that Crockford maps back ('0' typed as 'o', '1' typed as 'i') swapped in.
const messy = (s) => withDashes(s.replace(/0/g, "O").replace(/1/g, "I")).toLowerCase();

test("extractInviteCode: reads a present, well-formed code from the fragment", () => {
  assert.equal(extractInviteCode("#" + VALID_CODE), VALID_CODE);
});

test("extractInviteCode: accepts the dash-chunked display form and returns the canonical code", () => {
  assert.equal(extractInviteCode("#" + withDashes(VALID_CODE)), VALID_CODE);
});

test("extractInviteCode: normalizes a messy-but-valid input to the canonical code", () => {
  assert.equal(extractInviteCode("#" + messy(VALID_CODE)), VALID_CODE);
});

test("extractInviteCode: returns null when the fragment is absent", () => {
  assert.equal(extractInviteCode(""), null);
  assert.equal(extractInviteCode("#"), null);
});

test("extractInviteCode: never reads the query string, only the fragment", () => {
  assert.equal(extractInviteCode("?code=" + VALID_CODE), null);
});

test("extractInviteCode: rejects a code of the wrong length as malformed", () => {
  assert.equal(extractInviteCode("#" + VALID_CODE.slice(0, 76)), null);
});

test("extractInviteCode: rejects a code with a character outside the Crockford alphabet", () => {
  const badChar = VALID_CODE.slice(0, 76) + "U";
  assert.equal(extractInviteCode("#" + badChar), null);
});

test("buildDeepLink: builds the mattstack://join/<code> URL", () => {
  assert.equal(buildDeepLink(VALID_CODE), "mattstack://join/" + VALID_CODE);
});

test("resolveJoinState: with a valid code, carries the deep link as the clipboard fallback text", () => {
  const state = resolveJoinState("#" + VALID_CODE);
  assert.equal(state.hasCode, true);
  assert.equal(state.deepLink, "mattstack://join/" + VALID_CODE);
  assert.equal(state.clipboardText, state.deepLink);
});

test("resolveJoinState: with no code, shows no deep link and copies nothing", () => {
  const state = resolveJoinState("");
  assert.equal(state.hasCode, false);
  assert.equal(state.deepLink, null);
  assert.equal(state.clipboardText, null);
});

test("resolveJoinState: a malformed code is treated the same as no code", () => {
  const state = resolveJoinState("#" + VALID_CODE.slice(0, 76));
  assert.equal(state.hasCode, false);
  assert.equal(state.deepLink, null);
  assert.equal(state.clipboardText, null);
});
