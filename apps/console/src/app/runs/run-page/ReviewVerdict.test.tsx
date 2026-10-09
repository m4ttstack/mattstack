import '../../icons';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ParsedFinding } from '../derive/findings';

const { ReviewVerdict } = await import('./ReviewVerdict');

const FINDINGS: ParsedFinding[] = [
  {
    severity: 'important',
    text: 'Dedupe matches on email only, so contacts without an email import twice.',
    where: 'contacts/import/dedupe.ts:58',
  },
  {
    severity: 'important',
    text: 'No test covers merging two contacts that share a phone number.',
    where: null,
  },
  {
    severity: 'minor',
    text: "mergeContacts deletes the losing record; the name doesn't say so.",
    where: 'contacts/merge.ts:12',
  },
  {
    severity: 'minor',
    text: 'The skip log prints the whole contact record, email included.',
    where: null,
  },
];

const MR_URL = 'https://forge.test/acme/web/-/merge_requests/412';

function verdict(over: Partial<Parameters<typeof ReviewVerdict>[0]> = {}) {
  return renderWithProviders(
    <ReviewVerdict
      verdict="Request changes"
      findings={FINDINGS}
      mrIid="412"
      mrUrl={MR_URL}
      {...over}
    />
  );
}

const rowsOf = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-finding]')].map(r => [
    r.querySelector('[data-severity]')?.textContent ?? null,
    r.querySelector('[data-finding-text]')?.textContent,
    r.querySelector('[data-finding-where]')?.textContent ?? null,
  ]);

describe('ReviewVerdict', () => {
  it('heads the card with where it posted, the verdict and the finding count', () => {
    verdict();
    expect(screen.getByText('Posted to !412')).toBeInTheDocument();
    expect(
      screen.getByText('Request changes · 4 findings')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the MR/ })).toHaveAttribute(
      'href',
      MR_URL
    );
  });

  it('draws each finding as a row with a severity badge and its file when it names one', () => {
    const { container } = verdict();
    expect(rowsOf(container)).toEqual([
      ['Important', FINDINGS[0]!.text, 'contacts/import/dedupe.ts:58'],
      ['Important', FINDINGS[1]!.text, null],
      ['Minor', FINDINGS[2]!.text, 'contacts/merge.ts:12'],
      ['Minor', FINDINGS[3]!.text, null],
    ]);
    expect(screen.queryByText(/\[Important\]|\[Minor\]/)).toBeNull();
  });

  it('says one finding, and draws no badge for a finding with no severity', () => {
    const { container } = verdict({
      findings: [{ severity: null, text: 'Rename the helper', where: null }],
    });
    expect(screen.getByText('Request changes · 1 finding')).toBeInTheDocument();
    expect(rowsOf(container)).toEqual([[null, 'Rename the helper', null]]);
  });

  it('leaves the MR link out when there is no url', () => {
    const { container } = verdict({ mrUrl: null });
    expect(
      within(container).queryByRole('link', { name: /Open the MR/ })
    ).toBeNull();
  });

  it('draws no fold when every finding was posted', () => {
    verdict();
    expect(screen.queryByText(/not posted/)).toBeNull();
  });

  it('folds the unposted findings to a count that opens to list them dimmed', async () => {
    const { container } = verdict({
      findings: FINDINGS.slice(0, 2),
      notPosted: FINDINGS.slice(2),
    });
    expect(
      screen.getByText('Request changes · 2 findings')
    ).toBeInTheDocument();
    const fold = screen.getByRole('button', { name: /2 not posted/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(rowsOf(container)).toHaveLength(2);
    await userEvent.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(rowsOf(container).slice(2)).toEqual([
      ['Minor', FINDINGS[2]!.text, 'contacts/merge.ts:12'],
      ['Minor', FINDINGS[3]!.text, null],
    ]);
    expect(container.querySelectorAll('[data-finding][data-dim]')).toHaveLength(
      2
    );
  });
});
