/** `ps` etime (`[[dd-]hh:]mm:ss`) as the largest units that fit. */
export function formatUptime(etime: string): string {
  const trimmed = etime.trim();
  if (!trimmed || trimmed === "unknown") return "?";

  const parts = trimmed.split(/[-:]/);
  if (parts.length === 2) {
    const mins = parseInt(parts[0]!, 10);
    if (mins === 0) return `${parts[1]}s`;
    return `${mins}m`;
  }
  if (parts.length === 3) {
    if (trimmed.includes("-")) return `${parseInt(parts[0]!, 10)}d`;
    const hours = parseInt(parts[0]!, 10);
    const mins = parseInt(parts[1]!, 10);
    if (hours === 0) return `${mins}m`;
    return `${hours}h${mins > 0 ? `${mins}m` : ""}`;
  }
  if (parts.length === 4) return `${parseInt(parts[0]!, 10)}d`;
  return trimmed;
}
