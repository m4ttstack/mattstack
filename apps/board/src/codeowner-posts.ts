import { channelFromCodeownerSection } from '@mattstack/glance';

export interface OwnerRule {
  section: string;
  approved: boolean;
}

export type OwnerSkipReason =
  'approved' | 'no-channel' | 'already-posted' | 'channel-unavailable';

export interface OwnerSkip {
  section: string;
  reason: OwnerSkipReason;
  channel?: string;
  permalink?: string;
}

export interface OwnersPostPlan {
  channels: Array<{ channel: string; sections: string[] }>;
  skipped: OwnerSkip[];
}

/** The Code Owner rules in GitLab's REST `approval_state` body. */
export function ownerRulesFromApprovalState(body: unknown): OwnerRule[] {
  const rules = (body as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(rules)) return [];
  const out: OwnerRule[] = [];
  for (const rule of rules as Array<Record<string, unknown>>) {
    if (rule?.rule_type !== 'code_owner') continue;
    if (typeof rule.section !== 'string' || !rule.section) continue;
    out.push({ section: rule.section, approved: rule.approved === true });
  }
  return out;
}

/**
 * Which channels an MR's review request goes to, and why every other section
 * is left out. GitLab emits one rule per owned path, so a section counts as
 * approved only when all of its rules are. `available` is the channels Slack
 * lists for the posting user; omit it to skip that check.
 */
export function planOwnersPost(
  rules: OwnerRule[],
  opts: { posted: Record<string, string>; available?: Set<string> }
): OwnersPostPlan {
  const approvedBySection = new Map<string, boolean>();
  for (const rule of rules) {
    approvedBySection.set(
      rule.section,
      (approvedBySection.get(rule.section) ?? true) && rule.approved
    );
  }
  const byChannel = new Map<string, string[]>();
  const skipped: OwnerSkip[] = [];
  for (const [section, approved] of approvedBySection) {
    const channel = channelFromCodeownerSection(section);
    if (!channel) {
      skipped.push({ section, reason: 'no-channel' });
    } else if (approved) {
      skipped.push({ section, reason: 'approved', channel });
    } else if (opts.posted[channel]) {
      skipped.push({
        section,
        reason: 'already-posted',
        channel,
        permalink: opts.posted[channel],
      });
    } else if (opts.available && !opts.available.has(channel)) {
      skipped.push({ section, reason: 'channel-unavailable', channel });
    } else {
      byChannel.set(channel, [...(byChannel.get(channel) ?? []), section]);
    }
  }
  return {
    channels: [...byChannel].map(([channel, sections]) => ({
      channel,
      sections,
    })),
    skipped,
  };
}
