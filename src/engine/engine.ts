import type { AnalysisJob, EngineEvent, ErrorCode, OcrJob } from '../shared/messages';
import { type BoxFormat, detectBoxFormat, PROVIDERS } from '../shared/providers';
import { providerReady, resolveEngine, type Settings } from '../shared/settings';
import type { EngineKind, OcrBlock, OcrResult, ProgressInfo } from '../shared/types';
import { CodedError, errorMessage } from '../shared/util';
import { mergeRefinement } from './hybrid';
import {
  acquire,
  type EncodedImage,
  encode,
  fit,
  parseDataUrl,
  type Raster,
  resize,
  sampleColors,
  toDataUrl,
} from './image';
import { createClient, type LlmClient } from './llm';
import { groupBlocks, linesFromRaw, parseOcrJson, parseRefinement, parseTranslations } from './llm/parse';
import {
  ANALYSIS_SYSTEM,
  askPrompt,
  explainPrompt,
  OCR_SYSTEM,
  ocrPrompt,
  refinePrompt,
  summarizePrompt,
  TRANSLATE_SYSTEM,
  translatePrompt,
} from './llm/prompts';
import { cancelTesseract, recognizeTesseract } from './ocr/tesseract';

export type Emit = (event: EngineEvent) => void;

const running = new Map<string, { controller: AbortController; usesTesseract: boolean }>();

export function cancelJob(id: string) {
  const job = running.get(id);
  if (!job) return;
  job.controller.abort();
  if (job.usesTesseract) cancelTesseract();
}

function throttle<T>(fn: (value: T) => void, ms: number) {
  let last = 0;
  let pending: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    last = Date.now();
    if (pending !== undefined) fn(pending);
    pending = undefined;
  };
  const call = (value: T) => {
    pending = value;
    if (timer) return;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) flush();
    else timer = setTimeout(flush, wait);
  };
  call.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  return call;
}

const fullText = (blocks: OcrBlock[]) =>
  blocks.map((block) => block.lines.map((line) => line.text).join('\n')).join('\n\n');

function activeClient(settings: Settings): LlmClient {
  return createClient(settings.provider, settings.providers[settings.provider]);
}

function boxFormatFor(settings: Settings): BoxFormat {
  if (settings.boxFormat !== 'auto') return settings.boxFormat;
  return detectBoxFormat(settings.provider, settings.providers[settings.provider].model);
}

/**
 * Encodes the image the way the model will see it. Pixel-coordinate models must receive an
 * image the server will not resize again, or their coordinates drift.
 */
async function imageForModel(raster: Raster, settings: Settings, format: BoxFormat): Promise<EncodedImage> {
  const preset = PROVIDERS[settings.provider];
  const model = settings.providers[settings.provider].model.toLowerCase();
  if (format === 'pixels' && /qwen/.test(model)) {
    // Qwen2.5-VL resizes to multiples of 28 within ~1M pixels; pre-align so it doesn't.
    const fitted = fit(raster, preset.maxImageSide, 1280 * 28 * 28);
    const w = Math.max(28, Math.round(fitted.width / 28) * 28);
    const h = Math.max(28, Math.round(fitted.height / 28) * 28);
    return encode(resize(raster, w, h), Infinity);
  }
  if (preset.kind === 'anthropic') {
    return encode(fit(raster, preset.maxImageSide, 1_150_000), Infinity);
  }
  return encode(raster, preset.maxImageSide);
}

async function llmRead(
  raster: Raster,
  settings: Settings,
  signal: AbortSignal,
  progress: (info: ProgressInfo) => void,
): Promise<{ blocks: OcrBlock[]; language?: string }> {
  const client = activeClient(settings);
  const format = boxFormatFor(settings);
  const image = await imageForModel(raster, settings, format);
  progress({ stage: 'llm', label: `Asking ${client.model}` });
  const report = throttle((text: string) => {
    const lines = (text.match(/"text"\s*:/g) ?? []).length;
    progress({ stage: 'llm', label: lines ? `Reading text · ${lines} lines` : `Asking ${client.model}` });
  }, 150);
  const raw = await client.complete({
    system: OCR_SYSTEM,
    prompt: ocrPrompt(format, image.width, image.height),
    image,
    purpose: 'ocr',
    json: true,
    signal,
    onText: report,
  });
  report.cancel();
  const parsed = parseOcrJson(raw, format, image.width, image.height);
  return { blocks: groupBlocks(linesFromRaw(parsed.lines, 'l', 0.85)), language: parsed.language };
}

function withColors(raster: Raster, blocks: OcrBlock[]): OcrBlock[] {
  const lines = blocks.flatMap((block) => block.lines);
  if (!lines.length) return blocks;
  const colors = sampleColors(raster, lines.map((line) => line.box));
  lines.forEach((line, i) => Object.assign(line, colors[i]));
  return blocks;
}

function errorCode(error: unknown): ErrorCode {
  return error instanceof CodedError ? error.code : 'INTERNAL';
}

