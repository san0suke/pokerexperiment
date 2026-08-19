import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@poker/shared';
import { getToken, saveChips } from './auth-storage.js';
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

    // O saldo da conta muda longe de qualquer cena — no fim de uma mão, ao
    // levantar da mesa. Guardar aqui, na conexão, deixa o valor certo para quem
    // for desenhar depois; as cenas que o mostram escutam o mesmo evento só para
    // se redesenhar.
    socket.on('user:balance', ({ chips }) => saveChips(chips));
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
