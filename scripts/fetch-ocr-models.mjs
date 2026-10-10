// Downloads the PaddleOCR PP-OCRv5 mobile models into .cache/paddleocr so the extension
// build can bundle them. Each file is pinned to an immutable upstream revision and checked
// against its SHA-256; a mismatch aborts so a changed upstream file never ships silently.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PADDLE_FILES } from './paddle-files.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache', 'paddleocr');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

mkdirSync(cacheDir, { recursive: true });
for (const file of PADDLE_FILES) {
  const target = join(cacheDir, file.name);
  if (existsSync(target) && sha256(readFileSync(target)) === file.sha256) {
    console.log(`ok      ${file.name}`);
    continue;
  }
  const res = await fetch(file.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${file.name}: HTTP ${res.status} from ${file.url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== file.sha256) {
    throw new Error(`${file.name}: sha256 ${actual} does not match pinned ${file.sha256}`);
  }
  writeFileSync(target, bytes);
  console.log(`fetched ${file.name} (${bytes.length} bytes)`);
}
