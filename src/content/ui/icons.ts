const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICON_SOURCES = {
  lens: svg(
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/><path d="M8 9.5h5M8 12h3.2" stroke-width="1.6"/>',
  ),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>'),
  check: svg('<path d="m5 12.5 4.2 4.2L19 7"/>'),
  text: svg('<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>'),
  translate: svg(
    '<path d="M4 5.5h9M8.5 4v1.5c0 4-2.2 7-5 8.5M6 9c1.2 2.4 3.4 4.3 6 5"/><path d="m12.5 20 4-9 4 9M14 17h5"/>',
  ),
  sparkle: svg(
    '<path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z"/><path d="M19 15.5c.25 1.6 1 2.35 2.5 2.5-1.5.25-2.25 1-2.5 2.5-.25-1.5-1-2.25-2.5-2.5 1.5-.15 2.25-.9 2.5-2.5Z" stroke-width="1.4"/>',
  ),
  ask: svg('<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.2A8 8 0 1 1 20 12Z"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5M12 16.3v.1"/>'),
  summary: svg('<path d="M5 6h14M5 10h14M5 14h9M5 18h6"/>'),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  send: svg('<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>'),
  selectAll: svg('<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 10h8M8 14h5"/>'),
};

export type IconName = keyof typeof ICON_SOURCES;

const parsed = new Map<IconName, SVGElement>();

/** A fresh SVG node for an icon, built without innerHTML (pages and stores flag that). */
export function icon(name: IconName): SVGElement {
  let template = parsed.get(name);
  if (!template) {
    const doc = new DOMParser().parseFromString(ICON_SOURCES[name], 'image/svg+xml');
    template = document.importNode(doc.documentElement, true) as unknown as SVGElement;
    parsed.set(name, template);
  }
  return template.cloneNode(true) as SVGElement;
}
