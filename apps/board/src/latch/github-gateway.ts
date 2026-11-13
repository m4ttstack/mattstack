import { rtCommand } from '@mattstack/rt-client';
import { forgeReason } from '../forge-writes.ts';
import type { LatchGateway, LatchMr } from './post.ts';
import { stageFiles, type StageFn } from './stage.ts';

/** Above the daemon's own 90 s budget, as FORGE_WRITE_TIMEOUT_MS. */
export const LATCH_GITHUB_TIMEOUT_MS = 120_000;

export interface GithubLatchDeps {
  command?: typeof rtCommand;
  stage?: StageFn;
  timeoutMs?: number;
}

/** The latch's GitHub writes, all through daemon verbs; the board holds no token. */
export function githubLatchGateway(deps: GithubLatchDeps = {}): LatchGateway {
  const command = deps.command ?? rtCommand;
  const stage =
    deps.stage ?? ((files: Parameters<StageFn>[0]) => stageFiles(files));
  const timeoutMs = deps.timeoutMs ?? LATCH_GITHUB_TIMEOUT_MS;

  async function call<T>(
    verb: string,
    mr: LatchMr,
    extra: Record<string, unknown>
  ): Promise<T> {
    if (!mr.rtRepo)
      throw new Error(`no repo identity for !${mr.iid}, cannot write`);
    const res = await command<T>(
      verb,
      { repoName: mr.rtRepo, iid: mr.iid, ...extra },
      { timeoutMs }
    );
    if (!res.ok) {
      // forgeReason's prefix pattern is \w+, so a verb with a colon keeps its prefix.
      const reason = forgeReason(res.error ?? '').replace(
        `${verb} failed: `,
        ''
      );
      throw new Error(reason || `${verb} failed`);
    }
    return res.data as T;
  }

  return {
    forge: 'github',
    async uploadFiles(mr, files) {
      const staged = await stage(files);
      try {
        const data = await call<{ urls: Record<string, string> }>(
          'mr:attach-upload',
          mr,
          { files: staged.paths }
        );
        return files.map(f => {
          const url = data?.urls?.[f.filename];
          if (!url) throw new Error(`no upload url for ${f.filename}`);
          return `![${f.alt}](${url})`;
        });
      } finally {
        await staged.cleanup();
      }
    },
    async createThread(mr, body) {
      const data = await call<{
        discussionId?: string;
        noteId?: number;
        fallback?: string;
      }>('mr:comment-file', mr, { body });
      if (data?.fallback === 'no-files') return null;
      if (!data?.discussionId || data.noteId === undefined)
        throw new Error('mr:comment-file returned no thread');
      return { discussionId: data.discussionId, rootNoteId: data.noteId };
    },
    async updateNote(mr, noteId, body) {
      await call('mr:note-update', mr, { noteId, body });
    },
    async resolveDiscussion(mr, discussionId) {
      await call('discussions:resolve', mr, { discussionId, resolved: true });
    },
    async unresolveDiscussion(mr, discussionId) {
      await call('discussions:resolve', mr, { discussionId, resolved: false });
    },
    async createNote(mr, body, discussionId) {
      const data = await call<{ noteId: number }>('discussions:reply', mr, {
        discussionId,
        body,
      });
      return { id: data.noteId };
    },
  };
}
