import {
  applyPlayerAction,
  applyTurnTimeout,
  canStartHand,
  getPrivateHandState,
  getSeatedTableId,
  getTableBalances,
  getTableState,
  getTurnDeadline,
  markUserConnected,
  markUserDisconnected,
  seatUser,
  setReady,
  startTableHand,
  unseatUser,
  type StartedHandPrivates,
  type UnseatResult,
} from '../tables/table.registry.js';
import { readBalance, writeBalance } from '../users/balance.service.js';
import { broadcastLobby, type PokerServer, type PokerSocket } from './lobby.handlers.js';

const roomFor = (tableId: string) => `table:${tableId}`;

/**
 * Sockets vivos de cada jogador.
 *
 * Uma queda no celular vira duas conexões por um tempo: o socket.io reconecta em
 * um segundo, mas o servidor só percebe a morte do socket antigo pelo ping — até
 * uns 45s depois. O `disconnect` atrasado chega, então, com o jogador já de volta
 * e jogando; sem esta conta ele marcava como caído quem estava na frente da tela
 * e agendava a saída dele da mesa. Só a queda do **último** socket é uma queda.
 */
const liveSockets = new Map<string, Set<string>>();

/**
 * Relógio da vez, um por mesa. Fica aqui pelo mesmo motivo das remoções: o prazo
 * quem guarda é o registry, mas quem precisa acordar sozinho e avisar a sala do
 * que aconteceu é esta camada.
 */
const turnTimers = new Map<string, NodeJS.Timeout>();

function trackSocket(socket: PokerSocket): void {
  const sockets = liveSockets.get(socket.data.user.id) ?? new Set<string>();
  sockets.add(socket.id);
  liveSockets.set(socket.data.user.id, sockets);
}

/** Devolve `true` quando este era o último socket do jogador — aí sim ele caiu. */
function untrackSocket(socket: PokerSocket): boolean {
  const sockets = liveSockets.get(socket.data.user.id);
  sockets?.delete(socket.id);
  if (sockets && sockets.size > 0) {
    return false;
  }
  liveSockets.delete(socket.data.user.id);
  return true;
}

/**
 * Acerta o despertador da mesa com o prazo que o registry guarda. Chamado depois
 * de tudo que mexe na mão; como o prazo é um horário absoluto, reagendar não
 * estende a vez de ninguém.
 */
function syncTurnTimer(io: PokerServer, tableId: string): void {
  clearTimeout(turnTimers.get(tableId));
  turnTimers.delete(tableId);

  const deadline = getTurnDeadline(tableId);
  if (deadline === null) {
    return;
  }

  const timer = setTimeout(
    () => {
      turnTimers.delete(tableId);

      const result = applyTurnTimeout(tableId);
      if (result.taken) {
        io.to(roomFor(tableId)).emit('hand:action-taken', result.taken);
      }
      if (result.ended) {
        io.to(roomFor(tableId)).emit('hand:ended', result.ended);
        // Mão fechada pelo relógio paga igual: os saldos vão para o banco. Solto
        // de propósito — o despertador não espera o `UPDATE` para reagendar.
        void persistTableBalances(io, tableId);
      }
      if (!result.error) {
        emitTableState(io, tableId);
      }
      // Mesmo quando o disparo foi recusado por adiantado, o próximo prazo precisa
      // de despertador — senão a mesa fica sem relógio até a ação seguinte.
      syncTurnTimer(io, tableId);
    },
    Math.max(0, deadline - Date.now()),
  );

  // Uma mesa esperando não é motivo para o processo não terminar.
  timer.unref?.();
  turnTimers.set(tableId, timer);
}

/**
 * Grava o saldo sem derrubar a mesa se o banco recusar.
 *
 * A mão já acabou e as fichas já mudaram de dono na memória quando isto roda:
 * deixar a exceção subir mataria o handler no meio, sem `table:state`, e a mesa
 * ficaria travada por causa de um `UPDATE`. Perder a gravação custa as fichas
 * daquela mão; perder o resto custa a mesa.
 */
async function saveBalance(userId: string, chips: number): Promise<void> {
  try {
    await writeBalance(userId, chips);
  } catch (error) {
    console.error(`Falha ao gravar o saldo de ${userId}`, error);
  }
}

/**
 * Fim de mão: o stack de cada um vira o saldo da conta, e cada jogador recebe o
 * próprio número de volta.
 *
 * O `user:balance` sai socket a socket e não para a sala: saldo é assunto de
 * quem o tem, e o que a mesa precisa saber (o stack no assento) já vai no
 * `table:state`.
 */
