import { readFileSync } from 'fs';
import { join } from 'path';
import { loadConfig } from './config.ts';
import { isLocalRequest } from './local.ts';
import { SnapshotCache } from './cache.ts';
import { collectAllRepos, parseActionBody } from './data.ts';
import type { BoardRepo } from './data.ts';
import { actionPrompt, buildPaneCommand, focusTab, launchInWorkspace, tabLabel } from './herdr.ts';
import { jobFilePath, pruneJobStates, readJobStates, writeJobState } from './job-state.ts';

const config = loadConfig();

const cssPath = join(import.meta.dir, '..', 'client', 'style.css');
const favicon = readFileSync(join(import.meta.dir, '..', 'client', 'favicon.svg'), 'utf8');

const cache = new SnapshotCache<BoardRepo[]>(() => collectAllRepos(config.repos), []);

// Bundle the React client once at startup; served from memory. CSS is
// re-read per request instead, so style edits are live without a restart.
const build = await Bun.build({
  entrypoints: [join(import.meta.dir, '..', 'client', 'client.tsx')],
  target: 'browser',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
if (!build.success) {
  console.error(build.logs.join('\n'));
  throw new Error('client bundle failed');
}
const appJs = await build.outputs[0]!.text();

const shell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>gitq</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>`;

const LIVE_STATUSES = new Set(['starting', 'working', 'conflict']);

// $PORT wins over config so launchd can pin the port independently.
const port = Number(process.env.PORT) || config.port;

Bun.serve({
  port,
  // The cold assembly (git queries per stack + optional GitLab fetch) can
  // exceed Bun's 10s default; give the first request room.
  idleTimeout: 60,
  async fetch(req) {
    const { pathname, searchParams } = new URL(req.url);
    switch (pathname) {
      case '/healthz':
        return new Response('ok');
      case '/':
        return new Response(shell, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      case '/style.css':
        return new Response(readFileSync(cssPath, 'utf8'), { headers: { 'content-type': 'text/css; charset=utf-8' } });
      case '/favicon.svg':
        return new Response(favicon, { headers: { 'content-type': 'image/svg+xml' } });
      case '/app.js':
        return new Response(appJs, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
      case '/data.json': {
        if (searchParams.get('fresh') === '1') cache.invalidate();
        const snapshot = await cache.get();
        pruneJobStates();
        const jobs = readJobStates().filter((j) => config.repos.some((r) => r.path === j.repoPath));
        return Response.json({
          repos: snapshot.data,
          jobs,
          fetchedAt: snapshot.fetchedAt,
          fetchError: snapshot.fetchError,
          local: isLocalRequest(req),
        });
      }
      case '/action': {
        if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req)) return new Response('forbidden', { status: 403 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const parsed = parseActionBody(body, config.repos);
        if (!parsed) {
          return new Response(
            'expected { repoPath: <configured repo path>, stack: string, action: sync|publish|absorb|restructure }',
            { status: 400 },
          );
        }
        const statePath = jobFilePath(parsed.repoPath, parsed.stack, parsed.action);
        // Dedup: a live job for this triple re-focuses its tab instead of
        // spawning another pane. A dead tab falls through to a fresh launch.
        const existing = readJobStates().find(
          (j) => j.repoPath === parsed.repoPath && j.stack === parsed.stack && j.action === parsed.action,
        );
        if (existing?.tabId && LIVE_STATUSES.has(existing.status)) {
          try {
            await focusTab(existing.tabId);
            return Response.json({ ok: true, focused: true });
          } catch {
            // tab is gone; launch fresh below
          }
        }
        const repoName = config.repos.find((r) => r.path === parsed.repoPath)?.name ?? parsed.repoPath;
        // Seed the state file before spawning so the skill's writes merge
        // into a fully-identified job (Plan 2 merge semantics).
        writeJobState(statePath, { status: 'starting', repoPath: parsed.repoPath, stack: parsed.stack, action: parsed.action });
        try {
          const prompt = actionPrompt(parsed.action, parsed.repoPath, parsed.stack, statePath);
          const launched = await launchInWorkspace({
            workspaceLabel: config.herdrWorkspace,
            tabLabel: tabLabel(repoName, parsed.stack, parsed.action),
            paneCommand: buildPaneCommand(parsed.repoPath, prompt),
          });
          writeJobState(statePath, { status: 'starting', tabId: launched.tabId, workspaceId: launched.workspaceId });
          return Response.json({ ok: true, focused: launched.focusedExisting });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          writeJobState(statePath, { status: 'error', detail: `launch failed: ${message}` });
          return new Response(message, { status: 502 });
        }
      }
      default:
        return new Response('not found', { status: 404 });
    }
  },
});

console.log(`gitq board on http://localhost:${port}`);
void cache.get().catch(() => {});
