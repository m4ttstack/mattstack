import { createRef } from 'react';

import { Table } from '@mattstack/app-kit/core';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';

// --- ref forwarding ----------------------------------------------------
//
// The Table shadow wraps @mantine/core's Table, which forwards its ref to
// the underlying HTMLTableElement (see TableFactory's `ref: HTMLTableElement`
// in @mantine/core). The shadow must not drop that.

test('Table forwards its ref to the underlying HTMLTableElement', () => {
  const ref = createRef<HTMLTableElement>();
  renderWithProviders(<Table ref={ref} />);

  expect(ref.current).toBeInstanceOf(HTMLTableElement);
});

// --- static surface ------------------------------------------------------
//
// Mantine's Table.Factory staticComponents include DataRenderer alongside
// the other sub-components; the shadow's static surface must mirror it
// completely.

test('Table.DataRenderer is defined', () => {
  expect(Table.DataRenderer).toBeDefined();
});

// --- soft variant ----------------------------------------------------------
//
// A soft table sits inside a card: its own Paper takes the card's surface
// under the soft rule, and the header leaves its tint to the variant's CSS
// rather than the inline accent.

test('a soft Table wraps itself in a soft-outline Paper with no inline header accent', () => {
  const { container } = renderWithProviders(
    <Table variant="soft">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>file</Table.Th>
        </Table.Tr>
      </Table.Thead>
    </Table>
  );

  const table = container.querySelector('table')!;
  expect(table).toHaveAttribute('data-variant', 'soft');
  expect(table.parentElement).toHaveAttribute('data-variant', 'soft-outline');
  expect(container.querySelector('thead')!.style.backgroundColor).toBe('');
});

test('a default Table keeps its header accent and an unmarked Paper', () => {
  const { container } = renderWithProviders(
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>file</Table.Th>
        </Table.Tr>
      </Table.Thead>
    </Table>
  );

  expect(container.querySelector('table')!.parentElement).not.toHaveAttribute(
    'data-variant'
  );
  expect(container.querySelector('thead')!.style.backgroundColor).not.toBe('');
});
