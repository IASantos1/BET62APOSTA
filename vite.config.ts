import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5000,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api/live/ws': {
        target: 'wss://bet62apostasesportivas.bet62.workers.dev',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'https://bet62apostasesportivas.bet62.workers.dev',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
