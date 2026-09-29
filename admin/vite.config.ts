import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { processPlugin } from './src/middleware/processPlugin';

function adminSavePlugin(): Plugin {
  const dataDir = resolve(__dirname, 'data');
  return {
    name: 'admin-save',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method === 'POST' && req.url?.startsWith('/__admin_save')) {
          const url = new URL(req.url, 'http://localhost');
          const file = url.searchParams.get('file');
          if (!file || file.includes('..') || file.includes('/')) {
            res.writeHead(400);
            res.end('Invalid filename');
            return;
          }
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
            writeFileSync(resolve(dataDir, file), body, 'utf-8');
            res.writeHead(200);
            res.end('OK');
          });
          return;
        }
        next();
      });
    },
  };
}

function testResultsPlugin(): Plugin {
  const resultsDir = resolve(__dirname, '..', 'test-results');
  const MIME: Record<string, string> = {
    '.json': 'application/json',
    '.png': 'image/png',
    '.log': 'text/plain',
    '.jpg': 'image/jpeg',
  };
  return {
    name: 'test-results',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method === 'GET' && req.url?.startsWith('/__test_results/')) {
          const relPath = decodeURIComponent(req.url.slice('/__test_results/'.length));
          if (relPath.includes('..')) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
          }
          const filePath = resolve(resultsDir, relPath);
          if (!filePath.startsWith(resultsDir)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
          }
          if (!existsSync(filePath)) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          const ext = filePath.slice(filePath.lastIndexOf('.'));
          const contentType = MIME[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(readFileSync(filePath));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname),
  plugins: [adminSavePlugin(), testResultsPlugin(), processPlugin()],
  resolve: {
    alias: {
      '@main': resolve(__dirname, '../src'),
    },
  },
  server: {
    port: 5175,
    host: true,
    strictPort: true,
    allowedHosts: ['admin'],
    fs: {
      allow: ['..'],
    },
    proxy: {
      // Proxy model/asset requests to the main game's public dir
      '/models': {
        target: 'http://localhost:5173',
        changeOrigin: true,
      },
      '/draco': {
        target: 'http://localhost:5173',
        changeOrigin: true,
      },
      '/icons.svg': {
        target: 'http://localhost:5173',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  preview: {
    port: 5176,
    strictPort: true,
    proxy: {
      // Proxy all admin middleware calls to the live admin dev server
      '/__admin': {
        target: 'http://localhost:5175',
        changeOrigin: true,
      },
      '/__test_results': {
        target: 'http://localhost:5175',
        changeOrigin: true,
      },
      '/models': {
        target: 'http://localhost:5173',
        changeOrigin: true,
      },
      '/draco': {
        target: 'http://localhost:5173',
        changeOrigin: true,
      },
      '/icons.svg': {
        target: 'http://localhost:5173',
        changeOrigin: true,
      },
    },
  },
});
