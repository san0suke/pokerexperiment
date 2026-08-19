import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { buildCorsOriginCheck } from '../config/cors.js';
import { socketAuthMiddleware } from './socket-auth.middleware.js';
import { registerLobbyHandlers, type PokerServer } from './lobby.handlers.js';
import { registerTableHandlers } from './table.handlers.js';

export function createSocketServer(httpServer: HttpServer): PokerServer {
  const io: PokerServer = new Server(httpServer, {
    cors: { origin: buildCorsOriginCheck(env.corsOrigin) },
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    console.log(`[socket] ${socket.data.user.username} connected (${socket.id})`);

    registerLobbyHandlers(io, socket);
    registerTableHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      console.log(`[socket] ${socket.data.user.username} disconnected: ${reason}`);
    });
  });

  return io;
}
