# Console evidence@2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The console run page shows every evidence@2 case, its captions and waivers, and a light/dark toggle, in the record, the story rows and the compare modal.

**Architecture:** Every console caller moves from `parseEvidence` to RT-483's `readEvidence` (v1 reads as one case). One helper module (`evidenceImages.ts`) answers every question the components ask of a case (slots, themes, the shot to show, its caption or waiver, its URL). A new server route serves an image by case, slot and theme; the design fixture gains WEB-421, a three-case run the new boards are drawn from.

**Tech Stack:** React 19, `@mattstack/app-kit` (Mantine 9.5), wouter, Hono, Vitest + Testing Library, the console's parity harness.

**Spec:** `docs/apps/design/console/2026-10-10-console-evidence-v2-design.md` (RT-484), built on RT-483's `docs/superpowers/specs/2026-10-10-evidence-v2-design.md`.

## Global Constraints

- Do not start until the shepherd says RT-483 has merged; then Task 0 rebases onto it.
- Write only under `apps/console/`, `docs/apps/design/console/` and `.superpowers/`. `packages/rt-client` is read-only (RT-483 owns it).
- Import the reader and its types from `@mattstack/rt-client/evidence`: `readEvidence`, `EvidenceRecord`, `EvidenceCase`, `EvidenceShot`, `EvidenceSlotName`, `EvidenceTheme`.
- No console caller keeps `parseEvidence`, `ParsedEvidence`, `EvidenceImageKey` or `EvidenceV1` after Task 6.
- Kit components only, from `@mattstack/app-kit/core`; colour only through `color`/`variant` props or `c="dimmed"`; no inline `style`, no raw colours; weights 400/500/700 (never 600); every `Text` states a size (`docs/apps/ui-authoring.md`).
- Waivers read calm: kit `Badge` `variant="light" color="gray"`, reason text `c="dimmed"`. Never `warn`/`bad`, no alert icon.
- Copy, verbatim: `waived`, `light + dark`, `light`, `No before image`, `Waived: <reason>`, `Waived` (an image under its case's own waiver), `<n> cases`, `, <k> waived`, `EVIDENCE · <n>`.
- `EVIDENCE · n` and the Evidence tab count cases for `version: 2`, links for `version: 0`.
- Run tests from `apps/console`: `bunx vitest run <files>`; typecheck `bun run typecheck`. Run only targeted tests locally.
- Commit after every task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No mattstack ticket ids in code or tests.
- Never kill processes by pattern; stop only PIDs you started.

## Review Focus

1. A `?compare=` link naming a case that does not exist (a stale link after the field was rewritten): opens the first case, never a blank modal. Test in Task 5.
2. `?theme=dark` on a case with no dark shot: shows the light shot, no theme control. Test in Task 5.
3. A themed slot with only `dark`: the record and story show the dark shot with `dark` after the phase, and the route needs `theme=dark`. Test in Task 1 (`shotIn` falls back to the dark shot) and Task 2 (the 404 test's "themed slot, no theme" row pins the route rule).
4. A one-case v1 run with no `case` text (label falls back to `Evidence`): no case head in the record, and the compare title is the ticket alone (`evidenceTitle(ticket)`). Test in Task 3 (head) and Task 5 (title).
5. A case id with characters a URL must escape is impossible (RT-483's id regex), but the route must still 404 an unknown case, slot `middle`, or `theme=sepia` rather than throw. Test in Task 2.

---

### Task 0: Rebase onto RT-483 and confirm the reader

**Files:** none changed.

- [ ] **Step 1: Rebase**

Run from the worktree root:
```bash
git fetch origin && git rebase origin/main
bun install --frozen-lockfile
(cd packages/rt-client && bun run build)
```
Expected: rebase clean (this branch only touches `apps/console` and `docs/apps/design/console`), build exits 0.

- [ ] **Step 2: Confirm the exports this plan relies on**

```bash
grep -n "export function readEvidence\|export interface EvidenceCase\|export interface EvidenceShot\|export type EvidenceRecord\|export type EvidenceTheme\|export type EvidenceSlotName" packages/rt-client/src/evidence.ts
grep -n "export function runEvidenceAt\|export function runEvidence" -A 12 packages/rt-client/src/client.ts
grep -n "evidence_cases" packages/rt-client/src/commands.ts
```
Expected: all six evidence exports; `runEvidence(runId, key, repo, opts)` unchanged and a new `runEvidenceAt(runId, address, repo?, opts?)` taking rt-client's own `EvidenceAddress` (`{ case, slot, theme?, annotated? }`); `evidence_cases?: number` on the run summary. The console's own address type is named `ShotAddress` so it never collides with rt-client's `EvidenceAddress`. If `runEvidenceAt`'s parameters differ, adapt Task 2's one call to them and say so in the task report.

---

### Task 1: Helpers over a case (`evidenceImages.ts`)

**Files:**
- Modify: `apps/console/src/app/runs/run-page/evidenceImages.ts` (rewrite the v1 parts)
- Test: `apps/console/src/app/runs/run-page/evidenceImages.test.ts` (rewrite)

**Interfaces:**
- Produces (every later task uses these names):

```ts
export type EvidenceCases = Extract<EvidenceRecord, { version: 2 }>;
export type EvidencePhase = EvidenceSlotName; // 'before' | 'after'
export type EvidenceVariant = 'plain' | 'annotated';
export type CompareMode = EvidencePhase | 'side';
export const PHASE_LABEL: Record<EvidencePhase, string>;
export const MODE_LABEL: Record<CompareMode, string>;
export function isCompareMode(value: string | null): value is CompareMode;
export function isTheme(value: string | null): value is EvidenceTheme;
export function urlLabel(url: string): string;
export function fileNameOf(path: string): string;
export function slotsOf(c: EvidenceCase): EvidencePhase[];
export function themesIn(c: EvidenceCase): EvidenceTheme[];
export function shotIn(c: EvidenceCase, slot: EvidencePhase, theme?: EvidenceTheme): EvidenceShot | null;
export function isWaived(shot: EvidenceShot): boolean;
export function phaseWaived(c: EvidenceCase, slot: EvidencePhase): boolean;
export function caseWaived(c: EvidenceCase): boolean;
export function badgesOf(c: EvidenceCase, slot?: EvidencePhase): string[];
export function shotLine(c: EvidenceCase, shot: EvidenceShot): { kind: 'caption' | 'waiver'; text: string } | null;
export function headLabel(rec: EvidenceCases, c: EvidenceCase): string | null;
export interface ShotAddress { caseId: string; slot: EvidencePhase; theme?: EvidenceTheme; annotated: boolean }
export function addressOf(c: EvidenceCase, slot: EvidencePhase, shot: EvidenceShot, variant?: EvidenceVariant): ShotAddress;
export function shownName(shot: EvidenceShot, variant?: EvidenceVariant): string;
export function evidenceUrl(repo: string, runId: string, a: ShotAddress): string;
export function transcriptUrl(repo: string, runId: string): string;
export function legacyImageUrl(repo: string, runId: string, path: string): string; // unchanged
```

- [ ] **Step 1: Write the failing tests**

Replace `evidenceImages.test.ts` with:

```ts
import { readEvidence } from '@mattstack/rt-client/evidence';
import { describe, expect, it } from 'vitest';

import {
  addressOf,
  badgesOf,
  caseWaived,
  evidenceUrl,
  headLabel,
  isTheme,
  phaseWaived,
  shotIn,
  shotLine,
  shownName,
  slotsOf,
  themesIn,
  transcriptUrl,
  type EvidenceCases,
} from './evidenceImages';

const E = '/fixture/evidence/web-421';
const V2 = {
  v: 2,
  cases: [
    {
      id: 'rush-window',
      label: 'Rush order, same-day window',
      before: { path: `${E}/rush-before.png`, annotated: `${E}/rush-before-annotated.png`, caption: 'Red box: no window' },
      after: { path: `${E}/rush-after.png`, annotated: `${E}/rush-after-annotated.png`, caption: 'Red box: window shows' },
    },
    {
      id: 'order-card-themes',
      label: 'Order card in light and dark',
      after: {
        light: { path: `${E}/card-after-light.png`, annotated: `${E}/card-after-light-annotated.png`, caption: 'Arrow: contrast' },
        dark: { path: `${E}/card-after-dark.png`, waiver: 'Same marks as light; only the theme differs' },
      },
    },
    {
      id: 'empty-state',
      label: 'No delivery window yet',
      after: { path: `${E}/empty-after.png` },
      waiver: 'Before and after are pixel-identical',
    },
    { id: 'dark-only', label: 'Dark only', after: { dark: { path: `${E}/d.png`, waiver: 'x' } } },
  ],
};

function cases(value: unknown): EvidenceCases {
  const rec = readEvidence(JSON.stringify(value));
  if (rec.version !== 2) throw new Error('expected cases');
  return rec;
}
const rec = cases(V2);
const [rush, themes, empty, darkOnly] = rec.cases;

describe('case helpers', () => {
  it('lists slots before then after, and themes light first', () => {
    expect(slotsOf(rush!)).toEqual(['before', 'after']);
    expect(slotsOf(themes!)).toEqual(['after']);
    expect(themesIn(themes!)).toEqual(['light', 'dark']);
    expect(themesIn(rush!)).toEqual([]);
    expect(themesIn(darkOnly!)).toEqual(['dark']);
  });

  it('picks the asked theme, else the slot’s first shot', () => {
    expect(shotIn(themes!, 'after', 'dark')?.theme).toBe('dark');
    expect(shotIn(themes!, 'after')?.theme).toBe('light');
    expect(shotIn(darkOnly!, 'after', 'light')?.theme).toBe('dark');
    expect(shotIn(rush!, 'after', 'dark')?.theme).toBeUndefined();
    expect(shotIn(themes!, 'before')).toBeNull();
  });

  it('calls a case or slot waived only when none of its images is annotated', () => {
    expect(caseWaived(empty!)).toBe(true);
    expect(caseWaived(themes!)).toBe(false);
    expect(phaseWaived(themes!, 'after')).toBe(false);
    expect(phaseWaived(empty!, 'after')).toBe(true);
    expect(phaseWaived(empty!, 'before')).toBe(false);
  });

  it('badges themes and a waived case', () => {
    expect(badgesOf(themes!)).toEqual(['light + dark']);
    expect(badgesOf(empty!)).toEqual(['waived']);
    expect(badgesOf(empty!, 'after')).toEqual(['waived']);
    expect(badgesOf(rush!)).toEqual([]);
  });

  it('says what an image shows: its caption, its own waiver, or Waived under the case’s', () => {
    expect(shotLine(rush!, shotIn(rush!, 'after')!)).toEqual({ kind: 'caption', text: 'Red box: window shows' });
    expect(shotLine(themes!, shotIn(themes!, 'after', 'dark')!)).toEqual({
      kind: 'waiver',
      text: 'Waived: Same marks as light; only the theme differs',
    });
    expect(shotLine(empty!, shotIn(empty!, 'after')!)).toEqual({ kind: 'waiver', text: 'Waived' });
  });

  it('heads a case with its label, except a v1 record’s fallback label', () => {
    expect(headLabel(rec, rush!)).toBe('Rush order, same-day window');
    const v1 = cases({ v: 1, before: '/a/b.png' });
    expect(headLabel(v1, v1.cases[0]!)).toBeNull();
    const named = cases({ v: 1, before: '/a/b.png', case: 'Rush order' });
    expect(headLabel(named, named.cases[0]!)).toBe('Rush order');
  });

  it('addresses the annotated image by default and the base when there is none', () => {
    const shot = shotIn(themes!, 'after', 'light')!;
    expect(addressOf(themes!, 'after', shot)).toEqual({ caseId: 'order-card-themes', slot: 'after', theme: 'light', annotated: true });
    expect(addressOf(themes!, 'after', shot, 'plain').annotated).toBe(false);
    expect(addressOf(empty!, 'after', shotIn(empty!, 'after')!)).toEqual({ caseId: 'empty-state', slot: 'after', annotated: false });
    expect(shownName(shot)).toBe('card-after-light-annotated.png');
    expect(shownName(shot, 'plain')).toBe('card-after-light.png');
  });

  it('builds the image and transcript URLs', () => {
    expect(evidenceUrl('remote:acme%2Fweb', '20261008-1210', { caseId: 'order-card-themes', slot: 'after', theme: 'dark', annotated: false })).toBe(
      '/api/runs/remote:acme%2Fweb/20261008-1210/evidence/order-card-themes/after?theme=dark'
    );
    expect(evidenceUrl('r', '1', { caseId: 'case', slot: 'before', annotated: true })).toBe('/api/runs/r/1/evidence/case/before?annotated=1');
    expect(transcriptUrl('r', '1')).toBe('/api/runs/r/1/evidence/transcript');
  });

  it('knows a theme', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('sepia')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/console && bunx vitest run src/app/runs/run-page/evidenceImages.test.ts`
Expected: FAIL (missing exports such as `slotsOf`).

- [ ] **Step 3: Implement**

Replace `evidenceImages.ts` with:

```ts
import type {
  EvidenceCase,
  EvidenceRecord,
  EvidenceShot,
  EvidenceSlotName,
  EvidenceTheme,
} from '@mattstack/rt-client/evidence';

export type EvidenceCases = Extract<EvidenceRecord, { version: 2 }>;
export type EvidencePhase = EvidenceSlotName;
export type EvidenceVariant = 'plain' | 'annotated';
export type CompareMode = EvidencePhase | 'side';

export const PHASE_LABEL: Record<EvidencePhase, string> = {
  before: 'Before',
  after: 'After',
};
export const MODE_LABEL: Record<CompareMode, string> = {
  ...PHASE_LABEL,
  side: 'Side by side',
};

const PHASES: EvidencePhase[] = ['before', 'after'];
const THEMES: EvidenceTheme[] = ['light', 'dark'];
/** What `readEvidence` names a v1 record's one case when it has no text. */
const V1_FALLBACK_LABEL = 'Evidence';

export function isCompareMode(value: string | null): value is CompareMode {
  return value === 'before' || value === 'after' || value === 'side';
}

export function isTheme(value: string | null): value is EvidenceTheme {
  return value === 'light' || value === 'dark';
}

/** A web link as a person reads it: no scheme. */
export function urlLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

export function fileNameOf(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function slotsOf(c: EvidenceCase): EvidencePhase[] {
  return PHASES.filter(p => (c[p]?.length ?? 0) > 0);
}

export function themesIn(c: EvidenceCase): EvidenceTheme[] {
  const seen = new Set(
    PHASES.flatMap(p => c[p] ?? []).flatMap(s => (s.theme ? [s.theme] : []))
  );
  return THEMES.filter(t => seen.has(t));
}

/** The slot's shot in the asked theme, else its first (light comes first). */
export function shotIn(
  c: EvidenceCase,
  slot: EvidencePhase,
  theme?: EvidenceTheme
): EvidenceShot | null {
  const shots = c[slot] ?? [];
  return shots.find(s => s.theme === theme) ?? shots[0] ?? null;
}

/** An image that goes out unmarked: no annotated copy, and a waiver. */
export function isWaived(shot: EvidenceShot): boolean {
  return !shot.annotated && !!shot.waiver;
}

/** A slot is waived when it has images and none of them is annotated. */
export function phaseWaived(c: EvidenceCase, slot: EvidencePhase): boolean {
  const shots = c[slot] ?? [];
  return shots.length > 0 && shots.every(isWaived);
}

/** A case is waived when none of its images is annotated. */
export function caseWaived(c: EvidenceCase): boolean {
  const shots = PHASES.flatMap(p => c[p] ?? []);
  return shots.length > 0 && shots.every(isWaived);
}

/** The quiet badges after a case's label: its themes, then waived. */
export function badgesOf(c: EvidenceCase, slot?: EvidencePhase): string[] {
  const waived = slot ? phaseWaived(c, slot) : caseWaived(c);
  return [
    ...(themesIn(c).length === 2 ? ['light + dark'] : []),
    ...(waived ? ['waived'] : []),
  ];
}

/** The line under an image: its caption, its own waiver, or "Waived" when
    the case's waiver (shown once under the case) covers it. */
export function shotLine(
  c: EvidenceCase,
  shot: EvidenceShot
): { kind: 'caption' | 'waiver'; text: string } | null {
  if (shot.annotated)
    return shot.caption ? { kind: 'caption', text: shot.caption } : null;
  if (!shot.waiver) return null;
  return {
    kind: 'waiver',
    text: shot.waiver === c.waiver ? 'Waived' : `Waived: ${shot.waiver}`,
  };
}

/** A case's heading, or none for a v1 record that named no case. */
export function headLabel(rec: EvidenceCases, c: EvidenceCase): string | null {
  return rec.source === 1 && c.label === V1_FALLBACK_LABEL ? null : c.label;
}

export interface ShotAddress {
  caseId: string;
  slot: EvidencePhase;
  theme?: EvidenceTheme;
  annotated: boolean;
}

/** Where a shot is served: annotated unless the plain one is asked for or
    there is no annotated copy. */
export function addressOf(
  c: EvidenceCase,
  slot: EvidencePhase,
  shot: EvidenceShot,
  variant: EvidenceVariant = 'annotated'
): ShotAddress {
  return {
    caseId: c.id,
    slot,
    ...(shot.theme ? { theme: shot.theme } : {}),
    annotated: variant === 'annotated' && !!shot.annotated,
  };
}

/** The file name of the image `addressOf` serves for the same variant. */
export function shownName(
  shot: EvidenceShot,
  variant: EvidenceVariant = 'annotated'
): string {
  return fileNameOf(
    variant === 'annotated' && shot.annotated ? shot.annotated : shot.path
  );
}

/** `repo` is already the wire form the run page carries (percent-encoded,
    possibly `remote:`-prefixed), so it goes in as it is. */
export function evidenceUrl(
  repo: string,
  runId: string,
  a: ShotAddress
): string {
  const query = new URLSearchParams();
  if (a.theme) query.set('theme', a.theme);
  if (a.annotated) query.set('annotated', '1');
  const qs = query.toString();
  return `/api/runs/${repo}/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(a.caseId)}/${a.slot}${qs ? `?${qs}` : ''}`;
}

export function transcriptUrl(repo: string, runId: string): string {
  return `/api/runs/${repo}/${encodeURIComponent(runId)}/evidence/transcript`;
}

/** A legacy run's image is addressed by the path its evidence text names. */
export function legacyImageUrl(
  repo: string,
  runId: string,
  path: string
): string {
  return `/api/runs/${repo}/${encodeURIComponent(runId)}/evidence-file?path=${encodeURIComponent(path)}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/console && bunx vitest run src/app/runs/run-page/evidenceImages.test.ts`
Expected: PASS. (The rest of the app does not typecheck until Task 6; that is expected and Task 6 ends with a clean typecheck.)

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/runs/run-page/evidenceImages.ts apps/console/src/app/runs/run-page/evidenceImages.test.ts
git commit -m "console evidence: helpers over an evidence@2 case"
```

---

### Task 2: Serve an image by case, slot and theme; fixture run WEB-421

**Files:**
- Modify: `apps/console/src/server/runs.ts` (new route beside `/evidence/:key`, around line 290)
- Modify: `apps/console/src/server/fixtures/design/runsFixture.ts` (`evidence` → `transcript` + `evidenceImage`, counts via `readEvidence`)
- Create: `apps/console/src/server/fixtures/design/runs/run-20261008-1210.json`
- Modify: `apps/console/src/server/fixtures/design/runs/runs.json` (hide the new run)
- Create: `apps/console/src/server/fixtures/design/files/evidence/web-421/*.png` (copies, below)
- Modify: `apps/console/src/server/fixtures/design/files/evidence/IMAGES.md`
- Test: `apps/console/src/server/fixtures/design/fixtureRoutes.test.ts`, `runsFixture.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (server code does not import app modules).
- Produces: `GET /api/runs/:repo/:runId/evidence/:case/:slot?theme=&annotated=1` (200 image bytes or 404 `{ error: 'no evidence' }`); `GET /api/runs/:repo/:runId/evidence/transcript` unchanged; fixture run `20261008-1210` (WEB-421).
- `RunsFixture` changes: `evidence(repo, runId, key)` is replaced by
  `transcript(repo: string, runId: string): Promise<FixtureEvidence | null>` and
  `evidenceImage(repo: string, runId: string, a: { caseId: string; slot: string; theme?: string; annotated: boolean }): Promise<FixtureEvidence | null>`.

- [ ] **Step 1: Add the fixture images**

```bash
cd apps/console/src/server/fixtures/design/files/evidence
mkdir -p web-421
cp web-409/before.png web-421/rush-before.png
cp web-409/after-annotated.png web-421/rush-before-annotated.png
cp web-409/after.png web-421/rush-after.png
cp web-409/after-annotated.png web-421/rush-after-annotated.png
for t in light dark; do
  cp web-401/before.png web-421/card-before-$t.png
  cp web-401/after.png web-421/card-before-$t-annotated.png
  cp web-401/after.png web-421/card-after-$t.png
done
cp web-401/after.png web-421/card-after-light-annotated.png
cp web-377/after.png web-421/empty-after.png
```
Append to `IMAGES.md`: `WEB-421 reuses the WEB-409 (desk), WEB-401 (lake) and WEB-377 (vegetables) files under its own names.`

- [ ] **Step 2: Write the fixture run**

Create `runs/run-20261008-1210.json` by copying `run-20261008-1142.json` and changing:
- `run.id` → `"20261008-1210"`, `run.started_at` → `"2026-10-08T12:10:00-05:00"`, `run.ended_at` → `"2026-10-08T13:40:00-05:00"`, `outcome.mr` → `{ "iid": 421, "state": "merged", "url": "https://gitlab.com/acme/web/-/merge_requests/421", "mergedAt": "2026-10-08T13:42:00-05:00" }`.
- `stages`: the same eight names, all `done`, back to back from 12:10: provision 1m, plan 10m, gates 1m, evidence 44m (12:22 → 13:06), implement 20m, self-review 3m, ship 6m (13:29 → 13:35), watch-ci 5m.
- `fields`: keep only the ticket/branch/title facts the hero needs from the 1142 file (ticket `WEB-421`, title `Show delivery windows on the order card`, branch `web-421-delivery-windows`), and this `evidence` field (`at` 13:34, `produced_by` `ship`) whose `value` is the JSON string of:

```json
{
  "v": 2,
  "cases": [
    {
      "id": "rush-window",
      "label": "Rush order, same-day window",
      "before": { "path": "/fixture/evidence/web-421/rush-before.png", "annotated": "/fixture/evidence/web-421/rush-before-annotated.png", "caption": "Red box: the order card shows no delivery window" },
      "after": { "path": "/fixture/evidence/web-421/rush-after.png", "annotated": "/fixture/evidence/web-421/rush-after-annotated.png", "caption": "Red box: \"Today, 2–4 PM\" now sits under the total" }
    },
    {
      "id": "order-card-themes",
      "label": "Order card in light and dark",
      "before": {
        "light": { "path": "/fixture/evidence/web-421/card-before-light.png", "annotated": "/fixture/evidence/web-421/card-before-light-annotated.png", "caption": "Red box: no window line under the total" },
        "dark": { "path": "/fixture/evidence/web-421/card-before-dark.png", "annotated": "/fixture/evidence/web-421/card-before-dark-annotated.png", "caption": "Red box: no window line under the total" }
      },
      "after": {
        "light": { "path": "/fixture/evidence/web-421/card-after-light.png", "annotated": "/fixture/evidence/web-421/card-after-light-annotated.png", "caption": "Arrow: the window keeps its contrast on the card" },
        "dark": { "path": "/fixture/evidence/web-421/card-after-dark.png", "waiver": "Same marks as light; only the theme differs" }
      }
    },
    {
      "id": "empty-state",
      "label": "No delivery window yet",
      "after": { "path": "/fixture/evidence/web-421/empty-after.png" },
      "waiver": "Before and after are pixel-identical"
    }
  ],
  "transcript": "/fixture/evidence/web-409/transcript-after.md",
  "url": "http://localhost:4001/orders/4821",
  "attach": "ship"
}
```
- No `decisions`, `gates` or other fields, so the story shows only the evidence and ship rows.
- Add `"20261008-1210"` to `scenarios.runs.hidden` in `runs.json`.

- [ ] **Step 3: Write the failing route tests**

In `fixtureRoutes.test.ts`, replace the `'serves evidence bytes and the transcript as text'` test with:

```ts
  it('serves an image by case, slot and theme, and the transcript as text', async () => {
    const v1 = await get(`${RUN}/20261008-1142/evidence/case/after?annotated=1`);
    expect(v1.status).toBe(200);
    expect(v1.headers.get('content-type')).toBe('image/png');
    const dark = await get(`${RUN}/20261008-1210/evidence/order-card-themes/after?theme=dark`);
    expect(dark.status).toBe(200);
    const waived = await get(`${RUN}/20261008-1210/evidence/empty-state/after`);
    expect(waived.status).toBe(200);
    const transcript = await get(`${RUN}/20261008-1142/evidence/transcript`);
    expect(transcript.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await transcript.text()).toContain('0 warnings, 0 errors');
  });

  it('answers 404 for anything the record does not hold', async () => {
    for (const path of [
      `${RUN}/20261008-1210/evidence/order-card-themes/after`, // themed slot, no theme
      `${RUN}/20261008-1210/evidence/rush-window/after?theme=dark`, // unthemed slot, a theme
      `${RUN}/20261008-1210/evidence/empty-state/after?annotated=1`, // no annotated copy
      `${RUN}/20261008-1210/evidence/nope/after`,
      `${RUN}/20261008-1210/evidence/rush-window/middle`,
      `${RUN}/20261008-1210/evidence/order-card-themes/after?theme=sepia`,
      `${RUN}/20261008-1338/evidence/case/after`,
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: 'no evidence' });
    }
  });
```

In `runsFixture.test.ts` add, beside the run-record test:

```ts
  it('WEB-421: three evidence@2 cases, counted by case and by image', async () => {
    const f = runsFixture('runs');
    const d = await f.getRun('remote:acme%2Fweb', '20261008-1210');
    expect(d?.run.evidence_cases).toBe(3);
    expect(d?.run.evidence_count).toBe(12);
    expect((await f.listRuns()).some(r => r.id === '20261008-1210')).toBe(false);
  });
```

(Images: rush 2+2, card before 2+2, card after 2+1, empty 1 = 12.)

- [ ] **Step 4: Run to verify they fail**

Run: `cd apps/console && bunx vitest run src/server/fixtures/design/fixtureRoutes.test.ts src/server/fixtures/design/runsFixture.test.ts`
Expected: FAIL (404 on the new paths; `evidence_cases` undefined).

- [ ] **Step 5: Implement the fixture**

In `runsFixture.ts`:
- Import `readEvidence` from `@mattstack/rt-client/evidence` and drop `parseEvidence`, `EvidenceImageKey`, `EvidenceTextKey`.
- Where the summary is built (around line 205):

```ts
  const evidence = readEvidence(value('evidence'));
  const shots =
    evidence.version === 2
      ? evidence.cases.flatMap(c => [...(c.before ?? []), ...(c.after ?? [])])
      : [];
  // ...
    evidence_count: shots.reduce((n, s) => n + (s.annotated ? 2 : 1), 0),
    evidence_cases: evidence.version === 2 ? evidence.cases.length : 0,
    evidence_links: evidence.version === 0 ? evidence.links.length : 0,
```
- `evidenceValue` returns `readEvidence(field?.value)`; `legacyEvidenceFile` checks `parsed.version !== 0` as before.
- Replace the `evidence` method and its interface entry with:

```ts
    async transcript(repo, runId) {
      const rec = await evidenceValue(repo, runId);
      const path = rec.version === 2 ? rec.transcript : undefined;
      return path ? fileOf(path) : null;
    },

    async evidenceImage(repo, runId, a) {
      const rec = await evidenceValue(repo, runId);
      if (rec.version !== 2) return null;
      const c = rec.cases.find(x => x.id === a.caseId);
      if (a.slot !== 'before' && a.slot !== 'after') return null;
      const shots = c?.[a.slot] ?? [];
      const themed = shots.some(s => s.theme);
      if (themed !== (a.theme !== undefined)) return null;
      const shot = shots.find(s => s.theme === a.theme);
      const path = a.annotated ? shot?.annotated : shot?.path;
      return path ? fileOf(path) : null;
    },
```
with a local helper:

```ts
  async function fileOf(path: string): Promise<FixtureEvidence | null> {
    const mime = MIME[extname(path).toLowerCase()];
    if (!mime) return null;
    return { mime, bytes: new Uint8Array(await readFile(onDisk(path))) };
  }
```

- [ ] **Step 6: Implement the route**

In `server/runs.ts`, the `/evidence/:key` handler's fixture branch becomes transcript-only:

```ts
        if (fixture) {
          const evidence =
            key === 'transcript'
              ? await fixture.transcript(canonicalRepo(rawRepo), runId)
              : null;
          if (!evidence) return c.json({ error: 'no evidence' }, 404);
          // ...unchanged Response...
        }
```
and add right after that handler (chained, inline, as every route here is):

```ts
      .get('/api/runs/:repo/:runId/evidence/:case/:slot', async c => {
        const { repo: rawRepo, runId, case: caseId, slot } = c.req.param();
        const theme = c.req.query('theme');
        const annotated = c.req.query('annotated') === '1';
        if (
          (slot !== 'before' && slot !== 'after') ||
          (theme !== undefined && theme !== 'light' && theme !== 'dark')
        )
          return c.json({ error: 'no evidence' }, 404);
        if (fixture) {
          const file = await fixture.evidenceImage(canonicalRepo(rawRepo), runId, {
            caseId,
            slot,
            theme,
            annotated,
          });
          if (!file) return c.json({ error: 'no evidence' }, 404);
          return new Response(file.bytes, {
            status: 200,
            headers: { 'content-type': file.mime, 'cache-control': 'private, max-age=3600' },
          });
        }
        const res = await runEvidenceAt(
          runId,
          { case: caseId, slot, ...(theme ? { theme } : {}), ...(annotated ? { annotated } : {}) },
          canonicalRepo(rawRepo),
          { sockPath: process.env.RT_SOCK_PATH }
        );
        if (!res.ok || !res.data?.base64)
          return c.json({ error: res.error ?? 'no evidence' }, 404);
        return new Response(Buffer.from(res.data.base64, 'base64'), {
          status: 200,
          headers: { 'content-type': res.data.mime, 'cache-control': 'private, max-age=3600' },
        });
      })
```
Import `runEvidenceAt` beside `runEvidence`. Drop `EvidenceImageKey` from the imports; the `/evidence/:key` real branch casts `key as EvidenceTextKey`. In `fixtureRoutes.test.ts`'s `vi.mock`, add `runEvidenceAt: vi.fn(daemon)` beside `runEvidence`.

- [ ] **Step 7: Run to verify they pass**

Run: `cd apps/console && bunx vitest run src/server/fixtures/design/ src/server/runs`
Expected: PASS. If `runsFixture.test.ts`'s existing `run-record` test reads `JSON.parse(field(d, 'evidence')!).case`, it still holds (WEB-409 stays v1).

- [ ] **Step 8: Commit**

```bash
git add apps/console/src/server apps/console/src/server/fixtures
git commit -m "console evidence: serve images by case, slot and theme; fixture run WEB-421"
```

---

### Task 3: Record column, one group per case

**Files:**
- Modify: `apps/console/src/app/runs/run-page/EvidenceCard.tsx` (`RecordColumn`, `CaseCard` removed, `V1Evidence` → `CaseEvidence`, props)
- Modify: `apps/console/src/app/runs/run-page/EvidenceCard.module.css` (`.caseGroup`, `.noBefore`)
- Modify: `apps/console/src/app/runs/run-page/RecordPage.tsx` (`readEvidence`, counts, `?tab=`)
- Modify: `apps/console/src/app/runs/run-page/TranscriptBlock.tsx` (use `transcriptUrl` if it builds the URL itself)
- Test: `apps/console/src/app/runs/run-page/EvidenceCard.test.tsx` (record variant block)

**Interfaces:**
- Consumes (Task 1): `EvidenceCases`, `slotsOf`, `shotIn`, `addressOf`, `shownName`, `shotLine`, `badgesOf`, `headLabel`, `evidenceUrl`, `PHASE_LABEL`.
- Produces:
  - `EvidenceCardProps.evidence: EvidenceRecord` (was `ParsedEvidence`).
  - `CompareOpen = { mode?: CompareMode; variant?: EvidenceVariant; caseId?: string; theme?: EvidenceTheme }` (defined in `EvidenceCompare.tsx`; add `caseId` and `theme` now, Task 5 uses them).
  - Parity names: `Evidence` › `title`, `attached`, `Case <id>` › `head` › `label`, `badge <text>`; `case waiver`; `pair` › `shot Before|After` › `img`, `cap` › `phase` (or `phase row` › `phase`, `theme`), `caption`|`waiver`; `no before` › `t`; `rule`.

- [ ] **Step 1: Write the failing tests**

In `EvidenceCard.test.tsx`, add a v2 sample and a new `describe` (keep the legacy tests; rewrite the v1 helper to `readEvidence`):

```ts
import { readEvidence } from '@mattstack/rt-client/evidence';

function v1Of(fields: Record<string, string>) {
  return readEvidence(JSON.stringify({ v: 1, ...fields }));
}
const BOTH = v1Of({ /* same fields as today */ });

const W = '/fixture/evidence/web-421';
const THREE = readEvidence(JSON.stringify({
  v: 2,
  cases: [
    { id: 'rush-window', label: 'Rush order, same-day window',
      before: { path: `${W}/rush-before.png`, annotated: `${W}/rush-before-annotated.png`, caption: 'Red box: no window' },
      after: { path: `${W}/rush-after.png`, annotated: `${W}/rush-after-annotated.png`, caption: 'Red box: window shows' } },
    { id: 'order-card-themes', label: 'Order card in light and dark',
      after: { light: { path: `${W}/l.png`, annotated: `${W}/l-annotated.png`, caption: 'Arrow: contrast' },
               dark: { path: `${W}/d.png`, waiver: 'Same marks as light' } } },
    { id: 'empty-state', label: 'No delivery window yet', after: { path: `${W}/empty-after.png` },
      waiver: 'Before and after are pixel-identical' },
  ],
  attach: 'ship',
}));

describe('EvidenceCard record variant, evidence@2', () => {
  it('draws one group per case under a case count', () => {
    const { container } = record({ evidence: THREE, mrIid: '421' });
    expect(screen.getByText('EVIDENCE · 3')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-parity^="Case "]')).toHaveLength(3);
    expect(screen.getByText('Rush order, same-day window')).toBeInTheDocument();
    expect(screen.queryByText('CASE USED')).not.toBeInTheDocument();
  });

  it('shows the annotated image and its caption, a theme label and badges', () => {
    const { container } = record({ evidence: THREE });
    expect(shownSrcs(container)).toContain(
      '/api/runs/remote:acme%2Fweb/20261008-1142/evidence/rush-window/after?annotated=1'
    );
    expect(screen.getByText('Red box: window shows')).toBeInTheDocument();
    expect(screen.getByText('light + dark')).toBeInTheDocument();
    expect(screen.getByText('light')).toBeInTheDocument();
  });

  it('reads a waived case calm: badge, the reason once, and Waived under its image', () => {
    record({ evidence: THREE });
    expect(screen.getByText('waived')).toBeInTheDocument();
    expect(screen.getByText('Waived: Before and after are pixel-identical')).toBeInTheDocument();
    expect(screen.getByText('Waived')).toBeInTheDocument();
  });

  it('keeps After in its column when a case has no before', () => {
    record({ evidence: THREE });
    expect(screen.getAllByText('No before image')).toHaveLength(2);
  });

  it('opens compare on the case, phase and theme of the thumbnail clicked', async () => {
    const onCompare = vi.fn();
    record({ evidence: THREE, onCompare });
    await userEvent.click(screen.getByRole('button', { name: 'Open l-annotated.png full size' }));
    expect(onCompare).toHaveBeenCalledWith({
      caseId: 'order-card-themes', mode: 'after', theme: 'light', variant: 'annotated',
    });
  });

  it('draws a v1 run as one pair with no head when it named no case', () => {
    const { container } = record({ evidence: v1Of({ before: '/a/before.png', after: '/a/after.png' }) });
    expect(screen.getByText('EVIDENCE · 1')).toBeInTheDocument();
    expect(container.querySelector('[data-parity="head"]')).toBeNull();
  });
});
```
Update the existing record tests: `'draws Before and After thumbnails with their captions and the count'` now expects `EVIDENCE · 1` and the annotated after (`/evidence/case/after?annotated=1`); `'shows the case used'` becomes `'heads the pair with the case label'` expecting `Rush order, Sep 14 delay, Denver` and no `CASE USED`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/console && bunx vitest run src/app/runs/run-page/EvidenceCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the record column**

In `EvidenceCard.tsx`, replace `RecordColumn` and remove `CaseCard`:

```tsx
/** One image of a case in the record: its thumbnail, the phase (and theme
    when the slot has one), then its caption or waiver. */
function CaseShot({ repo, runId, c, phase, onCompare }: {
  repo: string; runId: string; c: EvidenceCase; phase: EvidencePhase;
  onCompare: (open: CompareOpen) => void;
}) {
  const shot = shotIn(c, phase, 'light');
  if (!shot)
    return (
      <div className={classes.noBefore} data-parity={`no ${phase}`}>
        <Text fz="sm" lh="normal" c="dimmed" data-parity="t">
          {`No ${phase} image`}
        </Text>
      </div>
    );
  const name = shownName(shot);
  const line = shotLine(c, shot);
  return (
    <Stack gap={6} className={classes.thumb} data-parity={`shot ${PHASE_LABEL[phase]}`}>
      <ThumbFrame>
        <EvidenceImage
          src={evidenceUrl(repo, runId, addressOf(c, phase, shot))}
          name={name}
          cover
          onOpen={() =>
            onCompare({ caseId: c.id, mode: phase, theme: shot.theme, variant: 'annotated' })
          }
        />
      </ThumbFrame>
      <Stack gap={2} data-parity="cap">
        {shot.theme ? (
          <Group gap={6} wrap="nowrap" data-parity="phase row">
            <Text fz="sm" lh="normal" fw={500} data-parity="phase">{PHASE_LABEL[phase]}</Text>
            <Text fz="sm" lh="normal" c="dimmed" data-parity="theme">{shot.theme}</Text>
          </Group>
        ) : (
          <Text fz="sm" lh="normal" fw={500} data-parity="phase">{PHASE_LABEL[phase]}</Text>
        )}
        {line ? (
          <Text fz="sm" lh="normal" c={line.kind === 'waiver' ? 'dimmed' : undefined} data-parity={line.kind}>
            {line.text}
          </Text>
        ) : null}
      </Stack>
    </Stack>
  );
}

/** The quiet gray badges after a case's label. */
function CaseBadges({ c, phase }: { c: EvidenceCase; phase?: EvidencePhase }) {
  return badgesOf(c, phase).map(b => (
    <Badge key={b} variant="light" color="gray" size="sm" data-parity={`badge ${b}`}>
      {b}
    </Badge>
  ));
}

/** One case in the record: its head, the case's own waiver, and Before and
    After side by side (an empty column keeps After on the right). */
function CaseGroup({ repo, runId, rec, c, onCompare }: {
  repo: string; runId: string; rec: EvidenceCases; c: EvidenceCase;
  onCompare: (open: CompareOpen) => void;
}) {
  const label = headLabel(rec, c);
  const phases = slotsOf(c);
  return (
    <Stack gap={10} data-parity={`Case ${c.id}`}>
      {label ? (
        <Group gap={8} wrap="nowrap" data-parity="head">
          <Text fz="md" lh="normal" fw={500} truncate data-parity="label">{label}</Text>
          <CaseBadges c={c} />
        </Group>
      ) : null}
      {c.waiver ? (
        <Text fz="sm" lh="normal" c="dimmed" data-parity="case waiver">{`Waived: ${c.waiver}`}</Text>
      ) : null}
      <div className={classes.thumbs} data-parity="pair">
        {(phases.length === 1 ? (['before', 'after'] as const) : phases).map(p => (
          <CaseShot key={p} repo={repo} runId={runId} c={c} phase={p} onCompare={onCompare} />
        ))}
      </div>
    </Stack>
  );
}

function RecordColumn({ repo, runId, rec, mrIid, onCompare }: {
  repo: string; runId: string; rec: EvidenceCases; mrIid?: string | null;
  onCompare: (open: CompareOpen) => void;
}) {
  return (
    <Paper variant="ground" withBorder radius={12} className={classes.recordCard} data-parity="Evidence">
      <Stack gap={16}>
        <Group justify="space-between" wrap="nowrap">
          <Eyebrow data-parity="title">{`EVIDENCE · ${rec.cases.length}`}</Eyebrow>
          {rec.attach === 'ship' && mrIid ? (
            <Text fz="md" lh="normal" c="dimmed" data-parity="attached">attached to !{mrIid}</Text>
          ) : null}
        </Group>
        {rec.cases.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 ? <Divider data-parity="rule" /> : null}
            <CaseGroup repo={repo} runId={runId} rec={rec} c={c} onCompare={onCompare} />
          </Fragment>
        ))}
        {rec.transcript ? <TranscriptBlock repo={repo} runId={runId} /> : null}
      </Stack>
    </Paper>
  );
}
```
Note `slotsOf` drives which columns draw: a case with both slots draws both; a case with one draws both columns so the missing one shows `No before image` (or `No after image`). Add `Badge`, `Divider` to the kit import and `Fragment` from react.

In `EvidenceCard.module.css` add:

```css
.noBefore {
  min-width: 0;
  padding-top: 2px;
}
```

Rename `V1Evidence` to `CaseEvidence` taking `evidence: EvidenceCases`; `EvidenceCard` branches `version === 0` (legacy, unchanged), `version === 2` (`CaseEvidence`), else `null`. Its own compare modal passes the record and ticket (Task 5 finalises those props; for now pass `record={evidence}`, `ticket={ticket}`).

If `TranscriptBlock.tsx` builds `/evidence/transcript` itself, switch it to `transcriptUrl(repo, runId)`.

- [ ] **Step 4: RecordPage**

In `RecordPage.tsx`:
- `const evidence = kind === 'work' ? readEvidence(evidenceValue ?? undefined) : null;`
- `const comparable = evidence?.version === 2 ? evidence : null;`
- tab count: `evidence?.version === 2 ? evidence.cases.length : evidence?.version === 0 ? evidence.links.length || undefined : undefined`
- Initial tab: also honour `?tab=<story|evidence|inputs>` (read with `useSearch`), so a link and the parity board can open the Evidence tab:

```tsx
const askedTab = new URLSearchParams(search).get('tab');
const [tab, setTab] = useState<RecordTab | null>(() =>
  comparable && link.mode ? 'evidence'
  : askedTab === 'story' || askedTab === 'evidence' || askedTab === 'inputs' ? askedTab
  : null
);
```
(an asked tab the run does not have falls back to Story because `shown` is checked against `tabs` when rendering: use `const shown = tab && tabs.includes(tab) ? tab : 'story';`).
- The compare modal block passes `record={comparable}` and `ticket={facts.hero.ticket}` (Task 5 wires the rest).

`?tab=evidence` has no unit test of its own: the `runs-ev-record` parity board (Task 7) loads the record through it, so a broken `?tab=` fails that board.

- [ ] **Step 5: Run to verify they pass**

Run: `cd apps/console && bunx vitest run src/app/runs/run-page/EvidenceCard.test.tsx src/app/runs/run-page/evidenceImages.test.ts`
Expected: PASS for the record and legacy blocks (story-variant tests are rewritten in Task 4; mark none as skipped: if one fails only because it is a story test, leave it failing and say so; Task 4 fixes it).

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/app/runs/run-page
git commit -m "console evidence: record column draws every case, its caption and waiver"
```

