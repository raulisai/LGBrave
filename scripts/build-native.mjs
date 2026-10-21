import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
execFileSync('cargo', ['build', '--manifest-path', 'wasm-engine/Cargo.toml', '--target', 'wasm32-unknown-unknown', '--release', '--locked'], { stdio: 'inherit' });
copyFileSync('wasm-engine/target/wasm32-unknown-unknown/release/luma_adblock_wasm.wasm', 'public/adblock.wasm');
const filters = ['easylist', 'easyprivacy'].map(name => readFileSync(`research/lists/${name}.txt`, 'utf8')).join('\n') + '\n/ad-fixture/\n@@/ad-fixture/allowed.js\n192.168.1.148##.lab-ad\n192.168.1.148###generic-lab-ad\n';
writeFileSync('public/native-filters.txt', filters);
copyFileSync('research/brave/LICENSE', 'public/MPL-2.0.txt');
console.log('Motor WASM y filtros preparados.');
