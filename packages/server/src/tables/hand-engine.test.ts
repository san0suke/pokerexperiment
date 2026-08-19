import { describe, expect, it } from 'vitest';
import { Rank, Suit, type Card } from '@poker/shared';
import {
  applyAction,
  createHandRuntime,
  foldSeat,
  legalActions,
  totalPot,
  type HandRuntime,
} from './hand-engine.js';

const SMALL_BLIND = 5;
const BIG_BLIND = 10;

/** Mesa com stacks controlados; o embaralhamento não importa fora do showdown. */
function table(stacks: number[]): HandRuntime {
  return createHandRuntime({
    players: stacks.map((chips, seatIndex) => ({ seatIndex, chips })),
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    previousDealerSeat: null,
    random: () => 0.5,
  });
}

const chipsOf = (hand: HandRuntime, seat: number) => hand.players.get(seat)!.chips;
const totalChips = (hand: HandRuntime) =>
  [...hand.players.values()].reduce((sum, player) => sum + player.chips, 0);

const card = (rank: Rank, suit: Suit): Card => ({ rank, suit });

describe('ordem de ação', () => {
  it('no heads-up o small blind fala primeiro no pré-flop', () => {
    const hand = table([1000, 1000]);
    expect(hand.turnSeat).toBe(hand.smallBlindSeat);
  });

  it('o big blind tem a opção de aumentar mesmo depois do call', () => {
    const hand = table([1000, 1000]);
    applyAction(hand, hand.smallBlindSeat, 'call');

    expect(hand.turnSeat).toBe(hand.bigBlindSeat);
    expect(hand.round).toBe('preflop');
    expect(legalActions(hand, hand.bigBlindSeat)?.canCheck).toBe(true);
  });

  it('com três jogadores a ação abre à esquerda do big blind', () => {
    const hand = table([1000, 1000, 1000]);
    expect(hand.turnSeat).toBe(0);
    expect(hand.dealerSeat).toBe(0);
    expect(hand.bigBlindSeat).toBe(2);
  });

  it('depois do flop quem fala primeiro é o jogador à esquerda do botão', () => {
    const hand = table([1000, 1000]);
    applyAction(hand, hand.smallBlindSeat, 'call');
    applyAction(hand, hand.bigBlindSeat, 'check');

    expect(hand.round).toBe('flop');
    expect(hand.turnSeat).toBe(hand.bigBlindSeat);
  });
});

describe('cartas comunitárias', () => {
  it('o flop abre três cartas e cada rua seguinte abre mais uma', () => {
    const hand = table([1000, 1000]);
    const [sb, bb] = [hand.smallBlindSeat, hand.bigBlindSeat];

    expect(hand.board).toHaveLength(0);

    applyAction(hand, sb, 'call');
    applyAction(hand, bb, 'check');
    expect(hand.round).toBe('flop');
    expect(hand.board).toHaveLength(3);

    applyAction(hand, bb, 'check');
    applyAction(hand, sb, 'check');
    expect(hand.round).toBe('turn');
    expect(hand.board).toHaveLength(4);

    applyAction(hand, bb, 'check');
    applyAction(hand, sb, 'check');
    expect(hand.round).toBe('river');
    expect(hand.board).toHaveLength(5);
  });

  it('nenhuma carta comunitária repete uma hole card', () => {
    const hand = table([1000, 1000]);
    applyAction(hand, hand.smallBlindSeat, 'call');
    applyAction(hand, hand.bigBlindSeat, 'check');

    const dealt = [
      ...hand.board,
      ...[...hand.players.values()].flatMap((player) => player.cards),
    ].map((c) => `${c.rank}-${c.suit}`);

    expect(new Set(dealt).size).toBe(dealt.length);
  });
});

describe('obrigação de cobrir a aposta', () => {
  it('não deixa passar quando há aposta na frente', () => {
    const hand = table([1000, 1000]);
    const result = applyAction(hand, hand.smallBlindSeat, 'check');

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/pague ou desista/);
  });

  it('pagar cobre exatamente a diferença', () => {
    const hand = table([1000, 1000]);
    const sb = hand.smallBlindSeat;
    const before = chipsOf(hand, sb);

    const result = applyAction(hand, sb, 'call');

    expect(result.amount).toBe(SMALL_BLIND);
    expect(chipsOf(hand, sb)).toBe(before - SMALL_BLIND);
    expect(hand.players.get(sb)!.bet).toBe(BIG_BLIND);
  });

  it('desistir entrega o pote para quem sobrou, sem showdown', () => {
    const hand = table([1000, 1000]);
    const sb = hand.smallBlindSeat;
    const bb = hand.bigBlindSeat;

    applyAction(hand, sb, 'fold');

    expect(hand.finished).toBe(true);
    expect(hand.outcome?.showdown).toEqual([]);
    // Os 5 que o small blind não cobriu voltam para o big blind antes da entrega,
    // então o pote entregue é 10 — e o saldo final é o mesmo: +5 para o big blind.
    expect(hand.outcome?.winners).toEqual([{ seatIndex: bb, amount: 10 }]);
    expect(chipsOf(hand, sb)).toBe(995);
    expect(chipsOf(hand, bb)).toBe(1005);
    expect(totalChips(hand)).toBe(2000);
  });
});