---

### Task 4: Story rows, one shot per case

**Files:**
- Modify: `apps/console/src/app/runs/derive/story.ts` (`evidencePhases`, `evidenceSummary`, `stageSummary` signature)
- Modify: `apps/console/src/app/runs/run-page/StageRow.tsx` (`readEvidence` in `StageNavItem` and `StagePane`)
- Modify: `apps/console/src/app/runs/run-page/EvidenceCard.tsx` (`StoryEvidence`)
- Test: `apps/console/src/app/runs/derive/story.test.ts`, `EvidenceCard.test.tsx` (story block)

**Interfaces:**
- Consumes (Task 1): `EvidenceCases`, `shotIn`, `addressOf`, `shownName`, `shotLine`, `badgesOf`, `phaseWaived`, `evidenceUrl`, `urlLabel`. (Task 3): `CaseBadges`, `Thumb`, `UrlLink`, `CompareOpen`.
- Produces: `stageSummary(entry: StoryEntry, evidence: EvidenceRecord | null = null): string`.
- Parity names (board `runs-ev-story`, root `Story list`): `Stage <stage>` › `body` › `strip` › `case` › `img`, `label line` › `label`, `badge <text>`; `caption`|`waiver`; `links` › `link` › `i`, `t`; `open`.

- [ ] **Step 1: Write the failing tests**

