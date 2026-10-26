import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, writeFileSync } from 'node:fs';

export default defineConfig(({mode}) => {
 const holy = mode === 'holy';
 const outDir = holy ? 'dist-holy' : 'dist';
 return {
  base: './',
  publicDir: holy ? 'holy-public' : 'public',
  plugins: [svelte(), {
    name: 'webos-classic-script',
    transformIndexHtml: {order:'pre', handler(html) { return holy ? html.replace('/src/main.js', '/src/holy-main.js').replace('Luma Browser Lab', 'Holy') : html; }},
    closeBundle() {
      const path = `${outDir}/index.html`;
      writeFileSync(path, readFileSync(path, 'utf8').replace('type="module" crossorigin', 'defer').replaceAll(' crossorigin', ''));
    }
  }],
  build: { outDir, target: 'chrome94', rolldownOptions: { output: { format: 'iife' } } }
 };
});
