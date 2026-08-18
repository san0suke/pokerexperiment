import {
  getTableState,
  seatUser,
  unseatUser,
  unseatUserEverywhere,
} from '../tables/table.registry.js';
import { broadcastLobby, type PokerServer, type PokerSocket } from './lobby.handlers.js';

const roomFor = (tableId: string) => `table:${tableId}`;

export function registerTableHandlers(io: PokerServer, socket: PokerSocket): void {
  const user = socket.data.user;

  socket.on('table:join', async ({ tableId }, ack) => {
    const state = seatUser(tableId, user);
    if (!state) {
      socket.emit('server:error', {
        code: 'TABLE_UNAVAILABLE',
        message: 'Mesa não encontrada ou lotada',
      });
      ack(null);
      return;
    }

    await socket.join(roomFor(tableId));
    ack(state);
    socket.to(roomFor(tableId)).emit('table:player-joined', user);
    io.to(roomFor(tableId)).emit('table:state', state);
    broadcastLobby(io);
  });

  socket.on('table:leave', async ({ tableId }) => {
    const state = unseatUser(tableId, user.id);
    await socket.leave(roomFor(tableId));
    if (state) {
      io.to(roomFor(tableId)).emit('table:player-left', user);
      io.to(roomFor(tableId)).emit('table:state', state);
      broadcastLobby(io);
    }
  });

  socket.on('disconnect', () => {
    const affectedTables = unseatUserEverywhere(user.id);
    for (const tableId of affectedTables) {
      io.to(roomFor(tableId)).emit('table:player-left', user);
      const state = getTableState(tableId);
      if (state) {
        io.to(roomFor(tableId)).emit('table:state', state);
      }
    }
    if (affectedTables.length > 0) {
      broadcastLobby(io);
    }
  });
}
