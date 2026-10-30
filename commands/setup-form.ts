/**
 * `rt setup form`: the questions setup still needs answered, as the JSON every
 * fast-setup screen draws.
 */
import type { CommandContext } from "../lib/command-tree.ts";
import { UserActionableError } from "../lib/errors.ts";
import { envelope } from "../lib/setup/contract.ts";
import { FORM_SECTIONS, composeForm, type FormRow, type FormRowState, type FormSection } from "../lib/setup/form.ts";
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
}

function realFormDeps(): FormDeps {
  return { probes: createRealProbes(), secrets: realSecretPresence(), json: (v) => out.json(v), exit: process.exit, orgs: listOrgs };
}

const ROW_STATUS: Record<FormRowState, RenderStatus> = { done: "done", busy: "pending", waiting: "pending", todo: "needs-you" };

const USAGE = "rt setup form --section macos|invite|connect|this-mac";

function isSection(value: string | undefined): value is FormSection {
  return FORM_SECTIONS.includes(value as FormSection);
}

export async function setupForm(args: string[], _ctx: CommandContext = {}, deps: FormDeps = realFormDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const p = deps.probes;

  let sections: FormSection[] = [...FORM_SECTIONS];
  const at = args.indexOf("--section");
  if (at >= 0) {
    const value = args[at + 1];
    if (!isSection(value)) {
      const err = new UserActionableError("bad-section", `${value ?? "(none)"} is not a part of setup. Use macos, invite, connect or this-mac`);
      return exitWithUserError(err, json, { json: deps.json, exit: deps.exit, now: () => p.now() }, usageFailure("Pick a part of setup: macos, invite, connect or this-mac", USAGE));
    }
    sections = [value];
  }

  const form = await composeForm(p, { sections, secrets: deps.secrets, orgs: (deps.orgs ?? listOrgs)() });
  if (json) {
    deps.json(envelope(form, p.now()));
    return;
  }
  const rows: FormRow[] = [...(form.sections.macos ?? []), ...(form.sections.invite ?? []), ...(form.sections.connect ?? []), ...(form.sections.thisMac ?? [])];
  out.print(...rows.map((r) => out.line(ROW_STATUS[r.state], r.title, r.detail)));
}
