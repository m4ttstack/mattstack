import { expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const ALLOWED = [
  /^website\/redirects\//,
  /^scripts\/deploy-rt-cool-redirects\.sh$/,
  /^scripts\/check-rt-cool-redirects\.ts$/,
  /^scripts\/lib\/docs-smoke\.ts$/,
  /^scripts\/__tests__\/docs-smoke\.test\.ts$/,
  /^lib\/__tests__\/no-rt-cool-links\.test\.ts$/,
  // The drift test for the redirect-only rt.cool project's _redirects file.
  /^scripts\/__tests__\/no-rt-cool-redirects-drift\.test\.ts$/,
  // The release skill describes the redirect-only rt-cool project and the smoke 301.
  /^skills\/rt-release\/publish-and-finish\.md$/,
  /^RELEASE_NOTES\.md$/,
  /^docs\/superpowers\//,
  /^plugins\/mattstack\/docs\/pre-release\//,
];

test("nothing outside the redirect tooling links to rt.cool", () => {
  const r = spawnSync("git", ["grep", "-l", "rt\\.cool"], { cwd: ROOT, encoding: "utf8" });
  const hits = r.stdout.split("\n").filter(Boolean).filter((f) => !ALLOWED.some((a) => a.test(f)));
  expect(hits).toEqual([]);
});
