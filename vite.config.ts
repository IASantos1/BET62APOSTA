import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000';

  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    define: {
      __BASE_PATH__: JSON.stringify('/'),
      __IS_PREVIEW__: JSON.stringify(false),
      __READDY_PROJECT_ID__: JSON.stringify(''),
      __READDY_VERSION_ID__: JSON.stringify(''),
      __READDY_AI_DOMAIN__: JSON.stringify(''),
      __STRIPE_PUBLIC_KEY__: JSON.stringify(env.STRIPE_PUBLIC_KEY || env.VITE_STRIPE_PUBLIC_KEY || ''),
    },
    envPrefix: ['VITE_'],
    server: {
      host: '0.0.0.0',
      port: 5000,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p,
        },
      },
    },
  };
});
