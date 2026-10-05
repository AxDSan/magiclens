// Test servers: the fixture site on two origins, plus a mock OpenAI-compatible vision model.
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const roots = { '/fx/': join(here, '.fixtures'), '/': join(here, 'site') };
const types = { '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.js': 'text/javascript' };

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  for (const [prefix, dir] of Object.entries(roots)) {
    if (!url.pathname.startsWith(prefix)) continue;
    const rel = normalize(url.pathname.slice(prefix.length) || 'index.html').replace(/^(\.\.[/\\])+/, '');
    const file = join(dir, rel);
    if (!existsSync(file)) continue;
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      // Cross-origin images stay tainted on purpose: no Access-Control-Allow-Origin.
    });
    createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404).end('not found');
}

createServer(serveStatic).listen(4599, 'localhost');
createServer(serveStatic).listen(4600, '127.0.0.1');

// ───────────── mock LLM ─────────────
let script = { lines: [], translations: {}, explain: 'This image shows **test text**.', delayMs: 15 };
const requests = [];

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });
}

const iou = (a, b) => {
  const x = Math.max(a[0], b[0]);
  const y = Math.max(a[1], b[1]);
  const r = Math.min(a[2], b[2]);
  const bt = Math.min(a[3], b[3]);
  const inter = Math.max(0, r - x) * Math.max(0, bt - y);
  const area = (q) => (q[2] - q[0]) * (q[3] - q[1]);
  return inter / (area(a) + area(b) - inter || 1);
};

function answer(prompt) {
  if (prompt.includes('A basic OCR engine read this image')) {
    // Hybrid refinement: give each listed region the ground-truth line it overlaps most.
    const lines = [];
    for (const match of prompt.matchAll(/^(l\d+) \[(\d+),(\d+),(\d+),(\d+)\]: (.*)$/gm)) {
      const box = match.slice(2, 6).map(Number);
      let best = null;
      let bestScore = 0;
      for (const truth of script.lines) {
        const score = iou(box, truth.bbox);
        if (score > bestScore) {
          bestScore = score;
          best = truth;
        }
      }
      lines.push({ id: match[1], text: best && bestScore > 0.1 ? best.text : JSON.parse(match[6]) });
    }
    return { purpose: 'refine', text: JSON.stringify({ language: 'en', lines, missing: [] }) };
  }
  if (prompt.includes('Read ALL text visible in this image')) {
    return {
      purpose: 'ocr',
      text: '```json\n' + JSON.stringify({ language: 'en', lines: script.lines.map((l) => ({ text: l.text, bbox: l.bbox })) }) + '\n```',
    };
  }
  if (prompt.includes('Translate each numbered paragraph')) {
    const ids = [...prompt.matchAll(/^\[(\w+)\] (.*)$/gm)];
    return {
      purpose: 'translate',
      text: ids.map(([, id, text]) => `[${id}] ${script.translations[text] ?? `«${text}»`}`).join('\n'),
    };
  }
  return { purpose: 'analysis', text: script.explain };
}

createServer(async (req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/mock/script' && req.method === 'POST') {
    script = { ...script, ...JSON.parse(await readBody(req)) };
    requests.length = 0;
    return res.writeHead(200, cors).end('{}');
  }
  if (url.pathname === '/mock/requests') {
    return res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(requests));
  }
  if (url.pathname === '/v1/models') {
    return res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'mock-vision' }] }));
  }
  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const user = body.messages.find((m) => m.role === 'user');
    const parts = Array.isArray(user.content) ? user.content : [{ type: 'text', text: user.content }];
    const prompt = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
    const image = parts.find((p) => p.type === 'image_url');
    const { purpose, text } = answer(prompt);
    requests.push({ purpose, model: body.model, hasImage: !!image, imageBytes: image ? image.image_url.url.length : 0 });
    res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (let i = 0; i < text.length; i += 16) {
      const delta = text.slice(i, i + 16);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, script.delayMs));
    }
    res.write('data: [DONE]\n\n');
    return res.end();
  }
  res.writeHead(404, cors).end();
}).listen(4601, '127.0.0.1');

console.log('test servers on :4599 (localhost), :4600 (127.0.0.1), mock LLM on :4601');
process.on('SIGTERM', () => process.exit(0));
