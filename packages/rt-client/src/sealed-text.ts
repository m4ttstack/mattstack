/** Text sealed to its recipients' age keys, so the relay that carries it cannot read it. */

/** What one sealed text belongs to: opened anywhere else, it is refused. */
export interface SealBinding {
  type: string;
  from: string;
  subject: string;
}

export type SealFields = Record<string, string>;

export type SealResult =
  /** `unreachable` names the recipients with no usable key, as canonical usernames. */
  | { ok: true; sealed: string; unreachable: string[] }
  | { ok: false; reason: "no-recipients" | "unavailable" };

export type OpenResult =
  | { ok: true; fields: SealFields }
  /** `unavailable` is the only reason worth retrying. */
  | { ok: false; reason: "unavailable" | "not-for-this-key" | "mismatch" | "damaged" };
