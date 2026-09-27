/**
 * Unit tests for integration.live.ts's target selection. Pure: no env reads
 * and no network, so a refusal is provable without credentials.
 */
import { describe, expect, test } from 'bun:test';
import { mutationTarget, readOnlyProjectPath } from './live/sandboxTarget.ts';

const VAR = 'GLANCE_HARNESS_GITLAB_SANDBOX';

describe('mutationTarget', () => {
  test('unset: refuses, names the variable, and yields no target', () => {
    const t = mutationTarget(VAR, undefined, 'project');
    expect(t.ok).toBe(false);
    if (t.ok) return;
    expect(t.refusal).toContain(VAR);
    expect(t).not.toHaveProperty('projectPath');
  });

  test('blank counts as unset', () => {
    expect(mutationTarget(VAR, '  ', 'project').ok).toBe(false);
  });

  test('set: yields exactly that project', () => {
    expect(mutationTarget(VAR, 'sandbox-group/glance-test-repo', 'project')).toEqual({
      ok: true,
      projectPath: 'sandbox-group/glance-test-repo',
      iid: null,
    });
  });

  test('set with an MR: yields exactly that project and MR', () => {
    expect(mutationTarget(VAR, 'sandbox-group/sub/glance-test-repo!12', 'mr')).toEqual({
      ok: true,
      projectPath: 'sandbox-group/sub/glance-test-repo',
      iid: 12,
    });
  });

  test('an MR-level step refuses a project-only value', () => {
    const t = mutationTarget(VAR, 'sandbox-group/glance-test-repo', 'mr');
    expect(t.ok).toBe(false);
    if (t.ok) return;
    expect(t.refusal).toContain('!<iid>');
  });

  test('a malformed value refuses and quotes it', () => {
    const t = mutationTarget(VAR, 'not-a-path', 'project');
    expect(t.ok).toBe(false);
    if (t.ok) return;
    expect(t.refusal).toContain('not-a-path');
  });
});

describe('readOnlyProjectPath', () => {
  test('keeps the fallback from the token user own list', () => {
    expect(readOnlyProjectPath('someone/their-repo', 'env/project')).toBe('someone/their-repo');
  });

  test('uses the env project path when the own list gave nothing', () => {
    expect(readOnlyProjectPath(null, 'env/project')).toBe('env/project');
    expect(readOnlyProjectPath(null, undefined)).toBeNull();
  });
});
