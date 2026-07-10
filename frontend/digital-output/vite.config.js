import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const basePath = (env.VITE_ROUTER_BASENAME || '/api').replace(/\/+$/, '');

  return {
    base: `${basePath}/`,
    plugins: [react()],
  };
});