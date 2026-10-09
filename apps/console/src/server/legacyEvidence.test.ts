import { describe, expect, it } from 'vitest';

import { legacyImageAllowed, legacyImagePath } from './legacyEvidence';

const root = '/home/u/.mattstack/evidence';
const real = (p: string) => (p.startsWith('/link') ? '/etc/passwd.png' : p);
const asObject = JSON.stringify({
  before: `${root}/web-412/before.png`,
});
const named = `${root}/web-412/before.png http://localhost:4001/orders`;

describe('legacyImageAllowed', () => {
  it('allows an image the run names inside the evidence root', () => {
    expect(
      legacyImageAllowed({
        evidence: named,
        path: `${root}/web-412/before.png`,
        realpath: real,
        evidenceRoot: root,
      })
    ).toBe(true);
  });
  it('refuses a path the run does not name', () => {
    expect(
      legacyImageAllowed({
        evidence: named,
        path: `${root}/web-999/x.png`,
        realpath: real,
        evidenceRoot: root,
      })
    ).toBe(false);
  });
  it('refuses a named path that resolves outside the root', () => {
    expect(
      legacyImageAllowed({
        evidence: '/link/x.png',
        path: '/link/x.png',
        realpath: real,
        evidenceRoot: root,
      })
    ).toBe(false);
  });
  it('refuses a named path whose root-prefixed name only shares the root as a prefix', () => {
    expect(
      legacyImageAllowed({
        evidence: `${root}-other/x.png`,
        path: `${root}-other/x.png`,
        realpath: real,
        evidenceRoot: root,
      })
    ).toBe(false);
  });
  it('refuses a non-image', () => {
    expect(
      legacyImageAllowed({
        evidence: `${root}/web-412/run.log`,
        path: `${root}/web-412/run.log`,
        realpath: real,
        evidenceRoot: root,
      })
    ).toBe(false);
  });
  it('refuses a missing file', () => {
    expect(
      legacyImageAllowed({
        evidence: named,
        path: `${root}/web-412/before.png`,
        realpath: () => null,
        evidenceRoot: root,
      })
    ).toBe(false);
  });
  it('refuses a v1 evidence value', () => {
    expect(
      legacyImageAllowed({
        evidence: JSON.stringify({
          v: 1,
          before: `${root}/web-412/before.png`,
        }),
        path: `${root}/web-412/before.png`,
        realpath: real,
        evidenceRoot: root,
      })
    ).toBe(false);
  });
  it('refuses a null evidence value', () => {
    expect(
      legacyImageAllowed({
        evidence: null,
        path: `${root}/web-412/before.png`,
        realpath: real,
        evidenceRoot: root,
      })
    ).toBe(false);
  });

  it('allows an image named in a JSON-object evidence value', () => {
    expect(
      legacyImageAllowed({
        evidence: asObject,
        path: `${root}/web-412/before.png`,
        realpath: real,
        evidenceRoot: root,
      })
    ).toBe(true);
  });
  it('refuses a JSON-object path the run does not name, a link out of the root and a non-image', () => {
    const log = JSON.stringify({ log: `${root}/web-412/run.log` });
    const link = JSON.stringify({ before: '/link/x.png' });
    const check = (evidence: string, path: string) =>
      legacyImageAllowed({
        evidence,
        path,
        realpath: real,
        evidenceRoot: root,
      });
    expect(check(asObject, `${root}/web-999/x.png`)).toBe(false);
    expect(check(link, '/link/x.png')).toBe(false);
    expect(check(log, `${root}/web-412/run.log`)).toBe(false);
  });
});

describe('legacyImagePath', () => {
  it('returns the resolved path the caller must read', () => {
    const named = `${root}/web-412/before.png`;
    expect(
      legacyImagePath({
        evidence: named,
        path: named,
        realpath: p => (p === named ? `${root}/web-412/real.png` : p),
        evidenceRoot: root,
      })
    ).toBe(`${root}/web-412/real.png`);
  });
  it('returns null for a refused path', () => {
    expect(
      legacyImagePath({
        evidence: '/link/x.png',
        path: '/link/x.png',
        realpath: real,
        evidenceRoot: root,
      })
    ).toBeNull();
  });
});
