import { NoAgeKeyError, SecretsTimeoutError, SopsDecryptError, sopsKeyMismatch } from "../secrets/store.ts";

/**
 * Why a saved token could not be read, in words a person can act on. The raw
 * error (sops stderr, the secrets file's path) goes to the log only, never to
 * a stored detail that `rt accounts` prints.
 */
export function unreadableReason(err: unknown): string {
  if (err instanceof NoAgeKeyError) return "this Mac has no age key in its keychain";
  if (err instanceof SecretsTimeoutError) return "the keychain didn't answer in time, so it may be locked";
  if (err instanceof SopsDecryptError) {
    return sopsKeyMismatch(err.stderr) ? "the secrets file isn't encrypted to this Mac's key" : "sops couldn't decrypt the secrets file";
  }
  return "the keychain wouldn't hand over the age key";
}
