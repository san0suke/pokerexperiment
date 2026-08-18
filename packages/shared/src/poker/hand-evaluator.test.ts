import { describe, expect, it } from 'vitest';
import { Card, Rank, Suit, createCard } from '../cards/card.js';
import { HandRank } from './hand-rank.js';
import { compareHands, evaluateHand } from './hand-evaluator.js';

const rankByLetter: Record<string, Rank> = {
  '2': Rank.Two,
  '3': Rank.Three,
  '4': Rank.Four,
  '5': Rank.Five,
  '6': Rank.Six,
  '7': Rank.Seven,
  '8': Rank.Eight,
  '9': Rank.Nine,
  T: Rank.Ten,
  J: Rank.Jack,
  Q: Rank.Queen,
  K: Rank.King,
  A: Rank.Ace,
};

const suitByLetter: Record<string, Suit> = {
  c: Suit.Clubs,
  d: Suit.Diamonds,
  h: Suit.Hearts,
  s: Suit.Spades,
};

/** Parses shorthand like "As Kd Qh Jc Ts" into cards. */
function hand(notation: string): Card[] {
  return notation
    .trim()
    .split(/\s+/)
    .map((token) => createCard(suitByLetter[token[1]], rankByLetter[token[0]]));
}

describe('evaluateHand — categories', () => {
  it('detects a royal flush', () => {
    expect(evaluateHand(hand('As Ks Qs Js Ts')).rank).toBe(HandRank.RoyalFlush);
  });

  it('detects a straight flush', () => {
    expect(evaluateHand(hand('9h 8h 7h 6h 5h')).rank).toBe(HandRank.StraightFlush);
  });

  it('detects a steel wheel (ace-low straight flush)', () => {
    const result = evaluateHand(hand('Ad 5d 4d 3d 2d'));
    expect(result.rank).toBe(HandRank.StraightFlush);
    expect(result.kickers[0]).toBe(Rank.Five);
  });

  it('detects four of a kind', () => {
    const result = evaluateHand(hand('7c 7d 7h 7s Kc'));
    expect(result.rank).toBe(HandRank.FourOfAKind);
    expect(result.kickers).toEqual([Rank.Seven, Rank.King]);
  });

  it('detects a full house', () => {
    const result = evaluateHand(hand('Qc Qd Qh 4s 4c'));
    expect(result.rank).toBe(HandRank.FullHouse);
    expect(result.kickers).toEqual([Rank.Queen, Rank.Four]);
  });

  it('detects a flush', () => {
    expect(evaluateHand(hand('Ac Jc 9c 6c 3c')).rank).toBe(HandRank.Flush);
  });

  it('detects a straight', () => {
    const result = evaluateHand(hand('9c 8d 7h 6s 5c'));
    expect(result.rank).toBe(HandRank.Straight);
    expect(result.kickers[0]).toBe(Rank.Nine);
  });

  it('detects an ace-low straight (the wheel) with Five as the high card', () => {
    const result = evaluateHand(hand('Ac 5d 4h 3s 2c'));
    expect(result.rank).toBe(HandRank.Straight);
    expect(result.kickers[0]).toBe(Rank.Five);
  });

  it('does not treat a wrap-around like Q-K-A-2-3 as a straight', () => {
    expect(evaluateHand(hand('Qc Kd Ah 2s 3c')).rank).toBe(HandRank.HighCard);
  });

  it('detects three of a kind', () => {
    const result = evaluateHand(hand('5c 5d 5h Ks 2c'));
    expect(result.rank).toBe(HandRank.ThreeOfAKind);
    expect(result.kickers).toEqual([Rank.Five, Rank.King, Rank.Two]);
  });

  it('detects two pair', () => {
    const result = evaluateHand(hand('Jc Jd 4h 4s 9c'));
    expect(result.rank).toBe(HandRank.TwoPair);
    expect(result.kickers).toEqual([Rank.Jack, Rank.Four, Rank.Nine]);
  });

  it('detects a pair', () => {
    const result = evaluateHand(hand('8c 8d Ah 6s 2c'));
    expect(result.rank).toBe(HandRank.Pair);
    expect(result.kickers).toEqual([Rank.Eight, Rank.Ace, Rank.Six, Rank.Two]);
  });

  it('detects high card', () => {
    const result = evaluateHand(hand('Ac Jd 9h 6s 3c'));
    expect(result.rank).toBe(HandRank.HighCard);
    expect(result.kickers).toEqual([Rank.Ace, Rank.Jack, Rank.Nine, Rank.Six, Rank.Three]);
  });
});