In `story.test.ts`, switch the import to `readEvidence` and add:

```ts
  it('places each case’s before in the evidence section and after in ship', () => {
    const evidence = JSON.stringify({
      v: 2,
      cases: [
        { id: 'a', label: 'A', before: { path: '/e/a.png', annotated: '/e/a-x.png', caption: 'c' }, after: { path: '/e/b.png', annotated: '/e/b-x.png', caption: 'c' } },
        { id: 'b', label: 'B', after: { path: '/e/c.png' }, waiver: 'same' },
      ],
    });
    const story = liveStory(input({
      stages: [st('evidence', 1, 'done', 0, 10), st('implement', 1, 'done', 10, 20), st('ship', 1, 'done', 20, 30)],
      fields: [fld('evidence', 25, evidence)],
    }));
    expect(story.entries.map(e => [e.attempt.stage, e.evidence])).toEqual([
      ['evidence', 'before'],
      ['ship', 'after'],
    ]);
  });
```
and in the `stageSummary` describe:

```ts
  it('counts cases and waived cases for several, screenshots for one', () => {
    const three = readEvidence(JSON.stringify({
      v: 2,
      cases: [
        { id: 'a', label: 'A', after: { path: '/e/a.png', annotated: '/e/a-x.png', caption: 'c' } },
        { id: 'b', label: 'B', after: { light: { path: '/e/l.png', annotated: '/e/l-x.png', caption: 'c' }, dark: { path: '/e/d.png', waiver: 'w' } } },
        { id: 'c', label: 'C', after: { path: '/e/c.png' }, waiver: 'same' },
      ],
      url: 'http://x/1',
    }));
    expect(stageSummary(entryOf({ evidence: 'after' }), three)).toBe('3 cases, 1 waived');
    expect(stageSummary(entryOf({ evidence: 'after', evidenceUrl: true }), three)).toBe('3 cases, 1 waived, 1 link');
    const one = readEvidence(JSON.stringify({ v: 1, before: '/a.png', beforeAnnotated: '/a-x.png' }));
    expect(stageSummary(entryOf({ evidence: 'before' }), one)).toBe('2 screenshots');
  });
```
Keep the existing v1 summary tests, now fed through `readEvidence` (`v1` built with `readEvidence(JSON.stringify({ v: 1, ... }))`); their expected strings do not change.

