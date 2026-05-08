import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: './temp-jsx.tsx',
      formats: ['es'],
      fileName: () => 'out.js'
    }
  }
});
