import { normalizeRemote } from '@mattstack/rt-client';

export { extractLinearId } from '@mattstack/rt-client';

/** The https origin a request to this authority would reach, as a URL parser reads it, so the host a token gate judges is the host the request goes to. */
function originOf(authority: string): string | null {
  try {
    return new URL(`https://${authority}`).origin;
  } catch {
    return null;
  }
}

const URL_FORM_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/]+)\//i;

/**
 * A remote's web origin and project path. The path comes from rt-client's
 * normalizeRemote, as in rt's own parser (lib/enrich.ts) minus its ssh alias
 * lookup. A URL-form remote's host is the one a URL parser would reach from
 * the raw authority, never normalizeRemote's reading of it, because the
 * token gate must judge the host the request goes to. A port on a non-http
 * remote belongs to sshd, so it is dropped.
 */
export function parseRemoteUrl(url: string): { host: string; projectPath: string } | null {
  const trimmed = url.trim();
  if (/^file:/i.test(trimmed)) return null;
  const normalized = normalizeRemote(trimmed);
  if (!normalized) return null;
  const slash = normalized.indexOf('/');
  const urlForm = URL_FORM_RE.exec(trimmed);
  const origin = originOf(urlForm ? urlForm[2]! : normalized.slice(0, slash));
  if (!origin) return null;
  const webOrigin = urlForm && /^https?$/i.test(urlForm[1]!) ? origin : origin.replace(/:\d+$/, '');
  return { host: webOrigin, projectPath: normalized.slice(slash + 1).replace(/\.git$/, '') };
}
