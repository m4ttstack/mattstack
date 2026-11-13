import { createRealProbes, type Probes } from "../probes.ts";
import { fakeProbes } from "./fakes.ts";

/**
 * Two listening local servers on different ports, so different origins. The
 * host answers every path with a redirect, to the other server or, with
 * `sameOrigin`, to `/moved<path>` on itself, where `reply` answers. The other
 * server records whether each request it got carried a PRIVATE-TOKEN, and
 * answers with `reply` too, so a caller that follows it would succeed.
 */
export interface RedirectHosts {
  /** host:port of the redirecting server, for a caller that builds `https://${host}`. */
  host: string;
  otherHost: string;
  otherHits: string[];
  stop(): void;
}

export function startRedirectHosts(opts: { status?: number; sameOrigin?: boolean; reply: (req: Request, path: string) => Response }): RedirectHosts {
  const otherHits: string[] = [];
  const other = Bun.serve({
    port: 0,
    fetch(req) {
      otherHits.push(req.headers.get("private-token") === null ? "no token" : "token");
      return opts.reply(req, new URL(req.url).pathname);
    },
  });
  const host = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/moved/")) return opts.reply(req, url.pathname.slice("/moved".length));
      const location = opts.sameOrigin ? `/moved${url.pathname}${url.search}` : `http://127.0.0.1:${other.port}${url.pathname}${url.search}`;
      return new Response(null, { status: opts.status ?? 302, headers: { location } });
    },
  });
  return {
    host: `127.0.0.1:${host.port}`,
    otherHost: `127.0.0.1:${other.port}`,
    otherHits,
    stop() {
      other.stop(true);
      host.stop(true);
    },
  };
}

/** Probes whose fetch is the real one, sent over http, so a caller that builds `https://${host}` reaches the local servers. */
export function realFetchProbes(): Probes {
  const real = createRealProbes();
  return fakeProbes({ fetch: (url, init) => real.fetch(url.replace(/^https:/, "http:"), init) });
}
