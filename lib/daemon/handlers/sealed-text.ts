/**
 * text:seal and text:open: how the apps, which hold no keys, seal text for
 * teammates and open what was sealed to this Mac. Socket only.
 */
import type { SealBinding, SealFields } from "../../../packages/rt-client/src/sealed-text.ts";
import type { SealedText } from "../../team/sealed-text.ts";
import type { CommandResult } from "./types.ts";

const MAX_NAMES = 200;
const MAX_FIELD_BYTES = 16 * 1024;
const MAX_SEALED_LENGTH = 256 * 1024;

function refuse(message: string) {
  return { ok: false as const, error: `text: ${message}`, failure: { code: "text-invalid", message } };
}

function isBinding(v: unknown): v is SealBinding {
  const { type, from, subject } = (v ?? {}) as Record<string, unknown>;
  return typeof type === "string" && typeof from === "string" && typeof subject === "string";
}

function isFields(v: unknown): v is SealFields {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v).every((text) => typeof text === "string" && Buffer.byteLength(text) <= MAX_FIELD_BYTES);
}

export function createSealedTextHandlers(deps: { sealedText: SealedText }): {
  "text:seal": (payload: unknown) => Promise<CommandResult<"text:seal">>;
  "text:open": (payload: unknown) => Promise<CommandResult<"text:open">>;
} {
  return {
    "text:seal": async (payload) => {
      const { to, binding, fields } = (payload ?? {}) as Record<string, unknown>;
      if (!Array.isArray(to) || to.length > MAX_NAMES || !to.every((n): n is string => typeof n === "string")) return refuse(`Name up to ${MAX_NAMES} people.`);
      if (!isBinding(binding)) return refuse("Say which message the text belongs to.");
      if (!isFields(fields)) return refuse(`Each field is text of up to ${MAX_FIELD_BYTES} bytes.`);
      return { ok: true, data: await deps.sealedText.seal(to, binding, fields) };
    },

    "text:open": async (payload) => {
      const { sealed, binding } = (payload ?? {}) as Record<string, unknown>;
      if (typeof sealed !== "string" || sealed.length > MAX_SEALED_LENGTH) return refuse("That is not sealed text.");
      if (!isBinding(binding)) return refuse("Say which message the text belongs to.");
      return { ok: true, data: await deps.sealedText.open(sealed, binding) };
    },
  };
}
