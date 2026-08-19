import {
  compareHands,
  evaluateHand,
  type BettingRound,
  type Card,
  type Deck,
  type HandRank,
} from '@poker/shared';
import { startHand, type StartHandOptions } from './hand.js';

export interface EnginePlayer {
  seatIndex: number;
  chips: number;
  /** Aposta na rua atual. Zera a cada rua. */
  bet: number;
  /** Tudo que já saiu do stack nesta mão — base dos side pots. */
  committed: number;
  folded: boolean;
  allIn: boolean;
  /** Já agiu nesta rua (o big blind começa sem ter agido: é a opção dele). */
  acted: boolean;
  cards: Card[];
}

export interface ShowdownEntry {
  seatIndex: number;
  holeCards: Card[];
  rank: HandRank;
}

export interface PotWin {
  seatIndex: number;
  amount: number;
}

export interface HandOutcome {
  /** Quanto cada vencedor levou, somando todos os potes. */
  winners: PotWin[];
  /** Cartas abertas. Vazio quando a mão terminou sem showdown. */
  showdown: ShowdownEntry[];
  pot: number;
}

export interface HandRuntime {
  /** Assentos da mão, em ordem crescente — a ordem de jogo é circular sobre ela. */
  order: number[];
  players: Map<number, EnginePlayer>;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  bigBlind: number;
  round: BettingRound;
  /** Maior aposta da rua atual. */
  currentBet: number;
  /** Tamanho do último aumento — piso para o próximo. */
  minRaise: number;
  /** De quem é a vez. `null` quando não há mais o que apostar. */
  turnSeat: number | null;
  board: Card[];
  deck: Deck;
  finished: boolean;
  outcome: HandOutcome | null;
}

export type ActionType = 'fold' | 'check' | 'call' | 'raise';

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Quanto sai do stack para pagar (limitado pelo que resta). */
  callAmount: number;
  canRaise: boolean;
  /** Menor "aumentar para" aceito; já considera all-in menor que o mínimo. */
  minRaiseTo: number;
  /** Maior "aumentar para" possível: tudo o que o jogador tem. */
  maxRaiseTo: number;
}

