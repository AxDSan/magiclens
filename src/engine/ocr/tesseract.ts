import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { browser } from 'wxt/browser';
import type { PageSegmentation } from '../../shared/settings';
import type { NBox, OcrBlock, OcrLine, OcrWord, ProgressInfo } from '../../shared/types';
import { clamp, CodedError } from '../../shared/util';
import { type Raster, resample } from '../image';

type Progress = (info: ProgressInfo) => void;

interface TessBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TessWord {
  text: string;
  confidence: number;
  bbox: TessBbox;
}
interface TessLine {
  text: string;
  confidence: number;
  bbox: TessBbox;
  baseline?: TessBbox & { has_baseline?: boolean };
  rowAttributes?: { rowHeight?: number; row_height?: number };
  words: TessWord[];
}
interface TessParagraph {
  bbox: TessBbox;
  lines: TessLine[];
}
interface TessBlock {
  paragraphs: TessParagraph[];
}

const BUNDLED_LANGS = new Set(['eng']);
const IDLE_MS = 90_000;

let workerLangs = '';
let workerReady: Promise<Worker> | null = null;
let currentProgress: Progress | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let generation = 0;

function onLog(message: { status: string; progress: number }) {
  if (!currentProgress) return;
  if (message.status === 'recognizing text') {
    currentProgress({ stage: 'recognize', progress: message.progress, label: 'Reading text' });
  } else if (/loading|initializ/.test(message.status)) {
    currentProgress({ stage: 'load', label: 'Warming up the OCR engine' });
  }
}

// Files added by the build hook in wxt.config.ts are not in WXT's typed public paths.
const assetUrl = (path: string) => (browser.runtime.getURL as (p: string) => string)(path);

async function getWorker(langs: string[]): Promise<Worker> {
  const key = langs.join('+');
  if (workerReady && workerLangs === key) return workerReady;
  await disposeWorker();
  workerLangs = key;
  const local = langs.every((lang) => BUNDLED_LANGS.has(lang));
  workerReady = createWorker(langs, OEM.LSTM_ONLY, {
    workerPath: assetUrl('/ocr/worker.min.js'),
    corePath: assetUrl('/ocr/core'),
    // English ships with the extension; other languages download once from the
    // tesseract.js data CDN and are cached in IndexedDB.
    ...(local ? { langPath: assetUrl('/ocr/lang') } : {}),
    workerBlobURL: false,
    logger: onLog,
    errorHandler: (error: unknown) => console.warn('[MagicLens] OCR worker error', error),
  });
  workerReady.catch(() => {
    workerReady = null;
    workerLangs = '';
  });
  return workerReady;
}

async function disposeWorker() {
  const pending = workerReady;
  workerReady = null;
  workerLangs = '';
  if (pending) await pending.then((w) => w.terminate()).catch(() => undefined);
}

function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void disposeWorker(), IDLE_MS);
}

/** Stops the running recognition by killing the worker; the next job starts a fresh one. */
export function cancelTesseract() {
  generation++;
  void disposeWorker();
}

function wordIsNoise(word: TessWord): boolean {
  const text = word.text.trim();
  if (!text) return true;
  const alnum = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (word.confidence < 30) return true;
  if (alnum === 0 && word.confidence < 70) return true;
  return alnum / text.length < 0.34 && word.confidence < 55;
}