describe('aumentos', () => {
  it('exige pelo menos o dobro do big blind no primeiro aumento', () => {
    const hand = table([1000, 1000]);
    const sb = hand.smallBlindSeat;

    expect(legalActions(hand, sb)?.minRaiseTo).toBe(20);
    expect(applyAction(hand, sb, 'raise', 15).ok).toBe(false);
    expect(applyAction(hand, sb, 'raise', 20).ok).toBe(true);
    expect(hand.currentBet).toBe(20);
  });

  it('um aumento reabre a ação para quem já tinha pago', () => {
    const hand = table([1000, 1000, 1000]);
    // 0 paga, 1 (small blind) aumenta: o 0 volta a ter escolha.
    applyAction(hand, 0, 'call');
    applyAction(hand, 1, 'raise', 40);

    expect(hand.turnSeat).toBe(2);
    applyAction(hand, 2, 'fold');
    expect(hand.turnSeat).toBe(0);
    expect(legalActions(hand, 0)?.callAmount).toBe(30);
  });

  it('o aumento seguinte precisa subir pelo menos o tamanho do anterior', () => {
    const hand = table([1000, 1000, 1000]);
    applyAction(hand, 0, 'raise', 40); // aumento de 30 sobre o big blind
    applyAction(hand, 1, 'fold');

    expect(legalActions(hand, 2)?.minRaiseTo).toBe(70);
    expect(applyAction(hand, 2, 'raise', 60).ok).toBe(false);
  });

  it('não deixa aumentar acima do próprio stack', () => {
    const hand = table([1000, 120]);
    const sb = hand.smallBlindSeat;
    const legal = legalActions(hand, sb)!;

    expect(legal.maxRaiseTo).toBe(chipsOf(hand, sb) + hand.players.get(sb)!.bet);
    expect(applyAction(hand, sb, 'raise', legal.maxRaiseTo + 1).ok).toBe(false);
  });
});

describe('all-in', () => {
  it('pagar com stack curto entra all-in pelo que resta', () => {
    const hand = table([1000, 60, 1000]);
    applyAction(hand, 0, 'raise', 400);

    // O assento 1 já pagou o small blind: sobram 55 para cobrir os 400.
    const paid = applyAction(hand, 1, 'call');

    expect(paid.amount).toBe(55);
    expect(chipsOf(hand, 1)).toBe(0);
    expect(hand.players.get(1)!.allIn).toBe(true);
    expect(hand.finished).toBe(false);
  });

  it('quando todos estão all-in o board corre até o river', () => {
    const hand = table([200, 200]);
    applyAction(hand, hand.turnSeat!, 'raise', 200);
    applyAction(hand, hand.turnSeat!, 'call');

    expect(hand.finished).toBe(true);
    expect(hand.board).toHaveLength(5);
    expect(hand.outcome?.showdown).toHaveLength(2);
    expect(totalChips(hand)).toBe(400);
  });

  it('devolve a aposta que ninguém cobriu', () => {
    // O stack curto só consegue pagar 200: os outros 800 voltam para quem apostou.
    const hand = table([1000, 200]);
    const first = hand.turnSeat!;
    applyAction(hand, first, 'raise', 1000);
    const second = hand.turnSeat!;
    applyAction(hand, second, 'call');

    expect(hand.finished).toBe(true);
    expect(hand.outcome!.pot).toBe(400);
    expect(totalChips(hand)).toBe(1200);
  });
});

