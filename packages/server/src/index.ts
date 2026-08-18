import { createServer } from 'node:http';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { createSocketServer } from './socket/socket-server.js';

const app = createApp();
const httpServer = createServer(app);
createSocketServer(httpServer);

httpServer.listen(env.port, () => {
  console.log(`[server] listening on http://localhost:${env.port}`);
  console.log(`[server] accepting browser clients from ${env.corsOrigin}`);
});
