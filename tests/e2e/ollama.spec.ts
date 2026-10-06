import { expect, FIXTURES, lensByHover, MOCK, scriptMock, setSettings, test, truthLines, waitForState } from './fixtures';

// Ollama rejects extension origins unless OLLAMA_ORIGINS is set. MagicLens strips the
// Origin header on its own requests to the Ollama host, and only on its own.
test('local Ollama works without OLLAMA_ORIGINS, and pages keep its protection', async ({ page, sw }) => {
  await setSettings(sw, {
    engine: 'llm',
    provider: 'ollama',
    providers: { ollama: { apiKey: '', baseUrl: `${MOCK}/ollama/v1`, model: 'qwen2.5vl:3b' } },
    boxFormat: 'xyxy1000',
  });
  await scriptMock({ lines: truthLines(FIXTURES.doc) });
  // Give the background a moment to install the session rule for the new base URL.
  await page.waitForTimeout(300);
  await lensByHover(page, '#plain');
  await waitForState(page, 'ready');

  const pageStatus = await page.evaluate(async (url) => (await fetch(url)).status, `${MOCK}/ollama/v1/models`);
  const log: { path: string; origin: string | null }[] = await (await fetch(`${MOCK}/mock/ollama-log`)).json();
  const fromExtension = log.filter((entry) => entry.path.endsWith('/chat/completions'));
  expect(fromExtension.length).toBeGreaterThan(0);
  expect(fromExtension.every((entry) => entry.origin === null)).toBe(true);
  // The page's own request still carries its Origin.
  expect(log.find((entry) => entry.path.endsWith('/models'))?.origin).toBe('http://localhost:4599');
  expect(pageStatus).toBe(200);
});
