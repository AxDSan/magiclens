/**
 * Pure geometry for the PP-OCRv5 detector (DB). Boxes are axis-aligned pixel edges, with x1/y1
 * exclusive. Constants follow PaddleOCR's DB defaults, which the verified reference uses.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const DET_MAX_SIDE = 960;
export const DET_BIN_THRESHOLD = 0.3;
export const DET_BOX_SCORE = 0.6;
export const DET_UNCLIP_RATIO = 1.5;
export const DET_MIN_PIXELS = 4;
export const DET_MIN_SIDE = 3;

/** Input size for the detector: longest side capped at DET_MAX_SIDE, each side a multiple of 32. */
export function detectionSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  const ratio = longest > DET_MAX_SIDE ? DET_MAX_SIDE / longest : 1;
  const snap = (side: number) => Math.max(32, Math.round((side * ratio) / 32) * 32);
  return { width: snap(width), height: snap(height) };
}

/**
 * Thresholds the probability map and returns the bounding box of each 4-connected region whose
 * mean probability clears DET_BOX_SCORE. The map is row-major, width x height.
 */
export function findTextBoxes(prob: Float32Array, width: number, height: number): Box[] {
  const seen = new Uint8Array(prob.length);
  const stack: number[] = [];
  const boxes: Box[] = [];
  for (let start = 0; start < prob.length; start++) {
    if (seen[start] || prob[start] <= DET_BIN_THRESHOLD) continue;
    seen[start] = 1;
    stack.push(start);
    let count = 0;
    let sum = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    while (stack.length) {
      const index = stack.pop() as number;
      const x = index % width;
      const y = (index - x) / width;
      count++;
      sum += prob[index];
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const next of neighbours) {
        if (next >= 0 && !seen[next] && prob[next] > DET_BIN_THRESHOLD) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (count < DET_MIN_PIXELS || sum / count < DET_BOX_SCORE) continue;
    boxes.push({ x0, y0, x1, y1 });
  }
  return boxes;
}

/** Expands a detected box so the glyph strokes sit inside the crop (DB unclip). */
export function unclipBox(box: Box): Box {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const d = (w * h * DET_UNCLIP_RATIO) / (2 * (w + h));
  return { x0: box.x0 - d, y0: box.y0 - d, x1: box.x1 + d, y1: box.y1 + d };
}

/** Maps a box from detector space to image pixels, clamped to the image. */
export function toImageBox(
  box: Box,
  detSize: { width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): Box {
  const sx = imageWidth / detSize.width;
  const sy = imageHeight / detSize.height;
  return {
    x0: Math.max(0, box.x0 * sx),
    y0: Math.max(0, box.y0 * sy),
    x1: Math.min(imageWidth, box.x1 * sx),
    y1: Math.min(imageHeight, box.y1 * sy),
  };
}

/**
 * Groups reading-ordered line boxes into blocks: a line joins the first block that already
 * holds a line directly above it (vertical gap at most half the shorter line) and horizontally
 * overlaps it. Returns line indices per block.
 */
export function groupIntoBlocks(lines: Box[]): number[][] {
  const groups: number[][] = [];
  lines.forEach((line, index) => {
    const home = groups.find((group) => group.some((other) => stacked(lines[other], line)));
    if (home) home.push(index);
    else groups.push([index]);
  });
  return groups;
}

function stacked(a: Box, b: Box): boolean {
  const shorter = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  // Negative when the boxes overlap vertically.
  const gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
  const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  return gap <= shorter * 0.5 && overlapX > 0;
}