In `EvidenceCard.test.tsx`'s story block add:

```ts
  it('draws one annotated shot per case for several cases, with label and line', () => {
    const { container } = story({ evidence: THREE, phase: 'after' });
    expect(container.querySelectorAll('[data-parity="case"]')).toHaveLength(3);
    expect(shownSrcs(container)).toEqual([
      '/api/runs/remote:acme%2Fweb/20261008-1142/evidence/rush-window/after?annotated=1',
      '/api/runs/remote:acme%2Fweb/20261008-1142/evidence/order-card-themes/after?theme=light&annotated=1',
      '/api/runs/remote:acme%2Fweb/20261008-1142/evidence/empty-state/after',
    ]);
    expect(screen.getByText('Waived: Before and after are pixel-identical')).toBeInTheDocument();
    expect(screen.getByText('waived')).toBeInTheDocument();
  });

  it('keeps a one-case run as today: plain then annotated, each named', () => {
    const { container } = story({ phase: 'after' });
    expect(shownSrcs(container)).toEqual([`${BASE}/case/after`, `${BASE}/case/after?annotated=1`]);
    expect(screen.getByText('after.png')).toBeInTheDocument();
    expect(screen.getByText('after-annotated.png')).toBeInTheDocument();
  });
```
Update the existing story tests' expected URLs from `${BASE}/before` style to `${BASE}/case/before` and `${BASE}/case/before?annotated=1`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/console && bunx vitest run src/app/runs/derive/story.test.ts src/app/runs/run-page/EvidenceCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the derive changes**

