/**
 * Finds URLs, bare domains and email addresses in recognized text. Pure string work with no
 * DOM access: `textlayer` calls it once per line, and it is unit-tested directly.
 */

export interface TextLink {
  /** Character range in the source string, `[start, end)`. */
  start: number;
  end: number;
  /** Matched text with trailing punctuation removed. */
  text: string;
  /** Absolute URL the link should open. */
  href: string;
  kind: 'url' | 'email';
}

/**
 * Top-level domains worth linkifying without a scheme. This is deliberately a list rather
 * than "any two letters": two-letter extensions such as .ts, .js, .py, .rs, .sh or .md are
 * far more common in screenshots as file names than as host names.
 */
const TLDS: Record<string, true> = Object.fromEntries(
  `com org net edu gov mil int info biz name pro aero asia cat coop jobs mobi museum tel
  travel xxx app dev page cloud site online store shop tech blog news live link xyz top club
  vip win work world today life one run zone space website digital agency studio design email
  social media community network solutions services systems software codes tools chat video
  photo photos gallery art music audio games game fun health care clinic hospital dental law
  legal attorney financial finance bank insurance realestate properties hotel hotels vacation
  restaurant bar cafe food menu pizza beer wine coffee fashion style shoes jewelry toys kids
  baby pet pets dog cat farm garden green eco energy solar auto autos car cars bike bikes taxi
  flights cruise tours tickets events event party wedding gifts sale sales deal deals discount
  market mall city town house homes estates rent mortgage loans credit cash money fund capital
  invest investments trade exchange forex crypto bitcoin blockchain token nft dao web3 ltd
  llc inc co me io ai tv cc ly gg fm am pm to in it is at be de fr es nl ch se no dk fi pt ie
  ru ua by kz tr il pk bd cn jp kr tw hk sg my id th vn ph au nz ca mx br ar cl pe za eg ng
  ke ma us uk eu`
    .match(/[a-z0-9]+/g)!
    .map((tld) => [tld, true]),
);

const TRIM: Record<string, true> = {
  '.': true,
  ',': true,
  ';': true,
  ':': true,
  '!': true,
  '?': true,
  "'": true,
  '"': true,
  '”': true,
  '’': true,
  '»': true,
  '…': true,
};
const OPENERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/** Drops sentence punctuation and unmatched closing brackets from the end of a match. */
function clean(raw: string): string {
  let text = raw;
  for (;;) {
    const last = text[text.length - 1];
    if (!last) return text;
    if (TRIM[last]) {
      text = text.slice(0, -1);
      continue;
    }
    const opener = OPENERS[last];
    if (opener) {
      const opens = text.split(opener).length - 1;
      const closes = text.split(last).length - 1;
      if (closes > opens) {
        text = text.slice(0, -1);
        continue;
      }
    }
    return text;
  }
}

const SCHEME = /\b(?:https?|ftp):\/\/[^\s<>"'`]+/gi;
const MAILTO = /\bmailto:[^\s<>"'`]+/gi;
const EMAIL = /\b[a-z0-9._%+-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi;
const WWW = /\bwww\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?/g;
const BARE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24})(?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?/gi;

interface Candidate extends TextLink {
  /** Lower wins when two matches overlap. */
  priority: number;
}

/** TLD of a hostname, ignoring a trailing port, path, query or fragment. */
function tldOf(host: string): string {
  const hostname = host.split(/[/?#]/)[0].split(':')[0];
  return hostname.slice(hostname.lastIndexOf('.') + 1).toLowerCase();
}

/**
 * Returns the links in `source`, ordered by position and never overlapping. Trailing
 * punctuation is not part of the link; `www.` and bare hosts are normalized to `https://`,
 * addresses to `mailto:`.
 */
export function findLinks(source: string): TextLink[] {
  const found: Candidate[] = [];
  const add = (
    pattern: RegExp,
    priority: number,
    kind: TextLink['kind'],
    resolve: (text: string, match: RegExpMatchArray) => string | null,
  ) => {
    for (const match of source.matchAll(pattern)) {
      const text = clean(match[0]);
      if (text.length < 3) continue;
      const href = resolve(text, match);
      if (!href) continue;
      found.push({
        start: match.index!,
        end: match.index! + text.length,
        text,
        href,
        kind,
        priority,
      });
    }
  };

  add(SCHEME, 0, 'url', (text) => (/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : null));
  add(MAILTO, 0, 'email', (text) => `mailto:${text.slice('mailto:'.length)}`);
  add(EMAIL, 1, 'email', (text) => (TLDS[tldOf(text)] ? `mailto:${text}` : null));
  add(WWW, 2, 'url', (text) => (TLDS[tldOf(text)] ? `https://${text}` : null));
  add(IPV4, 3, 'url', (text) =>
    text
      .split(/[/?#:]/)[0]
      .split('.')
      .every((octet) => Number(octet) <= 255)
      ? `http://${text}`
      : null,
  );
  add(BARE, 4, 'url', (text, match) =>
    TLDS[(match[1] ?? '').toLowerCase()] ? `https://${text}` : null,
  );

  found.sort(
    (a, b) => a.start - b.start || a.priority - b.priority || b.end - b.start - (a.end - a.start),
  );
  const links: TextLink[] = [];
  let claimed = 0;
  for (const { start, end, text, href, kind } of found) {
    // Overlaps are duplicates or a lower-priority fragment of the accepted match.
    if (start < claimed) continue;
    claimed = end;
    links.push({ start, end, text, href, kind });
  }
  return links;
}

/**
 * For each word of `words.join(' ')`, the index of the link it overlaps, or -1. `textlayer`
 * uses this to wrap exactly the words a match covers, including partial words such as
 * `example.com,` where the trailing comma is outside the link.
 */
export function linksForWords(words: string[], links: TextLink[]): number[] {
  const starts: number[] = [];
  for (let i = 0, offset = 0; i < words.length; i++) {
    starts.push(offset);
    offset += words[i].length + 1;
  }
  return words.map((word, i) => {
    const start = starts[i];
    const end = start + word.length;
    return links.findIndex((link) => link.start < end && link.end > start);
  });
}