async function persistTableBalances(io: PokerServer, tableId: string): Promise<void> {
  const balances = getTableBalances(tableId);
  if (balances.length === 0) {
    return;
  }

  await Promise.all(balances.map(({ userId, chips }) => saveBalance(userId, chips)));

  const sockets = await io.in(roomFor(tableId)).fetchSockets();
  for (const remote of sockets) {
    const own = balances.find((entry) => entry.userId === remote.data.user.id);
    if (own) {
      remote.emit('user:balance', { chips: own.chips });
    }
  }
}

function emitTableState(io: PokerServer, tableId: string): void {
  const state = getTableState(tableId);
  if (state) {
    io.to(roomFor(tableId)).emit('table:state', state);
  }
}

/** Depois de tudo que mexe na mão: estado novo para a sala e relógio da vez acertado. */
function afterHandChange(io: PokerServer, tableId: string): void {
  emitTableState(io, tableId);
  syncTurnTimer(io, tableId);
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
  afterHandChange(io, tableId);
}

async function announceUnseat(io: PokerServer, result: UnseatResult): Promise<void> {
  // Sair no meio da mão é fold, e a mesa ouve como tal: o jogo continua sem ele.
  if (result.folded) {
    io.to(roomFor(result.tableId)).emit('hand:action-taken', result.folded);
  }
  // A desistência pode ter terminado a mão aí mesmo — e aí quem ficou tem saldo
  // novo para gravar.
  if (result.ended) {
    io.to(roomFor(result.tableId)).emit('hand:ended', result.ended);
    await persistTableBalances(io, result.tableId);
  }
  afterHandChange(io, result.tableId);
}

export function registerTableHandlers(io: PokerServer, socket: PokerSocket): void {
  const user = socket.data.user;

  // Conexão nova do mesmo jogador é a volta dele: reacende os assentos e desmarca
  // o prazo. Fica aqui, e não no `table:join`, porque o assento precisa voltar ao
  // normal mesmo que ele volte direto para o lobby.
  trackSocket(socket);
  for (const tableId of markUserConnected(user.id)) {
    emitTableState(io, tableId);
  }

  socket.on('table:join', async ({ tableId }, ack) => {
    // As fichas da conta são as mesmas em qualquer mesa: em duas ao mesmo tempo
    // elas existiriam duas vezes, e a mão que acabasse por último apagaria o
    // resultado da outra ao gravar o saldo.
    const seatedAt = getSeatedTableId(user.id);
    if (seatedAt !== null && seatedAt !== tableId) {
      socket.emit('server:error', {
        code: 'ALREADY_SEATED',
        message: 'Você já está sentado em outra mesa. Saia dela para entrar nesta.',
      });
      ack(null);
      return;
    }

    // O stack é o saldo da conta, lido só de quem está sentando agora: quem já
    // está na mesa (reconexão, segunda aba) continua com as fichas de lá, que
    // podem estar bem à frente do último saldo gravado.
    let chips = 0;
    if (seatedAt === null) {
      const balance = await readBalance(user.id).catch((error: unknown) => {
        console.error(`Falha ao ler o saldo de ${user.id}`, error);
        return null;
      });
      if (balance === null) {
        socket.emit('server:error', {
          code: 'BALANCE_UNAVAILABLE',
          message: 'Não foi possível ler seu saldo. Tente de novo em instantes.',
        });
        ack(null);
        return;
      }
      chips = balance;
    }

    const state = seatUser(tableId, user, chips);
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

  socket.on('hand:action', async ({ tableId, action, amount }) => {
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
      // A mão fechou: os stacks são números fechados e viram saldo na conta.
      await persistTableBalances(io, tableId);
    }
    afterHandChange(io, tableId);
  });

  socket.on('table:leave', async ({ tableId }) => {
    const result = unseatUser(tableId, user.id);
    await socket.leave(roomFor(tableId));
    if (!result) {
      return;
    }

    io.to(roomFor(tableId)).emit('table:player-left', user);
    await announceUnseat(io, result);
    broadcastLobby(io);

    // Levantar da mesa é levar o stack de volta para a conta. Depois do
    // `announceUnseat`: se a saída fechou a mão, o pote já foi entregue.
    if (result.chips !== null) {
      await saveBalance(user.id, result.chips);
      socket.emit('user:balance', { chips: result.chips });
    }
  });

  socket.on('disconnect', () => {
    // Socket antigo morrendo depois de o jogador já ter voltado por outro não é
    // queda nenhuma: quem manda é a última conexão viva.
    if (!untrackSocket(socket)) {
      return;
    }

    // O assento não é liberado aqui, nem depois: fica dele, marcado como ausente.
    // A mão em andamento segue com o relógio da vez jogando por ele; as seguintes
    // começam sem ele, sem cobrar blind de quem não está.
    const affected = markUserDisconnected(user.id);
    for (const tableId of affected) {
      emitTableState(io, tableId);
    }
  });
}
