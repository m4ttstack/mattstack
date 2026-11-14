import { GitLabProvider, NoteMutator } from '@mattstack/glance';
import type { LatchGateway, LatchMr } from './post.ts';

/** The glance clients the gateway writes through. */
export interface GitlabLatchClients {
  mutator: Pick<
    NoteMutator,
    'uploadFile' | 'createDiscussion' | 'updateNote' | 'createNote'
  >;
  provider: Pick<GitLabProvider, 'resolveDiscussion' | 'unresolveDiscussion'>;
}

function projectIdOf(mr: LatchMr): number {
  if (mr.projectId === null)
    throw new Error(`gitlab latch write on !${mr.iid} has no project id`);
  return mr.projectId;
}

/** The latch's GitLab writes, bound to one board's host and token. */
export function latchGateway(
  host: string,
  token: string,
  clients: GitlabLatchClients = {
    mutator: new NoteMutator(host, token),
    provider: new GitLabProvider(host, token),
  }
): LatchGateway {
  const { mutator, provider } = clients;
  return {
    forge: 'gitlab',
    uploadFiles: async (mr, files) => {
      const projectId = projectIdOf(mr);
      const markdown: string[] = [];
      for (const f of files) {
        const up = await mutator.uploadFile(
          projectId,
          f.filename,
          f.bytes,
          f.contentType
        );
        markdown.push(up.markdown);
      }
      return markdown;
    },
    createThread: async (mr, body) => {
      const d = await mutator.createDiscussion(projectIdOf(mr), mr.iid, body);
      const root = d.notes[0];
      if (!root)
        throw new Error(`latch post on !${mr.iid} returned no root note`);
      return { discussionId: d.id, rootNoteId: root.id };
    },
    updateNote: (mr, noteId, body) =>
      mutator.updateNote(projectIdOf(mr), mr.iid, noteId, body),
    resolveDiscussion: (mr, id) =>
      provider.resolveDiscussion(mr.projectPath, mr.iid, id),
    unresolveDiscussion: (mr, id) =>
      provider.unresolveDiscussion(mr.projectPath, mr.iid, id),
    createNote: (mr, body, discussionId) =>
      mutator.createNote(projectIdOf(mr), mr.iid, body, discussionId),
  };
}
