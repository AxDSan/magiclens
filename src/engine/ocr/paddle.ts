import * as ort from 'onnxruntime-web/wasm';
import type { NBox, OcrBlock, OcrLine, OcrWord, ProgressInfo } from '../../shared/types';
import { CodedError } from '../../shared/util';
import type { Raster } from '../image';
import { assetUrl, lineIsNoise } from './common';
import { buildCharset, type DecodedLine, decodeCtc } from './paddle-decode';
import {
  type Box,
  DET_MIN_SIDE,
  detectionSize,
  findTextBoxes,
  groupIntoBlocks,
  toImageBox,
  unclipBox,
} from './paddle-geometry';

type Progress = (info: ProgressInfo) => void;

interface Models {
  det: ort.InferenceSession;
  rec: ort.InferenceSession;
  charset: string[];
}

/** A text region: `crop` is what the recognizer reads, `ink` is the tight extent of the glyphs. */
interface Region {
  crop: Box;
  ink: Box;
}

interface ReadLine {
  line: Omit<OcrLine, 'id'>;
  ink: Box;
}

const REC_HEIGHT = 48;
const REC_MIN_WIDTH = 320;
const REC_MAX_WIDTH = 3200;
/** Policy, not part of the reference pipeline: drop lines the recognizer is unsure about. */
const LINE_MIN_CONF = 0.5;
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

let models: Promise<Models> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function fetchBytes(path: string): Promise<ArrayBuffer> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new CodedError('INTERNAL', `Missing OCR asset ${path}`);
  return response.arrayBuffer();
}

function loadModels(): Promise<Models> {
  models ??= (async () => {
    // Only the threaded WASM build ships in onnxruntime-web 1.30, so it always gets loaded.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = {
      wasm: assetUrl('/ocr/ort/ort-wasm-simd-threaded.wasm'),
      mjs: assetUrl('/ocr/ort/ort-wasm-simd-threaded.mjs'),
    };
    const session = (path: string) =>
      fetchBytes(path).then((bytes) =>
        ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }),
      );
    const [det, rec, dict] = await Promise.all([
      session('/ocr/paddle/det.onnx'),
      session('/ocr/paddle/rec.onnx'),
      fetchBytes('/ocr/paddle/dict.txt').then((bytes) => new TextDecoder().decode(bytes)),
    ]);
    return { det, rec, charset: buildCharset(dict) };
  })().catch((error: unknown) => {
    models = null;
    throw error;
  });
  return models;
}

function checkCancel(signal: AbortSignal) {
  if (signal.aborted) throw new CodedError('CANCELLED', 'Cancelled');
}

/** RGBA pixels of a source rect scaled to dw x dh. */
function pixelsOf(
  source: OffscreenCanvas,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(dw, dh);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new CodedError('INTERNAL', 'Canvas 2D context unavailable');
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
  return ctx.getImageData(0, 0, dw, dh).data;
}

async function detect(
  det: ort.InferenceSession,
  raster: Raster,
  signal: AbortSignal,
): Promise<Region[]> {
  const size = detectionSize(raster.width, raster.height);
  const data = pixelsOf(raster.canvas, 0, 0, raster.width, raster.height, size.width, size.height);
  const plane = size.width * size.height;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    // The reference feeds BGR, so channel 0 reads the blue byte, normalised with mean[0].
    for (let c = 0; c < 3; c++) {
      input[c * plane + i] = (data[i * 4 + (2 - c)] / 255 - DET_MEAN[c]) / DET_STD[c];
    }
  }
  const out = await det.run({
    [det.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size.height, size.width]),
  });
  checkCancel(signal);
  const prob = out[det.outputNames[0]].data as Float32Array;

  const toImage = (box: Box) => toImageBox(box, size, raster.width, raster.height);
  const regions: Region[] = [];
  for (const box of findTextBoxes(prob, size.width, size.height)) {
    const crop = toImage(unclipBox(box));
    if (Math.min(crop.x1 - crop.x0, crop.y1 - crop.y0) < DET_MIN_SIDE) continue;
    regions.push({ crop, ink: toImage(box) });
  }
  return regions.sort((a, b) => a.ink.y0 - b.ink.y0 || a.ink.x0 - b.ink.x0);
}

const toNBox = (box: Box, width: number, height: number): NBox => ({
  x: box.x0 / width,
  y: box.y0 / height,
  w: (box.x1 - box.x0) / width,
  h: (box.y1 - box.y0) / height,
});

