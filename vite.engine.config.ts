import { defineConfig } from 'vite';

// Standalone build of the Phase 1 engine as a library (kept from Phase 1).
export default defineConfig({
  build: {
    lib: { entry: 'src/engine/index.ts', formats: ['es'], fileName: 'zipora-engine' },
    outDir: 'dist-engine',
    sourcemap: true,
  },
});
