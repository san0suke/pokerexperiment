import {
  applyPlayerAction,
  canStartHand,
  getPrivateHandState,
  getTableState,
  seatUser,
  setReady,
  startTableHand,
  unseatUser,
  unseatUserEverywhere,
  type StartedHandPrivates,
  type UnseatResult,
} from '../tables/table.registry.js';
import { broadcastLobby, type PokerServer, type PokerSocket } from './lobby.handlers.js';

const roomFor = (tableId: string) => `table:${tableId}`;

function emitTableState(io: PokerServer, tableId: string): void {
  const state = getTableState(tableId);
  if (state) {
    io.to(roomFor(tableId)).emit('table:state', state);
  }
}

/**
 * Entrega as cartas fechadas socket a socket. Broadcast na sala seria o mesmo que
 * abrir o jogo — todo mundo enxerga o payload no DevTools.
 */
async function deliverHoleCards(
  io: PokerServer,
  tableId: string,
  privates: StartedHandPrivates[],
): Promise<void> {
  const sockets = await io.in(roomFor(tableId)).fetchSockets();
  for (const remote of sockets) {
    const own = privates.find((entry) => entry.userId === remote.data.user.id);
    if (own) {
      remote.emit('hand:private-state', own.state);
    }
  }
}

/** Começa a mão assim que todos os sentados estão prontos. */
async function startHandIfEveryoneIsReady(io: PokerServer, tableId: string): Promise<void> {
  if (!canStartHand(tableId)) {
    return;
  }

  const privates = startTableHand(tableId);
  if (!privates) {
    return;
  }

  // Cartas primeiro: quando o `table:state` chegar com a mesa já jogando, o
  // cliente tem o que desenhar na frente do jogador.
  await deliverHoleCards(io, tableId, privates);
  emitTableState(io, tableId);
}

function announceUnseat(io: PokerServer, result: UnseatResult): void {
  // Sair no meio da mão é fold: ela pode ter terminado aí mesmo.
  if (result.ended) {
    io.to(roomFor(result.tableId)).emit('hand:ended', result.ended);
  }
  emitTableState(io, result.tableId);
}

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

    // Reconexão no meio de uma mão: devolve as cartas que já são dele.
    const ownCards = getPrivateHandState(tableId, user.id);
    if (ownCards) {
      socket.emit('hand:private-state', ownCards);
    }

    socket.to(roomFor(tableId)).emit('table:player-joined', user);
    io.to(roomFor(tableId)).emit('table:state', state);
    broadcastLobby(io);
  });

  socket.on('table:set-ready', async ({ tableId, ready }) => {
    const state = setReady(tableId, user.id, ready);
    if (!state) {
      return;
    }

    io.to(roomFor(tableId)).emit('table:state', state);
    await startHandIfEveryoneIsReady(io, tableId);
  });

  socket.on('hand:action', ({ tableId, action, amount }) => {
    const result = applyPlayerAction(tableId, user.id, action, amount);
    if (result.error) {
      socket.emit('server:error', { code: 'INVALID_ACTION', message: result.error });
      return;
    }

    if (result.taken) {
      io.to(roomFor(tableId)).emit('hand:action-taken', result.taken);
    }
    if (result.ended) {
      io.to(roomFor(tableId)).emit('hand:ended', result.ended);
    }
    emitTableState(io, tableId);
  });

  socket.on('table:leave', async ({ tableId }) => {
    const result = unseatUser(tableId, user.id);
    await socket.leave(roomFor(tableId));
    if (result) {
      io.to(roomFor(tableId)).emit('table:player-left', user);
      announceUnseat(io, result);
      broadcastLobby(io);
    }
  });

  socket.on('disconnect', () => {
    const affected = unseatUserEverywhere(user.id);
    for (const result of affected) {
      io.to(roomFor(result.tableId)).emit('table:player-left', user);
      announceUnseat(io, result);
    }
    if (affected.length > 0) {
      broadcastLobby(io);
    }
  });
}
