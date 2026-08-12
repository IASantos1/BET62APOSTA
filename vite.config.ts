import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const BETBY_PROXY = 'http://127.0.0.1:8788';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    define: {
      __BASE_PATH__: JSON.stringify('/'),
      __IS_PREVIEW__: JSON.stringify(false),
      __READDY_PROJECT_ID__: JSON.stringify(''),
      __READDY_VERSION_ID__: JSON.stringify(''),
      __READDY_AI_DOMAIN__: JSON.stringify(''),
    },
    envPrefix: ['VITE_'],
    server: {
      host: '0.0.0.0',
      port: 5000,
      allowedHosts: true,
      strictPort: true,
      proxy: {
        '/api/live/ws': {
          target: 'ws://127.0.0.1:3000',
          ws: true,
          changeOrigin: true,
          secure: false,
        },
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
        },
        '/health': {
          target: BETBY_PROXY,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('accept-encoding'); proxyReq.setHeader('accept-encoding','identity'); });
            proxy.on('proxyRes', (proxyRes) => { delete proxyRes.headers['content-encoding']; delete proxyRes.headers['content-length']; delete proxyRes.headers['transfer-encoding']; });
          },
        },
        '/jwt': {
          target: BETBY_PROXY,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('accept-encoding'); proxyReq.setHeader('accept-encoding','identity'); });
            proxy.on('proxyRes', (proxyRes) => { delete proxyRes.headers['content-encoding']; delete proxyRes.headers['content-length']; delete proxyRes.headers['transfer-encoding']; });
          },
        },
        '/v4': {
          target: BETBY_PROXY,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('accept-encoding'); proxyReq.setHeader('accept-encoding','identity'); });
            proxy.on('proxyRes', (proxyRes) => { delete proxyRes.headers['content-encoding']; delete proxyRes.headers['content-length']; delete proxyRes.headers['transfer-encoding']; });
          },
        },
        '/betby-api-v4': {
          target: BETBY_PROXY,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('accept-encoding'); proxyReq.setHeader('accept-encoding','identity'); });
            proxy.on('proxyRes', (proxyRes) => { delete proxyRes.headers['content-encoding']; delete proxyRes.headers['content-length']; delete proxyRes.headers['transfer-encoding']; });
          },
        },
        '/betby-api': {
          target: BETBY_PROXY,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => { proxyReq.removeHeader('accept-encoding'); proxyReq.setHeader('accept-encoding','identity'); });
            proxy.on('proxyRes', (proxyRes) => { delete proxyRes.headers['content-encoding']; delete proxyRes.headers['content-length']; delete proxyRes.headers['transfer-encoding']; });
          },
        },
        '/betby-tracker': { target: BETBY_PROXY, changeOrigin: true, secure: false },
        '/betby-static': { target: BETBY_PROXY, changeOrigin: true, secure: false },
        '/translate': { target: BETBY_PROXY, changeOrigin: true, secure: false },
        '/tracker': { target: BETBY_PROXY, changeOrigin: true, secure: false },
        '/betby/ws': {
          target: BETBY_PROXY.replace('http://','ws://'),
          ws: true,
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/betby/, ''),
        },
        '^/betby(?!/event)': {
          target: BETBY_PROXY,
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/betby/, ''),
        },
      },
    },
  };
});
