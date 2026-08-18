import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@poker/shared';
import { listTables } from '../tables/table.registry.js';

export type PokerServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type PokerSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export function broadcastLobby(io: PokerServer): void {
  io.emit('lobby:tables-updated', listTables());
}

export function registerLobbyHandlers(_io: PokerServer, socket: PokerSocket): void {
  socket.on('lobby:list-tables', (ack) => {
    ack(listTables());
  });
}