In `story.ts`:

```ts
import { legacyItems, readEvidence, type EvidenceRecord } from '@mattstack/rt-client/evidence';

function evidencePhases(value: string | undefined): StoryEvidence[] {
  const rec = readEvidence(value);
  if (rec.version === 0) return ['legacy'];
  if (rec.version !== 2) return [];
  const has = (p: 'before' | 'after') => rec.cases.some(c => (c[p]?.length ?? 0) > 0);
  return [...(has('before') ? (['before'] as const) : []), ...(has('after') ? (['after'] as const) : [])];
}
```
`stageSummary(entry, evidence: EvidenceRecord | null = null)` and:

```ts
function evidenceSummary(evidence: EvidenceRecord, phase: StoryEvidence, entryUrl: boolean): string | null {
  const parts: string[] = [];
  if (evidence.version === 0) {
    let shots = 0;
    let links = 0;
    for (const item of legacyItems(evidence.links)) if (item.kind === 'image') shots += 1; else links += 1;
    if (shots > 0) parts.push(counted(shots, 'screenshot'));
    if (links > 0) parts.push(counted(links, 'link'));
  } else if (evidence.version === 2 && phase !== 'legacy') {
    const inPhase = evidence.cases.filter(c => (c[phase]?.length ?? 0) > 0);
    if (evidence.cases.length === 1) {
      const shots = (inPhase[0]?.[phase] ?? []).reduce((n, s) => n + (s.annotated ? 2 : 1), 0);
      if (shots > 0) parts.push(counted(shots, 'screenshot'));
    } else if (inPhase.length > 0) {
      const waived = inPhase.filter(c => (c[phase] ?? []).every(s => !s.annotated && !!s.waiver)).length;
      parts.push(counted(inPhase.length, 'case') + (waived > 0 ? `, ${waived} waived` : ''));
    }
    if (entryUrl && evidence.url) parts.push(counted(1, 'link'));
  }
  return parts.length > 0 ? parts.join(', ') : null;
}
```
(`story.ts` is a derive module and does not import from `run-page/`, so the waived rule is restated inline; keep it identical to `phaseWaived`.)

