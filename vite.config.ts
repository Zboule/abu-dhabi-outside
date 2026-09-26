import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base matches the GitHub Pages project path: zboule.github.io/abu-dhabi-outside/
export default defineConfig({
  plugins: [react()],
  base: '/abu-dhabi-outside/',
});
