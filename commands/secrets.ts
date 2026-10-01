/**
 * rt secrets — sops-encrypted secrets under ~/.mattstack/user/secrets/, or
 * (with --team) the N-recipient team store under ~/.mattstack/teams/<slug>/.
 *
 *   rt secrets set <domain> <key> [--team <slug>] [--stdin]      write one key
 *   rt secrets list <domain> [--team <slug>]                     list a domain's key names (never values)
 *   rt secrets rotate <domain> <key> [--team <slug>] [--stdin]   replace a value, print the rotation commit message
 *   rt secrets rotate --team <slug>                               re-encrypt every domain file to the team's current recipients (no value to prompt/pipe, so no --stdin)
 *
 * The value is NEVER a CLI arg — that would put it in argv (shell history,
 * `ps`, and rt's own CLI command log). It comes from a no-echo TTY prompt, or
 * from stdin with --stdin (scripting). Every verb delegates to
 * lib/secrets/store.ts (personal) or lib/secrets/team-store.ts (--team);
 * this module only parses args, collects the value, wires the real seams,
 * and reports NoAgeKeyError/InvalidSecretsSegmentError/NoTeamRecipientsError
 * with a clear pointer (mirrors commands/home.ts's AgeKeyAbsentError handling).
 */

import { readdirSync } from "fs";
import { dirname, join } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { createRealAgeKeySeam } from "../lib/home/age-key.ts";
import { promptSecret } from "../lib/prompt-secret.ts";
import { mattstackHome } from "../lib/rt-paths.ts";
import {
  InvalidSecretsSegmentError,
  NoAgeKeyError,
  createRealSecretsExecSeam,
  listSecretNames,
  rotateSecret,
  writeSecret,
  type SecretsSeams,
} from "../lib/secrets/store.ts";
import {
  NoTeamRecipientsError,
  TeamReencryptError,
  createRealTeamSecretsSeams,
  listTeamSecretNames,
  reencryptTeamSecrets,
  teamSecretsFile,
  writeTeamSecret,
} from "../lib/secrets/team-store.ts";
import * as out from "../lib/ui/out.ts";

