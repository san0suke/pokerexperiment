import { describe, expect, it } from 'vitest';
import { cardToString } from '@poker/shared';
import { MIN_PLAYERS_PER_HAND, pickDealerSeat, startHand } from './hand.js';

const players = (...seats: number[]) => seats.map((seatIndex) => ({ seatIndex, chips: 1000 }));

const start = (seats: number[], previousDealerSeat: number | null = null) =>
  startHand({
    players: players(...seats),
    smallBlind: 5,
    bigBlind: 10,
    previousDealerSeat,
  });

describe('posicionamento do botão', () => {
  it('começa no menor assento ocupado na primeira mão', () => {
    expect(pickDealerSeat([2, 4, 5], null)).toBe(2);
  });

  it('anda uma posição a cada mão, dando a volta na mesa', () => {
    expect(pickDealerSeat([2, 4, 5], 2)).toBe(4);
    expect(pickDealerSeat([2, 4, 5], 5)).toBe(2);
  });

  it('pula o assento vago quando o dealer anterior saiu da mesa', () => {
    expect(pickDealerSeat([0, 4], 2)).toBe(4);
  });
});

describe('blinds', () => {
  it('no heads-up o dealer é o small blind', () => {
    const hand = start([0, 3]);

    expect(hand.dealerSeat).toBe(0);
    expect(hand.smallBlindSeat).toBe(0);
    expect(hand.bigBlindSeat).toBe(3);
  });

  it('com três ou mais o small blind é o assento seguinte ao botão', () => {
    const hand = start([0, 3, 5]);

    expect(hand.dealerSeat).toBe(0);
    expect(hand.smallBlindSeat).toBe(3);
    expect(hand.bigBlindSeat).toBe(5);
  });

  it('desconta os blinds do stack e monta o pote', () => {
    const hand = start([0, 3, 5]);

    expect(hand.chips.get(3)).toBe(995);
    expect(hand.chips.get(5)).toBe(990);
    expect(hand.chips.get(0)).toBe(1000);
    expect(hand.committed.get(3)).toBe(5);
    expect(hand.committed.get(5)).toBe(10);
    expect(hand.pot).toBe(15);
  });

  it('stack menor que o blind entra pelo que tem, sem ficar negativo', () => {
    const hand = startHand({
      players: [
        { seatIndex: 0, chips: 1000 },
        { seatIndex: 1, chips: 4 },
      ],
      smallBlind: 5,
      bigBlind: 10,
      previousDealerSeat: null,
    });

    expect(hand.chips.get(1)).toBe(0);
    expect(hand.committed.get(1)).toBe(4);
    expect(hand.pot).toBe(9);
  });
});

describe('mãos consecutivas', () => {
  /** Encadeia mãos passando o dealer da anterior, como o registry faz. */
  const playHands = (seats: number[], count: number) => {
    const history = [];
    let previousDealerSeat: number | null = null;
    for (let i = 0; i < count; i += 1) {
      const hand = start(seats, previousDealerSeat);
      previousDealerSeat = hand.dealerSeat;
      history.push(hand);
    }
    return history;
  };

  it('gira os blinds a cada nova mão', () => {
    const [first, second, third] = playHands([0, 2, 4], 3);

    expect([first.smallBlindSeat, first.bigBlindSeat]).toEqual([2, 4]);
    expect([second.smallBlindSeat, second.bigBlindSeat]).toEqual([4, 0]);
    expect([third.smallBlindSeat, third.bigBlindSeat]).toEqual([0, 2]);
  });

  it('no heads-up os dois se revezam entre small e big blind', () => {
    const [first, second, third] = playHands([1, 3], 3);

    expect([first.smallBlindSeat, first.bigBlindSeat]).toEqual([1, 3]);
    expect([second.smallBlindSeat, second.bigBlindSeat]).toEqual([3, 1]);
    // Volta ao começo: em duas mãos cada um pagou um blind de cada.
    expect([third.smallBlindSeat, third.bigBlindSeat]).toEqual([1, 3]);
  });

  it('cobra os blinds de novo em cada mão, sem acumular do anterior', () => {
    const [, second] = playHands([0, 2, 4], 2);

    expect(second.committed.get(second.smallBlindSeat)).toBe(5);
    expect(second.committed.get(second.bigBlindSeat)).toBe(10);
    expect(second.pot).toBe(15);
  });
});

describe('distribuição', () => {
  it('dá duas cartas para cada jogador, todas diferentes', () => {
    const hand = start([0, 1, 2, 3]);

    const dealt = [...hand.holeCards.values()];
    expect(dealt).toHaveLength(4);
    expect(dealt.every((cards) => cards.length === 2)).toBe(true);

    const distinct = new Set(dealt.flat().map(cardToString));
    expect(distinct.size).toBe(8);
  });

  it('recusa mesa com menos de dois jogadores', () => {
    expect(() => start([2])).toThrow(/pelo menos/);
    expect(MIN_PLAYERS_PER_HAND).toBe(2);
  });
});
