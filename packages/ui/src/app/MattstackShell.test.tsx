import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { ColorSchemeControl, useShellRail } from '@mattstack/app-kit/app';
import { RailLink } from '@mattstack/app-kit/router';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { MattstackShell } from './MattstackShell';

function renderShell() {
  const { hook } = memoryLocation({ path: '/' });
  return renderWithProviders(
    <Router hook={hook}>
      <MattstackShell name="probe" mark={<svg data-testid="mark" />}>
        <MattstackShell.Rail>
          <RailLink icon="layers" label="Runs" href="/" />
          <RailLink icon="search" label="Search" href="/search" />
        </MattstackShell.Rail>
        <MattstackShell.RailBottom>
          <span data-testid="bottom">extra</span>
        </MattstackShell.RailBottom>
        <main data-testid="page">page</main>
      </MattstackShell>
    </Router>
  );
}

test('renders the wordmark, the mark, and the page', () => {
  renderShell();
  expect(screen.getByRole('banner')).toHaveTextContent('probe');
  expect(screen.getByTestId('mark')).toBeInTheDocument();
  expect(screen.getByTestId('page')).toHaveTextContent('page');
});

test('renders the rail entries inside the navigation', () => {
  renderShell();
  const nav = screen.getByRole('navigation', { name: 'App sections' });
  expect(within(nav).getByRole('link', { name: 'Runs' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  expect(within(nav).getByRole('link', { name: 'Search' })).toBeInTheDocument();
  expect(within(nav).getByTestId('bottom')).toBeInTheDocument();
});

test('pins a colour-scheme control to the rail', () => {
  renderShell();
  expect(screen.getByLabelText('Color scheme')).toBeInTheDocument();
});

test.each([
  ['auto', 'lucide-monitor'],
  ['light', 'lucide-sun'],
  ['dark', 'lucide-moon'],
])(
  'the scheme control icon shows the stored %s choice',
  (stored, iconClass) => {
    window.localStorage.setItem('ui-color-scheme', JSON.stringify(stored));
    try {
      renderShell();
      const control = screen.getByLabelText('Color scheme');
      expect(control.querySelector(`svg.${iconClass}`)).not.toBeNull();
    } finally {
      window.localStorage.clear();
    }
  }
);

test('the button form of the scheme control shows the stored choice outside the rail', () => {
  window.localStorage.setItem('ui-color-scheme', JSON.stringify('dark'));
  try {
    renderWithProviders(<ColorSchemeControl variant="button" size={44} />);
    const control = screen.getByRole('button', { name: 'Color scheme' });
    expect(control.querySelector('svg.lucide-moon')).not.toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  } finally {
    window.localStorage.clear();
  }
});

test('rail={false} drops the rail and puts the scheme control at the end of the top bar', () => {
  const { hook } = memoryLocation({ path: '/' });
  const { container } = renderWithProviders(
    <Router hook={hook}>
      <MattstackShell name="probe" rail={false}>
        <MattstackShell.Header actions={<button type="button">Refresh</button>}>
          <span>probe</span>
        </MattstackShell.Header>
        <main data-testid="page">page</main>
      </MattstackShell>
    </Router>
  );
  expect(screen.queryByRole('navigation', { name: 'App sections' })).toBeNull();
  expect(container.querySelector('.mantine-AppShell-navbar')).toBeNull();
  expect(screen.queryByLabelText('Toggle navigation')).toBeNull();
  const names = within(screen.getByRole('banner'))
    .getAllByRole('button')
    .map(b => b.getAttribute('aria-label') ?? b.textContent);
  expect(names).toEqual(['Refresh', 'Color scheme']);
  expect(screen.getByTestId('page')).toBeInTheDocument();
});

test('mounts the app launcher when appName is passed', () => {
  const { hook } = memoryLocation({ path: '/' });
  renderWithProviders(
    <Router hook={hook}>
      <MattstackShell
        name="Chat"
        appName="chat"
        deckBase="https://deck.mattstack"
      >
        <main>page</main>
      </MattstackShell>
    </Router>
  );
  expect(
    within(screen.getByRole('banner')).getByRole('button', { name: 'Apps' })
  ).toBeInTheDocument();
});

test('omits the launcher when appName is absent', () => {
  const { hook } = memoryLocation({ path: '/' });
  renderWithProviders(
    <Router hook={hook}>
      <MattstackShell name="Chat">
        <main>page</main>
      </MattstackShell>
    </Router>
  );
  expect(
    within(screen.getByRole('banner')).queryByRole('button', { name: 'Apps' })
  ).not.toBeInTheDocument();
});

test('useShellRail is exported and defaults to a closed rail', () => {
  const seen: { expanded: boolean } = { expanded: true };
  function Probe() {
    seen.expanded = useShellRail().expanded;
    return null;
  }
  renderWithProviders(<Probe />);
  expect(seen.expanded).toBe(false); // default context: collapsed
});

test('renders header page context in place of the name, with actions before the launcher', () => {
  const { hook } = memoryLocation({ path: '/' });
  renderWithProviders(
    <Router hook={hook}>
      <MattstackShell
        name="probe"
        appName="probe"
        deckBase="https://deck.mattstack"
        mark={<svg data-testid="mark" />}
      >
        <MattstackShell.Header actions={<button type="button">Refresh</button>}>
          <nav aria-label="Breadcrumb">probe / Runs</nav>
        </MattstackShell.Header>
        <main data-testid="page">page</main>
      </MattstackShell>
    </Router>
  );
  const banner = screen.getByRole('banner');
  expect(within(banner).getByTestId('mark')).toBeInTheDocument();
  expect(
    within(banner).getByRole('navigation', { name: 'Breadcrumb' })
  ).toHaveTextContent('probe / Runs');
  expect(within(banner).queryByText('probe', { exact: true })).toBeNull();
  const names = within(banner)
    .getAllByRole('button')
    .map(b => b.getAttribute('aria-label') ?? b.textContent);
  expect(names.indexOf('Refresh')).toBeGreaterThan(-1);
  expect(names.indexOf('Refresh')).toBeLessThan(names.indexOf('Apps'));
  expect(screen.getByTestId('page')).toBeInTheDocument();
});
