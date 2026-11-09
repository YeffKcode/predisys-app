import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo /api se redirige a la API Node: mismo origen, así la cookie HTTPOnly SameSite=Strict viaja sin CORS.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': { target: env.API_PROXY_TARGET || 'http://localhost:4000', changeOrigin: false } },
    },
    build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  };
});
