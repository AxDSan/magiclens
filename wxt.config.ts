import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';
import { PADDLE_FILES } from './scripts/paddle-files.mjs';

const require = createRequire(import.meta.url);
const pkgDir = (name: string) => dirname(require.resolve(`${name}/package.json`));

// onnxruntime-web does not export ./package.json, so walk up from its entry to the package root.
const packageRoot = (name: string) => {
  let dir = dirname(require.resolve(name));
  while (!existsSync(join(dir, 'package.json')) || JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name !== name) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Package root for ${name} not found`);
    dir = parent;
  }
  return dir;
};

// Tesseract runs from files shipped inside the extension: MV3 forbids remote code, and
// bundling English keeps the default engine fully offline.
const tesseractAssets = () => {
  const tess = pkgDir('tesseract.js');
  const core = pkgDir('tesseract.js-core');
  const eng = pkgDir('@tesseract.js-data/eng');
  return [
    { absoluteSrc: join(tess, 'dist/worker.min.js'), relativeDest: 'ocr/worker.min.js' },
    ...['lstm', 'simd-lstm', 'relaxedsimd-lstm'].map((variant) => ({
      absoluteSrc: join(core, `tesseract-core-${variant}.wasm.js`),
      relativeDest: `ocr/core/tesseract-core-${variant}.wasm.js`,
    })),
    {
      absoluteSrc: join(eng, '4.0.0_best_int/eng.traineddata.gz'),
      relativeDest: 'ocr/lang/eng.traineddata.gz',
    },
  ];
};

// PaddleOCR models are fetched by `npm run fetch:ocr` (pinned and checksummed), not vendored.
// The ONNX Runtime WASM loader is bundled from the locked npm package.
const paddleAssets = () => {
  const cache = join(dirname(fileURLToPath(import.meta.url)), '.cache', 'paddleocr');
  const ort = packageRoot('onnxruntime-web');
  const models = PADDLE_FILES.map((file) => {
    const absoluteSrc = join(cache, file.name);
    if (!existsSync(absoluteSrc)) {
      throw new Error(`Missing ${absoluteSrc}. Run "npm run fetch:ocr" before building.`);
    }
    return { absoluteSrc, relativeDest: `ocr/paddle/${file.name}` };
  });
  return [
    ...models,
    { absoluteSrc: join(ort, 'dist/ort-wasm-simd-threaded.wasm'), relativeDest: 'ocr/ort/ort-wasm-simd-threaded.wasm' },
    { absoluteSrc: join(ort, 'dist/ort-wasm-simd-threaded.mjs'), relativeDest: 'ocr/ort/ort-wasm-simd-threaded.mjs' },
  ];
};

const chromium = new Set(['chrome', 'edge', 'opera', 'brave', 'chromium']);

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  imports: false,
  vite: () => ({
    plugins: [preact()],
    build: { target: 'es2022', chunkSizeWarningLimit: 2048 },
  }),
  manifest: ({ browser }) => ({
    name: 'MagicLens',
    description:
      'Read, select, translate and explain the text inside any image, right where it appears.',
    homepage_url: 'https://axdsan.github.io/magiclens/',
    permissions: [
      'storage',
      'contextMenus',
      'activeTab',
      'scripting',
      'declarativeNetRequestWithHostAccess',
      ...(chromium.has(browser) ? ['offscreen'] : []),
    ],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    action: { default_title: 'MagicLens' },
    commands: {
      'lens-main-image': {
        suggested_key: { default: 'Alt+Shift+L' },
        description: 'Read the main image on the page',
      },
      'lens-pick': {
        suggested_key: { default: 'Alt+Shift+K' },
        description: 'Pick an image or any element to read',
      },
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'magiclens@magiclens.dev',
              // Built-in data-collection consent arrived in Firefox 140 (desktop) / 142 (Android).
              strict_min_version: '140.0',
              data_collection_permissions: {
                required: ['none'],
                optional: ['websiteContent'],
              },
            },
            gecko_android: { strict_min_version: '142.0' },
          },
        }
      : {}),
  }),
  zip: {
    // Keep local tooling, test output, store images and the website out of the archive AMO
    // reviewers download.
    excludeSources: [
      'codedb.snapshot',
      '.codegraph/**',
      'test-results/**',
      'tests/e2e/.fixtures/**',
      'store/assets/**',
      'index.html',
      'web/**',
      '_layouts/**',
      '_config.yml',
    ],
  },
  hooks: {
    'entrypoints:resolved': (wxt, entrypoints) => {
      // The offscreen engine page is Chromium-only: Firefox and Safari host the engine in
      // their background page. Removing it here (rather than with an include filter) keeps
      // those builds free of a "skipped entrypoints" warning.
      if (chromium.has(wxt.config.browser)) return;
      const index = entrypoints.findIndex((entrypoint) => entrypoint.name === 'offscreen');
      if (index >= 0) entrypoints.splice(index, 1);
    },
    'build:publicAssets': (_wxt, files) => {
      files.push(...tesseractAssets(), ...paddleAssets());
    },
    'build:manifestGenerated': (wxt, manifest) => {
      // Safari has no offscreen documents, and its service workers cannot spawn the
      // Web Worker Tesseract needs, so it gets a non-persistent background page.
      if (wxt.config.browser === 'safari' && manifest.background) {
        const bg = manifest.background as { service_worker?: string };
        if (bg.service_worker) {
          manifest.background = { scripts: [bg.service_worker], persistent: false } as never;
        }
      }
    },
  },
});
