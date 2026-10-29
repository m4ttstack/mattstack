import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BackPill } from '../BackPill';
import { Trail } from '../Trail';

describe('BackPill', () => {
  it('is a button that goes back when it has no address', () => {
    const onClick = vi.fn();
    renderWithProviders(
      <BackPill label="All skills" onClick={onClick} testId="back" />
    );

    const pill = screen.getByRole('button', { name: 'All skills' });
    expect(pill).toHaveAttribute('data-testid', 'back');
    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is a link when the place has its own address', () => {
    renderWithProviders(<BackPill label="Runs" href="/runs" />);

    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
      'href',
      '/runs'
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('takes an accessible name apart from its label', () => {
    renderWithProviders(
      <BackPill label="acme" ariaLabel="Back to your team" onClick={() => {}} />
    );

    expect(
      screen.getByRole('button', { name: 'Back to your team' })
    ).toHaveTextContent('acme');
  });
});

describe('Trail', () => {
  it('links each place above the page and leaves the page itself plain', () => {
    const up = vi.fn();
    renderWithProviders(
      <Trail
        testId="trail"
        items={[
          { key: 'skill', label: '/acme:work', onClick: up, mono: true },
          { key: 'here', label: 'plan', onClick: vi.fn() },
        ]}
      />
    );

    const trail = screen.getByTestId('trail');
    const links = within(trail).getAllByRole('button');
    expect(links.map(link => link.textContent)).toEqual(['/acme:work']);
    expect(within(trail).getByText('plan').closest('button')).toBeNull();

    fireEvent.click(links[0]!);
    expect(up).toHaveBeenCalledOnce();
  });

  it('draws a place with nowhere to go as plain text', () => {
    renderWithProviders(
      <Trail
        items={[
          { key: 'pack', label: 'acme' },
          { key: 'here', label: 'Diagram' },
        ]}
      />
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.getByText('Diagram')).toBeInTheDocument();
  });

  it('sets a command in monospace, as Claude Code shows it', () => {
    renderWithProviders(
      <Trail
        items={[
          { key: 'skill', label: '/acme:work', onClick: () => {}, mono: true },
          { key: 'here', label: 'plan' },
        ]}
      />
    );

    expect(
      screen.getByRole('button', { name: '/acme:work' }).getAttribute('style')
    ).toContain('monospace');
    expect(screen.getByText('plan').getAttribute('style') ?? '').not.toContain(
      'monospace'
    );
  });
});
