import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@poker/shared';
import { getToken } from './auth-storage.js';
import { SOCKET_URL } from './backend-url.js';

export type PokerClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: PokerClientSocket | null = null;

/** One shared connection for the whole session, authenticated with the stored JWT. */
export function getSocket(): PokerClientSocket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      auth: { token: getToken() ?? '' },
      autoConnect: true,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
