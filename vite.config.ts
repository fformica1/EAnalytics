import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const GARMIN_BASE_URL = 'https://personal.connectapi.garmin.com';
const GARMIN_TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const INTERVALS_BASE_URL = 'https://intervals.icu/api/v1';

/**
 * Local dev-only stateless proxies for Garmin Personal API & Intervals.icu API v1.
 * Mirrors functions/api/garmin/[[path]].js and functions/api/intervals/[[path]].js on Cloudflare Pages.
 * Stores nothing and logs nothing; user credentials stay strictly in the browser session.
 */
function statelessDevProxy(): Plugin {
  return {
    name: 'stateless-api-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/garmin', async (req, res) => {
        try {
          const urlObj = new URL(req.url || '/', 'http://localhost');
          const subPath = urlObj.pathname;

          if (subPath === '/token' && req.method === 'POST') {
            const apiKey = req.headers['x-garmin-api-key'];
            if (!apiKey || typeof apiKey !== 'string') {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing X-Garmin-Api-Key header' }));
              return;
            }
            const upstream = await fetch(`${GARMIN_BASE_URL}${GARMIN_TOKEN_PATH}`, {
              method: 'POST',
              headers: {
                Accept: '*/*',
                Authorization: `ApiKey ${apiKey.trim()}`,
              },
            });
            const body = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(body);
            return;
          }

          const authHeader = req.headers['authorization'];
          if (!authHeader || typeof authHeader !== 'string') {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing Authorization Bearer header' }));
            return;
          }

          const targetUrl = `${GARMIN_BASE_URL}${subPath}${urlObj.search}`;
          const acceptHeader =
            typeof req.headers['accept'] === 'string'
              ? req.headers['accept']
              : 'application/json';

          const upstream = await fetch(targetUrl, {
            method: 'GET',
            headers: {
              Accept: acceptHeader,
              Authorization: authHeader,
            },
          });

          res.statusCode = upstream.status;
          const contentType = upstream.headers.get('content-type');
          if (contentType) {
            res.setHeader('Content-Type', contentType);
          }
          res.setHeader('Cache-Control', 'no-store');

          const buffer = Buffer.from(await upstream.arrayBuffer());
          res.end(buffer);
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Upstream proxy error',
            })
          );
        }
      });

      server.middlewares.use('/api/intervals', async (req, res) => {
        try {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }
          const authHeader = req.headers['authorization'];
          if (!authHeader || typeof authHeader !== 'string') {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing Authorization header' }));
            return;
          }
          const urlObj = new URL(req.url || '/', 'http://localhost');
          const targetUrl = `${INTERVALS_BASE_URL}${urlObj.pathname}${urlObj.search}`;
          const upstream = await fetch(targetUrl, {
            method: 'GET',
            headers: {
              Accept:
                typeof req.headers['accept'] === 'string'
                  ? req.headers['accept']
                  : 'application/json',
              Authorization: authHeader,
            },
          });
          res.statusCode = upstream.status;
          const contentType = upstream.headers.get('content-type');
          if (contentType) res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'no-store');
          const buffer = Buffer.from(await upstream.arrayBuffer());
          res.end(buffer);
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Intervals upstream proxy error',
            })
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    statelessDevProxy(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'MetricLab — Health & Sport Dashboard',
        short_name: 'MetricLab',
        description:
          'Dashboard PWA local-first per analisi attività stile Strava/iGPSPORT e metriche salute H24.',
        theme_color: '#121212',
        background_color: '#121212',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts'],
          leaflet: ['leaflet'],
          fitsdk: ['@garmin/fitsdk', 'jszip'],
        },
      },
    },
  },
});
