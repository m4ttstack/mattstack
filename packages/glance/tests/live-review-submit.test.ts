/**
 * Live check of NoteMutator's pending-comment calls against the harness
 * repo. Gated: set GLANCE_LIVE=1 to run; skipped silently otherwise.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Gitlab } from '@gitbeaker/rest';
import { NoteMutator, type TextPosition } from '../src/NoteMutator.ts';
import { approverUsers, gitlabRepo, loadCredentials, ownerUser } from './live/credentials.ts';

const LIVE = !!process.env.GLANCE_LIVE;
const FILE = `live-review-submit-${Date.now()}.txt`;
const FIVE_LINES = 'one\ntwo\nthree\nfour\nfive\n';
// bun applies its 5s default to hooks as well as tests, and every step here is a GitLab round trip.
const NETWORK_TIMEOUT_MS = 120_000;

describe.skipIf(!LIVE)('live: submitted review', () => {
  let host: string;
  let repo: string;
  let projectId: number;
  let iid: number;
  let branch: string;
  let owner: InstanceType<typeof Gitlab>;
  let reviewer: NoteMutator;
  let reviewerName: string;
  let reviewerToken: string;

  beforeAll(async () => {
    const creds = await loadCredentials();
    if (!creds) throw new Error('harness_credentials.json not found at the package root');
    const gl = gitlabRepo(creds);
    host = new URL(gl.web_url).origin;
    repo = gl.path_with_namespace ?? new URL(gl.web_url).pathname.replace(/^\//, '');
    const approver = approverUsers(creds)[0];
    if (!approver) throw new Error('harness needs one approver user');
    reviewerName = approver.username;
    reviewerToken = approver.token;
    owner = new Gitlab({ host, token: ownerUser(creds).token });
    reviewer = new NoteMutator(host, reviewerToken);

    const proj = await owner.Projects.show(repo);
    projectId = gl.project_id ?? (proj.id as number);
    branch = `live-review-submit-${Date.now()}`;
    await owner.Branches.create(repo, branch, proj.default_branch as string);
    await owner.Commits.create(repo, branch, 'live-review-submit: five lines', [
      { action: 'create', filePath: FILE, content: FIVE_LINES },
    ]);
    const mr = await owner.MergeRequests.create(repo, branch, proj.default_branch as string, `Live review submit ${branch}`);
    iid = mr.iid as number;
    // GitLab computes diff_refs a moment after the MR opens; fetchDiffRefs throws until then.
    for (let attempt = 0; ; attempt++) {
      try {
        await reviewer.fetchDiffRefs(projectId, iid);
        break;
      } catch (err) {
        if (attempt >= 10) throw err;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }, NETWORK_TIMEOUT_MS);

  afterAll(async () => {
    if (!owner || !branch) return;
    try { await owner.MergeRequests.edit(repo, iid, { stateEvent: 'close' }); } catch {}
    try { await owner.Branches.remove(repo, branch); } catch {}
  }, NETWORK_TIMEOUT_MS);

  const pos = (refs: { base_sha: string; start_sha: string; head_sha: string }, line: number): TextPosition =>
    ({ ...refs, position_type: 'text', new_path: FILE, old_path: FILE, new_line: line });

  test('a submitted review publishes its comment, drops a bad anchor only when asked, and sets the reviewer state', async () => {
    const refs = await reviewer.fetchDiffRefs(projectId, iid);

    const good = await reviewer.createDraftNote(projectId, iid, 'harness: inline finding', { position: pos(refs, 2) });
    expect(good.line_code).not.toBeNull();

    const bad = await reviewer.createDraftNote(projectId, iid, 'harness: outside the diff', { position: pos(refs, 9999) });
    expect(bad.line_code).toBeNull();
    await reviewer.deleteDraftNote(projectId, iid, bad.id);

    expect((await reviewer.listDraftNotes(projectId, iid)).map(d => d.id)).toEqual([good.id]);

    await reviewer.publishDraftNotes(projectId, iid, { note: 'harness: summary', reviewerState: 'reviewed' });
    expect(await reviewer.listDraftNotes(projectId, iid)).toEqual([]);

    const states = await reviewer.fetchReviewerStates(projectId, iid);
    expect(states.find(s => s.username === reviewerName)?.state).toBe('reviewed');
  }, NETWORK_TIMEOUT_MS);

  test('a pending reply with resolve resolves the thread on publish', async () => {
    const refs = await reviewer.fetchDiffRefs(projectId, iid);
    const thread = await reviewer.createPositionedDiscussion(projectId, iid, 'harness: thread to resolve', pos(refs, 3));
    await reviewer.createDraftNote(projectId, iid, 'harness: confirmed', {
      inReplyToDiscussionId: thread.id,
      resolveDiscussion: true,
    });
    await reviewer.publishDraftNotes(projectId, iid, { note: 'harness: round two', reviewerState: 'reviewed' });

    const res = await fetch(`${host}/api/v4/projects/${projectId}/merge_requests/${iid}/discussions/${thread.id}`, {
      headers: { 'PRIVATE-TOKEN': reviewerToken },
    });
    const d = (await res.json()) as { notes: Array<{ resolved?: boolean; body: string }> };
    expect(d.notes.at(-1)!.body).toBe('harness: confirmed');
    expect(d.notes[0]!.resolved).toBe(true);
  }, NETWORK_TIMEOUT_MS);
});
