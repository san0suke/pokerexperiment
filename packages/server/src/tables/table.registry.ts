import {
  HAND_RANK_LABELS,
  type ActionTakenPayload,
  type AuthenticatedUser,
  type HandResultPayload,
  type LobbyTableSummary,
  type PlayerAction,
  type PrivateHandState,
  type PublicHandState,
  type TableState,
} from '@poker/shared';
import { MIN_PLAYERS_PER_HAND } from './hand.js';
import {
  applyAction,
  createHandRuntime,
  foldSeat,
  legalActions,
  totalPot,
  type HandRuntime,
  type LegalActions,
} from './hand-engine.js';
import { secureRandom } from './secure-random.js';

interface Seat {
  user: AuthenticatedUser;
  ready: boolean;
  chips: number;
  bet: number;
  committed: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
}

interface Table {
  id: string;
  name: string;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  seats: Map<number, Seat>;
  /** Mão em andamento. As cartas moram aqui dentro e nunca entram no `TableState`. */
  hand: HandRuntime | null;
  /** Dealer da última mão, para o botão girar na próxima. */
  lastDealerSeat: number | null;
}

/**
 * Stack que cada jogador recebe ao sentar, igual em qualquer mesa. Não há loja
 * nem saldo por jogador ainda: o `chips` do `User` no Postgres não é debitado,
 * então o buy-in é fixo e some quando o servidor reinicia, igual aos assentos.
 * Quando o saldo existir, é daqui que ele passa a sair.
 */
const BUY_IN = 1000;

const tables = new Map<string, Table>();

function seedTable(id: string, name: string, smallBlind: number, bigBlind: number): void {
  tables.set(id, {
    id,
    name,
    maxSeats: 6,
    smallBlind,
    bigBlind,
    seats: new Map(),
    hand: null,
    lastDealerSeat: null,
  });
}

// Static tables for now; created/destroyed dynamically once the game loop exists.
seedTable('table-1', 'Mesa Iniciante', 5, 10);
seedTable('table-2', 'Mesa Intermediária', 25, 50);
seedTable('table-3', 'Mesa Alta', 100, 200);

export function listTables(): LobbyTableSummary[] {
  return [...tables.values()].map((table) => ({
    id: table.id,
    name: table.name,
    maxSeats: table.maxSeats,
    seatedCount: table.seats.size,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
  }));
}

/** Copia o que é público da mão viva para os assentos. As cartas ficam de fora. */
function syncSeatsFromHand(table: Table): void {
  if (!table.hand) {
    return;
  }
  for (const [seatIndex, seat] of table.seats) {
    const player = table.hand.players.get(seatIndex);
    if (!player) {
      continue;
    }
    seat.chips = player.chips;
    seat.bet = player.bet;
    seat.committed = player.committed;
    seat.folded = player.folded;
    seat.allIn = player.allIn;
    seat.inHand = true;
  }
}

function clearHandFromSeats(table: Table): void {
  for (const seat of table.seats.values()) {
    seat.bet = 0;
    seat.committed = 0;
    seat.inHand = false;
    seat.folded = false;
    seat.allIn = false;
  }
}

function toPublicHand(hand: HandRuntime): PublicHandState {
  return {
    dealerSeat: hand.dealerSeat,
    smallBlindSeat: hand.smallBlindSeat,
    bigBlindSeat: hand.bigBlindSeat,
    round: hand.round,
    pot: totalPot(hand),
    communityCards: [...hand.board],
    turnSeat: hand.turnSeat,
    currentBet: hand.currentBet,
    minRaiseTo: hand.currentBet + hand.minRaise,
  };
}

export function getTableState(tableId: string): TableState | null {
  const table = tables.get(tableId);
  if (!table) {
    return null;
  }
  return {
    id: table.id,
    name: table.name,
    maxSeats: table.maxSeats,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    status: table.hand ? 'playing' : 'waiting',
    seats: Array.from({ length: table.maxSeats }, (_, seatIndex) => {
      const seat = table.seats.get(seatIndex);
      return {
        seatIndex,
        user: seat?.user ?? null,
        ready: seat?.ready ?? false,
        chips: seat?.chips ?? 0,
        bet: seat?.bet ?? 0,
        committed: seat?.committed ?? 0,
        inHand: seat?.inHand ?? false,
        folded: seat?.folded ?? false,
        allIn: seat?.allIn ?? false,
      };
    }),
    hand: table.hand ? toPublicHand(table.hand) : null,
  };
}

