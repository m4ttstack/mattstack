/**
 * Convert ticket ID and title to slug format per the given format string.
 * Format: lowercase ticketId + "-" + title lowercased, with non-alphanumerics → "-",
 * collapsed, trimmed, and slug capped at 40 chars.
 *
 * Example: slugifyTicketTitle("RT-34", "Ephemeral Worktrees: rule!", "<ticket>-<slug>")
 *   → "rt-34-ephemeral-worktrees-rule"
 */
/** Lowercase, non-alphanumerics -> dash, collapsed, trimmed at both edges. */
function sanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugifyTicketTitle(
  ticketId: string,
  title: string,
  format: string
): string {
  const ticketSlug = sanitize(ticketId);

  // Replace non-alphanumeric characters with dashes
  let titleSlug = sanitize(title);

  // Cap the slug portion at 40 characters BEFORE assembling
  titleSlug = titleSlug.substring(0, 40).replace(/-+$/, ""); // Trim trailing dashes after cap

  // Build the result based on format. replaceAll (not replace): String.replace
  // only substitutes the first occurrence of a repeated placeholder. A
  // function replacer (not a plain string) because $-sequences in a string
  // replacement value are interpreted as patterns by both replace AND
  // replaceAll... a slug containing "$&" would otherwise get mangled.
  const result = format
    .replaceAll("<ticket>", () => ticketSlug)
    .replaceAll("<slug>", () => titleSlug);

  return result;
}

/**
 * Find the first candidate (base, base-2, base-3...) where exists() returns false.
 */
export function disambiguate(base: string, exists: (candidate: string) => boolean): string {
  if (!exists(base)) {
    return base;
  }

  let counter = 2;
  while (true) {
    const candidate = `${base}-${counter}`;
    if (!exists(candidate)) {
      return candidate;
    }
    counter++;
  }
}

/** True when `branch` was created for `ticket` under the branch `format`. */
export function belongsToTicket(branch: string, ticket: string, format: string): boolean {
  const ticketSlug = sanitize(ticket);
  const lower = branch.toLowerCase();
  const slugAt = format.indexOf("<slug>");
  const head = (slugAt === -1 ? format : format.slice(0, slugAt)).replaceAll(
    "<ticket>",
    () => ticketSlug
  );

  if (head.includes(ticketSlug)) {
    const stem = head.replace(/[^a-z0-9]+$/i, "");
    return lower === stem || (lower.startsWith(stem) && !/[a-z0-9]/.test(lower[stem.length] ?? "a"));
  }

  const escaped = ticketSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(lower);
}
