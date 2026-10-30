import { join } from "path";

export function homeGitDir(home: string): string {
  return join(home, ".mattstack", "user", ".git");
}
