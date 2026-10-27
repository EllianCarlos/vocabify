import { resolve } from 'node:path';
import { withPageConfig } from '@extension/vite-config';

const rootDir = resolve(import.meta.dirname);

export default withPageConfig({
  build: {
    outDir: resolve(rootDir, '..', '..', 'dist', 'offscreen'),
    // The ONNX runtime .wasm file is large; keep it as a separate file.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1000,
  },
});