const ROUND_ORDER: BettingRound[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

/** Quantas cartas cada rua abre. */
const CARDS_PER_ROUND: Partial<Record<BettingRound, number>> = { flop: 3, turn: 1, river: 1 };

function playersInOrder(runtime: HandRuntime): EnginePlayer[] {
  return runtime.order.map((seat) => runtime.players.get(seat)!);
}

/** Ainda na mão (não desistiu) — pode ganhar o pote. */
function stillIn(runtime: HandRuntime): EnginePlayer[] {
  return playersInOrder(runtime).filter((player) => !player.folded);
}

/** Ainda pode apostar — não desistiu nem está all-in. */
function canStillAct(runtime: HandRuntime): EnginePlayer[] {
  return stillIn(runtime).filter((player) => !player.allIn);
}

/** Assentos a partir do seguinte a `from`, dando a volta na mesa. */
function seatsAfter(runtime: HandRuntime, from: number): number[] {
  const index = runtime.order.indexOf(from);
  const start = index === -1 ? 0 : index + 1;
  return [...runtime.order.slice(start), ...runtime.order.slice(0, start)];
}

function needsToAct(runtime: HandRuntime, player: EnginePlayer): boolean {
  if (player.folded || player.allIn) {
    return false;
  }
  return !player.acted || player.bet < runtime.currentBet;
}

function nextToAct(runtime: HandRuntime, from: number): number | null {
  for (const seat of seatsAfter(runtime, from)) {
    if (needsToAct(runtime, runtime.players.get(seat)!)) {
      return seat;
    }
  }
  return null;
}

/** Primeiro a falar depois do flop: o jogador ativo à esquerda do botão. */
function firstToActAfterFlop(runtime: HandRuntime): number | null {
  for (const seat of seatsAfter(runtime, runtime.dealerSeat)) {
    const player = runtime.players.get(seat)!;
    if (!player.folded && !player.allIn) {
      return seat;
    }
  }
  return null;
}

export function createHandRuntime(options: StartHandOptions): HandRuntime {
  const started = startHand(options);

  const players = new Map<number, EnginePlayer>();
  for (const seatIndex of started.holeCards.keys()) {
    const committed = started.committed.get(seatIndex) ?? 0;
    const chips = started.chips.get(seatIndex) ?? 0;
    players.set(seatIndex, {
      seatIndex,
      chips,
      bet: committed,
      committed,
      folded: false,
      // Quem gastou tudo pagando o blind já entra all-in.
      allIn: chips === 0,
      acted: false,
      cards: started.holeCards.get(seatIndex) ?? [],
    });
  }

  const order = [...players.keys()].sort((a, b) => a - b);
  const currentBet = Math.max(...[...players.values()].map((player) => player.bet));

  const runtime: HandRuntime = {
    order,
    players,
    dealerSeat: started.dealerSeat,
    smallBlindSeat: started.smallBlindSeat,
    bigBlindSeat: started.bigBlindSeat,
    bigBlind: options.bigBlind,
    round: 'preflop',
    currentBet,
    minRaise: options.bigBlind,
    // No pré-flop a ação abre à esquerda do big blind (no heads-up, o próprio
    // dealer/small blind). O big blind fecha, com direito de aumentar.
    turnSeat: null,
    board: [],
    deck: started.deck,
    finished: false,
    outcome: null,
  };

  runtime.turnSeat = nextToAct(runtime, started.bigBlindSeat);
  settleIfRoundIsOver(runtime);
  return runtime;
}

export function legalActions(runtime: HandRuntime, seatIndex: number): LegalActions | null {
  const player = runtime.players.get(seatIndex);
  if (!player || runtime.finished || runtime.turnSeat !== seatIndex) {
    return null;
  }

  const toCall = Math.max(0, runtime.currentBet - player.bet);
  const callAmount = Math.min(toCall, player.chips);
  const maxRaiseTo = player.bet + player.chips;
  // Aumentar exige cobrir a aposta e ainda subir; quem só tem o call vai de all-in
  // pelo call, não por aumento.
  const canRaise = maxRaiseTo > runtime.currentBet && player.chips > toCall;

  return {
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0 && player.chips > 0,
    callAmount,
    canRaise,
    // Se o stack não alcança o aumento mínimo, o all-in é o mínimo possível.
    minRaiseTo: Math.min(runtime.currentBet + runtime.minRaise, maxRaiseTo),
    maxRaiseTo,
  };
}

export interface ActionOutcome {
  ok: boolean;
  reason?: string;
  /** Fichas que saíram do stack nesta ação. */
  amount?: number;
  /** Aposta total do jogador na rua depois da ação — o "aumentou para". */
  total?: number;
  /** Descreve o all-in para o log da mesa. */
  allIn?: boolean;
}

export function applyAction(
  runtime: HandRuntime,
  seatIndex: number,
  action: ActionType,
  raiseTo?: number,
): ActionOutcome {
  const legal = legalActions(runtime, seatIndex);
  if (!legal) {
    return { ok: false, reason: 'Não é a sua vez' };
  }

  const player = runtime.players.get(seatIndex)!;
  let amount = 0;

  switch (action) {
    case 'fold':
      player.folded = true;
      break;

    case 'check':
      if (!legal.canCheck) {
        return { ok: false, reason: 'Há uma aposta na mesa: pague ou desista' };
      }
      break;

    case 'call': {
      if (!legal.canCall) {
        return { ok: false, reason: 'Não há aposta para pagar' };
      }
      amount = legal.callAmount;
      pay(player, amount);
      break;
    }

    case 'raise': {
      if (!legal.canRaise) {
        return { ok: false, reason: 'Sem fichas suficientes para aumentar' };
      }
      const target = Math.round(raiseTo ?? 0);
      if (target < legal.minRaiseTo || target > legal.maxRaiseTo) {
        return {
          ok: false,
          reason: `Aumento inválido: entre ${legal.minRaiseTo} e ${legal.maxRaiseTo}`,
        };
      }

      const raiseSize = target - runtime.currentBet;
      amount = target - player.bet;
      pay(player, amount);

      // Aumento cheio reabre a rodada: quem já falou volta a ter escolha. Um
      // all-in menor que o mínimo (raise incompleto) não reabre — quem já pagou
      // só pode pagar a diferença, não aumentar de novo.
      if (raiseSize >= runtime.minRaise) {
        runtime.minRaise = raiseSize;
        for (const other of runtime.players.values()) {
          if (other.seatIndex !== seatIndex && !other.folded && !other.allIn) {
            other.acted = false;
          }
        }
      }
      runtime.currentBet = target;
      break;
    }
  }

  player.acted = true;
  advance(runtime, seatIndex);

  return { ok: true, amount, total: player.bet, allIn: player.allIn };
}

function pay(player: EnginePlayer, amount: number): void {
  const paid = Math.min(amount, player.chips);
  player.chips -= paid;
  player.bet += paid;
  player.committed += paid;
  if (player.chips === 0) {
    player.allIn = true;
  }
}

function advance(runtime: HandRuntime, fromSeat: number): void {
  // Sobrou um: leva o pote sem mostrar as cartas.
  if (stillIn(runtime).length === 1) {
    finish(runtime);
    return;
  }

  const next = nextToAct(runtime, fromSeat);
  if (next !== null) {
    runtime.turnSeat = next;
    return;
  }

  runtime.turnSeat = null;
  settleIfRoundIsOver(runtime);
}

/** Fecha a rua e abre a próxima — ou corre o board quando ninguém mais pode apostar. */
function settleIfRoundIsOver(runtime: HandRuntime): void {
  if (runtime.finished || runtime.turnSeat !== null) {
    return;
  }

  while (!runtime.finished) {
    closeRound(runtime);
    if (runtime.round === 'showdown') {
      finish(runtime);
      return;
    }

    // Com no máximo um jogador capaz de apostar, as ruas seguintes só abrem
    // cartas: ninguém tem decisão a tomar até o showdown.
    if (canStillAct(runtime).length > 1) {
      runtime.turnSeat = firstToActAfterFlop(runtime);
      if (runtime.turnSeat !== null) {
        return;
      }
    }
  }
}

function closeRound(runtime: HandRuntime): void {
  for (const player of runtime.players.values()) {
    player.bet = 0;
    player.acted = false;
  }
  runtime.currentBet = 0;
  runtime.minRaise = runtime.bigBlind;

  const nextRound = ROUND_ORDER[ROUND_ORDER.indexOf(runtime.round) + 1];
  runtime.round = nextRound;

  const cards = CARDS_PER_ROUND[nextRound];
  if (cards) {
    // Queima uma carta antes de cada rua, como na mesa.
    runtime.deck.draw(1);
    runtime.board.push(...runtime.deck.draw(cards));
  }
}

/**
 * Aposta não coberta volta para quem apostou: se todo mundo desistiu ou pagou
 * menos (all-in curto), a diferença nunca esteve em jogo.
 */
function returnUncalledBet(runtime: HandRuntime): void {
  const committed = playersInOrder(runtime)
    .map((player) => player.committed)
    .sort((a, b) => b - a);
  const [highest, second = 0] = committed;
  if (highest <= second) {
    return;
  }

  const owner = playersInOrder(runtime).find((player) => player.committed === highest);
  if (owner) {
    owner.chips += highest - second;
    owner.committed = second;
  }
}

interface Pot {
  amount: number;
  /** Assentos que disputam este pote. */
  eligible: number[];
}

/**
 * Divide o total apostado em potes por nível de all-in: quem pagou menos só
 * disputa até onde pagou, e o excedente vira side pot dos que foram mais longe.
 */
function buildPots(runtime: HandRuntime): Pot[] {
  const players = playersInOrder(runtime);
  const levels = [...new Set(players.map((player) => player.committed))]
    .filter((level) => level > 0)
    .sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previous = 0;

  for (const level of levels) {
    const amount = players.reduce(
      (sum, player) =>
        sum + (Math.min(player.committed, level) - Math.min(player.committed, previous)),
      0,
    );
    const eligible = players
      .filter((player) => !player.folded && player.committed >= level)
      .map((player) => player.seatIndex);

    if (amount > 0) {
      pots.push({ amount, eligible });
    }
    previous = level;
  }

  return pots;
}

/** Desempate de fichas ímpares: começa no primeiro assento à esquerda do botão. */
function oddChipOrder(runtime: HandRuntime, seats: number[]): number[] {
  const after = seatsAfter(runtime, runtime.dealerSeat);
  return [...seats].sort((a, b) => after.indexOf(a) - after.indexOf(b));
}

function finish(runtime: HandRuntime): void {
  runtime.finished = true;
  runtime.turnSeat = null;
  returnUncalledBet(runtime);

  const pot = playersInOrder(runtime).reduce((sum, player) => sum + player.committed, 0);
  const remaining = stillIn(runtime);
  const wins = new Map<number, number>();

  if (remaining.length === 1) {
    // Ganhou sem showdown: as cartas dele não são reveladas.
    const winner = remaining[0];
    winner.chips += pot;
    wins.set(winner.seatIndex, pot);
    runtime.outcome = {
      winners: [{ seatIndex: winner.seatIndex, amount: pot }],
      showdown: [],
      pot,
    };
    runtime.round = 'showdown';
    return;
  }

  const evaluated = new Map(
    remaining.map((player) => [
      player.seatIndex,
      evaluateHand([...player.cards, ...runtime.board]),
    ]),
  );

  for (const currentPot of buildPots(runtime)) {
    const contenders = currentPot.eligible.length > 0 ? currentPot.eligible : [];
    if (contenders.length === 0) {
      continue;
    }

    let best = contenders[0];
    let winnersOfPot: number[] = [best];
    for (const seat of contenders.slice(1)) {
      const diff = compareHands(evaluated.get(seat)!, evaluated.get(best)!);
      if (diff > 0) {
        best = seat;
        winnersOfPot = [seat];
      } else if (diff === 0) {
        winnersOfPot.push(seat);
      }
    }

    const share = Math.floor(currentPot.amount / winnersOfPot.length);
    let leftover = currentPot.amount - share * winnersOfPot.length;
    for (const seat of oddChipOrder(runtime, winnersOfPot)) {
      const extra = leftover > 0 ? 1 : 0;
      leftover -= extra;
      const total = share + extra;
      runtime.players.get(seat)!.chips += total;
      wins.set(seat, (wins.get(seat) ?? 0) + total);
    }
  }

  runtime.outcome = {
    winners: [...wins.entries()]
      .map(([seatIndex, amount]) => ({ seatIndex, amount }))
      .sort((a, b) => b.amount - a.amount),
    showdown: remaining.map((player) => ({
      seatIndex: player.seatIndex,
      holeCards: player.cards,
      rank: evaluated.get(player.seatIndex)!.rank,
    })),
    pot,
  };
  runtime.round = 'showdown';
}

/** Desistência forçada de quem abandonou a mesa no meio da mão. */
export function foldSeat(runtime: HandRuntime, seatIndex: number): void {
  const player = runtime.players.get(seatIndex);
  if (!player || runtime.finished || player.folded) {
    return;
  }

  player.folded = true;
  player.acted = true;

  if (runtime.turnSeat === seatIndex) {
    advance(runtime, seatIndex);
    return;
  }
  // Saiu fora da vez: a rodada pode ter ficado completa sem ele.
  if (stillIn(runtime).length === 1) {
    finish(runtime);
    return;
  }
  if (runtime.turnSeat === null) {
    settleIfRoundIsOver(runtime);
  }
}

/** Total apostado na mão até agora, incluindo a rua em andamento. */
export function totalPot(runtime: HandRuntime): number {
  return playersInOrder(runtime).reduce((sum, player) => sum + player.committed, 0);
}
