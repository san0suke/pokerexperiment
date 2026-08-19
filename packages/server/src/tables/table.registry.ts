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
  /**
   * Socket caiu. O assento continua dele — a mesa mostra "ausente" e a vida
   * segue: nas mãos em andamento o relógio da vez joga por ele; nas seguintes
   * ele fica de fora, sem pagar blind, até voltar e marcar pronto.
   */
  disconnected: boolean;
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
  /**
   * Instante (ms) em que a vez atual expira. `null` fora da mão ou quando não há
   * ninguém para agir. Guardado como horário absoluto, e não como o que falta,
   * para que reemitir o estado não estenda o prazo de quem está pensando.
   */
  turnDeadline: number | null;
}

/**
 * Quanto tempo cada jogador tem para agir. Estourado o prazo, o servidor joga por
 * ele: passa quando dá para passar e desiste quando há aposta na mesa — a escolha
 * que não custa fichas de quem não está lá.
 *
 * Sem isto, uma mesa parava para sempre esperando quem fechou a aba, e o prazo de
 * reconexão de 45s não resolvia: ele só corre para quem o socket caiu, não para
 * quem está conectado e não joga.
 */
export const TURN_TIMEOUT_MS = 25_000;


/**
 * Folga na comparação do prazo: o `setTimeout` do Node pode acordar um fio de
 * milissegundo antes da hora, e sem a folga o disparo legítimo seria recusado
 * como adiantado — a mesa travaria justamente no caso que o relógio existe para
 * destravar.
 */
const CLOCK_TOLERANCE_MS = 50;

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
    turnDeadline: null,
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

/**
 * Recomeça a contagem da vez. Chamado a cada mudança na mão — começo, ação,
 * desistência forçada —, porque qualquer uma delas passa a vez para alguém, mesmo
 * que seja o mesmo assento de novo (heads-up: quem fala por último no pré-flop
 * fala primeiro no flop).
 */
function restartTurnClock(table: Table): void {
  const hand = table.hand;
  table.turnDeadline =
    hand && !hand.finished && hand.turnSeat !== null ? Date.now() + TURN_TIMEOUT_MS : null;
}

function toPublicHand(table: Table, hand: HandRuntime): PublicHandState {
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
    turnDurationMs: TURN_TIMEOUT_MS,
    turnEndsInMs:
      table.turnDeadline === null ? null : Math.max(0, table.turnDeadline - Date.now()),
  };
}

/** Quando a vez atual expira, para a camada de socket agendar o relógio. */
export function getTurnDeadline(tableId: string): number | null {
  return tables.get(tableId)?.turnDeadline ?? null;
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
        disconnected: seat?.disconnected ?? false,
      };
    }),
    hand: table.hand ? toPublicHand(table, table.hand) : null,
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

/**
 * Em que mesa o jogador já está sentado, se estiver em alguma.
 *
 * O saldo da conta é um só e ele viaja inteiro para a mesa: sentar em duas ao
 * mesmo tempo faria as mesmas fichas existirem em dois lugares, e a mão que
 * acabasse por último apagaria o resultado da outra ao gravar o saldo.
 */
export function getSeatedTableId(userId: string): string | null {
  for (const table of tables.values()) {
    if (findSeatIndex(table, userId) !== null) {
      return table.id;
    }
  }
  return null;
}

/**
 * Stack de cada jogador sentado, para a camada de socket gravar na conta. Só faz
 * sentido chamar fora de uma mão: no meio dela parte das fichas está no pote.
 */
export function getTableBalances(tableId: string): { userId: string; chips: number }[] {
  const table = tables.get(tableId);
  if (!table) {
    return [];
  }
  return [...table.seats.values()].map((seat) => ({ userId: seat.user.id, chips: seat.chips }));
}

/**
 * Senta o jogador no primeiro assento livre com o stack que ele trouxe.
 *
 * O stack vem de fora — é o saldo da conta, que só a camada de socket sabe ler —
 * porque o registry não fala com o banco. Sentar de novo (reconexão, segunda aba)
 * cai no assento que já existe e **ignora** o valor recebido: as fichas de quem
 * está jogando são as da mesa, não as do último saldo gravado.
 *
 * `null` quando a mesa não existe ou está lotada.
 */
