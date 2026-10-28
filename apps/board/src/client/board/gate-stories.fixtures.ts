import type { GateQuestion, GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import type { DiffSource, FileDiff } from './diff-source.ts';

/**
 * The four gates Storybook shows, rebuilt from real review-post,
 * respond-plan and respond-post rows: question ids and counts, option
 * labels and descriptions, gate-ctx shapes, meta and origin keep the real
 * rows' structure, while every name, ticket, MR, path and piece of domain
 * wording is invented. This repo is public, so nothing here may be copied
 * from a live board.
 */

export interface StoryGate {
  gate: GateRow;
  mr: BoardMRWithReview;
  /** Where a drafted review's code sections get their diffs. */
  diffs?: DiffSource;
}

export const PEOPLE: ReadonlyMap<string, string> = new Map([
  ['pat', 'Pat Lin'],
  ['renee', 'Renee Park'],
  ['dana', 'Dana Ortiz'],
]);

const minutesAgo = (m: number) => Date.now() - m * 60_000;
const ctx = (v: unknown) => JSON.stringify(v);

function opt(value: string, label: string, description?: string) {
  return description === undefined
    ? { value, label }
    : { value, label, description };
}

function question(
  id: string,
  label: string,
  multi: boolean,
  options: GateQuestion['options'],
  context?: string
): GateQuestion {
  return { id, label, multi, options, ...(context ? { context } : {}) };
}

const FORGE = 'https://gitlab.example.com/acme/webapp/-/merge_requests';
const TREES = '/Users/pat/worktrees/gl-acme-webapp';
const mrSubject = (iid: number) => `mr:${FORGE}/${iid}`;

function boardMr(
  iid: number,
  title: string,
  author: string,
  sourceBranch: string,
  diff: [number, number, number],
  approvals: [given: number, required: number]
): BoardMRWithReview {
  const [given, required] = approvals;
  return {
    iid,
    title,
    webUrl: `${FORGE}/${iid}`,
    author: {
      id: `gitlab:${author.length + iid}`,
      username: author,
      name: PEOPLE.get(author) ?? author,
      avatarUrl: null,
    },
    sourceBranch,
    targetBranch: 'main',
    isDraft: false,
    createdAt: new Date(minutesAgo(60 * 26)).toISOString(),
    diff: { additions: diff[0], deletions: diff[1], filesChanged: diff[2] },
    pipelineState: 'passed',
    behindTarget: null,
    reviews: {
      required,
      given,
      remaining: Math.max(required - given, 0),
      isApproved: given >= required,
      approvedBy: [],
      reviewers: [],
      totalAssigned: 0,
      haveActed: given,
      havePending: 0,
      haveNotStarted: 0,
    },
    blockers: {
      isDraft: false,
      hasConflicts: false,
      needsRebase: false,
      pipelineFailing: false,
      pipelineRunning: false,
      awaitingApprovals: given < required,
    },
  } as unknown as BoardMRWithReview;
}

// --- Review: Dana's MR, reviewed by me -------------------------------------

const TILE_MR = boardMr(
  826,
  'ACME-3420: cache forecast tiles per region',
  'dana',
  'acme-3420-forecast-tile-cache',
  [184, 41, 5],
  [0, 1]
);

const CACHE = 'packages/forecast/src/tiles/tileCache.ts';
const CACHE_TEST = 'packages/forecast/src/tiles/tileCache.test.ts';

const TILE_FINDINGS = {
  f1: {
    id: 'f1',
    severity: 'critical',
    title: 'Cache key drops the region',
    body: '`tileKey` builds the key from zoom, x and y only. Two regions asking for the same tile coordinates share one entry, so the second region is served the first region’s forecast until the entry expires.',
    file: `${CACHE}:31`,
    fix: 'Put the region first in the key and add a two-region test.',
    kind: 'issue',
    comment:
      '**issue:** the key here is zoom/x/y only, so two regions asking for the same tile share one entry and the second one gets the first region’s forecast. could the region go first?\n\n```ts\nconst tileKey = (t: TileRequest) => `${t.region}:${t.z}/${t.x}/${t.y}`;\n```',
  },
  f2: {
    id: 'f2',
    severity: 'important',
    title: 'An expired tile is served after a failed refetch',
    body: 'When the refetch throws, the catch returns `entry.tile` without checking `expiresAt`, so a tile from yesterday keeps rendering with no stale marker.',
    file: `${CACHE}:58`,
    fix: 'Return the stale tile flagged as stale, or rethrow once it is past a hard limit.',
    kind: 'question',
    comment:
      '**question:** if the refetch throws, this hands back `entry.tile` no matter how old it is. is that on purpose? a tile from yesterday would keep rendering with nothing saying it’s stale.',
  },
  f3: {
    id: 'f3',
    severity: 'important',
    title: 'Evidence stops at the unit tests',
    body: 'The tests prove the cache in isolation, but nothing in the description shows the map reading cached tiles across a region switch, which is the AC the ticket leads with.',
    fix: 'Add a before/after capture of a region switch on the forecast map.',
    kind: 'suggestion',
    comment:
      '**suggestion:** would you mind adding a capture of a region switch on the forecast map? the tests cover the cache itself, but the first AC is about what the map shows.',
  },
  f4: {
    id: 'f4',
    severity: 'minor',
    title: 'Eviction never runs below the size cap',
    body: '`evict` only runs when `size > maxEntries`, so expired entries sit in memory until the cache fills.',
    file: `${CACHE}:66`,
    fix: 'Drop expired entries on read as well.',
    kind: 'issue',
    comment:
      '**issue (non-blocking):** expired entries only leave when the cache is full, so a quiet session keeps every old tile around. dropping them on read would cover it.',
  },
  f5: {
    id: 'f5',
    severity: 'minor',
    title: 'Two new branches have no test',
    body: 'Nothing covers the refetch failure path or the eviction of an expired entry.',
    fix: 'Add a case per branch.',
    kind: 'suggestion',
    comment:
      '**suggestion (non-blocking):** the refetch failure and the expired eviction don’t have a test yet. a case each would pin them.',
  },
  f6: {
    id: 'f6',
    severity: 'minor',
    title: 'Test helper falls back to the first tile',
    body: '`findTile(tiles, key) ?? tiles[0]` quietly tests the wrong tile if the fixture drifts.',
    file: `${CACHE_TEST}:108`,
    fix: 'Assert the tile exists instead of falling back.',
    kind: 'nitpick',
    comment:
      '**nitpick:** the `?? tiles[0]` fallback would quietly test the wrong tile if the fixture changes. an assert would fail loudly instead.',
  },
  f7: {
    id: 'f7',
    severity: 'minor',
    title: 'Description lists the radar layer as a consumer',
    body: 'The radar layer reads tiles through its own loader and never touches this cache.',
    fix: 'Drop the radar layer from the consumer list.',
    kind: 'nitpick',
    comment:
      '**nitpick:** the description lists the radar layer as a consumer, but it goes through its own loader. worth dropping so nobody goes looking.',
  },
};

const findingOption = (f: (typeof TILE_FINDINGS)[keyof typeof TILE_FINDINGS]) =>
  opt(
    f.id,
    `[${f.severity[0]!.toUpperCase()}${f.severity.slice(1)}] ${f.title}`,
    `${'file' in f ? f.file : 'not inline-anchorable (MR description)'} · ${f.fix} · kind:${f.kind}`
  );

const tileOrigin = {
  presentation: 'form' as const,
  surface: 'board',
  tabId: 'w41:t1',
  worktree: `${TREES}/juniper`,
  paneId: 'w41:p1',
  runId: '20261027-142817-249f-11804',
};

const reviewMeta = {
  label: 'review gate !826',
  headline: 'Your review of !826 is ready',
  summary: 'Pick what to post',
};

const { f1, f2, f3, f4, f5, f6, f7 } = TILE_FINDINGS;

export const reviewFirstRound: StoryGate = {
  mr: TILE_MR,
  diffs: {
    fetchFileDiff: async ({ file }) => TILE_DIFFS[file] ?? null,
    loadView: () => import('./DiffView.tsx'),
  },
  gate: {
    gateId: 'story-review-first-round',
    subject: mrSubject(826),
    kind: 'review-post',
    label: 'review gate !826',
    status: 'open',
    openedAt: minutesAgo(8),
    meta: reviewMeta,
    domain: 'review',
    origin: tileOrigin,
    context: ctx({
      'gate-ctx': 'review@1',
      readiness: 'with-fixes',
      summary:
        'The cache does what the ticket asks for one region, and the tests are red on main and green here. The key drops the region, so a second region reads the first one’s tiles; that one blocks.',
      findings: { critical: 1, important: 2, minor: 4 },
      editable: true,
      summaryComments: {
        comment: 'Left a few comments! The region key one is blocking for me.',
        approve:
          'Looks good to me, approving. Left a few inline notes to pick up on the way.',
      },
    }),
    questions: [
      question(
        'findings-1',
        'Post which findings to !826?',
        true,
        [f1, f2, f3, f4].map(findingOption),
        ctx({ 'gate-ctx': 'findings@1', findings: [f1, f2, f3, f4] })
      ),
      question(
        'findings-2',
        'Post which findings to !826?',
        true,
        [f5, f6, f7].map(findingOption),
        ctx({ 'gate-ctx': 'findings@1', findings: [f5, f6, f7] })
      ),
      question(
        'outcome',
        'Verdict on !826: ready once the cache key carries the region',
        false,
        [
          opt(
            'comment',
            'Comment (recommended)',
            'post the picked findings and leave approval for after the key fix'
          ),
          opt(
            'approve',
            'Approve',
            'post the picked findings and approve now despite the key bug'
          ),
        ]
      ),
    ],
  },
};

// Invented code for the two files the findings sit on, as GitLab's MR diffs
// API returns them: per-file hunks with no file headers.
const CACHE_PATCH = `@@ -24,8 +24,14 @@ export interface TileRequest {
   z: number;
   x: number;
   y: number;
 }

+const TTL_MS = 15 * 60_000;
+
+const tileKey = (t: TileRequest) => \`\${t.z}/\${t.x}/\${t.y}\`;
+
+const entries = new Map<string, CacheEntry>();
+
 export async function getTile(t: TileRequest): Promise<Tile> {
   const key = tileKey(t);
   const entry = entries.get(key);
@@ -44,13 +50,26 @@ export async function getTile(t: TileRequest): Promise<Tile> {
   if (entry && entry.expiresAt > Date.now()) return entry.tile;

   try {
     const tile = await fetchTile(t);
-    return tile;
+    entries.set(key, { tile, expiresAt: Date.now() + TTL_MS });
+    evict();
+    return tile;
   } catch (err) {
-    throw err;
+    if (entry) return entry.tile;
+    throw err;
   }
 }

+const maxEntries = 400;
+
+function evict() {
+  if (entries.size <= maxEntries) return;
+  const oldest = [...entries.entries()]
+    .sort(([, a], [, b]) => a.expiresAt - b.expiresAt)
+    .slice(0, entries.size - maxEntries);
+  for (const [key] of oldest) entries.delete(key);
+}
+
 export function clearTiles() {
   entries.clear();
 }
`;

const CACHE_TEST_PATCH = `@@ -98,6 +98,23 @@ describe('getTile', () => {
     expect(fetchTile).toHaveBeenCalledTimes(1);
   });

+  it('serves a cached tile inside the TTL', async () => {
+    const tiles = await loadFixtureTiles();
+    const key = '6/12/18';
+    fetchTile.mockResolvedValueOnce(findTile(tiles, key));
+    await getTile({ region: 'north', z: 6, x: 12, y: 18 });
+    const again = await getTile({ region: 'north', z: 6, x: 12, y: 18 });
+    expect(fetchTile).toHaveBeenCalledTimes(1);
+    expect(again).toBe(findTile(tiles, key) ?? tiles[0]);
+  });
+
+  it('evicts the oldest tiles past the cap', async () => {
+    for (let i = 0; i < 401; i++)
+      await getTile({ region: 'north', z: 6, x: i, y: 0 });
+    await getTile({ region: 'north', z: 6, x: 0, y: 0 });
+    expect(fetchTile).toHaveBeenCalledTimes(402);
+  });
+
   it('rethrows when nothing is cached', async () => {
     fetchTile.mockRejectedValueOnce(new Error('offline'));
     await expect(getTile(req)).rejects.toThrow('offline');
`;

const TILE_DIFFS: Record<string, FileDiff> = {
  [CACHE]: {
    path: CACHE,
    patch: CACHE_PATCH,
    forge: 'gitlab',
    webUrl: `${FORGE}/826/diffs#tileCache.ts`,
  },
  [CACHE_TEST]: {
    path: CACHE_TEST,
    patch: CACHE_TEST_PATCH,
    forge: 'gitlab',
    webUrl: `${FORGE}/826/diffs#tileCache.test.ts`,
  },
};

const carryover = (
  n: number,
  thread: string,
  label: string,
  defaults: { post: boolean; resolve: boolean },
  carry: {
    round: number;
    call: 'fixed' | 'not-fixed' | 'pushback-accepted' | 'pushback-rejected';
    original: string;
    reply: string;
    file?: string;
    authorReply?: string;
    note?: string;
  }
) =>
  question(
    `thread-${n}`,
    label,
    true,
    [
      opt(
        `post:${thread}`,
        defaults.post ? 'Post reply (recommended)' : 'Post reply'
      ),
      opt(
        `resolve:${thread}`,
        defaults.resolve ? 'Resolve thread (recommended)' : 'Resolve thread'
      ),
    ],
    ctx({ 'gate-ctx': 'carryover@1', thread, ...carry })
  );

const TILE_THREADS = {
  key: '5d1c0e7a93b24f6a8c0e1f2d3b4a5c6d7e8f9a01',
  stale: 'a07e4c2b9d1f3e5a7c9b0d2f4e6a8c1b3d5f7e92',
  evidence: 'c3f9e1d7b5a3c1e9f7d5b3a1c9e7f5d3b1a9c8e4',
};

const N1 = {
  id: 'n1',
  severity: 'minor',
  title: 'Stale flag is never cleared on a fresh fetch',
  body: 'The new `stale` flag is set when the refetch fails, but the success path builds a fresh entry without it, so it only clears by accident.',
  file: `${CACHE}:54`,
  fix: 'Set stale: false explicitly on the success path.',
  kind: 'nitpick',
  disposition: 'new',
  comment:
    '**nitpick:** the success path relies on the new entry not having `stale` at all. an explicit `stale: false` would say it out loud.',
};

/** Round 2 of the same review: the key fix landed, the stale-tile answer
    was a fair pushback, the evidence is still missing, and one small new
    finding turned up. */
export const reviewReReview: StoryGate = {
  mr: { ...TILE_MR, diff: { additions: 213, deletions: 44, filesChanged: 6 } },
  diffs: reviewFirstRound.diffs!,
  gate: {
    gateId: 'story-review-re-review',
    subject: mrSubject(826),
    kind: 'review-post',
    label: 'review gate !826',
    status: 'open',
    openedAt: minutesAgo(5),
    meta: reviewMeta,
    domain: 'review',
    origin: { ...tileOrigin, runId: '20261028-103324-937e-11805' },
    context: ctx({
      'gate-ctx': 'review@1',
      readiness: 'with-fixes',
      summary:
        'The region key is fixed and pinned by a two-region test. The stale-tile pushback holds up. The region-switch evidence is still missing, which is the one thing left before approval.',
      findings: { minor: 1 },
      round: 2,
      re_review: true,
      prior: { addressed: 2, still_open: 1 },
      editable: true,
      summaryComments: {
        comment:
          'Thanks for the updates! Replied on the threads; the evidence is the last thing for me.',
        approve:
          'Looks good to me, thanks for the quick turnaround! Replied on the threads.',
      },
    }),
    questions: [
      carryover(
        1,
        TILE_THREADS.key,
        `${CACHE}:31`,
        { post: true, resolve: true },
        {
          round: 1,
          call: 'fixed',
          file: `${CACHE}:31`,
          original: f1.comment,
          authorReply:
            'good catch. the region goes first in the key now, and there’s a test that asks two regions for the same tile.',
          note: 'tileKey (tileCache.ts:31) now starts with region; tileCache.test.ts:130 asks north and south for 6/12/18 and expects two fetches.',
          reply: 'thanks, that’s exactly it. resolving.',
        }
      ),
      carryover(
        2,
        TILE_THREADS.stale,
        `${CACHE}:58`,
        { post: true, resolve: true },
        {
          round: 1,
          call: 'pushback-accepted',
          file: `${CACHE}:58`,
          original: f2.comment,
          authorReply:
            'that’s on purpose: an old forecast beats a blank map when the tile service is down. i added a `stale` flag so the map can dim it, and the map work is ACME-3431.',
          note: 'the stale flag lands on the entry (tileCache.ts:61) and ACME-3431 covers dimming; serving old tiles during an outage is the documented product call.',
          reply:
            'fair, an old forecast is better than a blank map. the flag covers what i was after.',
        }
      ),
      carryover(
        3,
        TILE_THREADS.evidence,
        'General thread',
        { post: true, resolve: false },
        {
          round: 1,
          call: 'not-fixed',
          original: f3.comment,
          note: 'the description still has no capture of a region switch; no reply on the thread.',
          reply:
            'bumping this one: could you grab a quick capture of a region switch on the forecast map?',
        }
      ),
      question(
        'findings-1',
        'Post which findings to !826?',
        true,
        [
          opt(
            'n1',
            '[Minor] Stale flag is never cleared on a fresh fetch',
            `${CACHE}:54 · Set stale: false explicitly on the success path. · kind:nitpick`
          ),
        ],
        ctx({ 'gate-ctx': 'findings@1', findings: [N1] })
      ),
      question(
        'outcome',
        'Verdict on !826: ready once the evidence is up',
        false,
        [
          opt(
            'comment',
            'Comment (recommended)',
            'Posts the thread replies and the new finding, and leaves approval for later.'
          ),
          opt(
            'approve',
            'Approve',
            'Posts the thread replies and the new finding, and approves the MR.'
          ),
        ]
      ),
    ],
  },
};

// --- Respond: my MR, reviewed by Renee -------------------------------------

const PIN_MR = boardMr(
  831,
  'ACME-3436: keep station pins when the map re-centers',
  'pat',
  'acme-3436-keep-station-pins',
  [97, 22, 4],
  [0, 1]
);

const PIN_THREADS = {
  t1: '7b2e9c4a1d6f8e3b5a0c2d4f6e8a1b3c5d7e9f02',
  t2: 'e4a1c7b3d9f5e2a8c6b0d4f1e7a3c9b5d2f8e613',
  t3: '2c8f4a6e1b9d3f7a5c0e8b2d6f4a1c9e3b7d5f24',
  t4: '9d3b7f1e5a2c8d4b6f0a3e9c1d7b5f2a8e4c6d35',
  t5: 'f6a0d2c8e4b1f7a3d9c5e2b8f0a6d4c1e7b3f946',
};

const PIN_FILES = {
  t1: 'StationPins.tsx:48',
  t2: 'useMapCenter.ts:22',
  t3: 'StationPins.test.tsx:91',
  t4: 'stationLayer.ts:130',
  t5: 'General thread',
};

const PIN_PLAN = {
  t1: {
    fix: 'Key the pin list by station id instead of the array index.',
    claim:
      'the pins are keyed by index, so a re-center that reorders stations remounts every pin and drops the open popover.',
    note: 'confirmed: StationPins.tsx:48 keys by index, and the station list is re-sorted by distance on every re-center.',
    reply:
      'pins are keyed by station id now, so a re-center that reorders them keeps the open popover.',
  },
  t2: {
    fix: 'Read the center from the map’s moveend event instead of a 200ms poll.',
    claim:
      'polling the center every 200ms keeps a timer running while the map is idle; the map already fires `moveend`.',
    note: 'confirmed: useMapCenter.ts:22 sets an interval with no idle check, and moveend fires after every pan and zoom.',
    reply: 'switched to `moveend`, so nothing runs while the map is idle.',
  },
  t3: {
    fix: 'Add a test that re-centers with a popover open and expects it to stay open.',
    claim:
      'the tests only check pin count; nothing covers the bug the ticket is about, a popover closing on re-center.',
    note: 'confirmed: StationPins.test.tsx has no popover assertion.',
    reply:
      'added a test that opens a popover, re-centers, and expects it to stay open. it fails on main.',
  },
  t4: {
    fix: 'Drop the unused cluster radius export.',
    claim: '`CLUSTER_RADIUS` is exported but nothing imports it.',
    note: 'confirmed: no import of CLUSTER_RADIUS anywhere in the repo.',
    reply: 'dropped it.',
  },
};

const planThread = (
  n: number,
  key: keyof typeof PIN_PLAN,
  severity: 'blocking' | 'non-blocking'
) =>
  question(
    `thread-${n}`,
    PIN_FILES[key],
    false,
    [
      opt(
        `reply:${PIN_THREADS[key]}`,
        'Reply only',
        'Post the drafted reply and change no code.'
      ),
      opt(
        `fix:${PIN_THREADS[key]}`,
        'Fix the code (Recommended)',
        PIN_PLAN[key].fix
      ),
      opt(
        `skip:${PIN_THREADS[key]}`,
        'Skip this thread',
        'Post nothing and change nothing for this thread.'
      ),
    ],
    ctx({
      'gate-ctx': 'thread@1',
      author: 'renee',
      severity,
      claim: { summary: PIN_PLAN[key].claim },
      verdict: { call: 'valid', note: PIN_PLAN[key].note },
      reply: { kind: 'direction', text: PIN_PLAN[key].reply },
    })
  );

const pinOrigin = {
  presentation: 'form' as const,
  surface: 'board',
  tabId: 'w44:t1',
  worktree: `${TREES}/hazel`,
  paneId: 'w44:p1',
  runId: '20261028-091512-4c7d-11806',
};

export const respondPlan: StoryGate = {
  mr: PIN_MR,
  gate: {
    gateId: 'story-respond-plan',
    subject: mrSubject(831),
    kind: 'respond-plan',
    label: 'respond gate !831',
    status: 'open',
    openedAt: minutesAgo(9),
    meta: { label: 'respond gate !831' },
    domain: 'respond',
    origin: pinOrigin,
    context: ctx({
      'gate-ctx': 'plan@1',
      reviewer: 'renee',
      round: 1,
      threads: { total: 5, blocking: 1 },
      adjudication: '4 fix, 1 reply',
    }),
    questions: [
      planThread(1, 't1', 'blocking'),
      planThread(2, 't2', 'non-blocking'),
      planThread(3, 't3', 'non-blocking'),
      planThread(4, 't4', 'non-blocking'),
      question(
        'thread-5',
        PIN_FILES.t5,
        false,
        [
          opt(
            `reply:${PIN_THREADS.t5}`,
            'Reply only (Recommended)',
            'Post the drafted reply and change no code.'
          ),
          opt(
            `fix:${PIN_THREADS.t5}`,
            'Fix the code',
            'Nothing to change; the thread asks for a re-review ping.'
          ),
          opt(
            `skip:${PIN_THREADS.t5}`,
            'Skip this thread',
            'Post nothing and change nothing for this thread.'
          ),
        ],
        ctx({
          'gate-ctx': 'thread@1',
          author: 'renee',
          severity: 'none',
          claim: {
            summary:
              'Left a few comments, the index key one is the main one. Ping me when it’s ready for another look.',
          },
          verdict: {
            call: 'valid',
            note: 'process only; reply once threads 1-4 are in.',
          },
          reply: { kind: 'verbatim', text: 'Ready for another look!' },
        })
      ),
      question('code-changes', 'Approve the proposed code changes?', false, [
        opt('approve', 'Approve the changes'),
        opt('revise', 'Revise the proposal'),
        opt('skip', 'Skip code changes'),
      ]),
    ],
  },
};

const postThread = (
  n: number,
  key: keyof typeof PIN_THREADS,
  reply: { verb: 'reply' | 'fix'; text: string; sha?: string },
  resolvable = true
) =>
  question(
    `thread-${n}`,
    PIN_FILES[key],
    true,
    [
      opt(
        `post:${PIN_THREADS[key]}`,
        'Post this reply (Recommended)',
        'Post this reply to the thread.'
      ),
      ...(resolvable
        ? [
            opt(
              `resolve:${PIN_THREADS[key]}`,
              'Resolve the thread (Recommended)',
              'Resolve the thread after its reply.'
            ),
          ]
        : []),
    ],
    ctx({
      'gate-ctx': 'reply@1',
      thread: PIN_THREADS[key],
      file: PIN_FILES[key],
      ...reply,
    })
  );

/** The same MR after the fixes landed: four fix replies with their commits,
    and the re-review ping on the Overview thread, which GitLab cannot
    resolve. */
export const respondPost: StoryGate = {
  // The answered plan gate rides on the MR, as on the board, so each reply
  // card shows the reviewer's comment above it.
  mr: {
    ...PIN_MR,
    gates: [
      {
        ...respondPlan.gate,
        gateId: 'story-respond-plan-answered',
        status: 'answered',
        answers: {
          'thread-1': `fix:${PIN_THREADS.t1}`,
          'thread-2': `fix:${PIN_THREADS.t2}`,
          'thread-3': `fix:${PIN_THREADS.t3}`,
          'thread-4': `fix:${PIN_THREADS.t4}`,
          'thread-5': `reply:${PIN_THREADS.t5}`,
          'code-changes': 'approve',
        },
        answeredBy: 'board',
        answeredAt: minutesAgo(8),
      },
    ],
  } as BoardMRWithReview,
  gate: {
    gateId: 'story-respond-post',
    subject: mrSubject(831),
    kind: 'respond-post',
    label: 'respond gate !831',
    status: 'open',
    openedAt: minutesAgo(4),
    meta: { label: 'respond gate !831' },
    domain: 'respond',
    origin: pinOrigin,
    context: ctx({
      'gate-ctx': 'post@1',
      reviewer: 'renee',
      round: 1,
      replies: 5,
      fixes: [
        { sha: '3e7a9c1b5d2' },
        { sha: '8f2d4b6a0c9' },
        { sha: 'b5c1e7d3a9f' },
        { sha: '0a6e2c8f4b1' },
      ],
    }),
    questions: [
      postThread(1, 't1', {
        verb: 'fix',
        sha: '3e7a9c1b5d2',
        text: 'pins are keyed by station id now, so a re-center that reorders them keeps the open popover.',
      }),
      postThread(2, 't2', {
        verb: 'fix',
        sha: '8f2d4b6a0c9',
        text: 'switched to `moveend`, so nothing runs while the map is idle. the hook also stops listening on unmount now, which the poll never did.',
      }),
      postThread(3, 't3', {
        verb: 'fix',
        sha: 'b5c1e7d3a9f',
        text: 'added a test that opens a popover, re-centers, and expects it to stay open. it fails on main.',
      }),
      postThread(4, 't4', {
        verb: 'fix',
        sha: '0a6e2c8f4b1',
        text: 'dropped it.',
      }),
      postThread(
        5,
        't5',
        { verb: 'reply', text: 'Ready for another look!' },
        false
      ),
    ],
  },
};
