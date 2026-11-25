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
import { createRealAgeKeySeam, readAgeKey, type AgeKeySeam } from "../home/age-key.ts";
import { runCapture, type RunResult } from "../subprocess.ts";
import { warn } from "../ui/warn.ts";
import { canonicalHandle } from "./board-peers.ts";
import { isValidAgePublicKey } from "./members.ts";

export type { OpenResult, SealBinding, SealFields, SealResult };

export interface SealedTextDeps {
  ageBin(): string | null;
  ageKey: AgeKeySeam;
  roster(): { username: string; agePublicKey?: unknown }[];
  now(): number;
  warn?: SealedTextWarn;
}

/** Its context never holds text or a key. */
export type SealedTextWarn = (message: string, context: Record<string, unknown>) => void;

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
const KEY_RETRY_MS = 60_000;
const KEY_RETRY_MAX_MS = 10 * 60_000;
const ARMOR = /^-----BEGIN AGE ENCRYPTED FILE-----\s+([A-Za-z0-9+/=\s]+)-----END AGE ENCRYPTED FILE-----\s*$/;

const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;
const DAMAGED = { ok: false, reason: "damaged" } as const;

function isFields(v: unknown): v is SealFields {
  return v !== null && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
}

/** `age` quotes the ciphertext's own bytes in its errors, escaped so they never start a line: only a line it begins itself is believed. */
function whyNotOpened(stderr: string): Extract<OpenResult, { ok: false }> {
  if (/^age: error: no identity matched any of the recipients/m.test(stderr)) return { ok: false, reason: "not-for-this-key" };
  if (/^age: error: (reading "\/dev\/stdin"|failed to open input file)/m.test(stderr)) return UNAVAILABLE;
  return /^age: error: /m.test(stderr) ? DAMAGED : UNAVAILABLE;
}

/** Each open has a folder of its own, which would make every failure a new cause. */
function withoutTempFolder(text: string): string {
  return text.replace(/rt-sealed-\w+/g, "rt-sealed");
}

function ageFailure(run: RunResult): Record<string, unknown> {
  return { exitCode: run.exitCode, timedOut: run.timedOut === true, stderr: withoutTempFolder(run.stderr.split("\n")[0]!).slice(0, 200) };
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
  let missed: { err: unknown; at: number; wait: number } | null = null;
  let reading: Promise<string | null> | null = null;
  const said = new Map<"key" | "seal" | "open", string>();

  /** Once per cause, until it changes or clears: callers try again for hours. */
  function say(what: "key" | "seal" | "open", message: string, context: Record<string, unknown>): void {
    const cause = JSON.stringify(context);
    if (said.get(what) === cause) return;
    said.set(what, cause);
    deps.warn?.(message, context);
  }

  async function readKey(): Promise<string | null> {
    try {
      const found = await readAgeKey(deps.ageKey);
      if (!("key" in found)) {
        missed = { err: null, at: deps.now(), wait: KEY_RETRY_MS };
        say("key", "this Mac has no key", { absent: true });
        return null;
      }
      missed = null;
      said.delete("key");
      held = { key: found.key, at: deps.now() };
      return found.key;
    } catch (err) {
      missed = { err, at: deps.now(), wait: missed?.err ? Math.min(missed.wait * 2, KEY_RETRY_MAX_MS) : KEY_RETRY_MS };
      say("key", "this Mac's key could not be read", { err: String(err) });
      throw err;
    }
  }

  /** Null when this Mac has no key; rejects when it could not be read. A failed read can raise a dialog and wait on it, so the next waits a minute, then longer each time it fails again. */
  async function privateKey(): Promise<string | null> {
    if (held && deps.now() - held.at <= KEY_HELD_MS) return held.key;
    held = null;
    if (missed && deps.now() - missed.at < missed.wait) {
      if (missed.err) throw missed.err;
      return null;
    }
    reading ??= readKey().finally(() => {
      reading = null;
    });
    return reading;
  }

  function keysByUser(roster = deps.roster()): Map<string, Set<string>> {
    const keys = new Map<string, Set<string>>();
    for (const { username, agePublicKey } of roster) {
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
      const why = whyNotOpened(run.stderr);
      if (why.reason === "unavailable") say("open", "sealed text could not be opened", ageFailure(run));
      return why;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  return {
    async seal(to, binding, fields) {
      try {
        const age = deps.ageBin();
        const roster = deps.roster();
        // A store that cannot be read gives an empty roster, which says nothing about who has a key.
        if (!age || roster.length === 0) {
          say("seal", "text could not be sealed", { age: age !== null, roster: roster.length });
          return UNAVAILABLE;
        }
        const byUser = keysByUser(roster);
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
        const run = await runCapture([age, "-a", ...[...recipients].flatMap((key) => ["-r", key])], { stdin, stderr: "pipe", timeoutMs: AGE_TIMEOUT_MS });
        const body = run.exitCode === 0 ? ARMOR.exec(run.stdout)?.[1] : undefined;
        if (!body) {
          say("seal", "text could not be sealed", ageFailure(run));
          return UNAVAILABLE;
        }
        said.delete("seal");
        return { ok: true, sealed: body.replace(/\s+/g, ""), unreachable: [...unreachable] };
      } catch (err) {
        say("seal", "text could not be sealed", { err: String(err) });
        return UNAVAILABLE;
      }
    },

    async open(sealed, binding) {
      try {
        const age = deps.ageBin();
        if (!age) {
          say("open", "sealed text could not be opened", { age: false });
          return UNAVAILABLE;
        }
        const key = await privateKey().catch(() => null);
        if (!key) return UNAVAILABLE;
        const opened = await decrypt(age, key, Buffer.from(sealed, "base64"));
        if (!opened.ok) return opened;
        said.delete("open");
        return unwrap(opened.plaintext, binding);
      } catch (err) {
        say("open", "sealed text could not be opened", { err: withoutTempFolder(String(err)) });
        return UNAVAILABLE;
      }
    },

    async holdsKeyOf(username) {
      const key = await privateKey();
      if (key === null) return false;
      const derived = await deps.ageKey.run(["age-keygen", "-y"], { input: key, sensitive: true });
      if (derived.code !== 0) throw new Error("age-keygen -y: could not derive this Mac's public key");
      return keysByUser().get(canonicalHandle(username))?.has(derived.stdout.trim()) ?? false;
    },

    reachable() {
      return [...keysByUser().keys()];
    },
  };
}

/** `org` defaults to the one this Mac reads settings from, asked for at each use. */
export function realSealedText(org?: string, log: SealedTextWarn = (message, context) => warn("sealed-text", message, { context })): SealedText {
  return createSealedText({
    ageBin: () => findBundledTool("age"),
    ageKey: createRealAgeKeySeam(),
    roster: () => {
      const from = org ?? currentOrg();
      return from === null ? [] : readOrgRoster(from);
    },
    now: () => Date.now(),
    warn: log,
  });
}
