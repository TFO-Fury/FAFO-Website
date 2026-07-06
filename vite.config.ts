import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'import.meta.env.VITE_PAYPAL_CLIENT_ID': JSON.stringify(env.VITE_PAYPAL_CLIENT_ID || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      port: Number(env.PORT) || 3000,
      strictPort: true,
      // The Express API (api/_lib + server.ts routes) runs as a separate process
      // on API_PORT; proxy backend paths there instead of importing Vite's
      // server API from within it (that combo breaks tsx's module resolution).
      // changeOrigin is explicitly false so Express still sees the original
      // Host header (localhost:3000) for building OAuth redirect URLs, instead
      // of the internal API_PORT the string-shorthand proxy form would rewrite it to.
      proxy: {
        '/api': { target: `http://localhost:${Number(env.API_PORT) || 3001}`, changeOrigin: false },
        '/auth': { target: `http://localhost:${Number(env.API_PORT) || 3001}`, changeOrigin: false },
        '/ping': { target: `http://localhost:${Number(env.API_PORT) || 3001}`, changeOrigin: false },
      },
    },
  };
});