describe('showdown', () => {
  /**
   * Passa a mão até o river e só então fixa board e cartas — antes disso as ruas
   * seguintes ainda sacam do baralho e sobrescreveriam o cenário.
   */
  function showdownWith(hand: HandRuntime, board: Card[], hands: Record<number, Card[]>): void {
    while (!hand.finished && hand.round !== 'river') {
      applyAction(hand, hand.turnSeat!, hand.turnSeat === hand.smallBlindSeat && hand.round === 'preflop' ? 'call' : 'check');
    }

    hand.board = board;
    for (const [seat, cards] of Object.entries(hands)) {
      hand.players.get(Number(seat))!.cards = cards;
    }

    while (!hand.finished) {
      applyAction(hand, hand.turnSeat!, 'check');
    }
  }

  it('o melhor jogo leva o pote', () => {
    const hand = table([1000, 1000]);

    // 0 tem trinca de ases, 1 tem só um par no board.
    showdownWith(
      hand,
      [
        card(Rank.Ace, Suit.Clubs),
        card(Rank.Ace, Suit.Diamonds),
        card(Rank.Seven, Suit.Spades),
        card(Rank.Four, Suit.Hearts),
        card(Rank.Two, Suit.Clubs),
      ],
      {
        0: [card(Rank.Ace, Suit.Hearts), card(Rank.King, Suit.Spades)],
        1: [card(Rank.Nine, Suit.Hearts), card(Rank.Eight, Suit.Diamonds)],
      },
    );

    expect(hand.outcome?.winners).toEqual([{ seatIndex: 0, amount: 20 }]);
    expect(hand.outcome?.showdown).toHaveLength(2);
    expect(chipsOf(hand, 0)).toBe(1010);
    expect(chipsOf(hand, 1)).toBe(990);
  });

  it('mãos iguais dividem o pote', () => {
    const hand = table([1000, 1000]);

    // Os dois jogam o board: sequência ao ás para ambos.
    showdownWith(
      hand,
      [
        card(Rank.Ace, Suit.Clubs),
        card(Rank.King, Suit.Diamonds),
        card(Rank.Queen, Suit.Spades),
        card(Rank.Jack, Suit.Hearts),
        card(Rank.Ten, Suit.Clubs),
      ],
      {
        0: [card(Rank.Two, Suit.Hearts), card(Rank.Three, Suit.Spades)],
        1: [card(Rank.Two, Suit.Diamonds), card(Rank.Three, Suit.Clubs)],
      },
    );

    expect(hand.outcome?.winners).toHaveLength(2);
    expect(chipsOf(hand, 0)).toBe(1000);
    expect(chipsOf(hand, 1)).toBe(1000);
    expect(totalChips(hand)).toBe(2000);
  });

  it('side pot: o stack curto só disputa até onde pagou', () => {
    const hand = table([1000, 100, 1000]);
    // 0 aumenta forte, 1 vai all-in com o que tem e 2 paga o aumento cheio.
    applyAction(hand, 0, 'raise', 300);
    applyAction(hand, 1, 'call');
    applyAction(hand, 2, 'call');

    // 1 (curto) tem a melhor mão; 2 tem a segunda melhor.
    showdownWith(
      hand,
      [
        card(Rank.Ace, Suit.Clubs),
        card(Rank.King, Suit.Diamonds),
        card(Rank.Seven, Suit.Spades),
        card(Rank.Four, Suit.Hearts),
        card(Rank.Two, Suit.Clubs),
      ],
      {
        0: [card(Rank.Nine, Suit.Diamonds), card(Rank.Eight, Suit.Clubs)],
        1: [card(Rank.Ace, Suit.Hearts), card(Rank.Ace, Suit.Spades)],
        2: [card(Rank.King, Suit.Hearts), card(Rank.King, Suit.Spades)],
      },
    );

    const won = new Map(hand.outcome!.winners.map((w) => [w.seatIndex, w.amount]));
    // Pote principal: 100 de cada um dos três.
    expect(won.get(1)).toBe(300);
    // Side pot: só entre 0 e 2, que apostaram 300.
    expect(won.get(2)).toBe(400);
    expect(totalChips(hand)).toBe(2100);
  });
});

describe('abandono no meio da mão', () => {
  it('sair da mesa é desistir da mão, e o último em pé leva o pote', () => {
    const hand = table([1000, 1000]);
    const bb = hand.bigBlindSeat;

    foldSeat(hand, hand.smallBlindSeat);

    expect(hand.finished).toBe(true);
    expect(hand.outcome?.winners[0].seatIndex).toBe(bb);
    expect(totalChips(hand)).toBe(2000);
  });

  it('sair fora da vez não trava a mesa', () => {
    const hand = table([1000, 1000, 1000]);
    applyAction(hand, 0, 'call');
    // O jogador 2 (big blind) some enquanto a vez é dele mesmo.
    foldSeat(hand, 2);

    expect(hand.finished).toBe(false);
    expect(hand.turnSeat).not.toBeNull();
    expect(totalPot(hand)).toBe(25);
  });
});
