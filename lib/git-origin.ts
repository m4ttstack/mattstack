import { execSync } from "child_process";

/**
 * Reads the origin remote the same way rt-client's async `deriveRepoIdentity`
 * does (`git config --get remote.origin.url`), not `git remote get-url origin`:
 * under an `insteadOf` rewrite the two spellings diverge and would mint two
 * identities for one repo.
 */
export function readOriginRemoteForIdentity(cwd: string): string | null {
  try {
    const text = execSync("git config --get remote.origin.url", { cwd, encoding: "utf8", stdio: "pipe" }).trim();
    return text || null;
  } catch {
    return null;
  }
}
