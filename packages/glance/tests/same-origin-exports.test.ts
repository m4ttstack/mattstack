#!/usr/bin/env bun
/**
 * The daemon, setup probes and Boxscore send tokens through glance's one
 * same-origin redirect implementation, so the package entry exports it.
 */
import { describe, expect, test } from 'bun:test';
import * as glance from '../src/index.ts';
import { fetchSameOrigin, mayFollowRedirect } from '../src/sameOriginFetch.ts';

describe('package entry exports the same-origin redirect helpers', () => {
  test('fetchSameOrigin and mayFollowRedirect are the sameOriginFetch implementations', () => {
    expect((glance as Record<string, unknown>).fetchSameOrigin).toBe(fetchSameOrigin);
    expect((glance as Record<string, unknown>).mayFollowRedirect).toBe(mayFollowRedirect);
  });
});
