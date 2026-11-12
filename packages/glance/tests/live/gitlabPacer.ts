/**
 * Paces the live harness's GitLab requests per identity.
 *
 * GitLab.com refuses a Free-plan user past 100 requests a minute, and the
 * live suite, running as one fixture owner, went past that: the same eight
 * GitLab cases failed with 429 on every run. The pacer lives here, not in
 * glance, because only the harness knows it is one process firing a whole
 * suite through a handful of tokens. It wraps `fetch`, so every GitLab
 * request counts, whichever glance transport (gitbeaker, raw REST, GraphQL)
 * sent it, glance's own 429 retries included.
 */

const DEFAULT_PER_MINUTE = 80;
const WINDOW_MS = 60_000;

export interface GitLabPacerOptions {
  /** Requests one identity may send in any rolling minute. Below 100 to leave room for anything else using the token. */
  perMinute?: number;
  host?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

interface Identity {
  label: string;
  /** Send times still inside the rolling minute, oldest first. */
  recent: number[];
  requests: number;
  waitedMs: number;
  /** Serialises this identity's slot grants, so concurrent requests cannot both take the last slot. */
  queue: Promise<void>;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function tokenOf(input: string | URL | Request, init?: RequestInit): string {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  return headers.get('private-token') ?? headers.get('authorization') ?? 'anonymous';
}

function urlOf(input: string | URL | Request): URL | null {
  try {
    return new URL(input instanceof Request ? input.url : String(input));
  } catch {
    return null;
  }
}

export class GitLabPacer {
  private readonly perMinute: number;
  private readonly host: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;
  /** Keyed by the token itself, which never leaves this map: logs and the summary use the label. */
  private readonly identities = new Map<string, Identity>();
  private waitedMs = 0;

  constructor(opts: GitLabPacerOptions = {}) {
    this.perMinute = opts.perMinute ?? DEFAULT_PER_MINUTE;
    this.host = opts.host ?? 'gitlab.com';
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = opts.log ?? ((line) => console.log(line));
  }

  get totalWaitMs(): number {
    return this.waitedMs;
  }

  wrap(inner: typeof fetch): typeof fetch {
    const paced = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (urlOf(input)?.host === this.host) await this.take(this.identity(tokenOf(input, init)));
      return inner(input, init);
    };
    return Object.assign(paced, { preconnect: inner.preconnect }) as typeof fetch;
  }

  summary(): string {
    const ids = [...this.identities.values()];
    const total = ids.reduce((n, id) => n + id.requests, 0);
    const each = ids
      .map((id) => `${id.label}: ${plural(id.requests, 'request')}, waited ${seconds(id.waitedMs)}`)
      .join('; ');
    return (
      `GitLab pacing: ${plural(total, 'GitLab request')} from ${ids.length === 1 ? '1 identity' : `${ids.length} identities`} ` +
      `at most ${this.perMinute} a minute each; waited ${seconds(this.waitedMs)} in total${each ? ` (${each})` : ''}`
    );
  }

  private identity(token: string): Identity {
    let id = this.identities.get(token);
    if (!id) {
      id = { label: `identity ${this.identities.size + 1}`, recent: [], requests: 0, waitedMs: 0, queue: Promise.resolve() };
      this.identities.set(token, id);
    }
    return id;
  }

  private take(id: Identity): Promise<void> {
    const turn = id.queue.then(async () => {
      for (;;) {
        const t = this.now();
        while (id.recent.length > 0 && id.recent[0]! + WINDOW_MS <= t) id.recent.shift();
        if (id.recent.length < this.perMinute) {
          id.recent.push(t);
          id.requests += 1;
          return;
        }
        const waitMs = id.recent[0]! + WINDOW_MS - t;
        this.log(
          `  [gitlab pacer] ${id.label} sent ${plural(id.recent.length, 'request')} in the last minute; waiting ${seconds(waitMs)}`,
        );
        await this.sleep(waitMs);
        id.waitedMs += waitMs;
        this.waitedMs += waitMs;
      }
    });
    id.queue = turn.catch(() => {});
    return turn;
  }
}

let installed: GitLabPacer | null = null;

/** Wraps the process's `fetch` once; every later call returns the same pacer. */
export function installGitLabPacer(): GitLabPacer {
  if (!installed) {
    installed = new GitLabPacer();
    globalThis.fetch = installed.wrap(globalThis.fetch);
  }
  return installed;
}
