/**
 * Seals text to people's roster keys with the bundled `age`, and opens what
 * was sealed to this Mac's. `age` has no associated data, so the binding
 * travels inside the sealed text and `open` compares it.
 *
 * The private key reaches `age` on stdin only, never argv, a file or a log.
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { OpenResult, SealBinding, SealFields, SealResult } from "../../packages/rt-client/src/sealed-text.ts";
import { readOrgRoster } from "../../packages/rt-client/src/settings/active-team.ts";
import { currentOrg } from "../../packages/rt-client/src/settings/stores.ts";
import { findBundledTool } from "../bundled-tool.ts";
import { createRealAgeKeySeam, readAgeKey, readAgePublicKey, type AgeKeySeam } from "../home/age-key.ts";
import { runCapture } from "../subprocess.ts";
import { canonicalHandle } from "./board-peers.ts";
import { isValidAgePublicKey } from "./members.ts";

export type { OpenResult, SealBinding, SealFields, SealResult };

export interface SealedTextDeps {
  ageBin(): string | null;
  ageKey: AgeKeySeam;
  roster(): { username: string; agePublicKey?: unknown }[];
  now(): number;
}

export interface SealedText {
  seal(to: readonly string[], binding: SealBinding, fields: SealFields): Promise<SealResult>;
  open(sealed: string, binding: SealBinding): Promise<OpenResult>;
  /** Whether this Mac's key is one the roster holds for `username`; rejects when the key cannot be read. */
  holdsKeyOf(username: string): Promise<boolean>;
  /** Roster usernames with a usable key, canonical. */
  reachable(): string[];
}

const VERSION = 1;
const AGE_TIMEOUT_MS = 10_000;
const KEY_HELD_MS = 5 * 60_000;
const ARMOR = /^-----BEGIN AGE ENCRYPTED FILE-----\s+([A-Za-z0-9+/=\s]+)-----END AGE ENCRYPTED FILE-----\s*$/;

const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;
const DAMAGED = { ok: false, reason: "damaged" } as const;

function isFields(v: unknown): v is SealFields {
  return v !== null && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
}

function unwrap(plaintext: string, binding: SealBinding): OpenResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return DAMAGED;
  }
  if (parsed === null || typeof parsed !== "object") return DAMAGED;
  const { v, type, from, subject, fields } = parsed as Record<string, unknown>;
  if (v !== VERSION || !isFields(fields)) return DAMAGED;
  if (type !== binding.type || from !== canonicalHandle(binding.from) || subject !== binding.subject) return { ok: false, reason: "mismatch" };
  return { ok: true, fields };
}

export function createSealedText(deps: SealedTextDeps): SealedText {
  let held: { key: string; at: number } | null = null;
  let reading: Promise<string | null> | null = null;

  async function readKey(): Promise<string | null> {
    try {
      const found = await readAgeKey(deps.ageKey);
      if (!("key" in found)) return null;
      held = { key: found.key, at: deps.now() };
      return found.key;
    } catch {
      return null;
    }
  }

  function privateKey(): Promise<string | null> {
    if (held && deps.now() - held.at <= KEY_HELD_MS) return Promise.resolve(held.key);
    held = null;
    reading ??= readKey().finally(() => {
      reading = null;
    });
    return reading;
  }

  function keysByUser(): Map<string, Set<string>> {
    const keys = new Map<string, Set<string>>();
    for (const { username, agePublicKey } of deps.roster()) {
      const handle = canonicalHandle(username);
      if (!handle || typeof agePublicKey !== "string" || !isValidAgePublicKey(agePublicKey)) continue;
      keys.set(handle, (keys.get(handle) ?? new Set()).add(agePublicKey));
    }
    return keys;
  }

  async function decrypt(age: string, key: string, ciphertext: Buffer): Promise<{ ok: true; plaintext: string } | Extract<OpenResult, { ok: false }>> {
    const dir = mkdtempSync(join(tmpdir(), "rt-sealed-"));
    try {
      const file = join(dir, "text");
      writeFileSync(file, ciphertext, { mode: 0o600 });
      const run = await runCapture([age, "-d", "-i", "/dev/stdin", file], { stdin: key, stderr: "pipe", timeoutMs: AGE_TIMEOUT_MS });
      if (run.exitCode === 0) return { ok: true, plaintext: run.stdout };
      if (/no identity matched/.test(run.stderr)) return { ok: false, reason: "not-for-this-key" };
      // age itself exits 1: any other code is a launch or a kill, and a key or file it could not read is this Mac's trouble, not the text's.
      if (run.exitCode !== 1 || /\/dev\/stdin|failed to open input file/.test(run.stderr)) return UNAVAILABLE;
      return DAMAGED;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  return {
    async seal(to, binding, fields) {
      try {
        const age = deps.ageBin();
        if (!age) return UNAVAILABLE;
        const byUser = keysByUser();
        const recipients = new Set<string>();
        const unreachable = new Set<string>();
        for (const handle of to.map(canonicalHandle)) {
          const keys = byUser.get(handle);
          if (keys) for (const key of keys) recipients.add(key);
          else unreachable.add(handle);
        }
        if (recipients.size === 0) return { ok: false, reason: "no-recipients" };
        const { type, subject } = binding;
        const stdin = JSON.stringify({ v: VERSION, type, from: canonicalHandle(binding.from), subject, fields });
        const run = await runCapture([age, "-a", ...[...recipients].flatMap((key) => ["-r", key])], { stdin, timeoutMs: AGE_TIMEOUT_MS });
        const body = run.exitCode === 0 ? ARMOR.exec(run.stdout)?.[1] : undefined;
        if (!body) return UNAVAILABLE;
        return { ok: true, sealed: body.replace(/\s+/g, ""), unreachable: [...unreachable] };
      } catch {
        return UNAVAILABLE;
      }
    },

    async open(sealed, binding) {
      try {
        const age = deps.ageBin();
        if (!age) return UNAVAILABLE;
        const key = await privateKey();
        if (!key) return UNAVAILABLE;
        const opened = await decrypt(age, key, Buffer.from(sealed, "base64"));
        return opened.ok ? unwrap(opened.plaintext, binding) : opened;
      } catch {
        return UNAVAILABLE;
      }
    },

    async holdsKeyOf(username) {
      const mine = await readAgePublicKey(deps.ageKey);
      return mine !== null && (keysByUser().get(canonicalHandle(username))?.has(mine) ?? false);
    },

    reachable() {
      return [...keysByUser().keys()];
    },
  };
}

export function realSealedText(): SealedText {
  return createSealedText({
    ageBin: () => findBundledTool("age"),
    ageKey: createRealAgeKeySeam(),
    roster: () => {
      const org = currentOrg();
      return org === null ? [] : readOrgRoster(org);
    },
    now: () => Date.now(),
  });
}
