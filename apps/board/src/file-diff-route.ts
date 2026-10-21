import type { ForgeFileDiffData, RtResponse } from '@mattstack/rt-client';

/** The review sheet's FileDiff (client/board/diff-source.ts), as this
    route sends it. */
export interface FileDiffBody {
  path: string;
  oldPath: string;
  patch: string;
  forge: 'gitlab' | 'github';
  webUrl?: string;
  renamed: boolean;
  binary: boolean;
  tooLarge: boolean;
}

export interface FileDiffRouteDeps {
  isLocal: (req: Request) => boolean;
  /** The board's tracked MR with this web URL. */
  findMr: (mrUrl: string) => Promise<{ iid: number; webUrl: string } | null>;
  /** The MR's serialized rt repo identity. */
  repoFor: (mr: { iid: number; webUrl: string }) => string | null;
  readDiff: (payload: {
    repoName: string;
    iid: number;
    path: string;
  }) => Promise<RtResponse<ForgeFileDiffData>>;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });

/** A short line for the diff modal, from the daemon's error. */
function shortError(error: string | undefined): string {
  const text = error ?? '';
  if (/gitlabToken/i.test(text)) return 'No GitLab token is set up for rt.';
  if (/no GitHub token/i.test(text)) return 'No GitHub token is set up for rt.';
  if (/rt daemon unreachable/i.test(text))
    return 'The rt daemon is not running.';
  const forge = /GitHub/.test(text) ? 'GitHub' : 'GitLab';
  const status = /returned (\d{3})/.exec(text)?.[1];
  return status
    ? `${forge} answered ${status} for this diff.`
    : 'The diff could not be loaded.';
}

/** `GET /review/file-diff?mr=<web url>&file=<path>`: one file's diff in a
    tracked MR, for the review sheet. Local only: it serves source code,
    which the tunnel must never carry. */
export async function fileDiffRoute(
  req: Request,
  deps: FileDiffRouteDeps
): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  if (!deps.isLocal(req)) return json({ error: 'local only' }, 403);
  const params = new URL(req.url).searchParams;
  const mrUrl = params.get('mr');
  const file = params.get('file');
  if (!mrUrl || !file)
    return json({ error: 'expected ?mr=<url>&file=<path>' }, 400);
  const mr = await deps.findMr(mrUrl);
  if (!mr) return json({ error: 'This MR is not on the board.' }, 404);
  const repoName = deps.repoFor(mr);
  if (!repoName)
    return json(
      { error: 'The board cannot tell which repo this MR is in.' },
      502
    );
  const res = await deps.readDiff({ repoName, iid: mr.iid, path: file });
  if (!res.ok || !res.data) return json({ error: shortError(res.error) }, 502);
  const { forge, file: diff, truncated } = res.data;
  if (!diff && truncated)
    return json({ error: "This MR's diff is too long to search here." }, 413);
  if (!diff) return json({ error: "This file is not in the MR's diff." }, 404);
  const body: FileDiffBody = {
    path: diff.newPath,
    oldPath: diff.oldPath,
    patch: diff.diff ?? '',
    forge,
    ...(diff.webUrl ? { webUrl: diff.webUrl } : {}),
    renamed: diff.renamed,
    binary: diff.binary,
    tooLarge: diff.tooLarge,
  };
  return json(body);
}
