const NO_MESSAGES: readonly (readonly [string, unknown])[] = [
  ['/api/chat/direct', { messages: [] }],
  ['/api/chat/messages/', { messages: [] }],
];

const NOTHING_AT_ALL: readonly (readonly [string, unknown])[] = [
  ...NO_MESSAGES,
  ['/api/chat/rooms', { rooms: [] }],
  ['/api/chat/buddies', { buddies: [] }],
  ['/api/chat/who/', { members: [] }],
];

/** The answers a `?state=` URL swaps in, or none for any other URL. */
export function previewAnswers(
  search: string
): readonly (readonly [string, unknown])[] {
  const state = new URLSearchParams(search).get('state');
  if (state === 'empty') return NOTHING_AT_ALL;
  if (state === 'no-messages') return NO_MESSAGES;
  return [];
}

/** Dev only: real data hides the empty screens, so `?state=empty` shows the
    app with nothing in it, and `?state=no-messages` keeps the sidebar and
    empties the conversations. It holds until the page reloads. */
export function installPreviewStates(): void {
  const answers = previewAnswers(window.location.search);
  if (answers.length === 0) return;
  const realFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const answer = answers.find(([path]) => url.startsWith(path));
    return answer ? Response.json(answer[1]) : realFetch(input, init);
  }) as typeof window.fetch;
}