export async function runOcr(job: OcrJob, settings: Settings, emit: Emit): Promise<void> {
  const id = job.jobId;
  const controller = new AbortController();
  const state = { controller, usesTesseract: false };
  running.set(id, state);
  const started = performance.now();
  const progress = (info: ProgressInfo) => {
    if (!controller.signal.aborted) emit({ t: 'progress', id, info });
  };

  try {
    progress({
      stage: 'acquire',
      label: job.source.kind === 'capture' ? 'Capturing the element' : 'Loading the image',
    });
    const raster = await acquire(job.source, controller.signal);

    let engine: EngineKind = job.engine ?? resolveEngine(settings);
    if (engine !== 'local' && !providerReady(settings)) {
      if (job.engine) {
        throw new CodedError('NO_PROVIDER', 'Add an AI provider in MagicLens settings to read with AI.');
      }
      engine = 'local';
    }
    const preview = encode(raster, 2048, 'image/jpeg', 0.88);
    const notes: string[] = [];
    let blocks: OcrBlock[] = [];
    let language: string | undefined;
    let model = '';

    if (engine === 'local' || engine === 'hybrid') {
      state.usesTesseract = true;
      blocks = await recognizeTesseract(raster, settings.ocrLangs, settings.segmentation, progress);
      state.usesTesseract = false;
      model = `Tesseract · ${settings.ocrLangs.join('+')}`;
    }
    controller.signal.throwIfAborted();

    if (engine === 'hybrid' && blocks.length) {
      const client = activeClient(settings);
      emit({
        t: 'partial',
        id,
        result: {
          engine: 'local',
          model,
          width: raster.width,
          height: raster.height,
          blocks: withColors(raster, blocks),
          text: fullText(blocks),
          ms: Math.round(performance.now() - started),
        },
      });
      progress({ stage: 'refine', label: `Refining with ${client.model}` });
      try {
        const format = boxFormatFor(settings);
        const image = await imageForModel(raster, settings, format);
        const lines = blocks.flatMap((block) => block.lines);
        const raw = await client.complete({
          system: OCR_SYSTEM,
          prompt: refinePrompt(lines, format, image.width, image.height),
          image,
          purpose: 'ocr',
          json: true,
          signal: controller.signal,
        });
        const refinement = parseRefinement(raw, format, image.width, image.height);
        blocks = mergeRefinement(blocks, refinement);
        language = refinement.language;
        model = client.model;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        notes.push(`AI refinement failed, showing local OCR: ${errorMessage(error)}`);
        engine = 'local';
      }
    } else if (engine === 'llm' || engine === 'hybrid') {
      // Hybrid with nothing detected locally: let the model find the text itself.
      const read = await llmRead(raster, settings, controller.signal, progress);
      blocks = read.blocks;
      language = read.language;
      model = activeClient(settings).model;
      engine = 'llm';
    }

    const result: OcrResult = {
      engine,
      model,
      width: raster.width,
      height: raster.height,
      blocks: withColors(raster, blocks),
      text: fullText(blocks),
      language,
      ms: Math.round(performance.now() - started),
      notes: notes.length ? notes : undefined,
    };
    emit({ t: 'result', id, result, image: toDataUrl(await preview) });
  } catch (error) {
    const code = controller.signal.aborted ? 'CANCELLED' : errorCode(error);
    emit({ t: 'error', id, code, message: errorMessage(error) });
  } finally {
    running.delete(id);
  }
}

/** Turns "[b0] text" streaming output into readable paragraphs. */
const readableTranslation = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[A-Za-z]+\d+\]\s?/, '').trim())
    .filter(Boolean)
    .join('\n\n');

export async function runAnalysis(job: AnalysisJob, settings: Settings, emit: Emit): Promise<void> {
  const id = job.reqId;
  const controller = new AbortController();
  running.set(id, { controller, usesTesseract: false });
  try {
    if (!providerReady(settings)) {
      throw new CodedError('NO_PROVIDER', 'Add an AI provider in MagicLens settings to use this.');
    }
    const client = activeClient(settings);
    const { mime, base64 } = parseDataUrl(job.image);
    const image: EncodedImage = { mime, base64, width: job.result.width, height: job.result.height };
    const extra = settings.customInstructions.trim();
    const translate = job.kind === 'translate';
    const delta = throttle((text: string) => {
      emit({ t: 'delta', id, text: translate ? readableTranslation(text) : text });
    }, 40);

    let system = ANALYSIS_SYSTEM;
    let prompt: string;
    switch (job.kind) {
      case 'translate':
        system = TRANSLATE_SYSTEM;
        prompt = translatePrompt(job.result.blocks, settings.translateTo, extra);
        break;
      case 'summarize':
        prompt = summarizePrompt(job.result, extra);
        break;
      case 'ask':
        prompt = askPrompt(job.result, job.question ?? '', extra);
        break;
      default:
        prompt = explainPrompt(job.result, extra);
    }
    const text = await client.complete({
      system,
      prompt,
      image,
      purpose: 'analysis',
      signal: controller.signal,
      onText: delta,
    });
    delta.cancel();
    if (translate) {
      const translations = Object.fromEntries(
        parseTranslations(text, job.result.blocks.map((block) => block.id)),
      );
      emit({ t: 'done', id, text: readableTranslation(text), translations });
    } else {
      emit({ t: 'done', id, text });
    }
  } catch (error) {
    const code = controller.signal.aborted ? 'CANCELLED' : errorCode(error);
    emit({ t: 'error', id, code, message: errorMessage(error) });
  } finally {
    running.delete(id);
  }
}
