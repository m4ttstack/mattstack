/**
 * lib/agent-argv/prompt-file.ts ... an agent's prompt lives in an owner-only
 * file, never in argv, where any `pkill -f` pattern it mentions would match
 * the agent's own process.
 */

import { chmodSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export function writePromptFile(dir: string, name: string, text: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir and writeFile modes apply only on creation (and are umask-masked).
  chmodSync(dir, 0o700);
  const path = join(dir, name);
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function pointerPrompt(path: string): string {
  return `Your instructions for this session are in ${path}. Read that whole file now and follow it as your task.`;
}