describe('evaluateHand — best 5 of 7', () => {
  it('picks the flush hiding in 7 cards', () => {
    const result = evaluateHand(hand('2h 5h 9h Kh 3h 7c 8d'));
    expect(result.rank).toBe(HandRank.Flush);
    expect(result.cards.every((c) => c.suit === Suit.Hearts)).toBe(true);
  });

  it('prefers a full house over a flush draw that never completes', () => {
    const result = evaluateHand(hand('Kc Kd Ks 4h 4c 9h 2s'));
    expect(result.rank).toBe(HandRank.FullHouse);
  });

  it('prefers the straight flush over the plain flush in the same suit', () => {
    const result = evaluateHand(hand('9s 8s 7s 6s 5s As Kd'));
    expect(result.rank).toBe(HandRank.StraightFlush);
    expect(result.kickers[0]).toBe(Rank.Nine);
  });

  it('picks the best two pair when three pairs are present', () => {
    const result = evaluateHand(hand('Ac Ad 9h 9s 4c 4d Kh'));
    expect(result.rank).toBe(HandRank.TwoPair);
    expect(result.kickers).toEqual([Rank.Ace, Rank.Nine, Rank.King]);
  });
});

describe('compareHands', () => {
  it('ranks a higher category above a lower one', () => {
    const flush = evaluateHand(hand('Ac Jc 9c 6c 3c'));
    const straight = evaluateHand(hand('9c 8d 7h 6s 5c'));
    expect(compareHands(flush, straight)).toBeGreaterThan(0);
  });

  it('breaks a four-of-a-kind tie by the quad rank', () => {
    const higher = evaluateHand(hand('9c 9d 9h 9s 2c'));
    const lower = evaluateHand(hand('7c 7d 7h 7s Ac'));
    expect(compareHands(higher, lower)).toBeGreaterThan(0);
  });

  it('breaks a pair tie by kicker', () => {
    const higher = evaluateHand(hand('8c 8d Ah 6s 2c'));
    const lower = evaluateHand(hand('8h 8s Kh 6d 2d'));
    expect(compareHands(higher, lower)).toBeGreaterThan(0);
  });

  it('breaks a two-pair tie by the lower pair before the kicker', () => {
    const higher = evaluateHand(hand('Kc Kd 9h 9s 2c'));
    const lower = evaluateHand(hand('Kh Ks 8h 8s Ac'));
    expect(compareHands(higher, lower)).toBeGreaterThan(0);
  });

  it('treats identical hands in different suits as a tie', () => {
    const a = evaluateHand(hand('Ac Kd Qh Js 9c'));
    const b = evaluateHand(hand('Ad Kh Qs Jc 9d'));
    expect(compareHands(a, b)).toBe(0);
  });

  it('ranks a king-high flush above a queen-high flush', () => {
    const higher = evaluateHand(hand('Kc Jc 9c 6c 3c'));
    const lower = evaluateHand(hand('Qd Jd 9d 6d 3d'));
    expect(compareHands(higher, lower)).toBeGreaterThan(0);
  });

  it('ranks a wheel below every other straight', () => {
    const wheel = evaluateHand(hand('Ac 5d 4h 3s 2c'));
    const sixHigh = evaluateHand(hand('6c 5h 4d 3c 2h'));
    expect(compareHands(wheel, sixHigh)).toBeLessThan(0);
  });
});
