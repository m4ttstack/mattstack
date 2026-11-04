import { expect, test } from 'bun:test';

import { senderIsOrgAdmin } from '../peer/materialize-deps.ts';

const roles = () => ({ owners: ['Alice'], admins: ['bob'], teams: {} });

test('accepts owners and admins, ignoring case', () => {
  expect(senderIsOrgAdmin('alice', 'acme', roles)).toBe(true);
  expect(senderIsOrgAdmin('bob', 'acme', roles)).toBe(true);
});
test('refuses a plain member', () => {
  expect(senderIsOrgAdmin('carol', 'acme', roles)).toBe(false);
});
test('refuses on a Mac in no org', () => {
  expect(senderIsOrgAdmin('alice', null, roles)).toBe(false);
});
