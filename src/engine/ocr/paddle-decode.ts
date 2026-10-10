/**
 * CTC decoding for the PP-OCRv5 recognizer: greedy path, blank and repeat collapse, and
 * splitting into words at whitespace. Timesteps index the recognizer's output width.
 */

export interface DecodedWord {
  text: string;
  /** First and last-plus-one timestep covered by the word. */
  t0: number;
  t1: number;
  conf: number;
}

export interface DecodedLine {
  text: string;
  conf: number;
  words: DecodedWord[];
}

interface Char {
  text: string;
  t0: number;
  t1: number;
  conf: number;
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * Class 0 is the CTC blank, and the last class is the space the model emits between words.
 * Empty dictionary lines are dropped, matching the reference pipeline.
 */
export function buildCharset(dictionary: string): string[] {
  const entries = dictionary.split('\n').filter((line) => line !== '');
  return ['', ...entries, ' '];
}

/**
 * Decodes one line from row-major logits of shape [steps, classes] (probabilities, already
 * softmaxed). Char confidence is the mean probability over the timesteps it occupies.
 */
export function decodeCtc(
  logits: Float32Array,
  steps: number,
  classes: number,
  charset: string[],
): DecodedLine {
  const best = new Int32Array(steps);
  const bestProb = new Float32Array(steps);
  for (let t = 0; t < steps; t++) {
    let index = 0;
    let value = -Infinity;
    const base = t * classes;
    for (let c = 0; c < classes; c++) {
      if (logits[base + c] > value) {
        value = logits[base + c];
        index = c;
      }
    }
    best[t] = index;
    bestProb[t] = value;
  }

  const chars: Char[] = [];
  for (let t = 0; t < steps; ) {
    const index = best[t];
    let end = t;
    const probs: number[] = [];
    while (end < steps && best[end] === index) probs.push(bestProb[end++]);
    // Equal consecutive indices form one run; blanks end a run without emitting.
    if (index !== 0) {
      chars.push({ text: charset[index] ?? '', t0: t, t1: end, conf: mean(probs) });
    }
    t = end;
  }

  const words: DecodedWord[] = [];
  let current: Char[] = [];
  const flush = () => {
    if (!current.length) return;
    words.push({
      text: current.map((c) => c.text).join(''),
      t0: current[0].t0,
      t1: current[current.length - 1].t1,
      conf: mean(current.map((c) => c.conf)),
    });
    current = [];
  };
  for (const char of chars) {
    if (/\s/.test(char.text)) flush();
    else current.push(char);
  }
  flush();

  return {
    text: words.map((w) => w.text).join(' '),
    conf: chars.length ? mean(chars.map((c) => c.conf)) : 0,
    words,
  };
}