function findSeatIndex(table: Table, userId: string): number | null {
  for (const [seatIndex, seat] of table.seats) {
    if (seat.user.id === userId) {
      return seatIndex;
    }
  }
  return null;
}

/** Seats a user at the first free seat. Returns null if the table is missing or full. */
export function seatUser(tableId: string, user: AuthenticatedUser): TableState | null {
  const table = tables.get(tableId);
  if (!table) {
    return null;
  }

  if (findSeatIndex(table, user.id) === null) {
    const freeSeat = Array.from({ length: table.maxSeats }, (_, i) => i).find(
      (i) => !table.seats.has(i),
    );
    if (freeSeat === undefined) {
      return null;
    }
    // Quem senta no meio de uma mão só entra na próxima: sem cartas e sem pronto.
    table.seats.set(freeSeat, {
      user,
      ready: false,
      chips: BUY_IN,
      bet: 0,
      committed: 0,
      inHand: false,
      folded: false,
      allIn: false,
    });
  }

  return getTableState(tableId);
}

/** Monta o resultado da mão e devolve a mesa para o estado de espera. */
function closeHand(table: Table): HandResultPayload | null {
  const hand = table.hand;
  if (!hand?.outcome) {
    return null;
  }

  syncSeatsFromHand(table);

  const usernameFor = (seatIndex: number) => table.seats.get(seatIndex)?.user.username ?? '?';
  const result: HandResultPayload = {
    tableId: table.id,
    pot: hand.outcome.pot,
    winners: hand.outcome.winners.map((winner) => ({
      seatIndex: winner.seatIndex,
      username: usernameFor(winner.seatIndex),
      amount: winner.amount,
    })),
    showdown: hand.outcome.showdown.map((entry) => ({
      seatIndex: entry.seatIndex,
      holeCards: entry.holeCards,
      description: HAND_RANK_LABELS[entry.rank],
    })),
  };

  table.hand = null;
  clearHandFromSeats(table);
  for (const seat of table.seats.values()) {
    seat.ready = false;
  }

  return result;
}

export interface UnseatResult {
  tableId: string;
  /** Preenchido quando a saída encerrou a mão (os outros desistiram ou sobrou um). */
  ended: HandResultPayload | null;
}

export function unseatUser(tableId: string, userId: string): UnseatResult | null {
  const table = tables.get(tableId);
  if (!table) {
    return null;
  }

  const seatIndex = findSeatIndex(table, userId);
  if (seatIndex === null) {
    return { tableId, ended: null };
  }

  // Abandonar a mesa no meio da mão é desistir da mão: o que já foi apostado fica
  // no pote, como numa mesa de verdade.
  if (table.hand?.players.has(seatIndex)) {
    foldSeat(table.hand, seatIndex);
    syncSeatsFromHand(table);
  }

  table.seats.delete(seatIndex);

  let ended: HandResultPayload | null = null;
  if (table.hand?.finished) {
    ended = closeHand(table);
  }

  return { tableId, ended };
}

/** Used on disconnect, when we don't know which table the socket was at. */
export function unseatUserEverywhere(userId: string): UnseatResult[] {
  const affected: UnseatResult[] = [];
  for (const table of tables.values()) {
    if (findSeatIndex(table, userId) !== null) {
      const result = unseatUser(table.id, userId);
      if (result) {
        affected.push(result);
      }
    }
  }
  return affected;
}

/** Marca/desmarca o pronto. Ignorado durante uma mão — aí não há o que combinar. */
export function setReady(tableId: string, userId: string, ready: boolean): TableState | null {
  const table = tables.get(tableId);
  if (!table || table.hand) {
    return null;
  }

  const seatIndex = findSeatIndex(table, userId);
  if (seatIndex === null) {
    return null;
  }

  const seat = table.seats.get(seatIndex)!;
  seat.ready = ready;
  // Recompra automática de quem quebrou: sem loja nem saldo, travar o assento só
  // deixaria a mesa parada. Quando existir saldo por jogador, isto vira a compra.
  if (ready && seat.chips === 0) {
    seat.chips = BUY_IN;
  }

  return getTableState(tableId);
}

