import { Deck, type Card } from '@poker/shared';

/** Menos que isso não é mão de poker — é alguém sozinho pagando blind. */
export const MIN_PLAYERS_PER_HAND = 2;

export interface HandCandidate {
  seatIndex: number;
  chips: number;
}

export interface StartHandOptions {
  players: HandCandidate[];
  smallBlind: number;
  bigBlind: number;
  /** Dealer da mão anterior, para o botão girar. `null` na primeira mão da mesa. */
  previousDealerSeat: number | null;
  random?: () => number;
}

export interface StartedHand {
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  /** Blinds já recolhidos. */
  pot: number;
  /** seatIndex -> quanto o assento colocou no pote. */
  committed: Map<number, number>;
  /** seatIndex -> stack depois de pagar o blind. */
  chips: Map<number, number>;
  /** seatIndex -> as duas cartas fechadas. Nunca entra no estado público da mesa. */
  holeCards: Map<number, Card[]>;
  /** O mesmo baralho, já sem as hole cards: o flop, o turn e o river saem daqui. */
  deck: Deck;
}

/** Próximo assento ocupado no sentido horário, dando a volta no fim da lista. */
function nextSeat(seats: number[], from: number): number {
  return seats.find((seat) => seat > from) ?? seats[0];
}

/** Primeira mão começa no menor assento ocupado; depois o botão anda uma posição. */
export function pickDealerSeat(seats: number[], previousDealerSeat: number | null): number {
  if (previousDealerSeat === null) {
    return seats[0];
  }
  return nextSeat(seats, previousDealerSeat);
}

/** Ordem de distribuição: começa à esquerda do botão, como na mesa real. */
function dealOrder(seats: number[], firstSeat: number): number[] {
  const start = seats.indexOf(firstSeat);
  return [...seats.slice(start), ...seats.slice(0, start)];
}

/**
 * Monta o começo de uma mão: posiciona o botão, cobra os blinds e distribui as
 * hole cards. Função pura (fora o `random`) para dar para testar a rotação do
 * dealer e a regra de heads-up sem subir socket nenhum.
 */
export function startHand(options: StartHandOptions): StartedHand {
  const { smallBlind, bigBlind, previousDealerSeat, random } = options;

  const players = [...options.players].sort((a, b) => a.seatIndex - b.seatIndex);
  if (players.length < MIN_PLAYERS_PER_HAND) {
    throw new Error(`Uma mão precisa de pelo menos ${MIN_PLAYERS_PER_HAND} jogadores`);
  }

  const seats = players.map((player) => player.seatIndex);
  const dealerSeat = pickDealerSeat(seats, previousDealerSeat);

  // Heads-up inverte os blinds: com dois jogadores o próprio dealer é o small
  // blind (e age primeiro no pré-flop). Aplicar a regra geral aqui faria o botão
  // pagar big blind e agir por último nas duas rodadas.
  const smallBlindSeat = seats.length === 2 ? dealerSeat : nextSeat(seats, dealerSeat);
  const bigBlindSeat = nextSeat(seats, smallBlindSeat);

  const chips = new Map(players.map((player) => [player.seatIndex, player.chips]));
  const committed = new Map(seats.map((seat) => [seat, 0]));

  // Stack menor que o blind entra all-in pelo que tem, em vez de ficar negativo.
  const postBlind = (seat: number, amount: number): number => {
    const available = chips.get(seat) ?? 0;
    const paid = Math.min(amount, available);
    chips.set(seat, available - paid);
    committed.set(seat, (committed.get(seat) ?? 0) + paid);
    return paid;
  };

  const pot = postBlind(smallBlindSeat, smallBlind) + postBlind(bigBlindSeat, bigBlind);

  const deck = new Deck().shuffle(random);
  const order = dealOrder(seats, smallBlindSeat);
  const holeCards = new Map<number, Card[]>(order.map((seat) => [seat, []]));
  for (let round = 0; round < 2; round += 1) {
    for (const seat of order) {
      holeCards.get(seat)!.push(deck.draw(1)[0]);
    }
  }

  return { dealerSeat, smallBlindSeat, bigBlindSeat, pot, committed, chips, holeCards, deck };
}