function unionNBox(boxes: NBox[]): NBox {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Reads one region. Returns null when the recognizer found no confident text. */
async function readRegion(
  rec: ort.InferenceSession,
  charset: string[],
  raster: Raster,
  region: Region,
): Promise<ReadLine | null> {
  const { crop, ink } = region;
  const sx0 = Math.floor(crop.x0);
  const sy0 = Math.floor(crop.y0);
  const cw = Math.ceil(crop.x1) - sx0;
  const ch = Math.ceil(crop.y1) - sy0;
  // Keep the aspect ratio at the fixed recognizer height; pad to at least REC_MIN_WIDTH.
  const rw = Math.min(REC_MAX_WIDTH, Math.max(1, Math.ceil((REC_HEIGHT * cw) / ch)));
  const width = Math.max(REC_MIN_WIDTH, rw);

  const data = pixelsOf(raster.canvas, sx0, sy0, cw, ch, rw, REC_HEIGHT);
  const plane = REC_HEIGHT * width;
  // Zeros are the padding, which is zero in the normalised space the model expects.
  const input = new Float32Array(3 * plane);
  for (let y = 0; y < REC_HEIGHT; y++) {
    for (let x = 0; x < rw; x++) {
      const p = (y * rw + x) * 4;
      for (let c = 0; c < 3; c++) {
        input[c * plane + y * width + x] = (data[p + (2 - c)] / 255 - 0.5) / 0.5;
      }
    }
  }
  const out = await rec.run({
    [rec.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, REC_HEIGHT, width]),
  });
  const logits = out[rec.outputNames[0]];
  const [, steps, classes] = logits.dims as number[];
  if (classes !== charset.length) {
    throw new CodedError(
      'INTERNAL',
      `Recognizer has ${classes} classes but the dictionary has ${charset.length}`,
    );
  }
  const decoded: DecodedLine = decodeCtc(logits.data as Float32Array, steps, classes, charset);
  if (!decoded.text || decoded.conf < LINE_MIN_CONF) return null;

  // Timestep t covers tensor columns [t, t+1) * width / steps. Tensor column x is canvas
  // column x (drawn 1:1), and canvas column c maps to image column sx0 + c * cw / rw.
  const at = (t: number) =>
    Math.min(crop.x1, Math.max(crop.x0, sx0 + ((t * width) / steps) * (cw / rw)));
  const frame = (x0: number, x1: number): Box => ({ x0, y0: ink.y0, x1, y1: ink.y1 });
  const words: OcrWord[] = decoded.words.map((word) => ({
    text: word.text,
    conf: word.conf,
    box: toNBox(frame(at(word.t0), at(word.t1)), raster.width, raster.height),
  }));
  const lineBox = frame(
    Math.min(...decoded.words.map((w) => at(w.t0))),
    Math.max(...decoded.words.map((w) => at(w.t1))),
  );
  return {
    line: {
      text: decoded.text,
      conf: decoded.conf,
      box: toNBox(lineBox, raster.width, raster.height),
      size: (ink.y1 - ink.y0) / raster.height,
      words,
    },
    ink,
  };
}

async function run(raster: Raster, signal: AbortSignal, onProgress: Progress): Promise<OcrBlock[]> {
  checkCancel(signal);
  onProgress({ stage: 'load', label: 'Loading PaddleOCR models' });
  const { det, rec, charset } = await loadModels();
  checkCancel(signal);

  onProgress({ stage: 'detect', label: 'Finding text' });
  const regions = await detect(det, raster, signal);

  const read: ReadLine[] = [];
  for (const [index, region] of regions.entries()) {
    checkCancel(signal);
    onProgress({ stage: 'recognize', progress: index / regions.length, label: 'Reading text' });
    const entry = await readRegion(rec, charset, raster, region);
    if (entry && !lineIsNoise(entry.line)) read.push(entry);
  }
  checkCancel(signal);

  const lines: OcrLine[] = read.map((entry, index) => ({ ...entry.line, id: `l${index}` }));
  return groupIntoBlocks(read.map((entry) => entry.ink)).map((group, index) => {
    const blockLines = group.map((i) => lines[i]);
    return {
      id: `b${index}`,
      box: unionNBox(blockLines.map((line) => line.box)),
      lines: blockLines,
    };
  });
}

/** Runs PP-OCRv5 on `raster`. Calls are serialised; the models stay loaded for later calls. */
export function recognizePaddle(
  raster: Raster,
  signal: AbortSignal,
  onProgress: Progress,
): Promise<OcrBlock[]> {
  const guarded = async () => {
    try {
      return await run(raster, signal, onProgress);
    } catch (error) {
      if (signal.aborted) throw new CodedError('CANCELLED', 'Cancelled');
      throw error;
    }
  };
  const result = queue.then(guarded, guarded);
  queue = result.catch(() => undefined);
  return result;
}