export function seatUser(
  tableId: string,
  user: AuthenticatedUser,
  chips: number,
): TableState | null {
  const table = tables.get(tableId);
  if (!table) {
    return null;
  }

  const seatIndex = findSeatIndex(table, user.id);
  if (seatIndex === null) {
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
      chips: Math.max(0, Math.trunc(chips)),
      bet: 0,
      committed: 0,
      inHand: false,
      folded: false,
      allIn: false,
      disconnected: false,
    });
  } else {
    // Sentar de novo é a própria prova de que ele voltou.
    table.seats.get(seatIndex)!.disconnected = false;
  }

  return getTableState(tableId);
}

/**
 * O socket caiu: os assentos dele ficam guardados, marcados para os outros verem.
 *
 * O assento **não** é liberado — nem agora nem depois. A mesa não some porque a
 * internet oscilou: quem volta encontra o próprio assento, as próprias fichas e
 * os vizinhos onde estavam, ausentes ou não. Só o próprio jogador se levanta,
 * pelo `table:leave`.
 *
 * Quem some perde o "pronto": a mão seguinte começa sem ele, e sem cobrar blind
 * de quem não está lá.
 */
export function markUserDisconnected(userId: string): string[] {
  const affected: string[] = [];
  for (const table of tables.values()) {
    const seatIndex = findSeatIndex(table, userId);
    if (seatIndex === null) {
      continue;
    }
    const seat = table.seats.get(seatIndex)!;
    seat.disconnected = true;
    seat.ready = false;
    affected.push(table.id);
  }
  return affected;
}

/** O jogador voltou: devolve as mesas em que algum assento dele estava marcado. */
export function markUserConnected(userId: string): string[] {
  const affected: string[] = [];
  for (const table of tables.values()) {
    const seatIndex = findSeatIndex(table, userId);
    if (seatIndex === null) {
      continue;
    }
    const seat = table.seats.get(seatIndex)!;
    if (seat.disconnected) {
      seat.disconnected = false;
      affected.push(table.id);
    }
  }
  return affected;
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
    communityCards: [...hand.board],
  };

  table.hand = null;
  table.turnDeadline = null;
  clearHandFromSeats(table);
  for (const seat of table.seats.values()) {
    seat.ready = false;
  }

  return result;
}

export interface UnseatResult {
  tableId: string;
  /**
   * Preenchido quando a saída foi no meio da mão: sair é desistir, e a mesa
   * precisa ouvir isso como ouviria qualquer fold — senão o assento apenas some e
   * ninguém entende por que o jogo seguiu sem ele.
   */
  folded: ActionTakenPayload | null;
  /** Preenchido quando a saída encerrou a mão (os outros desistiram ou sobrou um). */
  ended: HandResultPayload | null;
  /**
   * Stack com que ele levantou, para voltar à conta. `null` quando ele nem estava
   * sentado — aí não há nada a gravar, e gravar zero apagaria o saldo dele.
   */
  chips: number | null;
}

export function unseatUser(tableId: string, userId: string): UnseatResult | null {
  const table = tables.get(tableId);
  if (!table) {
    return null;
  }

  const seatIndex = findSeatIndex(table, userId);
  if (seatIndex === null) {
    return { tableId, folded: null, ended: null, chips: null };
  }

  // Abandonar a mesa no meio da mão é desistir da mão: o que já foi apostado fica
  // no pote, como numa mesa de verdade, e o jogo segue para os outros.
  let folded: ActionTakenPayload | null = null;
  const player = table.hand?.players.get(seatIndex);
  if (table.hand && player) {
    // Quem já tinha desistido não desiste duas vezes.
    const wasStillIn = !player.folded;
    // Só quem estava com a vez passa a bola: o relógio de quem já estava pensando
    // não recomeça porque um vizinho levantou da mesa.
    const hadTheTurn = table.hand.turnSeat === seatIndex;

    foldSeat(table.hand, seatIndex);
    syncSeatsFromHand(table);
    if (hadTheTurn) {
      restartTurnClock(table);
    }
    if (wasStillIn) {
      folded = {
        seatIndex,
        username: table.seats.get(seatIndex)!.user.username,
        action: 'fold',
        amount: 0,
        allIn: false,
        timedOut: false,
      };
    }
  }

  // O stack sai da mesa junto com ele: é o que a conta recebe de volta. Lido
  // antes do `delete`, e depois do fold — o que ele já tinha apostado ficou no
  // pote e não volta.
  const chips = table.seats.get(seatIndex)!.chips;
  table.seats.delete(seatIndex);

  let ended: HandResultPayload | null = null;
  if (table.hand?.finished) {
    ended = closeHand(table);
  }

  return { tableId, folded, ended, chips };
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
  // Não há recompra: o stack é o saldo da conta, e quem quebrou quebrou. O pronto
  // dele não trava a mesa — `playableSeats` deixa de fora quem está sem fichas.

  return getTableState(tableId);
}

