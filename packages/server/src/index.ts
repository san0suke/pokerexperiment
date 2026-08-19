import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { createSocketServer } from './socket/socket-server.js';

const app = createApp();
const httpServer = createServer(app);
createSocketServer(httpServer);

/** IPv4 addresses other devices can reach this machine on. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal)
    .map((net) => net!.address);
}

httpServer.listen(env.port, env.host, () => {
  console.log(`[server] listening on ${env.host}:${env.port}`);
  console.log(`[server]   local:   http://localhost:${env.port}`);
  for (const address of lanAddresses()) {
    console.log(`[server]   network: http://${address}:${env.port}`);
  }
  console.log(
    env.corsOrigin
      ? `[server] CORS restricted to: ${env.corsOrigin}`
      : '[server] CORS: allowing local network origins (set CORS_ORIGIN to restrict)',
  );
});
