import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [],
  build: {
    lib: {
      entry: './temp-entry.ts',
      formats: ['es'],
      fileName: () => 'out.js'
    }
  }
});
