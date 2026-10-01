import type { CredentialHealthRow } from "./db.ts";

/** What a person reads for a stored check result, in `rt accounts` and in a setup row's detail. */
export const CREDENTIAL_STATUS_WORD: Record<CredentialHealthRow["status"], string> = {
  ready: "working",
  invalid: "rejected",
  error: "not checked",
};