/**
 * Assentos que podem jogar a próxima mão: sentados, com fichas e presentes.
 *
 * Ausente não entra na mão. Ele nem poderia — o `ready` cai junto com o socket —,
 * mas deixá-lo na conta travava a mesa inteira: `canStartHand` exige que **todos**
 * os que podem jogar estejam prontos, e um assento ausente nunca fica pronto. Com
 * ele de fora, quem está na frente da tela continua jogando e ele volta na mão
 * seguinte à volta dele.
 */
function playableSeats(table: Table): [number, Seat][] {
  return [...table.seats.entries()].filter(([, seat]) => seat.chips > 0 && !seat.disconnected);
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
  restartTurnClock(table);
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

  return runAction(table, table.hand, seatIndex, action, amount, false);
}

/**
 * O prazo do jogador da vez acabou: o servidor joga por ele. Passa quando dá para
 * passar, desiste quando há aposta na mesa — nunca gasta ficha de quem não está
 * na frente da tela.
 */
export function applyTurnTimeout(tableId: string): PlayerActionResult {
  const table = tables.get(tableId);
  if (!table?.hand || table.turnDeadline === null) {
    return { error: 'Não há vez correndo nesta mesa' };
  }

  // O jogador pode ter agido entre o disparo do relógio e esta chamada; aí a vez
  // já é de outro, com prazo novo, e não há nada a forçar.
  if (Date.now() < table.turnDeadline - CLOCK_TOLERANCE_MS) {
    return { error: 'Ainda há tempo nesta vez' };
  }

  const seatIndex = table.hand.turnSeat;
  if (seatIndex === null || !table.seats.has(seatIndex)) {
    // Prazo vencido sem ninguém para agir não deveria acontecer, mas deixá-lo de
    // pé faria a camada de socket reagendar o despertador para agora, sem parar.
    restartTurnClock(table);
    return { error: 'Não há vez correndo nesta mesa' };
  }

  const legal = legalActions(table.hand, seatIndex);
  const result = runAction(
    table,
    table.hand,
    seatIndex,
    legal?.canCheck ? 'check' : 'fold',
    undefined,
    true,
  );
  if (result.error) {
    restartTurnClock(table);
  }
  return result;
}

/** Aplica a ação — pedida pelo jogador ou forçada pelo relógio — e acerta a mesa. */
function runAction(
  table: Table,
  hand: HandRuntime,
  seatIndex: number,
  action: PlayerAction,
  amount: number | undefined,
  timedOut: boolean,
): PlayerActionResult {
  const outcome = applyAction(hand, seatIndex, action, amount);
  if (!outcome.ok) {
    return { error: outcome.reason ?? 'Ação inválida' };
  }

  syncSeatsFromHand(table);
  restartTurnClock(table);

  const taken: ActionTakenPayload = {
    seatIndex,
    username: table.seats.get(seatIndex)!.user.username,
    action,
    // Aumento se anuncia pelo total ("aumentou para 40"); o resto, pelo que saiu do stack.
    amount: (action === 'raise' ? outcome.total : outcome.amount) ?? 0,
    allIn: outcome.allIn ?? false,
    timedOut,
  };

  if (hand.finished) {
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
