import type { BoxFormat } from '../../shared/providers';
import type { OcrBlock, OcrLine, OcrResult } from '../../shared/types';

export const OCR_SYSTEM =
  'You are a meticulous OCR engine. You transcribe text exactly as printed and report ' +
  'where each line sits in the image. You answer with JSON only.';

function boxSpec(format: BoxFormat, width: number, height: number) {
  switch (format) {
    case 'yxyx1000':
      return {
        key: 'box_2d',
        text:
          '"box_2d": [ymin, xmin, ymax, xmax] — integers normalized to 0-1000 ' +
          '(0,0 is the top-left corner of the image, 1000,1000 the bottom-right).',
      };
    case 'pixels':
      return {
        key: 'bbox_2d',
        text:
          `"bbox_2d": [x1, y1, x2, y2] — integer pixel coordinates in this ${width}x${height} ` +
          'image (x1,y1 = top-left of the text, x2,y2 = bottom-right).',
      };
    default:
      return {
        key: 'bbox',
        text:
          '"bbox": [x_min, y_min, x_max, y_max] — integers normalized to 0-1000 ' +
          '(0,0 is the top-left corner of the image, 1000,1000 the bottom-right).',
      };
  }
}

export function ocrPrompt(format: BoxFormat, width: number, height: number): string {
  const spec = boxSpec(format, width, height);
  return [
    'Read ALL text visible in this image.',
    'Return one entry per visual line of text (never merge separate lines or columns), in natural reading order.',
    'Copy the text exactly: same spelling, case, punctuation, numbers and language. Do not translate, fix or summarize.',
    'Include small print, labels, captions, UI text, signs and watermarks.',
    `Each box must tightly enclose the ink of that line. Box format: ${spec.text}`,
    '',
    'Answer with JSON only, no prose and no code fences:',
    `{"language": "<BCP-47 code of the main language>", "lines": [{"text": "...", "${spec.key}": [..]}]}`,
    'If the image contains no text, answer {"language": "", "lines": []}.',
  ].join('\n');
}

const to1000 = (v: number) => Math.round(v * 1000);

export function refinePrompt(lines: OcrLine[], format: BoxFormat, width: number, height: number) {
  const spec = boxSpec(format, width, height);
  const listing = lines
    .map((line) => {
      const b = line.box;
      return `${line.id} [${to1000(b.x)},${to1000(b.y)},${to1000(b.x + b.w)},${to1000(b.y + b.h)}]: ${JSON.stringify(line.text)}`;
    })
    .join('\n');
  return [
    'A basic OCR engine read this image and produced the numbered lines below.',
    'Each has an id, its position as [x_min, y_min, x_max, y_max] on a 0-1000 grid, and the',
    'text the engine read. That text often contains recognition errors.',
    '',
    listing,
    '',
    'Look at the image and give the exact text of every numbered line as it appears in the',
    'image (same language, spelling, case and punctuation; do not translate). Keep the ids.',
    'If a numbered region holds no real text (noise, texture), return "" for it.',
    `If you see text lines the engine missed entirely, add them to "missing" with a box: ${spec.text}`,
    '',
    'Answer with JSON only, no prose and no code fences:',
    `{"language": "<BCP-47 code>", "lines": [{"id": "l0", "text": "..."}], "missing": [{"text": "...", "${spec.key}": [..]}]}`,
  ].join('\n');
}

export const ANALYSIS_SYSTEM =
  'You are MagicLens, a sharp visual assistant inside a web browser. The user pointed you ' +
  'at an image on a web page. Be accurate, concrete and brief. Use light Markdown ' +
  '(short paragraphs, bullet lists, **bold** for key facts). Never invent text that is not ' +
  'in the image.';

function textContext(result: OcrResult): string {
  if (!result.text.trim()) return 'OCR found no text in the image.';
  return `Text extracted from the image by OCR (may contain small errors):\n"""\n${result.text}\n"""`;
}

export function explainPrompt(result: OcrResult, extra: string): string {
  return [
    textContext(result),
    '',
    'Explain this image: what it shows, what its text says or means, and any context a reader',
    'would need (jargon, references, numbers, warnings). Keep it under 180 words.',
    extra,
  ].join('\n');
}

export function summarizePrompt(result: OcrResult, extra: string): string {
  return [
    textContext(result),
    '',
    'Summarize the information in this image in 3-6 bullet points. Lead with the most important fact.',
    extra,
  ].join('\n');
}

export function askPrompt(result: OcrResult, question: string, extra: string): string {
  return [textContext(result), '', `Question: ${question}`, extra].join('\n');
}

export const TRANSLATE_SYSTEM =
  'You are a professional translator. You translate text found in images faithfully and ' +
  'naturally, keeping names, numbers and formatting.';

export function translatePrompt(blocks: OcrBlock[], target: string, extra: string): string {
  const listing = blocks
    .map((block) => `[${block.id}] ${block.lines.map((l) => l.text).join(' ')}`)
    .join('\n');
  return [
    `Translate each numbered paragraph of text from this image into ${target}.`,
    'Use the image to resolve OCR mistakes and ambiguous words.',
    `If a paragraph is already in ${target} or is a name, number or code, repeat it unchanged.`,
    '',
    listing,
    '',
    'Answer with exactly one line per paragraph, in the same order, formatted as',
    '[id] translation',
    'and nothing else.',
    extra,
  ].join('\n');
}
