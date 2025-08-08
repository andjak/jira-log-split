/// <reference types="vitest" />
import { defineConfig } from 'vite';
import path from 'path';
// In ESM, __dirname is not defined by default; recreate it for path resolution
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.resolve(path.dirname(__filename));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/popup/index.html'),
        background: path.resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: `[name].js`,
        chunkFileNames: `[name].js`,
        assetFileNames: `[name].[ext]`,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
});

