import { normalizeRemote, parseIdentity, serializeIdentity } from "../../packages/rt-client/src/settings/identity-codec.ts";

export type UsageKind = "work" | "review" | "respond" | "doctor" | "other";

const GITLAB_MR = /^(https?:\/\/[^/]+\/.+?)\/-\/merge_requests\/(\d+)(?:[/?#]|$)/;
const GITHUB_PR = /^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#]|$)/;

export function mrKeyFromUrl(url: string): string | null {
  const m = GITLAB_MR.exec(url.trim()) ?? GITHUB_PR.exec(url.trim());
  if (!m) return null;
  const id = normalizeRemote(m[1]!);
  if (!id) return null;
  return `${serializeIdentity({ kind: "remote", id })}!${m[2]}`;
}

export function mrKeyFromField(value: string, runRepo: string): string | null {
  const v = value.trim();
  if (v === "" || v === "-") return null;
  const bare = /^!(\d+)$/.exec(v);
  if (bare) return parseIdentity(runRepo) ? `${runRepo}!${bare[1]}` : null;
  return mrKeyFromUrl(v);
}

export function mrKeyFromSubject(subject: string): string | null {
  return subject.startsWith("mr:") ? mrKeyFromUrl(subject.slice(3)) : null;
}

export function kindOf(workType: string): UsageKind {
  switch (workType) {
    case "feature":
    case "work":
      return "work";
    case "review":
      return "review";
    case "receive-review":
      return "respond";
    default:
      return "other";
  }
}
