#!/usr/bin/env bun
/**
 * parseCodeownerSections: section headers only, verbatim, sorted, de-duplicated
 * the way GitLab merges them (case-insensitively, first casing kept). A path
 * rule containing brackets is not a header because it does not start with
 * one; an approvals count and default owners are not part of the name.
 */
import { describe, expect, test } from 'bun:test';
import { channelFromCodeownerSection, parseCodeownerSections } from '../src/codeowners.ts';

describe('parseCodeownerSections', () => {
  test('reads plain, optional, counted, defaulted and indented headers once each, first casing wins', () => {
    const text = [
      '# owners',
      '[Docs] @writers',
      '^[Optional Section]',
      '[Backend][2] @acme/backend-pod',
      '  [Indented]',
      'src/foo/[bar].ts @someone',
      '[DOCS] @again',
      '',
    ].join('\n');
    expect(parseCodeownerSections(text)).toEqual(['Backend', 'Docs', 'Indented', 'Optional Section']);
  });

  test('keeps spaces and a channel suffix verbatim', () => {
    expect(parseCodeownerSections('[Acme - #pod-acme] @acme/pod\r\n[Platform QA] @qa')).toEqual([
      'Acme - #pod-acme',
      'Platform QA',
    ]);
  });

  test('a file with no headers yields an empty list', () => {
    expect(parseCodeownerSections('* @everyone\n# note\n')).toEqual([]);
    expect(parseCodeownerSections('')).toEqual([]);
  });

  test('an empty bracket pair is not a section', () => {
    expect(parseCodeownerSections('[] @nobody\n[ ] @nobody')).toEqual([]);
  });
});

describe('channelFromCodeownerSection', () => {
  test('reads the channel a section name carries, without the hash', () => {
    expect(channelFromCodeownerSection('Acme - #pod-acme')).toBe('pod-acme');
    expect(channelFromCodeownerSection('Platform QA - #pod-qa_platform')).toBe('pod-qa_platform');
  });

  test('a name with no channel yields null', () => {
    expect(channelFromCodeownerSection('Platform QA')).toBeNull();
    expect(channelFromCodeownerSection('Issue #')).toBeNull();
    expect(channelFromCodeownerSection('')).toBeNull();
  });

  test('a hash inside a word is not a channel', () => {
    expect(channelFromCodeownerSection('C#Tools')).toBeNull();
  });

  test('the last channel wins when a name carries more than one', () => {
    expect(channelFromCodeownerSection('Acme #old - #pod-acme')).toBe('pod-acme');
  });

  test('lowercases the channel, as Slack names are', () => {
    expect(channelFromCodeownerSection('Acme - #Pod-Acme')).toBe('pod-acme');
  });
});
