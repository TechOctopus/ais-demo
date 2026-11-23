import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  define: { __STATIC__: 'false', __BASE__: '"/"', __WORKER_URL__: '""' },
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/hub/v1': 'http://localhost:4000', '/sim': 'http://localhost:4000', '/identity': 'http://localhost:4000', '/sandbox': 'http://localhost:4000' },
  },
});
