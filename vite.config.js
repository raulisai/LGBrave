import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, writeFileSync } from 'node:fs';

export default defineConfig(({mode}) => {
 const holy = mode === 'holy';
 // The same catalogue as a plain responsive page for any device on the LAN (no TV, no CDP).
 const holyWeb = mode === 'holy-web';
 const outDir = holy ? 'dist-holy' : holyWeb ? 'dist-holy-web' : 'dist';
 return {
  base: './',
  publicDir: holy ? 'holy-public' : holyWeb ? false : 'public',
  plugins: [svelte(), {
    name: 'webos-classic-script',
    transformIndexHtml: {order:'pre', handler(html) {
      if (holyWeb) return html.replace('/src/main.js', '/src/holy-web-main.js').replace('Luma Browser Lab', 'Holy');
      return holy ? html.replace('/src/main.js', '/src/holy-main.js').replace('Luma Browser Lab', 'Holy') : html;
    }},
    closeBundle() {
      if (holyWeb) return; // A modern browser tab keeps its ES module script; no old webOS to humor here.
      const path = `${outDir}/index.html`;
      writeFileSync(path, readFileSync(path, 'utf8').replace('type="module" crossorigin', 'defer').replaceAll(' crossorigin', ''));
    }
  }],
  build: { outDir, target: holyWeb ? 'es2020' : 'chrome94', ...(holyWeb ? {} : { rolldownOptions: { output: { format: 'iife' } } }) }
 };
});
