// Dedicated build worker: resolve Vite's build promise before reporting success.
// Native tooling may retain idle handles on Windows; no success is inferred from log text.
import {build} from 'vite';
try {await build({mode:process.argv[2]||'production'});process.exit(0);}
catch(error){console.error(error);process.exit(1);}
