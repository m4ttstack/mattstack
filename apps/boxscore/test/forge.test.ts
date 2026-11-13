import { describe, expect, it } from 'vitest';

import {
  definitionOf,
  PANEL_COPY,
  subOf,
} from '../src/app/detail/panelCopy.js';
import { descriptor } from '../src/app/model/standings.js';
import { LOCKED_MESSAGE } from '../src/server/viewer-scope.js';
import {
  changeRef,
  changeUrl,
  forgeText,
  GITHUB_COPY,
} from '../src/shared/forge.js';
import { METRICS } from '../src/shared/metrics.js';
import type { MetricKey, TimeWindow } from '../src/shared/types.js';

describe('changeUrl', () => {
  it('points at a pull request on github', () => {
    expect(changeUrl('github', 'https://github.com', 'o/r', 7)).toBe(
      'https://github.com/o/r/pull/7'
    );
  });

  it('points at a merge request on gitlab, or when the forge is absent', () => {
    const want = 'https://gl.example/g/p/-/merge_requests/7';
    expect(changeUrl(undefined, 'https://gl.example', 'g/p', 7)).toBe(want);
    expect(changeUrl('gitlab', 'https://gl.example', 'g/p', 7)).toBe(want);
  });
});

describe('changeRef', () => {
  it('is #n on github and !n otherwise', () => {
    expect(changeRef('github', 12)).toBe('#12');
    expect(changeRef(undefined, 12)).toBe('!12');
    expect(changeRef('gitlab', 12)).toBe('!12');
  });
});

describe('forgeText', () => {
  const WINDOW: TimeWindow = {
    start: '2026-08-30T00:00:00.000Z',
    end: '2026-09-29T00:00:00.000Z',
    key: '30d',
  };
  const FACTS = { count: 3, p50: 1, p90: 2, bandLow: 10, bandHigh: 400 };

  function everyCopyString(): string[] {
    const out: string[] = [];
    for (const key of Object.keys(PANEL_COPY) as MetricKey[]) {
      const c = PANEL_COPY[key];
      out.push(c.source, subOf(key, WINDOW), definitionOf(key, FACTS));
    }
    for (const d of METRICS) out.push(d.label, d.description);
    out.push(
      LOCKED_MESSAGE,
      'GitLab /user lookup failed; no row is highlighted as you',
      'Fetching MR details',
      '12 distinct days with a push',
      'Pushes'
    );
    return out;
  }

  it('is the identity on gitlab and when the forge is absent', () => {
    for (const s of everyCopyString()) {
      expect(forgeText(s, 'gitlab')).toBe(s);
      expect(forgeText(s, undefined)).toBe(s);
    }
  });

  it('says PR and GitHub on github', () => {
    expect(forgeText('MRs merged', 'github')).toBe('PRs merged');
    expect(forgeText('Source: GitLab MRs you authored', 'github')).toBe(
      'Source: GitHub PRs you authored'
    );
    expect(forgeText('merge request', 'github')).toBe('pull request');
  });

  it('rewrites whole words only', () => {
    expect(forgeText('MRI', 'github')).toBe('MRI');
    expect(forgeText('SMR', 'github')).toBe('SMR');
  });

  it('names commits and Actions runs as the github sources', () => {
    expect(
      forgeText('Source: GitLab pushes to tracked projects', 'github')
    ).toBe('Source: GitHub commits on your PRs');
    expect(forgeText('Source: GitLab pipelines you triggered', 'github')).toBe(
      'Source: GitHub Actions runs you triggered'
    );
    expect(forgeText('12 distinct days with a push', 'github')).toBe(
      '12 distinct days with a commit'
    );
    expect(forgeText(descriptor('codingDays').description, 'github')).toBe(
      'Number of distinct days the user authored at least one commit on their PRs during the window.'
    );
  });

  it('takes the whole-string github copy before the word rewrite', () => {
    expect(GITHUB_COPY.Pushes).toBe('Commits');
    expect(forgeText('Pushes', 'github')).toBe('Commits');
    expect(forgeText(definitionOf('codingDays'), 'github')).toBe(
      'Distinct days you authored at least one commit on your PRs.'
    );
    const depth = forgeText(descriptor('reviewDepth').description, 'github');
    expect(depth).not.toContain('DiffNote');
    expect(depth).not.toMatch(/\bMRs?\b/);
    expect(forgeText(LOCKED_MESSAGE, 'github')).toBe(
      "boxscore couldn't tell who you are. Check that rt can read a GitHub token for one of boxscore's projects and that your GitHub username is on the team roster in console."
    );
  });

  it('leaves no MR word or GitLab in any github copy string', () => {
    for (const s of everyCopyString()) {
      const g = forgeText(s, 'github');
      expect(g).not.toMatch(/\bMRs?\b|GitLab|[Mm]erge requests?/);
    }
  });
});
