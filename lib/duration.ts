export function parseDuration(s: string): number | null {
  const m = /^(\d+)(ms|s|m|h)?$/.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  const unit = m[2] ?? "s";
  return n * (unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000);
}
