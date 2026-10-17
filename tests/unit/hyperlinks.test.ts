import { describe, expect, it } from 'vitest';
import { findLinks, linksForWords } from '../../src/shared/hyperlinks';

const hrefs = (text: string) => findLinks(text).map((link) => link.href);

describe('findLinks', () => {
  it('finds scheme URLs and stops before sentence punctuation', () => {
    expect(hrefs('Read https://example.com/docs?page=2&sort=new.')).toEqual([
      'https://example.com/docs?page=2&sort=new',
    ]);
    expect(hrefs('HTTPS://EXAMPLE.COM/A')).toEqual(['HTTPS://EXAMPLE.COM/A']);
  });

  it('normalizes www hosts and bare domains to https', () => {
    expect(hrefs('go to www.example.com now')).toEqual(['https://www.example.com']);
    expect(hrefs('see example.co.uk/path for more')).toEqual(['https://example.co.uk/path']);
    expect(hrefs('https://example.com')).toEqual(['https://example.com']);
  });

  it('turns addresses into mailto links without matching the domain twice', () => {
    const links = findLinks('write to hello@example.com today');
    expect(links.map((link) => link.href)).toEqual(['mailto:hello@example.com']);
    expect(links[0].kind).toBe('email');
    expect(hrefs('mailto:hello@example.com')).toEqual(['mailto:hello@example.com']);
  });

  it('keeps parentheses that belong to the URL and drops the sentence ones', () => {
    expect(hrefs('(https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ]);
  });

  it('finds local IPv4 addresses', () => {
    expect(hrefs('open http://192.168.1.20:8080/admin')).toEqual(['http://192.168.1.20:8080/admin']);
    expect(hrefs('version 999.1.1.1 is not an address')).toEqual([]);
  });

  it('leaves file names and code identifiers alone', () => {
    for (const text of ['main.ts', 'setup.py', 'build.sh', 'README.md', 'photo.png', 'notes.txt']) {
      expect(hrefs(text), text).toEqual([]);
    }
  });

  it('requires a known top-level domain for bare hosts', () => {
    expect(hrefs('example.invalid')).toEqual([]);
    expect(hrefs('first.second')).toEqual([]);
    expect(hrefs('example.io')).toEqual(['https://example.io']);
  });

  it('returns links in order without overlaps', () => {
    const links = findLinks('a@example.com or https://example.com/b then example.org.');
    expect(links.map((link) => [link.start, link.text, link.href])).toEqual([
      [0, 'a@example.com', 'mailto:a@example.com'],
      [17, 'https://example.com/b', 'https://example.com/b'],
      [44, 'example.org', 'https://example.org'],
    ]);
  });

  it('ignores text without links', () => {
    expect(findLinks('Quarterly report summary, updated October 2026')).toEqual([]);
  });
});

describe('linksForWords', () => {
  it('maps each word to the link that covers it', () => {
    const words = ['Visit', 'example.com/path,', 'and', 'a@example.com'];
    const links = findLinks(words.join(' '));
    expect(linksForWords(words, links)).toEqual([-1, 0, -1, 1]);
  });

  it('marks every word of a match that spans words', () => {
    // Detectors occasionally split a host across boxes; mapping must cover both words.
    const links = [
      { start: 0, end: 17, text: 'www.example.com/x', href: 'https://www.example.com/x', kind: 'url' as const },
    ];
    expect(linksForWords(['www.example.', 'com/x'], links)).toEqual([0, 0]);
  });

  it('returns -1 for every word when there are no links', () => {
    expect(linksForWords(['one', 'two'], [])).toEqual([-1, -1]);
  });
});
