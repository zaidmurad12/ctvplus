import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    // Tailwind v3 is a standard PostCSS plugin (see postcss.config.js) picked up
    // automatically by Vite's built-in CSS pipeline - no dedicated Vite plugin needed,
    // unlike v4's @tailwindcss/vite.
    plugins: [react()],
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
        // fallback, which puts it in Vite's watched module graph. public/movies.json is a
        // separate copy that server.ts's saveMoviesDatabase() also rewrites every time -
        // Vite treats any change inside publicDir as a reason to force a full page reload,
        // independent of the module graph. Both get rewritten constantly (imports, healing
        // passes, Firestore sync - saveMoviesDatabase() has ~19 call sites, several inside
        // per-movie loops), and each write was forcing a reload for anyone connected,
        // killing in-progress video playback every few minutes. Neither file needs a live
        // update - the app already fetches fresh data over /api/movies at runtime.
        ignored: ['**/movies_db.json', '**/public/movies.json', '**/*.db', '**/*.db-wal', '**/*.db-shm'],
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
