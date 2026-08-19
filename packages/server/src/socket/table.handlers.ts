import {
  applyPlayerAction,
  canStartHand,
  getPrivateHandState,
  getTableState,
  markUserConnected,
  markUserDisconnected,
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

/**
 * Quanto tempo o assento espera por quem caiu.
 *
 * Cair no celular é rotina: a tela apaga, o app vai para segundo plano, o wi-fi
 * troca de ponto. Liberar o assento na hora significava perder as fichas e a mão
 * por causa de um túnel. O preço é o outro lado: enquanto o prazo corre, a mesa
 * espera pela vez de quem sumiu, porque ainda não existe relógio de ação. Daí o
 * prazo ser curto.
 */
const RECONNECT_GRACE_MS = 45_000;

/**
 * Remoções agendadas por jogador. Fora do registry de propósito: liberar o
 * assento é a única parte que precisa avisar a sala, e quem sabe falar com a
 * sala é esta camada.
 */
const pendingRemovals = new Map<string, NodeJS.Timeout>();

function cancelPendingRemoval(userId: string): void {
  const timer = pendingRemovals.get(userId);
  if (timer) {
    clearTimeout(timer);
    pendingRemovals.delete(userId);
  }
}

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

/** Passado o prazo, quem caiu sai como se tivesse clicado em sair. */
function scheduleRemoval(io: PokerServer, user: PokerSocket['data']['user']): void {
  cancelPendingRemoval(user.id);

  const timer = setTimeout(() => {
    pendingRemovals.delete(user.id);

    const affected = unseatUserEverywhere(user.id);
    for (const result of affected) {
      io.to(roomFor(result.tableId)).emit('table:player-left', user);
      announceUnseat(io, result);
    }
    if (affected.length > 0) {
      broadcastLobby(io);
    }
  }, RECONNECT_GRACE_MS);

  // Um assento esperando não é motivo para o processo não terminar.
  timer.unref?.();
  pendingRemovals.set(user.id, timer);
}

export function registerTableHandlers(io: PokerServer, socket: PokerSocket): void {
  const user = socket.data.user;

  // Conexão nova do mesmo jogador é a volta dele: cancela a remoção agendada e
  // reacende os assentos. Fica aqui, e não no `table:join`, porque o assento
  // precisa voltar ao normal mesmo que ele volte direto para o lobby.
  cancelPendingRemoval(user.id);
  for (const tableId of markUserConnected(user.id)) {
    emitTableState(io, tableId);
  }

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
    // O assento não é liberado aqui: fica guardado, marcado como caído, até o
    // prazo de reconexão acabar.
    const affected = markUserDisconnected(user.id);
    if (affected.length === 0) {
      return;
    }

    for (const tableId of affected) {
      emitTableState(io, tableId);
    }
    scheduleRemoval(io, user);
  });
}
