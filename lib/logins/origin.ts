export type LoginKind = "email" | "password";

export class InvalidOriginError extends Error {}

const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1"]);

// The WHATWG URL parser lowercases the host, IDN-encodes it to punycode and
// drops a default port, so equal sites produce equal keys.
export function normalizeOrigin(input: string): { origin: string; key: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidOriginError("not an origin; write it like https://login.example.com");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new InvalidOriginError("only https and http origins can hold a dev login");
  if (url.username || url.password) throw new InvalidOriginError("an origin carries no user name or password");
  if (url.pathname !== "/" || url.search || url.hash) throw new InvalidOriginError("an origin has no path, query or fragment");
  const host = url.hostname;
  if (!host || host.startsWith("[")) throw new InvalidOriginError("the host must be a name or an IPv4 address");
  if (host.includes("_")) throw new InvalidOriginError("hosts containing _ are not supported");
  if (url.protocol === "http:" && !LOCAL_HTTP_HOSTS.has(host)) {
    throw new InvalidOriginError("http is allowed only for localhost and 127.0.0.1; use https");
  }
  const key = `${host}${url.port ? `_${url.port}` : ""}${url.protocol === "http:" ? "_http" : ""}`;
  return { origin: url.origin, key };
}

export function placeholderName(key: string, kind: LoginKind): string {
  return `devlogin:${key}:${kind}`;
}

export function parsePlaceholder(name: string): { key: string; kind: LoginKind } | null {
  const m = /^devlogin:([A-Za-z0-9][A-Za-z0-9_.-]*):(email|password)$/.exec(name);
  return m ? { key: m[1]!, kind: m[2] as LoginKind } : null;
}
