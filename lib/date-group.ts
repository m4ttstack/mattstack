/**
 * The date header a dated row sits under (glitter's History list, the
 * worktree restore picker), on the machine's local calendar with weeks
 * starting Monday. A date after now (clock skew) reads "Today".
 */
export function dateGroupLabel(date: Date, now: Date): string {
  const startOfDay = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const sinceMonday = (now.getDay() + 6) % 7;
  if (date >= startOfDay(0)) return "Today";
  if (date >= startOfDay(1)) return "Yesterday";
  if (date >= startOfDay(sinceMonday)) return "Earlier this week";
  if (date >= startOfDay(sinceMonday + 7)) return "Last week";
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}
