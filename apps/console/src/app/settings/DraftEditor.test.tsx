import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { draftNote } from './draftNotes';

vi.mock('@mattstack/app-kit/lazy', () => ({
  CodeMirror: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <textarea
      aria-label="JSON"
      value={value}
      onChange={e => onChange?.(e.currentTarget.value)}
    />
  ),
}));

const { DraftEditor } = await import('./DraftEditor');

const ORG_NOTE = 'No owners listed, so every admin is an org owner';

function orgDef(): SettingDefWire {
  return {
    key: 'mattstack.org',
    type: 'object',
    scopes: ['org'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'Who runs the org.',
    hasDefault: false,
    effective: { scope: 'org', file: '/o', value: undefined },
  } as unknown as SettingDefWire;
}

describe('draftNote', () => {
  it('warns when admins are listed and owners are not', () => {
    expect(draftNote('mattstack.org', { admins: ['lee'] })).toBe(ORG_NOTE);
    expect(draftNote('mattstack.org', { owners: [], admins: ['lee'] })).toBe(
      ORG_NOTE
    );
  });

  it('stays quiet with an owner, with no admins, or for another key', () => {
    expect(
      draftNote('mattstack.org', { owners: ['matt'], admins: ['lee'] })
    ).toBeNull();
    expect(draftNote('mattstack.org', { admins: [] })).toBeNull();
    expect(draftNote('board.title', { admins: ['lee'] })).toBeNull();
  });
});

describe('DraftEditor key notes', () => {
  it('shows the owners warning as the draft drops its owners', () => {
    renderWithProviders(
      <DraftEditor
        def={orgDef()}
        form={null}
        initial={{ owners: ['matt'], admins: ['lee'] }}
        targetLabel="org"
        saving={false}
        onSave={async () => true}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByText(ORG_NOTE)).toBeNull();
    fireEvent.change(screen.getByLabelText('JSON'), {
      target: { value: JSON.stringify({ admins: ['lee'] }) },
    });
    expect(screen.getByTestId('draft-key-note')).toHaveTextContent(ORG_NOTE);
  });
});
