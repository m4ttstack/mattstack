import * as vscode from 'vscode';
import { confirmedForgeHost, gitlabTokenRefusal } from './gitlab';

const shown = new Set<string>();

/**
 * The confirmed host for an MR lookup on this remote, after telling the
 * person once per refusal why no lookup will run. github.com only gets a
 * console line: a GitHub repo is not a misconfigured GitLab, and a warning
 * on every window would be noise.
 */
export function confirmedHostForLookup(remoteUrl: string): string | null {
  const confirmed = confirmedForgeHost();
  const refusal = gitlabTokenRefusal(remoteUrl, confirmed);
  if (refusal !== null && !shown.has(refusal)) {
    shown.add(refusal);
    console.warn(`[rt-context] ${refusal}`);
    if (!refusal.startsWith('github.com')) void vscode.window.showWarningMessage(`RT Context: ${refusal}`);
  }
  return confirmed;
}
