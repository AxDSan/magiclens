import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

const require = createRequire(import.meta.url);
const pkgDir = (name: string) => dirname(require.resolve(`${name}/package.json`));

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
    // Keep local tooling and test output out of the archive AMO reviewers download.
    excludeSources: ['codedb.snapshot', '.codegraph/**', 'test-results/**', 'tests/e2e/.fixtures/**'],
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
      files.push(...tesseractAssets());
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
