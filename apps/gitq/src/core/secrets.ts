import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface ResolveOptions {
  env?: Record<string, string | undefined>;
  secretsFile?: string;
}

/** GITLAB_TOKEN from the env, falling back to gitlabToken in ~/.rt/secrets.json (same convention as mr-board). */
export function resolveGitLabToken(opts: ResolveOptions = {}): string | null {
  const env = opts.env ?? process.env;
  if (env.GITLAB_TOKEN) return env.GITLAB_TOKEN;

  const file = opts.secretsFile ?? join(homedir(), '.rt', 'secrets.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { gitlabToken?: string };
    return parsed.gitlabToken ?? null;
  } catch {
    return null;
  }
}
