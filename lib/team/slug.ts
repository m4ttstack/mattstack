import { UserActionableError } from "../errors.ts";

const MAX_LENGTH = 40;

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, "");
  if (!slug) {
    throw new UserActionableError("bad-team-name", `${JSON.stringify(name)} cannot be a team name`, {}, { why: "A team name needs at least one letter or number." });
  }
  return slug;
}
