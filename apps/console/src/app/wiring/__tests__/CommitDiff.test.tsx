import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CommitDiff, filesOf } from '../CommitDiff';

const DIFF = [
  'diff --git a/skills/ship/SKILL.md b/skills/ship/SKILL.md',
  'index 111..222 100644',
  '--- a/skills/ship/SKILL.md',
  '+++ b/skills/ship/SKILL.md',
  '@@ -1,3 +1,3 @@',
  ' # Ship',
  '-Old line',
  '+New line',
  '+Another line',
  'diff --git a/attachments/gone.md b/attachments/gone.md',
  'deleted file mode 100644',
  '--- a/attachments/gone.md',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-one',
  '-two',
  'diff --git a/attachments/new.md b/attachments/new.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/attachments/new.md\t',
  '@@ -0,0 +1 @@',
  '+hello',
].join('\n');

describe('filesOf', () => {
  it('names a rename with no hunks by its new path, and counts no lines', () => {
    const [file] = filesOf(
      [
        'diff --git a/notes/old.md b/notes/new.md',
        'similarity index 100%',
        'rename from notes/old.md',
        'rename to notes/new.md',
        '',
      ].join('\n')
    );
    expect(file).toMatchObject({ path: 'notes/new.md', added: 0, removed: 0 });
  });

  it('names a binary file by its header path', () => {
    const [file] = filesOf(
      [
        'diff --git a/img/logo.png b/img/logo.png',
        'index 1111111..2222222 100644',
        'Binary files a/img/logo.png and b/img/logo.png differ',
        '',
      ].join('\n')
    );
    expect(file).toMatchObject({ path: 'img/logo.png', added: 0, removed: 0 });
  });

  it('cuts a diff into one patch per file, in its own order', () => {
    expect(filesOf(DIFF).map(file => file.path)).toEqual([
      'skills/ship/SKILL.md',
      'attachments/gone.md',
      'attachments/new.md',
    ]);
  });

  it('counts each file’s added and removed lines, not its headers', () => {
    expect(
      filesOf(DIFF).map(file => [file.path, file.added, file.removed])
    ).toEqual([
      ['skills/ship/SKILL.md', 2, 1],
      ['attachments/gone.md', 0, 2],
      ['attachments/new.md', 1, 0],
    ]);
  });

  it('keeps each file’s own section, headers included', () => {
    const [ship] = filesOf(DIFF);
    expect(ship!.patch.startsWith('diff --git a/skills/ship/SKILL.md')).toBe(
      true
    );
    expect(ship!.patch).toContain('+Another line\n');
    expect(ship!.patch).not.toContain('gone.md');
  });

  it('names a deleted file by its old path', () => {
    expect(filesOf(DIFF)[1]!.path).toBe('attachments/gone.md');
  });

  it('reads an empty diff, or text before the first file, as no files', () => {
    expect(filesOf('')).toEqual([]);
    expect(filesOf('warning: something\n')).toEqual([]);
  });
});

describe('CommitDiff', () => {
  const props = {
    from: 'abc1234',
    to: 'def5678',
    files: [],
    file: null,
    truncated: false,
    isPending: false,
    error: null,
  };

  it('heads a range with its two ends', () => {
    renderWithProviders(<CommitDiff {...props} />);

    const panel = screen.getByTestId('commit-diff');
    expect(panel).toHaveTextContent('abc1234 → def5678');
    expect(panel).toHaveTextContent('0 files changed');
    expect(screen.getByTestId('compare-empty')).toBeInTheDocument();
  });

  it('names a range by its title in place of its ends, with its actions at the head', () => {
    renderWithProviders(
      <CommitDiff
        {...props}
        from="HEAD"
        to="working"
        title="Unsynced changes"
        actions={<button type="button">Publish</button>}
      />
    );

    const panel = screen.getByTestId('commit-diff');
    expect(panel).toHaveTextContent('Unsynced changes');
    expect(panel).not.toHaveTextContent('HEAD → working');
    expect(
      within(panel).getByRole('button', { name: 'Publish' })
    ).toBeInTheDocument();
  });

  it('says why the diff could not be read', () => {
    renderWithProviders(<CommitDiff {...props} error="git failed" />);

    expect(screen.getByTestId('compare-error')).toHaveTextContent('git failed');
    expect(screen.getByTestId('commit-diff')).not.toHaveTextContent(
      'files changed'
    );
  });

  it('says when the diff was cut', () => {
    renderWithProviders(<CommitDiff {...props} truncated />);

    expect(screen.getByTestId('compare-truncated')).toBeInTheDocument();
  });
});
