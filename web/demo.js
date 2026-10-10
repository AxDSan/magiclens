// Landing page: a live recreation of MagicLens reading a poster (same effects as the
// extension: clockwise comet, Game of Life squares, selectable text, in-place translation),
// plus small page touches. No dependencies, no network.
(() => {
  const W = 1280;
  const H = 800;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const panel = $('panel');
  const answer = $('answer');
  if (!stage) return;

  // ── The poster, drawn at 2x; word boxes are recorded in the same coordinates. ──
  const LINES = [
    { text: 'NOITE DE FADO', font: 'bold 128px Arial', size: 128, x: 116, y: 264, color: '#ffd696' },
    { text: 'Música ao vivo todas as sextas', font: '60px Arial', size: 60, x: 116, y: 400, color: '#ffffff' },
    { text: 'Alfama, a partir das 21h', font: '60px Arial', size: 60, x: 116, y: 496, color: '#ffffff' },
    { text: 'Entrada livre', font: 'bold 52px Arial', size: 52, x: 116, y: 636, color: '#ffd696' },
  ];
  const TRANSLATIONS = [
    { lines: [0], text: 'FADO NIGHT', gold: true },
    { lines: [1, 2], text: 'Live music every Friday\nAlfama, from 9 pm' },
    { lines: [3], text: 'Free entry', gold: true },
  ];

  const canvas = $('poster');
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1d2a44');
  bg.addColorStop(1, '#3a1f3d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255, 214, 150, 0.55)';
  ctx.lineWidth = 6;
  ctx.strokeRect(44, 44, W - 88, H - 88);

  const words = [];
  LINES.forEach((line, lineIndex) => {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, line.x, line.y);
    const metrics = ctx.measureText(line.text);
    const space = ctx.measureText(' ').width;
    const parts = line.text.split(' ');
    let x = line.x;
    parts.forEach((part, i) => {
      const width = ctx.measureText(part).width;
      words.push({
        text: part,
        line: lineIndex,
        last: i === parts.length - 1,
        x,
        width,
        span: width + (i === parts.length - 1 ? 0 : space),
        top: line.y - metrics.actualBoundingBoxAscent,
        bottom: line.y + metrics.actualBoundingBoxDescent,
        baseline: line.y,
        size: line.size,
        bold: line.font.startsWith('bold'),
      });
      x += width + space;
    });
  });

  // ── Text layer: highlight boxes plus transparent, selectable words. ──
  const hls = $('hls');
  const layer = $('words');
  const spans = words.map((word, i) => {
    const hl = document.createElement('i');
    hl.className = 'hl';
    hl.style.setProperty('--d', `${(word.x / W) * 420 + word.line * 90}ms`);
    hls.append(hl);
    const span = document.createElement('span');
    span.textContent = word.last ? word.text : `${word.text} `;
    if (word.bold) span.style.fontWeight = '700';
    layer.append(span);
    if (word.last) layer.append(document.createElement('br'));
    word.hl = hl;
    return span;
  });

  // ── Comet: a highlight running clockwise around the frame at constant speed. ──
  class Comet {
    constructor(host) {
      this.el = document.createElement('div');
      this.el.className = 'comet';
      host.append(this.el);
      this.tails = [];
      this.strips = [];
      for (let i = 0; i < 4; i++) {
        const strip = document.createElement('div');
        strip.className = 'side';
        const tail = document.createElement('i');
        tail.className = 'tail';
        strip.append(tail);
        this.el.append(strip);
        this.strips.push(strip);
        this.tails.push(tail);
      }
      this.animations = [];
    }
    start(width, height) {
      this.stop();
      const perimeter = 2 * (width + height);
      const lap = Math.min(4400, Math.max(2400, (perimeter / 560) * 1000));
      this.el.style.setProperty('--lap', `${perimeter}px`);
      this.el.style.setProperty('--tail', `${Math.round(Math.min(380, Math.max(70, perimeter * 0.2)))}px`);
      const sides = [
        [0, 0, width, 0],
        [width, 0, height, 90],
        [width, height, width, 180],
        [0, height, height, 270],
      ];
      let offset = 0;
      const now = document.timeline.currentTime;
      this.animations = sides.map(([x, y, length, angle], i) => {
        const strip = this.strips[i];
        strip.style.cssText = `left:${x}px;top:${y}px;width:${length}px;transform:rotate(${angle}deg)`;
        this.tails[i].style.width = `${2 * perimeter}px`;
        const animation = this.tails[i].animate(
          [{ transform: `translate3d(${-offset - perimeter}px,0,0)` }, { transform: `translate3d(${-offset}px,0,0)` }],
          { duration: lap, iterations: Infinity, easing: 'linear' },
        );
        animation.startTime = now;
        offset += length;
        return animation;
      });
    }
    stop() {
      this.animations.forEach((animation) => animation.cancel());
      this.animations = [];
    }
  }
  const comets = [new Comet($('ring')), new Comet($('bloom'))];

  // ── Squares pulsing outward in rings, alternating two Game of Life generations. ──
  const BAND_COLORS = ['#7fa6ff', '#8f90ff', '#a47cff', '#c06cff', '#dc68e0', '#f472bd', '#ff8f9a'];
  const lifeStep = (cells, cols, rows) => {
    const next = new Uint8Array(cells.length);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if ((dx || dy) && nx >= 0 && ny >= 0 && nx < cols && ny < rows) n += cells[ny * cols + nx];
          }
        }
        next[y * cols + x] = n === 3 || (cells[y * cols + x] && n === 2) ? 1 : 0;
      }
    }
    return next;
  };
  const buildCells = (width, height) => {
    const host = $('cells');
    host.replaceChildren();
    const pitch = Math.min(15, Math.max(8, Math.min(width, height) / 18));
    const cols = Math.floor(width / pitch);
    const rows = Math.floor(height / pitch);
    const square = Math.max(2, Math.round(pitch * 0.4));
    const ox = (width - cols * pitch) / 2 + pitch * 0.3;
    const oy = (height - rows * pitch) / 2 + pitch * 0.3;
    const bands = BAND_COLORS.length;
    let cells = new Uint8Array(cols * rows).map(() => (Math.random() < 0.34 ? 1 : 0));
    cells = lifeStep(lifeStep(cells, cols, rows), cols, rows);
    for (let gen = 0; gen < 2; gen++) {
      for (let band = 0; band < bands; band++) {
        const map = document.createElement('canvas');
        map.width = Math.round(width);
        map.height = Math.round(height);
        map.style.setProperty('--band', band);
        map.style.setProperty('--gen', gen);
        const c = map.getContext('2d');
        c.fillStyle = BAND_COLORS[band];
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const d = Math.hypot((x + 0.5) / cols - 0.5, (y + 0.5) / rows - 0.5) * Math.SQRT2 * bands;
            if (cells[y * cols + x] && Math.min(bands - 1, Math.floor(d)) === band) {
              c.fillRect(Math.round(ox + x * pitch), Math.round(oy + y * pitch), square, square);
            }
          }
        }
        host.append(map);
      }
      cells = lifeStep(cells, cols, rows);
    }
  };

  // ── Layout: everything follows the stage's size. ──
  const layout = () => {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const scale = width / W;
    stage.style.setProperty('--diag', `${Math.ceil(Math.hypot(width, height) + 8)}px`);
    words.forEach((word, i) => {
      const pad = 4;
      Object.assign(word.hl.style, {
        left: `${(word.x - pad) * scale}px`,
        top: `${(word.top - pad) * scale}px`,
        width: `${(word.width + 2 * pad) * scale}px`,
        height: `${(word.bottom - word.top + 2 * pad) * scale}px`,
      });
      Object.assign(spans[i].style, {
        left: `${word.x * scale}px`,
        top: `${(word.baseline - word.size * 0.846) * scale}px`,
        fontSize: `${word.size * scale}px`,
        transform: 'none',
      });
    });
    // Read every width first, then write: one layout pass for the whole layer.
    const natural = spans.map((span) => span.offsetWidth);
    spans.forEach((span, i) => {
      span.style.transform = `scaleX(${(words[i].span * scale) / Math.max(1, natural[i])})`;
    });
    layoutTranslations();
  };

  const trs = $('trs');
  const layoutTranslations = () => {
    const scale = stage.clientWidth / W;
    [...trs.children].forEach((el, i) => {
      const group = words.filter((w) => TRANSLATIONS[i].lines.includes(w.line));
      const x0 = Math.min(...group.map((w) => w.x)) - 14;
      const y0 = Math.min(...group.map((w) => w.top)) - 12;
      const x1 = Math.max(...group.map((w) => w.x + w.width)) + 14;
      const y1 = Math.max(...group.map((w) => w.bottom)) + 12;
      Object.assign(el.style, {
        left: `${x0 * scale}px`,
        top: `${y0 * scale}px`,
        width: `${(x1 - x0) * scale}px`,
        height: `${(y1 - y0) * scale}px`,
      });
      let size = group[0].size * 0.82 * scale;
      el.style.fontSize = `${size}px`;
      while ((el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && size > 6) {
        size *= 0.94;
        el.style.fontSize = `${size}px`;
      }
    });
  };

  new ResizeObserver(layout).observe(stage);

  // ── The read, start to finish. ──
  const cursor = $('cursor');
  const lensBtn = $('lensBtn');
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const setState = (state) => (stage.dataset.state = state);
  let cellsBuilt = false;

  const scan = () => {
    if (stage.dataset.state === 'scan' || stage.dataset.state === 'ready') return;
    timers.forEach(clearTimeout);
    cursor.classList.remove('on');
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!cellsBuilt) {
      buildCells(width, height);
      cellsBuilt = true;
    }
    comets[0].start(width + 4, height + 4);
    comets[1].start(width + 8, height + 8);
    setState('scan');
    later(() => {
      setState('ready');
      $('demo').classList.add('flat');
      later(() => comets.forEach((comet) => comet.stop()), 900);
    }, reduced ? 300 : 2800);
  };

  const play = () => {
    reset();
    if (reduced) return later(scan, 200);
    const target = {
      x: lensBtn.offsetLeft + lensBtn.offsetWidth / 2 - 4,
      y: lensBtn.offsetTop + lensBtn.offsetHeight / 2 - 2,
    };
    cursor.style.transition = 'none';
    cursor.style.setProperty('--cx', `${stage.clientWidth * 0.36}px`);
    cursor.style.setProperty('--cy', `${stage.clientHeight * 0.92}px`);
    later(() => {
      cursor.style.transition = '';
      cursor.classList.add('on');
      cursor.style.setProperty('--cx', `${target.x}px`);
      cursor.style.setProperty('--cy', `${target.y}px`);
    }, 400);
    later(() => {
      lensBtn.classList.add('pressed');
      later(() => lensBtn.classList.remove('pressed'), 160);
      scan();
    }, 1700);
  };

  const reset = () => {
    timers.forEach(clearTimeout);
    timers.length = 0;
    comets.forEach((comet) => comet.stop());
    stage.removeAttribute('data-translated');
    trs.replaceChildren();
    answer.classList.remove('on');
    answer.replaceChildren();
    panel.querySelectorAll('[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    getSelection()?.removeAllRanges();
    setState('idle');
  };

  lensBtn.addEventListener('click', scan);

  const actions = {
    copy(button) {
      const text = LINES.map((line) => line.text).join('\n');
      navigator.clipboard?.writeText(text).catch(() => {});
      const label = button.querySelector('span');
      label.textContent = 'Copied';
      setTimeout(() => (label.textContent = 'Copy'), 1400);
    },
    translate(button) {
      const on = !stage.hasAttribute('data-translated');
      button.setAttribute('aria-pressed', String(on));
      getSelection()?.removeAllRanges();
      if (!on) {
        stage.removeAttribute('data-translated');
        trs.replaceChildren();
        return;
      }
      TRANSLATIONS.forEach((item, i) => {
        const el = document.createElement('div');
        el.className = `tr${item.gold ? ' gold' : ''}`;
        el.textContent = item.text;
        el.style.setProperty('--d', `${i * 120}ms`);
        trs.append(el);
      });
      stage.setAttribute('data-translated', '');
      layoutTranslations();
    },
    explain(button) {
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(on));
      answer.classList.toggle('on', on);
      if (!on) return;
      answer.replaceChildren();
      const parts = [
        ['p', 'A poster for a ', ['b', 'fado night'], ' in Alfama, Lisbon.'],
        ['li', 'Live fado music ', ['b', 'every Friday']],
        ['li', 'Starts at ', ['b', '9 pm']],
        ['li', 'Entry is ', ['b', 'free']],
      ];
      const list = document.createElement('ul');
      const caret = document.createElement('span');
      caret.className = 'caret';
      let delay = 0;
      parts.forEach(([tag, ...content]) => {
        const node = document.createElement(tag);
        later(() => {
          (tag === 'li' ? list : answer).append(node);
          if (tag === 'li' && !list.isConnected) answer.append(list);
          content.forEach((piece) => {
            if (typeof piece === 'string') node.append(piece);
            else {
              const strong = document.createElement(piece[0]);
              strong.textContent = piece[1];
              node.append(strong);
            }
          });
          node.append(caret);
        }, (delay += reduced ? 0 : 260));
      });
      later(() => caret.remove(), delay + 600);
    },
    replay: () => play(),
  };
  panel.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (button) actions[button.dataset.action](button);
  });

  // Start when the demo scrolls into view.
  new IntersectionObserver(
    (entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      play();
    },
    { threshold: 0.45 },
  ).observe(stage);

  // ── Page touches: card glow follows the pointer; sections fade in. ──
  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    });
  });
  const revealer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('in')),
    { threshold: 0.15 },
  );
  document.querySelectorAll('.strip, .section h2, .card, .steps li, .privacy-card, .marquee, .store, .support-card').forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = `${(i % 3) * 70}ms`;
    revealer.observe(el);
  });
})();
