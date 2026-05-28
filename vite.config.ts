import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const LOCAL_PROXY = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  define: {
    __BASE_PATH__: JSON.stringify('/'),
    __IS_PREVIEW__: JSON.stringify(false),
    __READDY_PROJECT_ID__: JSON.stringify(''),
    __READDY_VERSION_ID__: JSON.stringify(''),
    __READDY_AI_DOMAIN__: JSON.stringify(''),
    __STRIPE_PUBLIC_KEY__: JSON.stringify(process.env.STRIPE_PUBLIC_KEY || process.env.VITE_STRIPE_PUBLIC_KEY || ''),
  },
  envPrefix: ['VITE_'],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: LOCAL_PROXY,
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p,
      },
    },
  },
});
