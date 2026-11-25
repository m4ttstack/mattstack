/** Proof that a support message comes from someone in the org: the key is that org's alone, so a relay username, which carries no org or forge, is not trusted by itself. */
import { createHmac, timingSafeEqual } from "crypto";
import type { SealBinding } from "../../packages/rt-client/src/sealed-text.ts";
import type { SupportKind } from "../../packages/rt-client/src/support.ts";
import { canonicalHandle } from "../team/board-peers.ts";

export interface ProofInput {
  kind: SupportKind;
  id: string;
  from: string;
  to: string;
  sentAt: number;
  body: string;
}

export function supportBinding(kind: SupportKind, id: string, from: string): SealBinding {
  return { type: `support-${kind}`, from, subject: id };
}

function digest(key: string, input: ProofInput): Buffer {
  const fields = ["support-v1", input.kind, input.id, canonicalHandle(input.from), canonicalHandle(input.to), input.sentAt, input.body];
  return createHmac("sha256", Buffer.from(key, "base64")).update(JSON.stringify(fields)).digest();
}

export function supportMac(key: string, input: ProofInput): string {
  return digest(key, input).toString("hex");
}

export function verifySupportMac(keys: readonly string[], input: ProofInput, mac: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(mac)) return false;
  const claimed = Buffer.from(mac, "hex");
  return keys.some((key) => timingSafeEqual(digest(key, input), claimed));
}
