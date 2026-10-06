import type { EmbedMessage } from '@mattstack/settings-kit/embed';

export { embedMessage } from '@mattstack/settings-kit/embed';

/** Posts only to the page that framed this one: the referrer's origin when
    the browser sent one, else nowhere rather than to `*`. */
export function postToHost(msg: EmbedMessage) {
  if (window.parent === window) return;
  const origin = hostOrigin();
  if (origin) window.parent.postMessage(msg, origin);
}

function hostOrigin(): string | null {
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
}
