#!/usr/bin/env bun
/**
 * GitHub fetchCodeownerSections: the owner list of the default branch's
 * CODEOWNERS file, read in one GraphQL request.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { GITHUB_CODEOWNERS_PATHS, parseGitHubCodeowners } from '../src/codeowners.ts';
import { stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

type Blob = { text: string | null; isTruncated: boolean } | null;

function repoWith(blobs: { gh?: Blob; root?: Blob; docs?: Blob }) {
  return { repository: { gh: blobs.gh ?? null, root: blobs.root ?? null, docs: blobs.docs ?? null } };
}

const blob = (text: string | null, isTruncated = false): Blob => ({ text, isTruncated });

describe('parseGitHubCodeowners', () => {
  test('lowercases, dedupes, sorts, drops emails and trailing comments', () => {
    const text = [
      '# comment',
      '*       @Org/Platform  @alice',
      '/docs/  docs@example.com @org/docs # trailing',
      '*.js    @ALICE'
    ].join('\n');
    expect(parseGitHubCodeowners(text)).toEqual(['@alice', '@org/docs', '@org/platform']);
  });

  test('a blank or comment-only file has no owners', () => {
    expect(parseGitHubCodeowners('')).toEqual([]);
    expect(parseGitHubCodeowners('# only\n\n  # comment\n')).toEqual([]);
  });

  test('documented locations', () => {
    expect([...GITHUB_CODEOWNERS_PATHS]).toEqual(['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']);
  });
});

describe('GitHubProvider.fetchCodeownerSections', () => {
  const provider = () => new GitHubProvider('https://github.com', 'tok');

  test('the .github file wins over the root file, in one request', async () => {
    const { urls } = stubForge({
      graphql: () => repoWith({ gh: blob('* @gh-owner'), root: blob('* @root-owner') })
    });
    expect(await provider().fetchCodeownerSections({ projectPath: 'o/r' })).toEqual(['@gh-owner']);
    expect(urls.length).toBe(1);
  });

  test('the docs file is used when it is the only one', async () => {
    stubForge({ graphql: () => repoWith({ docs: blob('* @Docs-Owner') }) });
    expect(await provider().fetchCodeownerSections({ projectPath: 'o/r' })).toEqual(['@docs-owner']);
  });

  test('no file at any location is null', async () => {
    stubForge({ graphql: () => repoWith({}) });
    expect(await provider().fetchCodeownerSections({ projectPath: 'o/r' })).toBeNull();
  });

  test('a present blob with no text throws', async () => {
    stubForge({ graphql: () => repoWith({ root: blob(null) }) });
    await expect(provider().fetchCodeownerSections({ projectPath: 'o/r' })).rejects.toThrow(/CODEOWNERS/);
  });

  test('a truncated blob throws', async () => {
    stubForge({ graphql: () => repoWith({ gh: blob('* @a', true) }) });
    await expect(provider().fetchCodeownerSections({ projectPath: 'o/r' })).rejects.toThrow(/CODEOWNERS/);
  });

  test('a null repository throws', async () => {
    stubForge({ graphql: () => ({ repository: null }) });
    await expect(provider().fetchCodeownerSections({ projectPath: 'o/r' })).rejects.toThrow();
  });
});
