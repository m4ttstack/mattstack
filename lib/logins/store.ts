import { listSecretNames, readSecret, removeSecret, writeSecret, type SecretsSeams } from "../secrets/store.ts";
import { normalizeOrigin, placeholderName } from "./origin.ts";

export const DEV_LOGINS_DOMAIN = "dev-logins";

export interface DevLogin { origin: string; email: string; password: string }
export interface DevLoginSummary { origin: string; email: string; fields: { email: string; password: string } }

export interface LoginsBackend {
  read(key: string): Promise<string | null>;
  names(): Promise<string[]>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<boolean>;
}

export class InvalidLoginError extends Error {}
export class CorruptLoginError extends Error {}

export function secretsBackend(seams: SecretsSeams): LoginsBackend {
  return {
    // readSecret indexes a plain object, so a key like "constructor" (a valid
    // single-label host) would otherwise return an inherited built-in.
    read: async (key) => {
      const value = await readSecret(DEV_LOGINS_DOMAIN, key, seams);
      return typeof value === "string" ? value : null;
    },
    names: () => listSecretNames(DEV_LOGINS_DOMAIN, seams),
    write: (key, value) => writeSecret(DEV_LOGINS_DOMAIN, key, value, seams),
    remove: (key) => removeSecret(DEV_LOGINS_DOMAIN, key, seams),
  };
}

function parse(key: string, raw: string): DevLogin {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new CorruptLoginError(`dev login "${key}" is not valid JSON; replace it with rt logins add`);
  }
  const o = v as Partial<DevLogin>;
  if (typeof o.origin !== "string" || typeof o.email !== "string" || typeof o.password !== "string") {
    throw new CorruptLoginError(`dev login "${key}" is missing a field; replace it with rt logins add`);
  }
  let normalizedKey: string;
  try {
    normalizedKey = normalizeOrigin(o.origin).key;
  } catch {
    normalizedKey = "";
  }
  if (normalizedKey !== key) throw new CorruptLoginError(`dev login "${key}" is stored under the wrong site; replace it with rt logins add`);
  return { origin: o.origin, email: o.email, password: o.password };
}

export async function getLogin(b: LoginsBackend, key: string): Promise<DevLogin | null> {
  const raw = await b.read(key);
  return raw === null ? null : parse(key, raw);
}

export async function listLogins(b: LoginsBackend): Promise<DevLoginSummary[]> {
  const out: DevLoginSummary[] = [];
  for (const key of (await b.names()).sort()) {
    const login = await getLogin(b, key);
    if (!login) continue;
    out.push({
      origin: login.origin,
      email: login.email,
      fields: { email: placeholderName(key, "email"), password: placeholderName(key, "password") },
    });
  }
  return out;
}

export async function saveLogin(b: LoginsBackend, originInput: string, email: string, password: string): Promise<{ origin: string; key: string; replaced: boolean }> {
  const { origin, key } = normalizeOrigin(originInput);
  const cleanEmail = email.trim();
  if (!cleanEmail) throw new InvalidLoginError("the email is empty");
  if (!password) throw new InvalidLoginError("the password is empty");
  const replaced = (await b.read(key)) !== null;
  await b.write(key, JSON.stringify({ origin, email: cleanEmail, password }));
  return { origin, key, replaced };
}

export async function removeLogin(b: LoginsBackend, originInput: string): Promise<boolean> {
  return b.remove(normalizeOrigin(originInput).key);
}
