import { join } from "path";
import { row, type Action, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";
import { FragmentError, isBlankOverridesText, parseFragment, type Fragment } from "../../skills/manifest-merge.ts";
import { findOldSlotKeys, hasDomainRulesBlock, hasRootRulesProp, type OldSlotKey } from "../../skills/old-slots.ts";

export const SKILLS_OVERRIDES_ROW_ID = "skills.overrides";

const BASE = {
  id: SKILLS_OVERRIDES_ROW_ID,
  kind: "tool" as const,
  title: "Skill overrides",
  why: "Old slot keys in your own overrides file stop the mattstack skills from compiling.",
  required: false,
  recheck: "on-change" as const,
};

const DOMAIN_CAVEAT = "A rules prop adds to lower layers where domain replaced them.";

function describeKey(k: OldSlotKey): string {
  const where = k.pipeline ? ` in pipeline ${k.pipeline}` : "";
  if (k.successor) return `${k.key} ${k.slot}${where} becomes ${k.successor}`;
  const target = hasDomainRulesBlock(k.key)
    ? `${k.key}/domain-rules rules or a step's own rules prop, your choice`
    : hasRootRulesProp(k.key)
      ? `${k.key} rules`
      : "a step's own rules prop";
  return `${k.key} ${k.slot}${where} becomes ${target}`;
}

function oldKeysDetail(old: OldSlotKey[]): string {
  const list = `Old slot keys: ${old.map(describeKey).join("; ")}.`;
  return old.some((k) => k.successor === null) ? `${list} ${DOMAIN_CAVEAT}` : list;
}

function unreadableReason(err: unknown): string {
  const reason = err instanceof FragmentError ? err.reason : err instanceof Error ? err.message : String(err);
  return reason.startsWith("is ") ? `it ${reason}` : reason;
}

function steps(first: string): Action {
  return { type: "steps", label: "Show steps…", steps: [first, "Run: rt skills materialize"] };
}

export function skillsOverridesRow(input: { file: string; text: string | null }): Row {
  const { file, text } = input;
  if (text === null) return row({ ...BASE, status: "skipped", detail: "No overrides file" });
  if (isBlankOverridesText(text)) return row({ ...BASE, status: "ready", detail: "No old slot keys" });

  let fragment: Fragment;
  try {
    fragment = parseFragment(text, file);
  } catch (err) {
    return row({
      ...BASE,
      status: "needs-you",
      detail: `Could not read the file: ${unreadableReason(err)}.`,
      action: steps(`Fix the problem above in ${file}`),
    });
  }
  const old = findOldSlotKeys(fragment);
  if (old.length === 0) return row({ ...BASE, status: "ready", detail: "No old slot keys" });
  return row({
    ...BASE,
    status: "needs-you",
    detail: oldKeysDetail(old),
    action: steps(`Edit ${file} as listed`),
  });
}

export function skillsOverridesRowFor(p: Pick<Probes, "home" | "readFile">): Row {
  const file = join(p.home, ".mattstack", "user", "skills", "overrides.jsonc");
  return skillsOverridesRow({ file, text: p.readFile(file) });
}
