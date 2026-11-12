/**
 * Whether a stored GitLab token may go to `host`. A host that merely looks
 * like GitLab, named by a repo's origin or a team's settings, is no evidence
 * it IS the person's GitLab: only gitlab.com, whose identity cannot be
 * spoofed, or the host the person confirmed through
 * `rt setup gitlab connect --host` (`rt.integrations.forgeHost`) qualifies.
 * Connecting GitHub can record github.com as that confirmed host, so
 * github.com is refused outright. rt's own copy of this gate is
 * `mayOfferGitLabToken` in lib/team/forge-token.ts; the two change together.
 */
export function mayOfferGitLabTokenToHost(host: string | null | undefined, confirmedHost: unknown): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  if (h === "github.com") return false;
  if (h === "gitlab.com") return true;
  return typeof confirmedHost === "string" && confirmedHost !== "" && h === confirmedHost.toLowerCase();
}
