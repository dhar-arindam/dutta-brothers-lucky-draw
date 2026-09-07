import { resolveRuntimeMode } from './runtime-mode.js';

if (resolveRuntimeMode() !== 'LOCAL') {
  throw new Error('The Mega Draw local seed launcher requires APP_RUNTIME=LOCAL.');
}

process.env.LOCAL_MEGA_DRAW_SEED = '1';
await import('./main.js');
