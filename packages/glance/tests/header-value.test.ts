#!/usr/bin/env bun
/**
 * `headerValue` is shared by the Octokit client and the provider-agnostic
 * events watcher, so it must live in a module that imports nothing: the
 * watcher is its own build entrypoint and must not pull Octokit in.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { headerValue } from '../src/headers.ts';

describe('headerValue', () => {
  test('reads a plain object', () => {
    expect(headerValue({ 'retry-after': '7' }, 'retry-after')).toBe('7');
  });

  test('reads a Headers instance', () => {
    expect(headerValue(new Headers({ 'Retry-After': '9' }), 'retry-after')).toBe('9');
  });

  test('stringifies numbers and returns null for anything absent', () => {
    expect(headerValue({ 'retry-after': 7 }, 'retry-after')).toBe('7');
    expect(headerValue({}, 'retry-after')).toBeNull();
    expect(headerValue(undefined, 'retry-after')).toBeNull();
    expect(headerValue('nope', 'retry-after')).toBeNull();
  });

  test('the module imports nothing', () => {
    const source = readFileSync(new URL('../src/headers.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
