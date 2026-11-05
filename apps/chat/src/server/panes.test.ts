import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  chatRooms: vi.fn(),
  chatWho: vi.fn(),
  chatMessages: vi.fn(),
  chatBuddies: vi.fn(),
  chatJoin: vi.fn(),
  chatPost: vi.fn(),
  chatArchive: vi.fn(),
  chatDmOpen: vi.fn(),
  chatSlackAvatarFile: vi.fn(),
  chatSlackStatus: vi.fn(),
  paneList: vi.fn(),
  paneFocus: vi.fn(),
  daemonHealth: vi.fn(),
  getSetting: vi.fn(() => ({ value: 'matt' })),
}));
const rt = await import('@mattstack/rt-client');
const { routes } = await import('./routes');

beforeEach(() => vi.resetAllMocks());

test('POST /api/panes/:id/focus forwards the pane id and returns the focus result', async () => {
  vi.mocked(rt.paneFocus).mockResolvedValueOnce({
    ok: true,
    data: { paneId: 'w1:p1', focused: true },
  });
  const res = await routes.request('/api/panes/w1:p1/focus', {
    method: 'POST',
  });
  expect(res.status).toBe(200);
  expect(rt.paneFocus).toHaveBeenCalledWith(
    { paneId: 'w1:p1' },
    expect.anything()
  );
  expect(await res.json()).toEqual({ paneId: 'w1:p1', focused: true });
});

test('POST /api/panes/:id/focus maps an rt failure to 502', async () => {
  vi.mocked(rt.paneFocus).mockResolvedValueOnce({
    ok: false,
    error: 'tray unavailable',
  });
  const res = await routes.request('/api/panes/w1:p1/focus', {
    method: 'POST',
  });
  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ error: 'tray unavailable' });
});

test('the removed pane routes stay gone', async () => {
  expect((await routes.request('/api/panes')).status).toBe(404);
  expect((await routes.request('/api/panes/accounts')).status).toBe(404);
  expect((await routes.request('/api/panes/directories')).status).toBe(404);
  expect((await routes.request('/api/panes/w1:p1/peek')).status).toBe(404);
  expect(
    (await routes.request('/api/panes', { method: 'POST', body: '{}' })).status
  ).toBe(404);
});
