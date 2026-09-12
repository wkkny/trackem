import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  // Installed Electron builds load index.html via file:, not a web-server root.
  base: './',
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/release/**'] } },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
