import { clamp } from '../../shared/util';

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: Element) => {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
};

/**
 * A highlight that travels clockwise around a rectangle at constant speed. A rotating conic
 * gradient would race through the corners and crawl along the middle of long sides; here each
 * side is a strip whose gradient slides along it, and all four strips share one start time so
 * the highlight turns the corners seamlessly. Only `transform` animates.
 */
export class Comet {
  private tails: HTMLElement[] = [];
  private strips: HTMLElement[] = [];
  private animations: Animation[] = [];
  private lap = 0;
  private sizeKey = '';

  constructor(readonly el: HTMLElement) {
    for (let i = 0; i < 4; i++) {
      const strip = make('div', 'side', el);
      this.strips.push(strip);
      this.tails.push(make('i', 'tail', strip));
    }
  }

  /** Lays the comet out for a `width` x `height` box; a no-op while the size is unchanged. */
  resize(width: number, height: number) {
    const key = `${Math.round(width)}x${Math.round(height)}`;
    if (key === this.sizeKey || width < 1 || height < 1) return;
    this.sizeKey = key;

    const perimeter = 2 * (width + height);
    const lap = clamp(perimeter / 560, 2.4, 4.4) * 1000;
    const now = Number(document.timeline.currentTime ?? performance.now());
    // Carry the progress through the lap over, so a resize does not make the comet jump.
    const first = this.animations[0];
    const phase = first?.startTime != null ? ((now - Number(first.startTime)) % this.lap) / this.lap : 0;
    this.animations.forEach((animation) => animation.cancel());
    this.lap = lap;

    this.el.style.setProperty('--lap', `${perimeter}px`);
    this.el.style.setProperty('--tail', `${Math.round(clamp(perimeter * 0.2, 70, 380))}px`);
    // Each strip's x axis points clockwise along its side; its y axis points into the box.
    const sides = [
      { x: 0, y: 0, length: width, angle: 0 },
      { x: width, y: 0, length: height, angle: 90 },
      { x: width, y: height, length: width, angle: 180 },
      { x: 0, y: height, length: height, angle: 270 },
    ];
    let start = 0;
    this.animations = sides.map((side, index) => {
      const strip = this.strips[index];
      strip.style.left = `${side.x}px`;
      strip.style.top = `${side.y}px`;
      strip.style.width = `${side.length}px`;
      strip.style.transform = `rotate(${side.angle}deg)`;
      // The tail holds two comets one lap apart, so a strip shows the comet that is on its
      // side even right after the animation wraps around.
      const tail = this.tails[index];
      tail.style.width = `${2 * perimeter}px`;
      const animation = tail.animate(
        [
          { transform: `translate3d(${-start - perimeter}px, 0, 0)` },
          { transform: `translate3d(${-start}px, 0, 0)` },
        ],
        { duration: lap, iterations: Infinity, easing: 'linear' },
      );
      start += side.length;
      return animation;
    });
    const startTime = now - phase * lap;
    for (const animation of this.animations) animation.startTime = startTime;
  }
}

type Generation = Uint8Array;

/** One Game of Life step on a `cols` x `rows` grid whose border is dead. */
function step(cells: Generation, cols: number, rows: number): Generation {
  const next = new Uint8Array(cells.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < cols && ny < rows) neighbours += cells[ny * cols + nx];
        }
      }
      const alive = cells[y * cols + x];
      next[y * cols + x] = neighbours === 3 || (alive && neighbours === 2) ? 1 : 0;
    }
  }
  return next;
}

/** Largest side, in canvas pixels, of a cell map; larger images are drawn smaller and scaled. */
const MAX_MAP = 640;

/** Rings the cells are grouped into, from the centre outward; each ring lights up in turn. */
const BAND_COLORS = ['#7fa6ff', '#8f90ff', '#a47cff', '#c06cff', '#dc68e0', '#f472bd', '#ff8f9a'];

/**
 * Small squares that pulse outward from the centre in rings. Two consecutive Game of Life
 * generations take turns between pulses, so the pattern seems to evolve as it radiates.
 * Each ring of each generation is one canvas drawn once; only their opacity and scale
 * animate, so there is no per-square element and nothing repaints.
 */
export function buildCells(container: HTMLElement, width: number, height: number) {
  const pitch = clamp(Math.min(width, height) / 18, 8, 15);
  const cols = Math.max(1, Math.floor(width / pitch));
  const rows = Math.max(1, Math.floor(height / pitch));
  const scale = Math.min(1, MAX_MAP / Math.max(width, height));
  const mapWidth = Math.max(1, Math.round(width * scale));
  const mapHeight = Math.max(1, Math.round(height * scale));
  const square = Math.max(1, Math.round(pitch * 0.4 * scale));
  const offsetX = (width - cols * pitch) / 2 + (pitch * 0.6) / 2;
  const offsetY = (height - rows * pitch) / 2 + (pitch * 0.6) / 2;
  const bands = BAND_COLORS.length;

  // Elliptical distance from the centre, so the rings fit the element's shape.
  const bandOf = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = (x + 0.5) / cols - 0.5;
      const dy = (y + 0.5) / rows - 0.5;
      bandOf[y * cols + x] = Math.min(bands - 1, Math.floor(Math.hypot(dx, dy) * Math.SQRT2 * bands));
    }
  }

  let cells: Generation = new Uint8Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = Math.random() < 0.34 ? 1 : 0;
  // A couple of steps turn random noise into the clusters and gliders Life is known for.
  cells = step(step(cells, cols, rows), cols, rows);

  for (let generation = 0; generation < 2; generation++) {
    for (let band = 0; band < bands; band++) {
      const map = make('canvas', 'cell-band', container);
      map.style.setProperty('--band', String(band));
      map.style.setProperty('--gen', String(generation));
      map.width = mapWidth;
      map.height = mapHeight;
      const context = map.getContext('2d');
      if (!context) continue;
      context.fillStyle = BAND_COLORS[band];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const index = y * cols + x;
          if (!cells[index] || bandOf[index] !== band) continue;
          context.fillRect(
            Math.round((offsetX + x * pitch) * scale),
            Math.round((offsetY + y * pitch) * scale),
            square,
            square,
          );
        }
      }
    }
    cells = step(cells, cols, rows);
  }
}
