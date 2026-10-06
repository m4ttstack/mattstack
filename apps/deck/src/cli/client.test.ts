import { expect, test } from 'bun:test';

import { deckNotRunning, withDeckWait } from './client.ts';

const SMAPP_DEV = `gui/501/com.mattstack.deck.dev = {
\tpath = (submitted by smd.340)
\tmanaged_by = com.apple.xpc.ServiceManagement
}`;

test('a helper-owned machine is pointed at the mattstack app, never deck setup', async () => {
  const probe = async (argv: string[]) =>
    argv[2]!.endsWith('/com.mattstack.deck.dev')
      ? { code: 0, stdout: SMAPP_DEV }
      : { code: 113, stdout: '' };

  const msg = await deckNotRunning(probe, null);

  expect(msg).toStartWith("Deck isn't running. ");
  expect(msg).toContain('mattstack app');
  expect(msg).not.toContain('deck setup');
});

test('a machine with no helper keeps the deck serve / deck setup hint', async () => {
  const probe = async () => ({ code: 113, stdout: '' });

  expect(await deckNotRunning(probe, null)).toBe(
    "Deck isn't running. Start it with `deck serve` or install it with `deck setup`."
  );
});

const refused = async (): Promise<Response> => {
  throw Object.assign(new TypeError('Unable to connect'), {
    code: 'ConnectionRefused',
  });
};

const reset = async (): Promise<Response> => {
  throw Object.assign(new TypeError('socket closed'), { code: 'ECONNRESET' });
};

test("inside a deck run, deck's own restart dropped mid-answer is never repeated", async () => {
  // `deck restart deck` drops its own socket after acting on the request;
  // sending it again would restart the new deck too.
  let calls = 0;
  await expect(
    withDeckWait(
      () => {
        calls++;
        return reset();
      },
      {
        insideRun: true,
        resendAfterReset: false,
        waitMs: 1000,
        sleep: async () => {},
      }
    )
  ).rejects.toThrow('socket closed');
  expect(calls).toBe(1);
});

test('inside a deck run, any other request a dying deck dropped is sent again', async () => {
  let calls = 0;
  const res = await withDeckWait(
    async () => (++calls < 2 ? reset() : new Response('{}')),
    { insideRun: true, waitMs: 1000, sleep: async () => {} }
  );
  expect(res.status).toBe(200);
  expect(calls).toBe(2);
});

test("Bun's own refusal from a closed port is one the wait retries", async () => {
  const probe = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data() {} },
  });
  const { port } = probe;
  probe.stop(true);
  let calls = 0;
  const res = await withDeckWait(
    async () =>
      ++calls < 2 ? fetch(`http://127.0.0.1:${port}/`) : new Response('{}'),
    { insideRun: true, waitMs: 1000, sleep: async () => {} }
  );
  expect(res.status).toBe(200);
  expect(calls).toBe(2);
});

test('inside a deck run, a deck that is restarting is waited for', async () => {
  let calls = 0;
  const res = await withDeckWait(
    async () => (++calls < 3 ? refused() : new Response('{}')),
    { insideRun: true, waitMs: 1000, sleep: async () => {} }
  );
  expect(res.status).toBe(200);
  expect(calls).toBe(3);
});

test('inside a deck run, a deck that stays down still fails once the wait is over', async () => {
  let now = 0;
  await expect(
    withDeckWait(refused, {
      insideRun: true,
      waitMs: 1000,
      now: () => now,
      sleep: async ms => {
        now += ms;
      },
    })
  ).rejects.toThrow('Unable to connect');
});

test('outside a deck run, a deck that is down fails at once', async () => {
  let calls = 0;
  await expect(
    withDeckWait(
      () => {
        calls++;
        return refused();
      },
      { insideRun: false, sleep: async () => {} }
    )
  ).rejects.toThrow('Unable to connect');
  expect(calls).toBe(1);
});
