import { gitlabOnly, type BoardConfig } from '../config.ts';
import { latchGateway } from './gateway.ts';
import { githubLatchGateway } from './github-gateway.ts';
import type { LatchGateway } from './post.ts';

/** The latch gateway for this board's forge, or null when it cannot write. */
export function boardLatchGateway(
  config: BoardConfig,
  gitlabToken: string | null
): LatchGateway | null {
  if (config.forge.kind === 'gitlab')
    return gitlabToken ? latchGateway(gitlabOnly(config), gitlabToken) : null;
  if (config.forge.kind === 'github') return githubLatchGateway();
  return null;
}
