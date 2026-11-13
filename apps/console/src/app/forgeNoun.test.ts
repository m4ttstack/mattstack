import { describe, expect, it } from 'vitest';

import {
  eitherNoun,
  forgeOf,
  mixedNouns,
  mrLongNoun,
  mrNoun,
  mrNouns,
  mrRefText,
  noMrYet,
} from './forgeNoun';

const GITHUB_ID = 'remote:github.com%2Fowner%2Frepo';
const GITLAB_ID = 'remote:gitlab.example.com%2Fgroup%2Frepo';

describe('forgeOf', () => {
  it('reads only github.com itself as GitHub', () => {
    expect(
      forgeOf('https://notgithub.com.example.org/o/r/-/merge_requests/7')
    ).toBe('gitlab');
  });

  it('reads GitHub from a URL', () => {
    expect(forgeOf('https://github.com/o/r/pull/7')).toBe('github');
    expect(forgeOf('HTTPS://GitHub.com/o/r/pull/7')).toBe('github');
  });

  it('reads GitLab from any other forge URL', () => {
    expect(forgeOf('https://gitlab.example.com/g/p/-/merge_requests/7')).toBe(
      'gitlab'
    );
  });

  it('reads the host of a serialized repo identity', () => {
    expect(forgeOf(GITHUB_ID)).toBe('github');
    expect(forgeOf(GITLAB_ID)).toBe('gitlab');
  });

  it('reads the host of an mrKey', () => {
    expect(forgeOf(`${GITHUB_ID}!12`)).toBe('github');
    expect(forgeOf(`${GITLAB_ID}!12`)).toBe('gitlab');
  });

  it('takes the first hint that names a forge', () => {
    expect(forgeOf(null, undefined, GITHUB_ID)).toBe('github');
    expect(forgeOf('https://gitlab.example.com/x', GITHUB_ID)).toBe('gitlab');
  });

  it('is unknown without a host', () => {
    expect(forgeOf()).toBeNull();
    expect(forgeOf(null, '')).toBeNull();
    expect(forgeOf('path:%2FUsers%2Fme%2Frepo')).toBeNull();
    expect(forgeOf('remote:acme%2Fweb')).toBeNull();
    expect(forgeOf('repo-tools')).toBeNull();
    expect(forgeOf('https://')).toBeNull();
  });
});

describe('nouns', () => {
  it('says PR on GitHub', () => {
    expect(mrNoun('github')).toBe('PR');
    expect(mrNouns('github')).toBe('PRs');
    expect(mrLongNoun('github')).toBe('pull request');
    expect(mrRefText('github', 12)).toBe('#12');
  });

  it('says MR on GitLab', () => {
    expect(mrNoun('gitlab')).toBe('MR');
    expect(mrNouns('gitlab')).toBe('MRs');
    expect(mrLongNoun('gitlab')).toBe('merge request');
    expect(mrRefText('gitlab', '12')).toBe('!12');
  });

  it('reads an unknown forge as GitLab', () => {
    expect(mrNoun(null)).toBe('MR');
    expect(mrNouns(null)).toBe('MRs');
    expect(mrLongNoun(null)).toBe('merge request');
    expect(mrRefText(null, 12)).toBe('!12');
  });

  it('names both forges for a missing MR when the forge is unknown', () => {
    expect(noMrYet('github')).toBe('no PR yet');
    expect(noMrYet('gitlab')).toBe('no MR yet');
    expect(noMrYet(null)).toBe('no MR or PR yet');
  });
});

describe('nouns for a list that may mix forges', () => {
  it('uses the forge’s noun when one is known', () => {
    expect(eitherNoun('github')).toBe('PR');
    expect(mixedNouns('github')).toBe('PRs');
    expect(eitherNoun('gitlab')).toBe('MR');
    expect(mixedNouns('gitlab')).toBe('MRs');
  });

  it('names both forges when none is known', () => {
    expect(eitherNoun(null)).toBe('MR or PR');
    expect(mixedNouns(null)).toBe('MRs and PRs');
  });
});
