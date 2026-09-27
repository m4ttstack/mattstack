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

  test.each(['group/./project', 'group/../project', 'group/pro ject', 'group/pro$ject'])(
    'refuses the path segment in %s',
    (raw: string) => {
      expect(mutationTarget(VAR, raw, 'project').ok).toBe(false);
    }
  );

  test.each(['group/project!0', 'group/project!012', 'group/project!100000000000000000000'])(
    'refuses the iid in %s',
    (raw: string) => {
      expect(mutationTarget(VAR, raw, 'mr').ok).toBe(false);
    }
  );

  test('accepts a ten-digit iid', () => {
    expect(mutationTarget(VAR, 'group/project!1234567890', 'mr')).toMatchObject({ ok: true, iid: 1234567890 });
  });
});

describe('mutationTarget for a GitHub repo', () => {
  const GH = 'GLANCE_HARNESS_GITHUB_SANDBOX';

  test('set: yields exactly that owner/repo', () => {
    expect(mutationTarget(GH, 'someone/glance-conformance', 'repo')).toEqual({
      ok: true,
      projectPath: 'someone/glance-conformance',
      iid: null,
    });
  });

  test.each(['someone/glance-conformance/extra', 'someone/glance-conformance!12', 'someone'])(
    'refuses %s, naming the owner/repo shape',
    (raw: string) => {
      const t = mutationTarget(GH, raw, 'repo');
      expect(t.ok).toBe(false);
      if (t.ok) return;
      expect(t.refusal).toContain('owner/repo');
      expect(t.refusal).not.toContain('group/project');
    }
  );

  test('unset: the refusal names the owner/repo shape', () => {
    const t = mutationTarget(GH, undefined, 'repo');
    expect(t.ok).toBe(false);
    if (t.ok) return;
    expect(t.refusal).toContain('owner/repo');
  });
});

describe('readOnlyProjectPath', () => {
  test("keeps the fallback from the token user's own list", () => {
    expect(readOnlyProjectPath('someone/their-repo', 'env/project')).toBe('someone/their-repo');
  });

  test('uses the env project path when the own list gave nothing', () => {
    expect(readOnlyProjectPath(null, 'env/project')).toBe('env/project');
    expect(readOnlyProjectPath(null, undefined)).toBeNull();
  });
});
