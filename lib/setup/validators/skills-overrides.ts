import { join } from "path";
import { row, type Action, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";
import { parseFragment, type Fragment } from "../../skills/manifest-merge.ts";
import { findOldSlotKeys, hasDomainRulesBlock, type OldSlotKey } from "../../skills/old-slots.ts";

export const SKILLS_OVERRIDES_ROW_ID = "skills.overrides";

const BASE = {
  id: SKILLS_OVERRIDES_ROW_ID,
  kind: "tool" as const,
  title: "Skill overrides",
  why: "Old slot keys in your own overrides file stop the mattstack skills from compiling.",
  required: false,
  recheck: "on-change" as const,
};

function describeKey(k: OldSlotKey): string {
  const where = k.pipeline ? ` in pipeline ${k.pipeline}` : "";
  if (k.successor) return `${k.key} ${k.slot}${where} becomes ${k.successor}`;
  const use = hasDomainRulesBlock(k.key) ? `${k.key}/domain-rules rules, or a step's own rules prop` : "a step's own rules prop";
  return `${k.key} ${k.slot}${where}: you decide. Use ${use}. rules adds to lower layers where domain replaced them`;
}

/** FragmentError reads "fragment <reason>: <path>"; the step already names the file. */
function unreadableReason(err: unknown, file: string): string {
  let reason = err instanceof Error ? err.message : String(err);
  if (reason.endsWith(`: ${file}`)) reason = reason.slice(0, -`: ${file}`.length);
  if (reason.startsWith("fragment ")) reason = reason.slice("fragment ".length);
  return reason.startsWith("is ") ? `it ${reason}` : reason;
}

function steps(file: string, how: string): Action {
  return { type: "steps", label: "Show steps…", steps: [`Edit ${file} ${how}`, "Run: rt skills materialize"] };
}

export function skillsOverridesRow(input: { file: string; text: string | null }): Row {
  const { file, text } = input;
  if (text === null) return row({ ...BASE, status: "skipped", detail: "No overrides file" });
  if (text.trim() === "") return row({ ...BASE, status: "ready", detail: "No old slot keys" });

  let fragment: Fragment;
  try {
    fragment = parseFragment(text, file);
  } catch (err) {
    return row({
      ...BASE,
      status: "needs-you",
      detail: `Could not read the file: ${unreadableReason(err, file)}.`,
      action: steps(file, "so it is valid JSONC"),
    });
  }
  const old = findOldSlotKeys(fragment);
  if (old.length === 0) return row({ ...BASE, status: "ready", detail: "No old slot keys" });
  return row({
    ...BASE,
    status: "needs-you",
    detail: `Old slot keys: ${old.map(describeKey).join("; ")}`,
    action: steps(file, "as listed"),
  });
}

export function skillsOverridesRowFor(p: Pick<Probes, "home" | "readFile">): Row {
  const file = join(p.home, ".mattstack", "user", "skills", "overrides.jsonc");
  return skillsOverridesRow({ file, text: p.readFile(file) });
}
