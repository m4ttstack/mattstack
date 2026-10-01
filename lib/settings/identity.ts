// RT-50: repo identity normalization/derivation moved to @mattstack/rt-client.
// Every existing rt importer of lib/settings/identity.ts keeps working
// unchanged through this re-export barrel; the implementation lives at the
// path below.
export * from "../../packages/rt-client/src/settings/identity.ts";

/**
 * Flattens a raw identity id (host/path, or an absolute path) into one
 * dash-joined segment: "gitlab.com/acme/acme-dev" -> "gitlab.com-acme-acme-dev".
 * The bindings materializer names `~/.mattstack/repos/<slug>/` with the same
 * derivation, so the two must stay byte-for-byte in sync, or every caller
 * here silently stops matching the real directories and row ids.
 */
export function repoIdentitySlug(rawId: string): string {
  return rawId.replace(/\//g, "-");
}
