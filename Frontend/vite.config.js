import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'gymmate-frontend-yxmo.onrender.com',
    port: 27354,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'gymmate-frontend-yxmo.onrender.com',
        changeOrigin: true,
      },
    },
  },
});
