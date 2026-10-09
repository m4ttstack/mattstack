import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import './icons';

const pruneDaysGet = vi.fn();

vi.mock('./api', () => ({
  client: {
    api: {
      settings: {
        'runs-prune-days': {
          $get: (...args: unknown[]) => pruneDaysGet(...args),
        },
      },
    },
  },
}));

const { NotFoundPage, notFoundReason } = await import('./NotFoundPage');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <NotFoundPage />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('notFoundReason', () => {
  it('names the prune window once it is known', () => {
    expect(notFoundReason(30)).toBe(
      'The link may be from an older console, or the run was pruned after 30 days.'
    );
    expect(notFoundReason(1)).toBe(
      'The link may be from an older console, or the run was pruned after 1 day.'
    );
    expect(notFoundReason(undefined)).toBe(
      'The link may be from an older console, or the run was pruned.'
    );
  });
});

describe('NotFoundPage', () => {
  it('says why the address is empty, in the window rt prunes at, and links back to the runs', async () => {
    pruneDaysGet.mockResolvedValue(ok({ days: 45 }));
    renderPage();

    const root = document.querySelector('[data-parity="Not found"]');
    expect(root).toHaveTextContent('Nothing at this address');
    expect(
      await screen.findByText(
        'The link may be from an older console, or the run was pruned after 45 days.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to runs' })).toHaveAttribute(
      'href',
      '/'
    );
    expect(screen.queryByText('404')).toBeNull();
  });

  it('sits on the page surface, not graph paper', () => {
    pruneDaysGet.mockResolvedValue(ok({ days: 30 }));
    renderPage();

    expect(document.querySelector('#page-shell-content')).toHaveAttribute(
      'data-own-surface'
    );
  });
});
