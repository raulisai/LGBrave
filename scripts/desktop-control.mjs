// Stable entry point for installed Windows/Mac apps. Shared code lives in desktop/shared.
export * from '../desktop/shared/desktop-control.mjs';
import {runCLI} from '../desktop/shared/desktop-control.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runCLI();
