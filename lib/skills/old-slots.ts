import type { Fragment } from "./manifest-merge.ts";

export type OldSlotKey = { key: string; slot: string; successor: string | null; pipeline: string | null };

export type OldSlotEngine = {
  /** Old slot -> the new key and prop that replaced it. */
  slots: Record<string, string>;
  /** Slots `replaced-slots` lists that the root block still declares as props, so binding them is not old. */
  kept: string[];
  domainRules: boolean;
  rootRules: boolean;
};

/**
 * The old-to-new mapping as data rather than read from installed engines: it
 * has to work on a Mac whose plugin has not updated yet. old-slots.test.ts
 * keeps it in step with plugins/mattstack/attachments.
 */
export const OLD_SLOT_ENGINES: Record<string, OldSlotEngine> = {
  work: { slots: { tiering: "mattstack:work/sub-agent-tiering tiering" }, kept: [], domainRules: false, rootRules: false },
  "watch-ci": { slots: { forge: "mattstack:watch-ci/forge forge" }, kept: [], domainRules: true, rootRules: false },
  "stage-watch-ci": { slots: { forge: "mattstack:stage-watch-ci/forge forge" }, kept: [], domainRules: true, rootRules: false },
  review: { slots: { criteria: "mattstack:review/criteria criteria", reviewer: "mattstack:review/reviewer reviewer" }, kept: [], domainRules: false, rootRules: false },
  "self-review": { slots: { criteria: "mattstack:self-review/criteria criteria", reviewer: "mattstack:self-review/reviewer reviewer" }, kept: [], domainRules: false, rootRules: false },
  "receive-review": {
    slots: {
      criteria: "mattstack:receive-review/criteria criteria",
      "reply-rules": "mattstack:receive-review/reply-rules reply-rules",
      reviewer: "mattstack:receive-review/reviewer reviewer",
    },
    kept: [],
    domainRules: false,
    rootRules: false,
  },
  shepherdr: { slots: {}, kept: ["tiering", "strategy", "accounts"], domainRules: false, rootRules: true },
  "stage-plan": { slots: {}, kept: [], domainRules: true, rootRules: false },
  "stage-self-review": { slots: {}, kept: [], domainRules: true, rootRules: false },
  "stage-evidence": { slots: {}, kept: [], domainRules: true, rootRules: false },
  "stage-provision": { slots: {}, kept: [], domainRules: true, rootRules: false },
  "stage-ship": { slots: {}, kept: [], domainRules: true, rootRules: false },
  ship: { slots: {}, kept: [], domainRules: true, rootRules: false },
  "stage-gates": { slots: {}, kept: [], domainRules: true, rootRules: false },
};

const PREFIX = "mattstack:";

function engineOf(key: string): string | null {
  if (!key.startsWith(PREFIX) || key.includes("/")) return null;
  return key.slice(PREFIX.length);
}

function tableEntry(key: string): OldSlotEngine | undefined {
  const engine = engineOf(key);
  return engine !== null && Object.hasOwn(OLD_SLOT_ENGINES, engine) ? OLD_SLOT_ENGINES[engine] : undefined;
}

/** Whether `<key>/domain-rules` exists to take over an old `domain` binding on this engine key. */
export function hasDomainRulesBlock(key: string): boolean {
  return tableEntry(key)?.domainRules === true;
}

/** Whether this engine key's root block declares a `rules` prop, the nearest successor to its old `domain`. */
export function hasRootRulesProp(key: string): boolean {
  return tableEntry(key)?.rootRules === true;
}

function oldIn(bindings: Record<string, Record<string, string>> | undefined, pipeline: string | null): OldSlotKey[] {
  const out: OldSlotKey[] = [];
  for (const [key, props] of Object.entries(bindings ?? {})) {
    const engine = engineOf(key);
    if (engine === null) continue;
    const entry = Object.hasOwn(OLD_SLOT_ENGINES, engine) ? OLD_SLOT_ENGINES[engine] : undefined;
    for (const slot of Object.keys(props)) {
      if (slot === "domain") out.push({ key, slot, successor: null, pipeline });
      else if (entry && Object.hasOwn(entry.slots, slot)) out.push({ key, slot, successor: entry.slots[slot]!, pipeline });
    }
  }
  return out;
}

export function findOldSlotKeys(fragment: Fragment): OldSlotKey[] {
  const out = oldIn(fragment.bindings, null);
  for (const [name, value] of Object.entries(fragment.pipelines ?? {})) {
    if (!Array.isArray(value)) out.push(...oldIn(value.bindings, name));
  }
  return out;
}
