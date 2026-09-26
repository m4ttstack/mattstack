/** A public tunnel forwards the original Host header, so hostname alone
    reliably tells local from tunnel traffic. Local iff localhost, 127.0.0.1,
    or any *.localhost domain. */
export function isLocalRequest(req: Request): boolean {
  const host = req.headers.get('host');
  if (!host) return false;
  const hostname = host.split(':')[0]!.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
}

/** `isLocalRequest` trusts only Host, which a cross-origin `no-cors` request
    can still reach: a browser sends Host for the actual target, not the page
    that issued the request. A browser sends Origin on every POST, same-origin
    included, so a present Origin must name a local host; a missing one means
    a non-browser client (curl, the CLI) and is allowed. */
export function isAllowedOrigin(origin: string | null): boolean {
  if (origin === null) return true;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
}
