import { createServer } from 'node:http';

import { createDefaultNodeHandler } from './app.js';
import { resolveRuntimeMode } from './runtime-mode.js';

export const backendFoundation = true;

export const startServer = (port = 3001) => {
  const runtimeMode = resolveRuntimeMode();
  if (runtimeMode !== 'LOCAL') {
    throw new Error('Local server startup is allowed only when APP_RUNTIME=LOCAL.');
  }

  const nodeHandler = createDefaultNodeHandler();
  const server = createServer((req, res) => {
    void nodeHandler(req, res);
  });

  server.listen(port, () => {
    console.log(`Backend server listening on http://localhost:${port} (runtime: ${runtimeMode})`);
  });

  return server;
};

const envPort = Number(process.env.LOCAL_BACKEND_PORT ?? '3001');
const port = Number.isInteger(envPort) && envPort > 0 ? envPort : 3001;
startServer(port);
