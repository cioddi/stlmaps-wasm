import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// https://vite.dev/config/
export default defineConfig({
  // Use relative paths for all assets
  base: './',
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  optimizeDeps: {
    // Exclude local packages from pre-bundling to ensure all exports are available
    exclude: ['@threegis/core', '@threegis/core-wasm'],
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash].[ext]'
      }
    },
    worker: {
      format: 'es',
      plugins: []
    }
  },
  worker: {
    format: 'es'
  }
});
