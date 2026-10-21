import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, writeFileSync } from 'node:fs';

export default defineConfig({
  base: './',
  plugins: [svelte(), {
    name: 'webos-classic-script',
    closeBundle() {
      const path = 'dist/index.html';
      writeFileSync(path, readFileSync(path, 'utf8').replace('type="module" crossorigin', 'defer').replaceAll(' crossorigin', ''));
    }
  }],
  build: { target: 'chrome94', rolldownOptions: { output: { format: 'iife' } } }
});
