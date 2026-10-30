/**
 * `rt setup form`: the questions setup still needs answered, as the JSON every
 * fast-setup screen draws. With no `--section` it also says which screen setup
 * is on, what paused the last run, and which app ready opens. The create
 * section is read only on its own, with `--forge` naming where the repo goes.
 *
 * A read makes two writes, both idempotent. A whole read after a run that
 * ended ok marks setup finished once nothing blocks Finish
 * (`markSetupFinished`), so a leftover fixed by its own action lands on the
 * ready screen without a second bar. A read of the connect section ends and
 * removes a sign-in session older than ten minutes (`readLogin`).
 */
import type { CommandContext } from "../lib/command-tree.ts";
import { UserActionableError } from "../lib/errors.ts";
import { envelope, type Plan } from "../lib/setup/contract.ts";
import { SECTION_READS, composeForm, type CreateChoice, type FormRow, type FormRowState, type FormSection, type PlanMode } from "../lib/setup/form.ts";
import { realSecretPresence } from "../lib/setup/plan.ts";
import { createRealProbes, type Probes } from "../lib/setup/probes.ts";
import { exitWithUserError } from "../lib/setup/user-failure.ts";
import type { SecretPresence } from "../lib/setup/validators/accounts.ts";
import { listOrgs } from "../lib/settings/stores.ts";
import * as out from "../lib/ui/out.ts";
import type { RenderStatus } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

export interface FormDeps {
  probes: Probes;
  secrets: SecretPresence;
  json: (v: unknown) => void;
  exit: (code: number) => never;
  orgs?: () => string[];
  plan?: (mode: PlanMode) => Promise<Plan>;
}

function realFormDeps(): FormDeps {
  return { probes: createRealProbes(), secrets: realSecretPresence(), json: (v) => out.json(v), exit: process.exit, orgs: listOrgs };
}

const ROW_STATUS: Record<FormRowState, RenderStatus> = { done: "done", busy: "pending", waiting: "pending", todo: "needs-you" };

const USAGE = "rt setup form --section macos|invite|restore|connect|this-mac|create";
const CREATE_USAGE = "rt setup form --section create --forge github|gitlab [--host <host>]";

function isSection(value: string | undefined): value is FormSection {
  return SECTION_READS.includes(value as FormSection);
}

function flagValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

export async function setupForm(args: string[], _ctx: CommandContext = {}, deps: FormDeps = realFormDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const p = deps.probes;

  let sections: FormSection[] | undefined;
  const at = args.indexOf("--section");
  if (at >= 0) {
    const value = args[at + 1];
    if (!isSection(value)) {
      const err = new UserActionableError("bad-section", `${value ?? "(none)"} is not a part of setup. Use macos, invite, restore, connect, this-mac or create`);
      return exitWithUserError(err, json, { json: deps.json, exit: deps.exit, now: () => p.now() }, usageFailure("Pick a part of setup: macos, invite, restore, connect, this-mac or create", USAGE));
    }
    sections = [value];
  }

  let create: CreateChoice | undefined;
  if (sections?.includes("create")) {
    const forge = flagValue(args, "--forge");
    if (forge !== "github" && forge !== "gitlab") {
      const err = new UserActionableError("bad-forge", `${forge ?? "(none)"} is not a forge setup can create a team on. Use github or gitlab`);
      return exitWithUserError(err, json, { json: deps.json, exit: deps.exit, now: () => p.now() }, usageFailure("Pick where the team's repo goes: github or gitlab", CREATE_USAGE));
    }
    create = { forge, host: flagValue(args, "--host") ?? null };
  }

  const form = await composeForm(p, { ...(sections ? { sections } : {}), ...(create ? { create } : {}), secrets: deps.secrets, orgs: (deps.orgs ?? listOrgs)(), ...(deps.plan ? { plan: deps.plan } : {}) });
  if (json) {
    deps.json(envelope(form, p.now()));
    return;
  }
  const rows: FormRow[] = [...(form.sections.macos ?? []), ...(form.sections.invite ?? []), ...(form.sections.restore ?? []), ...(form.sections.connect ?? []), ...(form.sections.thisMac ?? []), ...(form.sections.create ?? [])];
  out.print(...rows.map((r) => out.line(ROW_STATUS[r.state], r.title, r.detail)));
}
