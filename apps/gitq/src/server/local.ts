/** A public tunnel forwards the original Host header, so hostname alone
    reliably tells local from tunnel traffic. Local iff localhost, 127.0.0.1,
    or any *.localhost domain. */
export function isLocalRequest(req: Request): boolean {
  const host = req.headers.get('host');
  if (!host) return false;
  const hostname = host.split(':')[0]!.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
}