/** Assentos que podem jogar a próxima mão: sentados e com fichas. */
function playableSeats(table: Table): [number, Seat][] {
  return [...table.seats.entries()].filter(([, seat]) => seat.chips > 0);
}

/** Todos os que podem jogar estão prontos, e são pelo menos dois. */
export function canStartHand(tableId: string): boolean {
  const table = tables.get(tableId);
  if (!table || table.hand) {
    return false;
  }

  const playable = playableSeats(table);
  return playable.length >= MIN_PLAYERS_PER_HAND && playable.every(([, seat]) => seat.ready);
}

export interface StartedHandPrivates {
  userId: string;
  state: PrivateHandState;
}

/**
 * Começa a mão: embaralha com o RNG criptográfico, posiciona o botão, cobra os
 * blinds e distribui as cartas. Devolve as cartas privadas separadas por usuário
 * para o handler entregar cada uma ao socket certo — elas não passam pelo
 * `TableState`.
 */
export function startTableHand(tableId: string): StartedHandPrivates[] | null {
  const table = tables.get(tableId);
  if (!table || !canStartHand(tableId)) {
    return null;
  }

  const playable = playableSeats(table);
  const hand = createHandRuntime({
    players: playable.map(([seatIndex, seat]) => ({ seatIndex, chips: seat.chips })),
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    previousDealerSeat: table.lastDealerSeat,
    random: secureRandom,
  });

  table.hand = hand;
  table.lastDealerSeat = hand.dealerSeat;
  clearHandFromSeats(table);
  syncSeatsFromHand(table);
  for (const seat of table.seats.values()) {
    // O pronto vale por mão: na próxima todos confirmam de novo.
    seat.ready = false;
  }

  return playable.map(([seatIndex, seat]) => ({
    userId: seat.user.id,
    state: {
      tableId: table.id,
      seatIndex,
      holeCards: hand.players.get(seatIndex)?.cards ?? [],
    },
  }));
}

export interface PlayerActionResult {
  error?: string;
  taken?: ActionTakenPayload;
  /** A ação encerrou a mão. */
  ended?: HandResultPayload;
}

/**
 * Valida e aplica a ação do jogador. Toda a regra roda aqui: o cliente manda o
 * que quer fazer e o servidor decide se pode.
 */
export function applyPlayerAction(
  tableId: string,
  userId: string,
  action: PlayerAction,
  amount?: number,
): PlayerActionResult {
  const table = tables.get(tableId);
  if (!table?.hand) {
    return { error: 'Não há mão em andamento nesta mesa' };
  }

  const seatIndex = findSeatIndex(table, userId);
  if (seatIndex === null) {
    return { error: 'Você não está sentado nesta mesa' };
  }

  const outcome = applyAction(table.hand, seatIndex, action, amount);
  if (!outcome.ok) {
    return { error: outcome.reason ?? 'Ação inválida' };
  }

  syncSeatsFromHand(table);

  const taken: ActionTakenPayload = {
    seatIndex,
    username: table.seats.get(seatIndex)!.user.username,
    action,
    // Aumento se anuncia pelo total ("aumentou para 40"); o resto, pelo que saiu do stack.
    amount: (action === 'raise' ? outcome.total : outcome.amount) ?? 0,
    allIn: outcome.allIn ?? false,
  };

  if (table.hand.finished) {
    const ended = closeHand(table);
    return ended ? { taken, ended } : { taken };
  }

  return { taken };
}

/** Ações disponíveis para quem tem a vez — o cliente usa para montar os botões. */
export function getLegalActions(tableId: string, userId: string): LegalActions | null {
  const table = tables.get(tableId);
  if (!table?.hand) {
    return null;
  }
  const seatIndex = findSeatIndex(table, userId);
  return seatIndex === null ? null : legalActions(table.hand, seatIndex);
}

/** Reenvio das próprias cartas — usado quando o jogador volta para a mesa. */
export function getPrivateHandState(tableId: string, userId: string): PrivateHandState | null {
  const table = tables.get(tableId);
  if (!table?.hand) {
    return null;
  }

  const seatIndex = findSeatIndex(table, userId);
  if (seatIndex === null) {
    return null;
  }

  const player = table.hand.players.get(seatIndex);
  return player ? { tableId: table.id, seatIndex, holeCards: player.cards } : null;
}
