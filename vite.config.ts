import { defineConfig } from 'vite';

export default defineConfig({
  // Relativo: funciona no GitHub Pages (user.github.io/repo/)
  base: './',
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  resolve: {
    alias: {
      '@shared': '/shared',
    },
  },
});
