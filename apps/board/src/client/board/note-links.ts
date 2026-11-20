export type NoteLink = { url: string; host: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCT = /[.,;:!?\]]$/;

/** Sentence punctuation after a URL is the sentence's, not the URL's; a
    closing paren is the URL's only while the URL opened one. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    if (TRAILING_PUNCT.test(url)) url = url.slice(0, -1);
    else if (url.endsWith(')') && url.split(')').length > url.split('(').length)
      url = url.slice(0, -1);
    else return url;
  }
}

/** Splits a note into its words and its links, so the row can show a link
    as its host instead of a raw URL wrapping mid-token. */
export function splitNoteLinks(text: string): {
  prose: string;
  links: NoteLink[];
} {
  const links: NoteLink[] = [];
  const prose = text.replace(URL_RE, raw => {
    const url = trimUrl(raw);
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return raw;
    }
    if (!links.some(l => l.url === url)) links.push({ url, host });
    return raw.slice(url.length);
  });
  if (!links.length) return { prose: text, links };
  return {
    prose: prose
      .split('\n')
      .map(line =>
        line
          .replace(/[ \t]{2,}/g, ' ')
          .replace(/ ([.,;:!?])/g, '$1')
          .trim()
      )
      .filter(Boolean)
      .join('\n'),
    links,
  };
}
