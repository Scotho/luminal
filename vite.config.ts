import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

/** Replace `<!-- @include "path" -->` comments with file contents (recursive). */
function htmlIncludePlugin(): Plugin {
  const INCLUDE_RE = /<!--\s*@include\s+"([^"]+)"\s*-->/g;
  return {
    name: 'html-include',
    transformIndexHtml(html) {
      let out = html;
      // Resolve nested @include directives until none remain.
      while (INCLUDE_RE.test(out)) {
        INCLUDE_RE.lastIndex = 0;
        out = out.replace(
          INCLUDE_RE,
          (_, filePath) => readFileSync(resolve(__dirname, filePath), 'utf-8'),
        );
      }
      return out;
    },
  };
}

export default defineConfig({
  plugins: [htmlIncludePlugin()],
  optimizeDeps: {
    include: ['cobe'],
  },
  server: {
    allowedHosts: ['hot', 'cold'],
  },
  css: {
    transformer: 'lightningcss',
  },
  build: {
    cssMinify: 'lightningcss',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        terms: resolve(__dirname, 'terms.html'),
        changelog: resolve(__dirname, 'changelog.html'),
        roadmap: resolve(__dirname, 'roadmap.html'),
        credits: resolve(__dirname, 'credits.html'),
      },
    },
  },
});
