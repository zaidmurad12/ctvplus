import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // movies_db.json is imported by src/data/initialMovies.ts as a static build-time
        // fallback, which puts it in Vite's watched module graph. The server rewrites this
        // same file constantly (imports, healing passes, Firestore sync - see
        // saveMoviesDatabase() call sites in server.ts), and each write was forcing a full
        // page reload for anyone connected, killing in-progress video playback every few
        // minutes. The fallback only needs the value at build time, never a live update.
        ignored: ['**/movies_db.json', '**/*.db', '**/*.db-wal', '**/*.db-shm'],
      },
    },
    build: {
      outDir: 'dist',
      cssCodeSplit: false,
      target: ['chrome65', 'firefox60', 'safari11', 'edge79', 'es2015'],
      rollupOptions: {
        output: {
          format: 'iife',
          inlineDynamicImports: true,
          entryFileNames: 'assets/index.js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name && assetInfo.name.endsWith('.css')) {
              return 'assets/index.css';
            }
            return 'assets/[name].[ext]';
          },
        },
      },
    },
  };
});