function lineIsNoise(line: OcrLine): boolean {
  const alnum = (line.text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (alnum === 0) return true;
  // Isolated single glyphs are usually texture, not text.
  return line.text.replace(/\s/g, '').length === 1 && line.conf < 0.8;
}

const union = (boxes: TessBbox[]): TessBbox => ({
  x0: Math.min(...boxes.map((b) => b.x0)),
  y0: Math.min(...boxes.map((b) => b.y0)),
  x1: Math.max(...boxes.map((b) => b.x1)),
  y1: Math.max(...boxes.map((b) => b.y1)),
});

export function convertTesseract(blocks: TessBlock[], width: number, height: number): OcrBlock[] {
  const norm = (b: TessBbox): NBox => ({
    x: b.x0 / width,
    y: b.y0 / height,
    w: (b.x1 - b.x0) / width,
    h: (b.y1 - b.y0) / height,
  });
  const out: OcrBlock[] = [];
  let lineIndex = 0;
  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      const lines: OcrLine[] = [];
      for (const line of paragraph.lines ?? []) {
        const kept = (line.words ?? []).filter((word) => !wordIsNoise(word));
        if (!kept.length) continue;
        const bbox = union(kept.map((w) => w.bbox));
        const words: OcrWord[] = kept.map((w) => ({
          text: w.text.trim(),
          box: norm(w.bbox),
          conf: w.confidence / 100,
        }));
        let baseline: OcrLine['baseline'];
        const b = line.baseline;
        if (b && b.has_baseline !== false && b.x1 > b.x0) {
          const angle = Math.atan2(b.y1 - b.y0, b.x1 - b.x0);
          // Tesseract reports the baseline from the line's own origin; evaluate it at the
          // left edge of the kept words.
          const y = b.y0 + (bbox.x0 - b.x0) * Math.tan(angle);
          const ink = bbox.y1 - bbox.y0;
          if (y > bbox.y0 + ink * 0.3 && y < bbox.y1 + ink * 0.15) {
            baseline = { y: y / height, angle };
          }
        }
        const rowHeight = line.rowAttributes?.rowHeight ?? line.rowAttributes?.row_height ?? 0;
        const inkHeight = bbox.y1 - bbox.y0;
        // Row height covers ascenders and descenders; it is the best font-size estimate
        // when sane, otherwise fall back to the ink height.
        const size =
          rowHeight > inkHeight * 0.6 && rowHeight < inkHeight * 2.2 ? rowHeight : inkHeight;
        const ocrLine: OcrLine = {
          id: `l${lineIndex++}`,
          text: words.map((w) => w.text).join(' '),
          box: norm(bbox),
          size: size / height,
          baseline,
          conf: line.confidence / 100,
          words,
        };
        if (!lineIsNoise(ocrLine)) lines.push(ocrLine);
      }
      if (!lines.length) continue;
      out.push({
        id: `b${out.length}`,
        box: norm(union(lines.map((l) => toTess(l.box, width, height)))),
        lines,
      });
    }
  }
  return out;
}

const toTess = (box: NBox, width: number, height: number): TessBbox => ({
  x0: box.x * width,
  y0: box.y * height,
  x1: (box.x + box.w) * width,
  y1: (box.y + box.h) * height,
});

const keptChars = (blocks: OcrBlock[]) =>
  blocks.reduce((n, b) => n + b.lines.reduce((m, l) => m + l.text.length * l.conf, 0), 0);

/** Upscales small images: Tesseract's LSTM reads best with glyphs around 20-40px tall. */
function prepare(raster: Raster): Raster {
  const longest = Math.max(raster.width, raster.height);
  const scale = clamp(2000 / longest, 1, 3);
  if (scale > 1.05) return resample(raster, scale);
  const cap = 3600 / longest;
  return cap < 1 ? resample(raster, cap) : raster;
}

export async function recognizeTesseract(
  raster: Raster,
  langs: string[],
  segmentation: PageSegmentation,
  onProgress: Progress,
): Promise<OcrBlock[]> {
  const run = async () => {
    const started = generation;
    clearTimeout(idleTimer);
    currentProgress = onProgress;
    try {
      onProgress({ stage: 'load', label: 'Warming up the OCR engine' });
      const tess = await getWorker(langs.length ? langs : ['eng']);
      const input = prepare(raster);
      const blob = await input.canvas.convertToBlob({ type: 'image/png' });

      const pass = async (psm: PSM) => {
        await tess.setParameters({
          tessedit_pageseg_mode: psm,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
        const { data } = await tess.recognize(blob, {}, { blocks: true, text: false });
        return convertTesseract(
          (data.blocks ?? []) as unknown as TessBlock[],
          input.width,
          input.height,
        );
      };

      if (segmentation === 'sparse') return await pass(PSM.SPARSE_TEXT);
      if (segmentation === 'block') return await pass(PSM.SINGLE_BLOCK);
      const auto = await pass(PSM.AUTO);
      // Layout analysis misses scattered text (memes, signs, UI); retry in sparse mode
      // when it found little, and keep whichever pass read more confident text.
      if (keptChars(auto) < 24) {
        onProgress({ stage: 'recognize', progress: 0, label: 'Looking for scattered text' });
        const sparse = await pass(PSM.SPARSE_TEXT);
        if (keptChars(sparse) > keptChars(auto) * 1.15) return sparse;
      }
      return auto;
    } catch (error) {
      if (generation !== started) throw new CodedError('CANCELLED', 'Cancelled');
      throw error;
    } finally {
      currentProgress = null;
      scheduleIdle();
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
