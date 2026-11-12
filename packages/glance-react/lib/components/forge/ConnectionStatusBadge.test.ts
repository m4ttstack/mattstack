import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConnectionStatusBadge } from './ConnectionStatusBadge';

describe('ConnectionStatusBadge polling', () => {
  it('polling is hidden by default like connected', () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionStatusBadge, { status: 'polling' })
    );
    expect(html).toBe('');
  });

  it('polling renders its label with showWhenConnected', () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionStatusBadge, {
        status: 'polling',
        showWhenConnected: true,
      })
    );
    expect(html).toContain('Polling for updates');
    expect(html).not.toContain('animate-spin');
    expect(html).not.toContain('animate-pulse');
  });
});
