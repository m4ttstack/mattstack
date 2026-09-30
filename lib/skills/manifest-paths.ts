import { basename, dirname, join } from "path";

export function packManifestPath(mattstackRoot: string, slug: string, pack: string): string {
  return join(mattstackRoot, "repos", slug, "packs", pack, "skills.jsonc");
}

export function legacyManifestPath(mattstackRoot: string, slug: string): string {
  return join(mattstackRoot, "repos", slug, "skills.jsonc");
}

function isPerPackShape(manifestPath: string): boolean {
  return basename(dirname(dirname(manifestPath))) === "packs";
}

/** The registry repo key `run-start --repo` expects: the repo dir's name, for both file shapes. */
export function manifestRepoKey(manifestPath: string): string {
  const dir = dirname(manifestPath);
  return isPerPackShape(manifestPath) ? basename(dirname(dirname(dir))) : basename(dir);
}

export function manifestPack(manifestPath: string): string | null {
  return isPerPackShape(manifestPath) ? basename(dirname(manifestPath)) : null;
}
