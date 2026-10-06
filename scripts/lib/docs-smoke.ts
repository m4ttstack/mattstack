import { DOCS_HOST } from "./docs-moves.ts";

export type SmokeCheck = { url: string; status: number; location?: string };

export const SMOKE_CHECKS: SmokeCheck[] = [
  { url: `${DOCS_HOST}/`, status: 200 },
  { url: `${DOCS_HOST}/rt/reference/cd`, status: 200 },
  { url: `${DOCS_HOST}/gitq`, status: 200 },
  { url: "https://rt.cool/reference/cd", status: 301, location: `${DOCS_HOST}/rt/reference/cd` },
];

export function evaluate(check: SmokeCheck, got: { status: number; location: string | null }): string | null {
  if (got.status !== check.status) return `${check.url}: expected ${check.status}, got ${got.status}`;
  if (check.location && got.location !== check.location) {
    return `${check.url}: redirects to ${got.location}, expected ${check.location}`;
  }
  return null;
}
