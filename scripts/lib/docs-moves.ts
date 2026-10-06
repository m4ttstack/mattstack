export type DocsMove = { from: string; to: string; prefix?: boolean };

export const DOCS_HOST = "https://docs.mattstack.dev";

const RT_GUIDES = [
  "chat", "common-flags", "context-extension", "glitter", "logging",
  "picker", "plugins", "proxy", "runner", "strongdm",
];

export const DOCS_MOVES: readonly DocsMove[] = [
  { from: "/", to: "/rt" },
  { from: "/reference", to: "/rt/reference", prefix: true },
  { from: "/getting-started/install", to: "/start/install" },
  { from: "/getting-started/just-me", to: "/start/setup" },
  { from: "/getting-started/onboard-a-repo", to: "/start/onboard-a-repo" },
  { from: "/getting-started/first-commands", to: "/rt/first-commands" },
  { from: "/guides/teams-and-invites", to: "/start/teams" },
  { from: "/guides/tray", to: "/start/menu-bar-app" },
  { from: "/guides/daemon", to: "/start/daemon" },
  { from: "/guides/state-backup", to: "/start/state-backup" },
  { from: "/guides/gates", to: "/skills/gates" },
  { from: "/guides/mcp", to: "/skills/mcp" },
  ...RT_GUIDES.map((g) => ({ from: `/guides/${g}`, to: `/rt/guides/${g}` })),
];

function strip(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function mapPath(path: string): string | undefined {
  const p = strip(path);
  for (const m of DOCS_MOVES) {
    if (p === m.from) return m.to;
    if (m.prefix && p.startsWith(`${m.from}/`)) return m.to + p.slice(m.from.length);
  }
  return undefined;
}

export function resolveRedirect(path: string): string {
  return mapPath(path) ?? "/";
}

export function rewriteLink(href: string, opts: { gitq?: boolean } = {}): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const hash = href.indexOf("#");
  const path = hash >= 0 ? href.slice(0, hash) : href;
  const anchor = hash >= 0 ? href.slice(hash) : "";
  if (opts.gitq) {
    if (path === "/gitq" || path.startsWith("/gitq/")) return href;
    return (path === "/" ? "/gitq" : `/gitq${strip(path)}`) + anchor;
  }
  if (/^\/(start|apps|rt|gitq|skills)(\/|$)/.test(path)) return href;
  const to = mapPath(path);
  return to ? to + anchor : href;
}

export function rtCoolRedirects(): string {
  const lines: string[] = [];
  for (const m of DOCS_MOVES) {
    const to = `${DOCS_HOST}${m.to}`;
    if (m.prefix) {
      lines.push(`${m.from} ${to} 301`, `${m.from}/* ${to}/:splat 301`);
    } else if (m.from === "/") {
      lines.push(`/ ${to} 301`);
    } else {
      lines.push(`${m.from} ${to} 301`, `${m.from}/ ${to} 301`);
    }
  }
  lines.push(`/* ${DOCS_HOST}/ 301`);
  return lines.join("\n") + "\n";
}
