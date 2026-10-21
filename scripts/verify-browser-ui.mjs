import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTV } from './cdp.mjs';
const cdp = await connectTV(process.argv[2]);
const directory = process.argv[3] || 'evidence/browser-lab';
mkdirSync(directory, { recursive: true });
try {
  const page = await cdp.evaluate(`({title:document.title,heading:document.querySelector('h1')?.innerText,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,buttons:document.querySelectorAll('button').length})`);
  assert.ok(page.heading.includes('Más web.'));
  assert.equal(page.width, 1920); assert.equal(page.height, 1080);
  assert.equal(page.scrollWidth, page.width); assert.ok(page.scrollHeight <= page.height);
  const result = await cdp.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${directory}/safari-final.png`, Buffer.from(result.data, 'base64'));
  writeFileSync(`${directory}/ui-verification.json`, JSON.stringify({ capturedAt: new Date().toISOString(), ...page }, null, 2));
  console.log(page);
} finally { cdp.close(); }
