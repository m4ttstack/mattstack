import { describe, expect, test } from "bun:test";
import { NoAgeKeyError, SecretsTimeoutError, SopsDecryptError } from "../../secrets/store.ts";
import { unreadableReason } from "../unreadable-reason.ts";

describe("unreadableReason", () => {
  test("no age key", () => {
    expect(unreadableReason(new NoAgeKeyError())).toBe("this Mac has no age key in its keychain");
  });

  test("a keychain that never answered", () => {
    expect(unreadableReason(new SecretsTimeoutError("security timed out after 30000ms"))).toBe(
      "the keychain didn't answer in time, so it may be locked",
    );
  });

  test("a secrets file encrypted to another key keeps no path or sops output", () => {
    const err = new SopsDecryptError("/Users/acme/.mattstack/user/secrets/board.json", "Error getting data key: 0 successful groups required, got 0\n  no identity matched any of the recipients");
    const reason = unreadableReason(err);
    expect(reason).toBe("the secrets file isn't encrypted to this Mac's key");
    expect(reason).not.toContain("/Users/");
  });

  test("any other sops failure keeps no path or sops output", () => {
    const reason = unreadableReason(new SopsDecryptError("/Users/acme/x.json", "MAC mismatch"));
    expect(reason).toBe("sops couldn't decrypt the secrets file");
  });

  test("anything else", () => {
    expect(unreadableReason(new Error("security find-generic-password: exited 51"))).toBe(
      "the keychain wouldn't hand over the age key",
    );
  });
});