function createRealSecretsSeams(): SecretsSeams {
  return { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() };
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Strips recognized flags (and --team's value) — anything else stays positional so validation rejects it visibly instead of it silently vanishing. */
function positional(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--stdin") continue;
    if (a === "--team") {
      i++; // also skip the flag's value
      continue;
    }
    result.push(a);
  }
  return result;
}

/** Existing domain filenames (`.json` stripped) in the personal or `--team` secrets dir; [] when the dir is absent. */
function existingDomains(team: string | undefined): string[] {
  const dir = team ? dirname(teamSecretsFile(team, "x")) : join(mattstackHome(), "user", "secrets");
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

function reportSecretsError(err: unknown): never {
  if (
    err instanceof NoAgeKeyError ||
    err instanceof InvalidSecretsSegmentError ||
    err instanceof NoTeamRecipientsError ||
    err instanceof TeamReencryptError
  ) {
    // TeamReencryptError's own message already names the completed vs.
    // remaining files — a half-rotated team must be loudly described here,
    // not collapsed into a bare "it failed" line.
    const [title = err.message, ...rest] = err.message.split("\n");
    out.fail({ title, ...(rest.length > 0 ? { details: rest.join("\n") } : {}) });
    process.exit(1);
  }
  throw err;
}

async function readValueFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function collectValue(message: string, args: string[]): Promise<string> {
  return args.includes("--stdin") ? readValueFromStdin() : promptSecret(message);
}

export async function secretsSet(args: string[], _ctx: CommandContext = {}, seams?: SecretsSeams): Promise<void> {
  const team = flagValue(args, "--team");
  let [domain, key] = positional(args);
  if ((!domain || !key) && process.stdin.isTTY && !process.env.RT_BATCH) {
    const { textInput } = await import("../lib/rt-render.ts");
    if (!domain) {
      const existing = existingDomains(team);
      const hint = existing.length ? ` (existing: ${existing.join(", ")})` : "";
      const picked = (await textInput({ message: `Domain${hint}`, stderr: true })).trim();
      if (!picked) process.exit(0);
      domain = picked;
    }
    if (!key) {
      const picked = (await textInput({ message: `Key for ${domain}`, stderr: true })).trim();
      if (!picked) process.exit(0);
      key = picked;
    }
  }
  if (!domain || !key) {
    out.fail({ title: "Which secret?", next: out.cmd("rt secrets set <domain> <key>") });
    process.exit(1);
  }

  const value = await collectValue(`Value for ${domain}.${key}`, args);

  try {
    if (team) {
      await writeTeamSecret(team, domain, key, value, seams ?? createRealTeamSecretsSeams(team));
    } else {
      await writeSecret(domain, key, value, seams ?? createRealSecretsSeams());
    }
  } catch (err) {
    reportSecretsError(err);
  }
  out.print(out.line("done", "Saved the secret", `${team ? `${team}/` : ""}${domain}.${key}`));
}

export async function secretsList(args: string[], _ctx: CommandContext = {}, seams?: SecretsSeams): Promise<void> {
  const team = flagValue(args, "--team");
  let [domain] = positional(args);
  if (!domain && process.stdin.isTTY && !process.env.RT_BATCH) {
    const domains = existingDomains(team);
    if (domains.length > 0) {
      const { filterableSelect } = await import("../lib/pick-wrappers.ts");
      const picked = await filterableSelect({
        message: "Domain",
        options: domains.map((d) => ({ value: d, label: d })),
        stderr: true,
      });
      if (!picked) process.exit(0);
      domain = picked;
    }
  }
  if (!domain) {
    out.fail({ title: "Which domain?", next: out.cmd("rt secrets list <domain>") });
    process.exit(1);
  }

  let names: string[];
  try {
    names = team
      ? await listTeamSecretNames(team, domain, seams ?? createRealTeamSecretsSeams(team))
      : await listSecretNames(domain, seams ?? createRealSecretsSeams());
  } catch (err) {
    reportSecretsError(err);
  }

  const label = team ? `${team}/${domain}` : domain;
  if (names.length === 0) {
    out.print(out.line("pending", `No secrets in ${label} yet`));
    return;
  }
  out.print(out.section(`Secrets in ${label}`, `${names.length} ${names.length === 1 ? "key" : "keys"}`, out.table(names.map((n) => [n]))));
}

async function rotateTeamAll(team: string, seams?: SecretsSeams): Promise<void> {
  const activeSeams = seams ?? createRealTeamSecretsSeams(team);
  let reencrypted: string[];
  try {
    reencrypted = await reencryptTeamSecrets(team, activeSeams);
  } catch (err) {
    reportSecretsError(err);
  }

  if (reencrypted.length === 0) {
    out.print(out.line("skipped", `No secret files to re-encrypt for team ${team}`));
    return;
  }
  out.print(
    out.line("done", `Re-encrypted ${reencrypted.length} ${reencrypted.length === 1 ? "file" : "files"} for team ${team}`),
    out.verbatim(reencrypted),
    out.callout("note", "Anyone already removed from the team keeps what they decrypted before. Re-encrypting stops future reads only."),
  );
}

export async function secretsRotate(args: string[], _ctx: CommandContext = {}, seams?: SecretsSeams): Promise<void> {
  const team = flagValue(args, "--team");
  let [domain, key] = positional(args);

  if (team && !domain && !key) {
    await rotateTeamAll(team, seams);
    return;
  }

  if ((!domain || !key) && process.stdin.isTTY && !process.env.RT_BATCH) {
    const { filterableSelect } = await import("../lib/pick-wrappers.ts");
    const { textInput } = await import("../lib/rt-render.ts");
    if (!domain) {
      const domains = existingDomains(team);
      if (domains.length > 0) {
        const picked = await filterableSelect({
          message: "Domain",
          options: domains.map((d) => ({ value: d, label: d })),
          stderr: true,
        });
        if (!picked) process.exit(0);
        domain = picked;
      }
    }
    if (domain && !key) {
      const picked = (await textInput({ message: `Key for ${domain}`, stderr: true })).trim();
      if (!picked) process.exit(0);
      key = picked;
    }
  }

  if (!domain || !key) {
    out.fail({
      title: "Which secret?",
      why: "Name a domain and key, or a team alone to re-encrypt every file",
      next: out.cmd("rt secrets rotate <domain> <key>"),
    });
    process.exit(1);
  }

  const value = await collectValue(`New value for ${domain}.${key}`, args);

  if (team) {
    try {
      await writeTeamSecret(team, domain, key, value, seams ?? createRealTeamSecretsSeams(team));
    } catch (err) {
      reportSecretsError(err);
    }
    out.print(out.line("done", "Rotated the secret", `${team}/${domain}.${key}`));
    return;
  }

  let message: string;
  try {
    message = await rotateSecret(domain, key, () => value, seams ?? createRealSecretsSeams());
  } catch (err) {
    reportSecretsError(err);
  }
  out.print(out.line("done", "Rotated the secret", `${domain}.${key}`), out.copy(message, "commit message"));
}
