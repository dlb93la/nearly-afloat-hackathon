import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.endsWith('/three/build/three.core.js')) return 'three-core';
          if (id.endsWith('/three/build/three.module.js')) return 'three-renderer';
        },
      },
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        traps: fileURLToPath(new URL('./trap-lab.html', import.meta.url)),
      },
    },
  },
});