In `StageRow.tsx`, both `parseEvidence(evidenceField?.value)` calls become `readEvidence(evidenceField?.value)`.

- [ ] **Step 4: Implement the story evidence**

Replace `StoryEvidence` in `EvidenceCard.tsx`:

```tsx
/** One case in a several-case story row: its annotated shot (or the waived
    base), then its label, badges and line. */
function CaseThumb({ repo, runId, c, phase, onCompare }: {
  repo: string; runId: string; c: EvidenceCase; phase: EvidencePhase;
  onCompare: (open: CompareOpen) => void;
}) {
  const shot = shotIn(c, phase, 'light')!;
  const line = shotLine(c, shot);
  return (
    <Stack gap={4} className={classes.storyThumb} data-parity="case">
      <ThumbFrame>
        <EvidenceImage
          src={evidenceUrl(repo, runId, addressOf(c, phase, shot))}
          name={shownName(shot)}
          cover
          onOpen={() => onCompare({ caseId: c.id, mode: phase, theme: shot.theme, variant: 'annotated' })}
        />
      </ThumbFrame>
      <Group gap={6} wrap="nowrap" data-parity="label line">
        <Text fz="sm" lh="normal" fw={500} truncate data-parity="label">{c.label}</Text>
        <CaseBadges c={c} phase={phase} />
      </Group>
      {line ? (
        <Text fz="sm" lh="normal" c={line.kind === 'waiver' ? 'dimmed' : undefined} data-parity={line.kind}>
          {line.kind === 'waiver' && line.text === 'Waived' && c.waiver ? `Waived: ${c.waiver}` : line.text}
        </Text>
      ) : null}
    </Stack>
  );
}

function StoryEvidence({ repo, runId, rec, phase: only, withUrl, onCompare }: {
  repo: string; runId: string; rec: EvidenceCases; phase?: EvidencePhase;
  withUrl: boolean; onCompare: (open: CompareOpen) => void;
}) {
  const phase = only ?? (['before', 'after'] as const).find(p => rec.cases.some(c => c[p]?.length));
  if (!phase) return null;
  const inPhase = rec.cases.filter(c => (c[phase]?.length ?? 0) > 0);
  if (inPhase.length === 0) return null;
  const url = withUrl ? rec.url : undefined;
  const one = rec.cases.length === 1 ? inPhase[0]! : null;
  const shot = one ? shotIn(one, phase, 'light')! : null;
  return (
    <Stack gap={12}>
      <div className={classes.strip} data-parity="strip">
        {one && shot
          ? (['plain', 'annotated'] as const)
              .filter(v => v === 'plain' || shot.annotated)
              .map(variant => (
                <Thumb
                  key={variant}
                  src={evidenceUrl(repo, runId, addressOf(one, phase, shot, variant))}
                  name={shownName(shot, variant)}
                  size="story"
                  line={variant === 'annotated' || !shot.annotated ? shotLine(one, shot) : null}
                  onOpen={() => onCompare({ caseId: one.id, mode: phase, theme: shot.theme, variant })}
                />
              ))
          : inPhase.map(c => (
              <CaseThumb key={c.id} repo={repo} runId={runId} c={c} phase={phase} onCompare={onCompare} />
            ))}
      </div>
      <Group gap={16} wrap="wrap" className={classes.links} data-parity="links">
        {url ? <UrlLink url={url} /> : null}
        <Anchor component="button" type="button" fz="md" lh="normal" c="accent" onClick={() => onCompare({ mode: phase })} data-parity="open">
          Open full size →
        </Anchor>
      </Group>
    </Stack>
  );
}
```
`Thumb` gains an optional `line?: { kind: 'caption' | 'waiver'; text: string } | null` drawn as a `Text fz="sm" lh="normal"` (`c="dimmed"` for a waiver) with `data-parity={line.kind}` under the file name. `UrlLink`'s `Anchor` gets `data-parity="link"`.

