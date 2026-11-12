import { describe, expect, test } from 'bun:test';

import type { BoardConfig } from '../config.ts';
import { projectPathFromWebUrl } from '../data.ts';
import { daemonOwnerIo } from '../run-owner-io.ts';

type ForgeCfg = Pick<BoardConfig, 'forge' | 'projects'>;
const GH: ForgeCfg = {
  forge: { kind: 'github', host: 'https://github.com' },
  projects: ['acme/widgets'],
};
const GL: ForgeCfg = {
  forge: { kind: 'gitlab', host: 'https://gitlab.example.com' },
  projects: ['g/p'],
};

describe('projectPathFromWebUrl on a forge', () => {
  test('a GitHub PR URL parses to owner/repo, with or without a tail', () => {
    for (const tail of ['', '/files', '#discussion_r12', '?w=1'])
      expect(
        projectPathFromWebUrl(
          `https://github.com/acme/widgets/pull/7${tail}`,
          GH
        )
      ).toBe('acme/widgets');
  });
  test('a case-different GitHub URL returns the configured spelling', () => {
    expect(
      projectPathFromWebUrl('https://github.com/Acme/Widgets/pull/7', GH)
    ).toBe('acme/widgets');
    expect(
      projectPathFromWebUrl('https://github.com/Acme/Widgets/pull/7', {
        ...GH,
        projects: [],
      })
    ).toBe('Acme/Widgets');
  });
  test('dotted and dashed GitHub names parse', () => {
    expect(
      projectPathFromWebUrl('https://github.com/my.org/repo-name.js/pull/3', GH)
    ).toBe('my.org/repo-name.js');
  });
  test('the wrong forge or a non-PR URL returns null', () => {
    expect(
      projectPathFromWebUrl(
        'https://gitlab.example.com/g/p/-/merge_requests/1',
        GH
      )
    ).toBeNull();
    expect(
      projectPathFromWebUrl('https://github.com/acme/widgets/pull/7', GL)
    ).toBeNull();
    expect(
      projectPathFromWebUrl('https://github.com/acme/widgets/issues/7', GH)
    ).toBeNull();
  });
  test('GitLab parsing is unchanged', () => {
    expect(
      projectPathFromWebUrl(
        'https://gitlab.example.com/g/p/-/merge_requests/1',
        GL
      )
    ).toBe('g/p');
    expect(
      projectPathFromWebUrl(
        'https://gitlab.example.com/G/P/-/merge_requests/1',
        GL
      )
    ).toBe('G/P');
  });
  test('daemonOwnerIo slugs a GitHub MR by the configured spelling', () => {
    expect(
      daemonOwnerIo(GH).repoSlugForMr('https://github.com/Acme/Widgets/pull/7')
    ).toBe('github.com-acme-widgets');
  });
});
