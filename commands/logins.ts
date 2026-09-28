/**
 * rt logins: dev-server logins that browser runs fill on a matching page.
 * Values never travel in argv: a terminal prompts for both with hidden input, and
 * --json reads {email, password} from stdin.
 */

import { spawnSync } from "child_process";
import type { CommandContext } from "../lib/command-tree.ts";
import { createRealAgeKeySeam } from "../lib/home/age-key.ts";
import { InvalidOriginError, normalizeOrigin } from "../lib/logins/origin.ts";
import {
  CorruptLoginError, InvalidLoginError, listLogins, removeLogin, saveLogin, secretsBackend, type LoginsBackend,
} from "../lib/logins/store.ts";
import { promptSecret } from "../lib/prompt-secret.ts";
import { InvalidSecretsSegmentError, NoAgeKeyError, createRealSecretsExecSeam } from "../lib/secrets/store.ts";
import { UserActionableError, exitUserError } from "../lib/setup/errors.ts";
import { readStdinJson } from "../lib/setup/probes.ts";

export interface LoginsDeps {
  backend: () => LoginsBackend;
  readStdin: () => Promise<unknown>;
  promptSecret: (message: string) => Promise<string>;
  promptText: (message: string) => Promise<string>;
  openUrl: (url: string) => void;
  print: (s: string) => void;
  isTTY: boolean;
}

function realDeps(): LoginsDeps {
  return {
    backend: () => secretsBackend({ ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() }),
    readStdin: () => readStdinJson(),
    promptSecret: (m) => promptSecret(m),
    promptText: async (m) => {
      const { textInput } = await import("../lib/rt-render.ts");
      return (await textInput({ message: m, stderr: true })).trim();
    },
    openUrl: (u) => { spawnSync("open", [u]); },
    print: (s) => console.log(s),
    isTTY: Boolean(process.stdin.isTTY) && !process.env.RT_BATCH,
  };
}

function resolveDeps(over?: Partial<LoginsDeps>): LoginsDeps {
  return { ...realDeps(), ...over };
}

function positionals(args: string[]): string[] {
  return args.filter((a) => !a.startsWith("--"));
}

export function devLoginAddUrl(origin: string): string {
  return `mattstack://dev-logins/add?origin=${encodeURIComponent(origin)}`;
}

function fail(verb: string, json: boolean, d: LoginsDeps, err: unknown): never {
  if (err instanceof UserActionableError) exitUserError(err, json, `logins ${verb}`, d.print);
  if (err instanceof InvalidOriginError) exitUserError(new UserActionableError("bad-origin", err.message), json, `logins ${verb}`, d.print);
  if (err instanceof InvalidLoginError) exitUserError(new UserActionableError("bad-login", err.message), json, `logins ${verb}`, d.print);
  if (err instanceof NoAgeKeyError || err instanceof CorruptLoginError || err instanceof InvalidSecretsSegmentError) {
    exitUserError(new UserActionableError("store", err.message), json, `logins ${verb}`, d.print);
  }
  throw err;
}

async function originArg(verb: string, args: string[], json: boolean, d: LoginsDeps): Promise<string> {
  let [origin] = positionals(args);
  if (!origin && d.isTTY && !json) origin = await d.promptText("Origin (https://login.example.com)");
  if (!origin) throw new UserActionableError("usage", `usage: rt logins ${verb} <origin>`);
  return normalizeOrigin(origin).origin;
}

export async function loginsList(args: string[], _ctx: CommandContext = {}, over?: Partial<LoginsDeps>): Promise<void> {
  const d = resolveDeps(over);
  const json = args.includes("--json");
  try {
    const rows = await listLogins(d.backend());
    if (json) return d.print(JSON.stringify(rows));
    if (rows.length === 0) return d.print("No dev logins saved. Add one with: rt logins add <origin>");
    for (const r of rows) d.print(`${r.origin}  ${r.email}`);
  } catch (err) {
    fail("list", json, d, err);
  }
}

export async function loginsAdd(args: string[], _ctx: CommandContext = {}, over?: Partial<LoginsDeps>): Promise<void> {
  const d = resolveDeps(over);
  const json = args.includes("--json");
  try {
    if (positionals(args).length > 1) {
      throw new UserActionableError("usage", "rt logins add takes the origin only; the email and password are prompted, or read as JSON from stdin with --json");
    }
    const origin = await originArg("add", args, json, d);
    let email: string;
    let password: string;
    if (json) {
      const body = (await d.readStdin()) as { email?: unknown; password?: unknown } | null;
      if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
        throw new UserActionableError("bad-stdin", "--json expects {\"email\": \"...\", \"password\": \"...\"} on stdin");
      }
      email = body.email;
      password = body.password;
    } else if (d.isTTY) {
      email = await d.promptSecret(`Email for ${origin}`);
      password = await d.promptSecret(`Password for ${origin}`);
    } else {
      throw new UserActionableError("needs-tty", "no terminal to prompt in; pass --json and pipe {email, password} on stdin");
    }
    const saved = await saveLogin(d.backend(), origin, email, password);
    d.print(json ? JSON.stringify({ ok: true, origin: saved.origin, replaced: saved.replaced }) : `${saved.replaced ? "Replaced" : "Saved"} the dev login for ${saved.origin}`);
  } catch (err) {
    fail("add", json, d, err);
  }
}

export async function loginsOpenAdd(args: string[], _ctx: CommandContext = {}, over?: Partial<LoginsDeps>): Promise<void> {
  const d = resolveDeps(over);
  const json = args.includes("--json");
  try {
    const origin = await originArg("open-add", args, json, d);
    const url = devLoginAddUrl(origin);
    d.openUrl(url);
    d.print(json ? JSON.stringify({ ok: true, url }) : `Opened mattstack to save a dev login for ${origin}`);
  } catch (err) {
    fail("open-add", json, d, err);
  }
}

export async function loginsRemove(args: string[], _ctx: CommandContext = {}, over?: Partial<LoginsDeps>): Promise<void> {
  const d = resolveDeps(over);
  const json = args.includes("--json");
  try {
    let [origin] = positionals(args);
    if (!origin && d.isTTY && !json) {
      const rows = await listLogins(d.backend());
      if (rows.length > 0) {
        const { filterableSelect } = await import("../lib/pick-wrappers.ts");
        const picked = await filterableSelect({ message: "Dev login to delete", options: rows.map((r) => ({ value: r.origin, label: `${r.origin}  ${r.email}` })), stderr: true });
        if (!picked) return;
        origin = picked;
      }
    }
    if (!origin) throw new UserActionableError("usage", "usage: rt logins remove <origin>");
    const removed = await removeLogin(d.backend(), origin);
    d.print(json ? JSON.stringify({ ok: true, removed }) : removed ? `Deleted the dev login for ${normalizeOrigin(origin).origin}` : "No dev login saved for that site");
  } catch (err) {
    fail("remove", json, d, err);
  }
}