- [ ] **Step 5: Run to verify they pass**

Run: `cd apps/console && bunx vitest run src/app/runs/derive/story.test.ts src/app/runs/run-page/EvidenceCard.test.tsx src/app/runs/run-page/StageRow.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/app/runs/derive apps/console/src/app/runs/run-page
git commit -m "console evidence: story rows show every case, counted by case"
```

---

### Task 5: Compare modal: case picker, theme toggle, captions, link

**Files:**
- Modify: `apps/console/src/app/runs/run-page/EvidenceCompare.tsx`
- Modify: `apps/console/src/app/runs/run-page/EvidenceCompare.module.css` (`.caseSelect` width)
- Modify: `apps/console/src/app/runs/run-page/RecordPage.tsx` (link → modal, modal → link)
- Modify: `apps/console/src/app/runs/run-page/EvidenceCard.tsx` (`CaseEvidence`'s own modal props)
- Test: `apps/console/src/app/runs/run-page/EvidenceCompare.test.tsx`

**Interfaces:**
- Consumes (Task 1): `EvidenceCases`, `slotsOf`, `themesIn`, `shotIn`, `shotLine`, `addressOf`, `shownName`, `headLabel`, `evidenceUrl`, `isCompareMode`, `isTheme`, `MODE_LABEL`, `PHASE_LABEL`. (Task 3): `evidenceTitle`, `CompareOpen`.
- Produces:

```ts
export interface CompareOpen { mode?: CompareMode; variant?: EvidenceVariant; caseId?: string; theme?: EvidenceTheme }
export interface CompareShown { caseId: string; mode: CompareMode; theme?: EvidenceTheme }
export function useCompareLink(): {
  open: CompareOpen | null;       // from ?compare, ?case, ?theme; null when ?compare is absent or not a mode
  asked: string | null;           // the raw ?compare value
  clear: () => void;              // drops compare, case and theme
  sync: (shown: CompareShown) => void; // rewrites compare/case/theme (replace), only while ?compare is present
};
export interface EvidenceCompareProps extends CompareOpen {
  repo: string; runId: string; record: EvidenceCases; ticket?: string | null;
  onClose: () => void; onShow?: (shown: CompareShown) => void;
}
```
- Parity names (board `runs-ev-compare`, app root `Compare modal`): `head` › `t`, `case select`, `theme`, `seg`; `img`; `cap` › `phase`, `caption`|`waiver`.

- [ ] **Step 1: Write the failing tests**

Rewrite `EvidenceCompare.test.tsx`'s fixture to `readEvidence` (v1 sample as today, plus `THREE` from Task 3's tests, copied in full into this file) and add:

```ts
describe('EvidenceCompare, several cases', () => {
  const open = (p: Partial<EvidenceCompareProps> = {}) =>
    renderWithProviders(
      <EvidenceCompare repo={REPO} runId={RUN} record={THREE} ticket="WEB-421" onClose={vi.fn()} {...p} />
    );

  it('titles itself with the ticket and offers every case', async () => {
    open();
    expect(await screen.findByText('WEB-421')).toBeInTheDocument();
    const picker = screen.getByRole('textbox', { name: 'Case' });
    expect(picker).toHaveValue('Rush order, same-day window');
  });

  it('shows the theme control only for a case with both themes', async () => {
    open();
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull();
    cleanup();
    open({ caseId: 'order-card-themes', theme: 'dark', mode: 'after' });
    expect(await screen.findByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByText('Waived: Same marks as light')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute(
      'src', '/api/runs/remote:acme%2Fweb/20261008-1142/evidence/order-card-themes/after?theme=dark'
    );
  });

  it('opens the first case for an unknown case and light for an absent theme', async () => {
    open({ caseId: 'gone', theme: 'dark', mode: 'side' });
    expect(await screen.findByRole('textbox', { name: 'Case' })).toHaveValue('Rush order, same-day window');
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull();
  });

  it('keeps the mode when the new case has it, else takes its last', async () => {
    const onShow = vi.fn();
    open({ mode: 'side', onShow });
    await userEvent.click(screen.getByRole('textbox', { name: 'Case' }));
    await userEvent.click(await screen.findByRole('option', { name: 'No delivery window yet' }));
    expect(onShow).toHaveBeenLastCalledWith({ caseId: 'empty-state', mode: 'after' });
  });

  it('writes the caption under each frame side by side', async () => {
    open({ mode: 'side' });
    expect(await screen.findByText('Red box: no window')).toBeInTheDocument();
    expect(screen.getByText('Red box: window shows')).toBeInTheDocument();
  });

  it('titles a v1 run that named no case with the ticket alone', async () => {
    renderWithProviders(
      <EvidenceCompare repo={REPO} runId={RUN} ticket="WEB-409" onClose={vi.fn()}
        record={readEvidence(JSON.stringify({ v: 1, before: '/a/b.png', after: '/a/c.png' })) as EvidenceCases} />
    );
    expect(await screen.findByText('WEB-409')).toBeInTheDocument();
  });
});
```
Existing single-case tests keep their assertions; their `evidence=` prop becomes `record=` and `title=` becomes `ticket="WEB-409"` (the title then reads `WEB-409 · Rush order, Sep 14 delay, Denver`, as today).

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/console && bunx vitest run src/app/runs/run-page/EvidenceCompare.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the modal**

Key parts of the new `EvidenceCompare.tsx` (keep `EvidenceModal` and `EvidenceFrame` as they are):

```tsx
const COMPARE_PARAM = 'compare';
const CASE_PARAM = 'case';
const THEME_PARAM = 'theme';

export function useCompareLink() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const asked = params.get(COMPARE_PARAM);
  const theme = params.get(THEME_PARAM);
  const open: CompareOpen | null = isCompareMode(asked)
    ? { mode: asked, caseId: params.get(CASE_PARAM) ?? undefined, theme: isTheme(theme) ? theme : undefined }
    : null;
  const write = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      navigate(qs ? `${location}?${qs}` : location, { replace: true });
    },
    [location, navigate]
  );
  const clear = useCallback(() => {
    const next = new URLSearchParams(search);
    if (!next.has(COMPARE_PARAM)) return;
    for (const k of [COMPARE_PARAM, CASE_PARAM, THEME_PARAM]) next.delete(k);
    write(next);
  }, [search, write]);
  const sync = useCallback(
    (shown: CompareShown) => {
      const next = new URLSearchParams(search);
      if (!next.has(COMPARE_PARAM)) return;
      next.set(COMPARE_PARAM, shown.mode);
      next.set(CASE_PARAM, shown.caseId);
      if (shown.theme) next.set(THEME_PARAM, shown.theme);
      else next.delete(THEME_PARAM);
      if (next.toString() !== new URLSearchParams(search).toString()) write(next);
    },
    [search, write]
  );
  return { open, asked, clear, sync };
}

function modesOf(c: EvidenceCase): CompareMode[] {
  const phases = slotsOf(c);
  return phases.length > 1 ? [...phases, 'side'] : phases;
}

export function EvidenceCompare({ repo, runId, record, ticket, mode: askedMode, caseId: askedCase, theme: askedTheme, variant = 'annotated', onClose, onShow }: EvidenceCompareProps) {
  const first = record.cases[0]!;
  const [caseId, setCaseId] = useState(
    record.cases.some(c => c.id === askedCase) ? askedCase! : first.id
  );
  const c = record.cases.find(x => x.id === caseId) ?? first;
  const modes = modesOf(c);
  const [mode, setMode] = useState<CompareMode>(
    askedMode && modes.includes(askedMode) ? askedMode : (modes.at(-1) ?? 'before')
  );
  const themes = themesIn(c);
  const [theme, setTheme] = useState<EvidenceTheme | undefined>(
    askedTheme && themes.includes(askedTheme) ? askedTheme : themes[0]
  );
  const shownMode = modes.includes(mode) ? mode : (modes.at(-1) ?? 'before');
  const shownTheme = theme && themes.includes(theme) ? theme : themes[0];

  useEffect(() => {
    onShow?.({ caseId: c.id, mode: shownMode, ...(shownTheme ? { theme: shownTheme } : {}) });
  }, [c.id, shownMode, shownTheme, onShow]);

  const several = record.cases.length > 1;
  const title = several ? (ticket ?? 'Evidence') : evidenceTitle(ticket, headLabel(record, c) ?? undefined);
  const phases: EvidencePhase[] = shownMode === 'side' ? slotsOf(c) : [shownMode];

  return (
    <EvidenceModal
      title={title}
      onClose={onClose}
      parityRoot="Compare modal"
      controls={
        <>
          {several ? (
            <Select
              aria-label="Case"
              value={c.id}
              onChange={v => v && setCaseId(v)}
              data={record.cases.map(x => ({ value: x.id, label: x.label }))}
              allowDeselect={false}
              classNames={{ root: classes.caseSelect }}
              data-parity="case select"
            />
          ) : null}
          {themes.length === 2 ? (
            <SegmentedControl
              aria-label="Theme"
              value={shownTheme}
              onChange={v => setTheme(v as EvidenceTheme)}
              data={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
              data-parity="theme"
            />
          ) : null}
          {modes.length > 1 ? (
            <SegmentedControl
              aria-label="Before, after or side by side"
              value={shownMode}
              onChange={v => setMode(v as CompareMode)}
              data={modes.map(m => ({ value: m, label: MODE_LABEL[m] }))}
              data-parity="seg"
            />
          ) : null}
        </>
      }
    >
      <div className={classes.images} data-side={shownMode === 'side' ? 'true' : 'false'}>
        {phases.map(p => {
          const shot = shotIn(c, p, shownTheme);
          if (!shot) return null;
          const line = shotLine(c, shot);
          return (
            <Stack key={p} gap={6} className={classes.column}>
              <EvidenceFrame src={evidenceUrl(repo, runId, addressOf(c, p, shot, variant))} name={shownName(shot, variant)} />
              <Stack gap={2} data-parity="cap">
                <Text fz="md" fw={500} lh="normal" truncate data-parity="phase">
                  {shownMode === 'side' ? PHASE_LABEL[p] : shownName(shot, variant)}
                </Text>
                {line ? (
                  <Text fz="md" lh="normal" c={line.kind === 'waiver' ? 'dimmed' : undefined} data-parity={line.kind}>
                    {line.kind === 'waiver' && line.text === 'Waived' && c.waiver ? `Waived: ${c.waiver}` : line.text}
                  </Text>
                ) : null}
              </Stack>
            </Stack>
          );
        })}
      </div>
    </EvidenceModal>
  );
}
```
`EvidenceCompare.module.css` add `.caseSelect { width: 280px; }`. The `Select` comes from `@mattstack/app-kit/core`; Mantine's `Select` input is a textbox whose accessible name is the `aria-label`.

