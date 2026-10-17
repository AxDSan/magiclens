import {
  expect,
  expectedForImage,
  FIXTURES,
  lensByHover,
  matchWords,
  MOCK,
  overlaySpans,
  scriptMock,
  test,
  truthLines,
  useMockProvider,
  waitForState,
} from './fixtures';

const panelButton = (title: string) => `magiclens-root .panel button[title="${title}"]`;

test.describe('AI providers (mock OpenAI-compatible server)', () => {
  test('hybrid: local boxes, model-corrected text', async ({ page, sw }) => {
    await useMockProvider(sw, 'hybrid');
    // The "truth" differs from what is printed, proving the model's text wins.
    const truth = truthLines(FIXTURES.doc).map((line, i) => (i === 1 ? { ...line, text: 'Revenue grew by 42 percent this year!' } : line));
    await scriptMock({ lines: truth });
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');
    const text = await page.evaluate(() =>
      [...document.querySelector('magiclens-root')!.shadowRoot!.querySelectorAll('.w')].map((w) => w.textContent).join(' '),
    );
    expect(text).toContain('year!');
    // Positions still come from the local detector.
    const { ratio } = matchWords(await expectedForImage(page, '#plain', FIXTURES.doc), await overlaySpans(page));
    expect(ratio).toBeGreaterThanOrEqual(0.85);
    const requests = await (await fetch(`${MOCK}/mock/requests`)).json();
    expect(requests.map((r: { purpose: string }) => r.purpose)).toEqual(['refine']);
    expect(requests[0].hasImage).toBe(true);
  });

  test('AI-only: the model places the lines itself', async ({ page, sw }) => {
    await useMockProvider(sw, 'llm');
    await scriptMock({ lines: truthLines(FIXTURES.doc) });
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');
    const spans = await overlaySpans(page);
    // Word boxes are interpolated inside model line boxes; check whole lines.
    const expected = await expectedForImage(page, '#plain', FIXTURES.doc);
    const { ratio } = matchWords(expected, spans);
    expect(ratio).toBeGreaterThanOrEqual(0.5);
    const lineTexts = await page.evaluate(() => {
      const root = document.querySelector('magiclens-root')!.shadowRoot!;
      return root.querySelectorAll('.w').length;
    });
    expect(lineTexts).toBe(FIXTURES.doc.words.length);
  });

  test('explain streams Markdown into the panel', async ({ page, sw }) => {
    await useMockProvider(sw, 'local');
    await scriptMock({ lines: truthLines(FIXTURES.doc), explain: 'This is a **quarterly report** about revenue.' });
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');
    await page.locator(panelButton('Explain this image')).click();
    const out = page.locator('magiclens-root .out');
    await expect(out).toContainText('quarterly report about revenue');
    await expect(out.locator('strong')).toHaveText('quarterly report');
  });

  test('translate paints translations over the paragraphs', async ({ page, sw }) => {
    await useMockProvider(sw, 'local');
    await scriptMock({
      lines: truthLines(FIXTURES.doc),
      translations: { 'Quarterly report summary': 'Resumen del informe trimestral' },
    });
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');
    await page.locator(panelButton('Translate the text in place')).click();
    const painted = page.locator('magiclens-root .tr');
    await expect(painted.first()).toBeVisible();
    await expect(painted.filter({ hasText: 'Resumen del informe trimestral' })).toHaveCount(1);
    // The translated paragraph sits where the original heading is.
    const heading = (await expectedForImage(page, '#plain', FIXTURES.doc)).find((w) => w.text === 'Quarterly')!;
    const box = (await painted.filter({ hasText: 'Resumen' }).boundingBox())!;
    expect(Math.abs(box.x - heading.x)).toBeLessThan(12);
    expect(box.y).toBeLessThan(heading.y + heading.h);
    expect(box.y + box.height).toBeGreaterThan(heading.y);
  });

  test('URLs in the image become real links', async ({ page, sw }) => {
    await useMockProvider(sw, 'llm');
    const url = 'http://localhost:4599/index.html';
    const lines = truthLines(FIXTURES.doc).map((line, i) =>
      i === 2 ? { ...line, text: `Docs live at ${url}` } : line,
    );
    await scriptMock({ lines });
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');

    const links = page.locator('magiclens-root .txt a');
    await expect(links).toHaveCount(1);
    const link = links.first();
    await expect(link).toHaveAttribute('href', url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // Only the URL is wrapped, not the words around it.
    await expect(link.locator('.w')).toHaveCount(1);
    await expect(link.locator('.w')).toHaveText(url);
    await expect(page.locator('magiclens-root .panel .meta')).toContainText('1 link');

    const word = link.locator('.w');
    await word.hover();
    expect(await word.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');

    // `rel=noopener` means the popup has no opener, so it is reported by the context.
    const [popup] = await Promise.all([page.context().waitForEvent('page'), word.click()]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toBe(url);
    await popup.close();
  });

  test('without a provider, AI actions point to settings', async ({ page, sw }) => {
    await sw.evaluate(async () => {
      await chrome.storage.local.set({ settings: { engine: 'local', provider: 'openai' } });
    });
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');
    await page.locator(panelButton('Explain this image')).click();
    await expect(page.locator('magiclens-root .notice')).toContainText('Connect an AI provider');
  });
});

declare const chrome: { storage: { local: { set(items: object): Promise<void> } } };
