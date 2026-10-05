/**
 * Minimal Markdown renderer for model output. Builds DOM nodes with textContent only, so
 * nothing the model writes can inject markup into the page.
 */
function inline(text: string, parent: Node) {
  const pattern = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    let node: HTMLElement;
    if (match[2] || match[3]) {
      node = document.createElement('strong');
      inline(match[2] ?? match[3], node);
    } else if (match[4]) {
      node = document.createElement('code');
      node.textContent = match[4];
    } else if (match[5] || match[6]) {
      node = document.createElement('em');
      inline(match[5] ?? match[6], node);
    } else {
      const link = document.createElement('a');
      link.textContent = match[7];
      link.href = match[8];
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      node = link;
    }
    parent.appendChild(node);
    last = match.index! + match[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

export function renderMarkdown(source: string, target: HTMLElement) {
  const fragment = document.createDocumentFragment();
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let list: HTMLElement | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement('p');
    paragraph.forEach((line, i) => {
      if (i) p.appendChild(document.createElement('br'));
      inline(line, p);
    });
    fragment.appendChild(p);
    paragraph = [];
  };
  const closeList = () => {
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flushParagraph();
      closeList();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      const pre = document.createElement('pre');
      const el = document.createElement('code');
      el.textContent = code.join('\n');
      pre.appendChild(el);
      fragment.appendChild(pre);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const h = document.createElement(`h${Math.min(3, heading[1].length)}`);
      inline(heading[2], h);
      fragment.appendChild(h);
    } else if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'UL' : 'OL';
      if (!list || list.tagName !== tag) {
        list = document.createElement(tag.toLowerCase());
        fragment.appendChild(list);
      }
      const li = document.createElement('li');
      inline((bullet ?? numbered)![1], li);
      list.appendChild(li);
    } else if (!line.trim()) {
      flushParagraph();
      closeList();
    } else {
      closeList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  target.replaceChildren(fragment);
}
