import type { Card } from '../cards/card.js';

/** Identity attached to an authenticated socket, decoded from the JWT. */
export interface AuthenticatedUser {
  id: string;
  username: string;
}

/** A table as shown in the lobby list — no hand or hole-card data. */
export interface LobbyTableSummary {
  id: string;
  name: string;
  maxSeats: number;
  seatedCount: number;
  smallBlind: number;
  bigBlind: number;
}

/** `waiting` = aceita o pronto/não pronto; `playing` = mão em andamento. */
export type TableStatus = 'waiting' | 'playing';

export type BettingRound = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface TableSeat {
  seatIndex: number;
  user: AuthenticatedUser | null;
  /** Marcou "estou pronto". Zerado a cada mão iniciada. */
  ready: boolean;
  /** Stack do jogador na mesa. */
  chips: number;
  /** Aposta deste assento na rua atual — é o que falta cobrir para pagar. */
  bet: number;
  /** Fichas que este assento já colocou no pote na mão atual. */
  committed: number;
  /** Recebeu hole cards na mão em andamento. */
  inHand: boolean;
  /** Desistiu da mão. */
  folded: boolean;
  /** Apostou todas as fichas: continua na mão, mas não age mais. */
  allIn: boolean;
  /**
   * O socket do jogador caiu e o assento está guardado esperando a volta dele.
   * Passado o prazo, o servidor libera o assento como se ele tivesse saído.
   */
  disconnected: boolean;
}

/**
 * Estado público da mão, transmitido para a sala inteira.
 *
 * Nunca carrega hole cards: qualquer carta que chegue aqui é visível no DevTools
 * de todos os jogadores. As cartas de cada um saem por `hand:private-state`, só
 * para o socket do dono.
 */
export interface PublicHandState {
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  round: BettingRound;
  /** Total já recolhido dos jogadores nesta mão, blinds inclusos. */
  pot: number;
  /** Cartas comunitárias reveladas até agora — vazio no pré-flop. */
  communityCards: Card[];
  /** De quem é a vez. `null` enquanto não há aposta a fazer. */
  turnSeat: number | null;
  /** Maior aposta da rua atual: quem estiver abaixo paga ou desiste. */
  currentBet: number;
  /** Menor valor aceito num aumento, já pelas regras da rodada. */
  minRaiseTo: number;
  /** Quanto tempo cada jogador tem para agir, contado do começo da vez dele. */
  turnDurationMs: number;
  /**
   * Quanto falta da vez atual, em milissegundos, no instante em que este estado
   * saiu do servidor. É um prazo relativo, e não um horário: o relógio do celular
   * pode estar minutos fora do relógio do servidor, e a diferença viraria um
   * contador errado. O cliente conta a partir do que recebeu.
   */
  turnEndsInMs: number | null;
}

/** Ações do poker. `raise` cobre também apostar do zero e o all-in. */
export type PlayerAction = 'fold' | 'check' | 'call' | 'raise';

export interface PlayerActionPayload {
  tableId: string;
  action: PlayerAction;
  /** Só para `raise`: o valor total para o qual se está aumentando. */
  amount?: number;
}

/** Ação de alguém na mesa, para o resto da sala acompanhar. */
export interface ActionTakenPayload {
  seatIndex: number;
  username: string;
  action: PlayerAction;
  /** Em `raise`, o total para o qual se aumentou; nas outras, o que saiu do stack. */
  amount: number;
  allIn: boolean;
  /** O tempo acabou e o servidor jogou pelo jogador (passa, ou desiste se não der). */
  timedOut: boolean;
}

export interface ShowdownHand {
  seatIndex: number;
  holeCards: Card[];
  /** Nome da jogada, já em português. */
  description: string;
}

export interface HandWinner {
  seatIndex: number;
  username: string;
  amount: number;
}

export interface HandResultPayload {
  tableId: string;
  pot: number;
  winners: HandWinner[];
  /** Vazio quando a mão acabou sem showdown (todos desistiram). */
  showdown: ShowdownHand[];
  /**
   * O board como parou. Já era público durante a mão; vem junto para o cliente
   * manter as cartas na mesa até a próxima começar.
   */
  communityCards: Card[];
}

/** Table state broadcast to everyone in the room. */
export interface TableState {
  id: string;
  name: string;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  status: TableStatus;
  seats: TableSeat[];
  hand: PublicHandState | null;
}

/** Enviado só para o socket do dono das cartas. */
export interface PrivateHandState {
  tableId: string;
  seatIndex: number;
  holeCards: Card[];
}

export interface JoinTablePayload {
  tableId: string;
}

export interface LeaveTablePayload {
  tableId: string;
}

export interface SetReadyPayload {
  tableId: string;
  ready: boolean;
}

export interface SocketErrorPayload {
  code: string;
  message: string;
}

/**
 * Saldo da conta do jogador, empurrado quando a mesa o altera.
 *
 * O stack do assento já viaja no `TableState`, mas o saldo guardado no cliente
 * (o que o lobby mostra) veio do login e envelheceria a cada mão jogada.
 */
export interface BalanceUpdatedPayload {
  chips: number;
}
