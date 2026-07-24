import { describe, test, expect } from 'bun:test';
import { extractLinearId } from '../src/core/linear.ts';

describe('extractLinearId', () => {
  test('extracts ID from feat/ENG-123', () => {
    expect(extractLinearId('feat/ENG-123')).toBe('ENG-123');
  });

  test('extracts bare ID ENG-123', () => {
    expect(extractLinearId('ENG-123')).toBe('ENG-123');
  });

  test('extracts ID from deep path user/feat/ACME-456', () => {
    expect(extractLinearId('user/feat/ACME-456')).toBe('ACME-456');
  });

  test('returns null for feat/some-feature (no matching segment)', () => {
    expect(extractLinearId('feat/some-feature')).toBeNull();
  });

  test('returns null for main (no matching segment)', () => {
    expect(extractLinearId('main')).toBeNull();
  });

  test('returns null for feat/ENG-123-title (segment does not match strict regex)', () => {
    expect(extractLinearId('feat/ENG-123-title')).toBeNull();
  });
});