- [ ] **Step 4: Wire the record page and the card**

`RecordPage.tsx`:

```tsx
const link = useCompareLink();
const [compare, setCompare] = useState<CompareOpen | null>(() => (comparable && link.open ? link.open : null));
const [tab, setTab] = useState<RecordTab | null>(() => (comparable && link.open ? 'evidence' : /* ?tab= rule from Task 3 */ ...));
const staleLink = link.asked !== null && compare === null;
// ...
{comparable && compare ? (
  <EvidenceCompare
    repo={repo}
    runId={runId}
    record={comparable}
    ticket={facts.hero.ticket}
    {...compare}
    onShow={link.sync}
    onClose={() => { setCompare(null); link.clear(); }}
  />
) : null}
```
`EvidenceCard.tsx` `CaseEvidence`'s own modal: `<EvidenceCompare repo={repo} runId={runId} record={evidence} ticket={ticket} {...own} onClose={() => setOwn(null)} />`.

- [ ] **Step 5: Run to verify they pass**

Run: `cd apps/console && bunx vitest run src/app/runs/run-page/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/app/runs/run-page
git commit -m "console evidence: compare modal picks a case and a theme, with captions"
```

---

### Task 6: Stories, typecheck and the last `parseEvidence` callers

**Files:**
- Modify: `apps/console/src/app/runs/run-page/EvidenceCard.stories.tsx`, `EvidenceCompare.stories.tsx`, `RecordPage.stories.tsx`, `RunPage.stories.tsx` (whichever build evidence values)
- Modify: any remaining console file `grep` finds below

- [ ] **Step 1: Find every remaining caller**

Run: `cd apps/console && grep -rn "parseEvidence\|ParsedEvidence\|EvidenceImageKey\|EvidenceV1\b\|EvidenceV1Parsed\|shotsOf\|phasesIn\|variantsIn\|shotFor" src scripts`
Expected after this task: no matches (tests included).

- [ ] **Step 2: Move each to `readEvidence`**

Stories build values with `readEvidence(JSON.stringify(...))`; add an `EvidenceCard` story `Record · three cases` and `Story · three cases` and an `EvidenceCompare` story `Three cases · dark` using the WEB-421 value from Task 2 (paths `/fixture/evidence/web-421/...`).

- [ ] **Step 3: Typecheck, lint and the whole run-page suite**

Run: `cd apps/console && bun run typecheck && bun run lint && bunx vitest run src/app/runs src/server`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/console
git commit -m "console evidence: stories and the last parseEvidence callers move to readEvidence"
```

---

### Task 7: Parity boards, README and browser check

**Files:**
- Modify: `apps/console/scripts/parity/boards.ts`
- Modify: `docs/apps/design/console/README.md` (an "Evidence v2" section: boards table, board-fix list)
- Modify: `apps/console/scripts/parity/run.md` (roots table rows)

- [ ] **Step 1: Add the boards**

In `boards.ts`, after `runs-p2-search`:

```ts
  runsBoard(
    'runs-ev-record',
    'Evidence v2 · Record (3 cases)',
    'fk63W',
    `${RUN}/20261008-1210?tab=evidence`,
    ['Evidence'],
    1180
  ),
  runsBoard(
    'runs-ev-story',
    'Evidence v2 · Story rows · B · one shot per case (3 cases)',
    'u5oje',
    `${RUN}/20261008-1210`,
    ['Story list'],
    820,
    {
      // The board draws the evidence and ship rows open.
      action: { kind: 'clicks', layers: ['Stage evidence', 'Stage ship'], waitFor: 'strip' },
    }
  ),
  runsBoard(
    'runs-ev-compare',
    'Evidence v2 · Compare (case, theme)',
    'Yhu2H',
    `${RUN}/20261008-1210?compare=side&case=order-card-themes&theme=dark`,
    ['Compare'],
    960,
    { appRoots: { Compare: 'Compare modal' } }
  ),
```
(Check `runs-p2-story-details`' action for how a stage row is opened; if the row opens from a child layer rather than `Stage <name>`, use the same layer it uses.)

- [ ] **Step 2: Run the parity gate**

Follow `apps/console/scripts/parity/run.md` with these ports, so no other lane's harness is touched: fixture server `PORT=11197`, Vite `--port 5317` with `CONSOLE_API_PORT=11197`, harness `PARITY_HARNESS_PORT=11198` (and the matching `appOrigin` override the run.md describes). Run `runs-ev-record`, `runs-ev-story`, `runs-ev-compare`, `runs-p2-record`, `runs-p2-story-details` and `runs-p2-overlays`, light and dark.
Expected: 0 mismatches outside the board-fix list. Every kit-versus-board difference found (Badge padding and its `l` label layer, Select and SegmentedControl sizes, the kit Modal frame, the transcript block, the real photos in place of the board's shapes, the `Case` card and the plain thumbnail gone from runs-p2-record, the compare `cap` now a stack on runs-p2-overlays) goes into the README's board-fix list under a new "Evidence v2" heading, one line each, as the existing sections do.

- [ ] **Step 3: README**

Add an "Evidence v2" section to `docs/apps/design/console/README.md`: the three boards (slug, frame, light id, dark id, route, roots: `fk63W`/`KawsQ`, `u5oje`/`E7Qki`, `Yhu2H`/`F0mno7`), option A (`KILKv`/`B22iH`) kept for the record and never compared, the WEB-421 fixture run, and the board-fix list from Step 2. Add the three rows to `run.md`'s roots table.

- [ ] **Step 4: Browser check (mandatory UI validation)**

Using the same fixture servers, dispatch `fast-browser:browser-driver` (model haiku, effort medium, with the rules' ask-back paragraph) to screenshot at 1440 wide, light and dark, into the scratchpad:
1. `http://localhost:5317/runs/remote%3Aacme%2Fweb/20261008-1210?tab=evidence` (record, three cases),
2. `http://localhost:5317/runs/remote%3Aacme%2Fweb/20261008-1210` with the evidence and ship rows opened (story),
3. `http://localhost:5317/runs/remote%3Aacme%2Fweb/20261008-1210?compare=side&case=order-card-themes&theme=dark` (compare, light/dark case),
4. `...?compare=after&case=empty-state` (the waived case),
5. `http://localhost:5317/runs/remote%3Aacme%2Fweb/20261008-1142?tab=evidence` (a v1 run, unchanged apart from the annotated thumbnail and the case head).
Look at every screenshot yourself and write down plainly what reads wrong; fix it, or list it in the task report.

- [ ] **Step 5: Commit**

```bash
git add apps/console/scripts/parity docs/apps/design/console/README.md
git commit -m "console evidence: parity boards, README and board-fix list"
```

---

## Self-review notes

- Spec coverage: data and helpers (T1), addressing and route (T2), count (T2 summary, T3 card and tab), record column (T3), story rows and summary (T4), compare modal and link (T5), waivers calm (T1 badge rule, T3–T5 copy), legacy and v1 (T3–T5 tests), fixture (T2), boards and parity (T7), error handling (T2 404s, T5 unknown case/theme), testing (every task), browser screenshots (T7).
- MAT-429 and a Plain/Annotated control stay out of scope, as the spec says.
