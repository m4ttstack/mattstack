/**
 * rt logins: dev-server logins that browser runs fill on a matching page.
 * Values never travel in argv: a terminal prompts for the email and a masked password, and
 * --json reads {email, password} from stdin.
 */

import { spawnSync } from "child_process";
import type { CommandContext } from "../lib/command-tree.ts";
import { createRealAgeKeySeam } from "../lib/home/age-key.ts";
import { InvalidOriginError, normalizeOrigin } from "../lib/logins/origin.ts";
import {
  CorruptLoginError, InvalidLoginError, listLogins, removeLogin, saveLogin, secretsBackend, type LoginsBackend,
} from "../lib/logins/store.ts";
import { promptSecret, type PromptSecretOptions } from "../lib/prompt-secret.ts";
import { InvalidSecretsSegmentError, NoAgeKeyError, createRealSecretsExecSeam } from "../lib/secrets/store.ts";
import { UserActionableError, logFailureDetail, userErrorPayload } from "../lib/errors.ts";
import { readStdinJson } from "../lib/setup/probes.ts";
import { userFailure } from "../lib/setup/user-failure.ts";
import * as out from "../lib/ui/out.ts";
import type { Segment } from "../lib/ui/protocol.ts";

export interface LoginsDeps {
  backend: () => LoginsBackend;
  readStdin: () => Promise<unknown>;
  promptSecret: (message: string, opts?: PromptSecretOptions) => Promise<string>;
  promptText: (message: string) => Promise<string>;
  openUrl: (url: string) => boolean;
  /** One machine line on stdout. Never human text. */
  json: (value: unknown) => void;
  isTTY: boolean;
}

function realDeps(): LoginsDeps {
  return {
    backend: () => secretsBackend({ ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() }),
    readStdin: () => readStdinJson(),
    promptSecret: (m, opts) => promptSecret(m, undefined, opts),
    promptText: async (m) => {
      const { textInput } = await import("../lib/rt-render.ts");
      return (await textInput({ message: m, stderr: true })).trim();
    },
    openUrl: (u) => spawnSync("open", [u]).status === 0,
    json: (v) => out.json(v),
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

const USAGE_HUMAN: Record<string, { title: string; next: Segment }> = {
  "usage: rt logins add <origin>": { title: "Which site?", next: out.cmd("rt logins add <origin>") },
  "usage: rt logins open-add <origin>": { title: "Which site?", next: out.cmd("rt logins open-add <origin>") },
  "usage: rt logins remove <origin>": { title: "Which site?", next: out.cmd("rt logins remove <origin>") },
};

function fail(json: boolean, d: LoginsDeps, err: unknown): never {
  const user =
    err instanceof UserActionableError ? err
    : err instanceof InvalidOriginError ? new UserActionableError("bad-origin", err.message)
    : err instanceof InvalidLoginError ? new UserActionableError("bad-login", err.message)
    : err instanceof NoAgeKeyError || err instanceof CorruptLoginError || err instanceof InvalidSecretsSegmentError ? new UserActionableError("store", err.message)
    : null;
  if (!user) throw err;
  logFailureDetail(user);
  if (json) d.json(userErrorPayload(user));
  else out.fail(userFailure(user, user.code === "usage" ? USAGE_HUMAN[user.message] : undefined));
  process.exit(2);
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
    if (json) return d.json(rows);
    if (rows.length === 0) return out.print(out.line("pending", "No dev logins saved yet"), out.callout("next", out.cmd("rt logins add <origin>")));
    out.print(out.table(rows.map((r) => [r.origin, r.email])));
  } catch (err) {
    fail(json, d, err);
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
      email = await d.promptText(`Email for ${origin}`);
      password = await d.promptSecret(`Password for ${origin}`, { mask: "*" });
    } else {
      throw new UserActionableError("needs-tty", "no terminal to prompt in; pass --json and pipe {email, password} on stdin");
    }
    const saved = await saveLogin(d.backend(), origin, email, password);
    if (json) d.json({ ok: true, origin: saved.origin, replaced: saved.replaced });
    else out.print(out.line("done", `${saved.replaced ? "Replaced" : "Saved"} the dev login for ${saved.origin}`));
  } catch (err) {
    fail(json, d, err);
  }
}

export async function loginsOpenAdd(args: string[], _ctx: CommandContext = {}, over?: Partial<LoginsDeps>): Promise<void> {
  const d = resolveDeps(over);
  const json = args.includes("--json");
  try {
    const origin = await originArg("open-add", args, json, d);
    const url = devLoginAddUrl(origin);
    if (!d.openUrl(url)) throw new UserActionableError("open-failed", "Could not open mattstack. Is the app installed?");
    if (json) d.json({ ok: true, url });
    else out.print(out.line("done", `Opened mattstack to save a dev login for ${origin}`));
  } catch (err) {
    fail(json, d, err);
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
    if (json) d.json({ ok: true, removed });
    else out.print(removed ? out.line("done", `Deleted the dev login for ${normalizeOrigin(origin).origin}`) : out.line("skipped", "No dev login saved for that site"));
  } catch (err) {
    fail(json, d, err);
  }
}
