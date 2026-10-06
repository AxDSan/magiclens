import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, lensByHover, scriptMock, test, truthLines, useMockProvider, waitForState } from './fixtures';

// Renders the AI features for a human to look at. Run with VISUAL_DIR=/some/dir.
const dir = process.env.VISUAL_DIR;

test('visual: hybrid refine, explain and translate', async ({ page, sw }) => {
  test.skip(!dir, 'set VISUAL_DIR to capture frames');
  mkdirSync(dir!, { recursive: true });
  await useMockProvider(sw, 'hybrid');
  await scriptMock({
    lines: truthLines(FIXTURES.doc),
    delayMs: 60,
    explain:
      'This is the **summary slide** of a quarterly report.\n\n- Revenue grew **42%** year over year\n- Questions go to the finance team\n- Last updated in October 2026',
    translations: {
      'Quarterly report summary': 'Resumen del informe trimestral',
      'Revenue grew by 42 percent this year': 'Los ingresos crecieron un 42 por ciento este año',
      'Contact the finance team for details': 'Contacte al equipo de finanzas para más detalles',
      'Updated October 2026': 'Actualizado en octubre de 2026',
    },
  });
  const box = (await page.locator('#plain').boundingBox())!;
  const clip = { x: Math.max(0, box.x - 30), y: Math.max(0, box.y - 30), width: box.width + 60, height: box.height + 330 };
  await lensByHover(page, '#plain');
  await waitForState(page, 'refine');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(dir!, 'refine.png'), clip });
  await waitForState(page, 'ready');
  await page.locator('magiclens-root .panel button[title="Explain this image"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(dir!, 'explain-stream.png'), clip });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(dir!, 'explain.png'), clip });
  await page.locator('magiclens-root .panel button[title="Translate the text in place"]').click();
  await page.locator('magiclens-root .tr').first().waitFor();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: join(dir!, 'translate.png'), clip });
});
