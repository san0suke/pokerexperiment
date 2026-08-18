import { Card, Rank } from '../cards/card.js';
import { HandRank } from './hand-rank.js';

export interface HandResult {
  rank: HandRank;
  /** Tie-break values in descending priority order. */
  kickers: Rank[];
  /** The best 5 cards that produced this result. */
  cards: Card[];
}

function combinations<T>(items: T[], size: number): T[][] {
  const results: T[][] = [];
  const combo: T[] = [];

  function build(start: number): void {
    if (combo.length === size) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      combo.push(items[i]);
      build(i + 1);
      combo.pop();
    }
  }

  build(0);
  return results;
}

function evaluateFiveCardHand(cards: Card[]): HandResult {
  const ranksDesc = cards.map((c) => c.rank).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);

  const uniqueRanksDesc = Array.from(new Set(ranksDesc)).sort((a, b) => b - a);
  let straightHigh: Rank | null = null;
  if (uniqueRanksDesc.length === 5) {
    if (uniqueRanksDesc[0] - uniqueRanksDesc[4] === 4) {
      straightHigh = uniqueRanksDesc[0];
    } else if (
      uniqueRanksDesc[0] === Rank.Ace &&
      uniqueRanksDesc[1] === 5 &&
      uniqueRanksDesc[2] === 4 &&
      uniqueRanksDesc[3] === 3 &&
      uniqueRanksDesc[4] === 2
    ) {
      // Ace-low straight (the "wheel"): A-2-3-4-5, Five is the effective high card.
      straightHigh = 5 as Rank;
    }
  }

  const countByRank = new Map<Rank, number>();
  for (const rank of ranksDesc) {
    countByRank.set(rank, (countByRank.get(rank) ?? 0) + 1);
  }
  const groups = Array.from(countByRank.entries()).sort(
    (a, b) => b[1] - a[1] || b[0] - a[0],
  );
  const counts = groups.map(([, count]) => count);

  if (isFlush && straightHigh !== null) {
    if (straightHigh === Rank.Ace) {
      return { rank: HandRank.RoyalFlush, kickers: [Rank.Ace], cards };
    }
    return { rank: HandRank.StraightFlush, kickers: [straightHigh], cards };
  }
  if (counts[0] === 4) {
    const [four] = groups[0];
    const [kicker] = groups[1];
    return { rank: HandRank.FourOfAKind, kickers: [four, kicker], cards };
  }
  if (counts[0] === 3 && counts[1] === 2) {
    return { rank: HandRank.FullHouse, kickers: [groups[0][0], groups[1][0]], cards };
  }
  if (isFlush) {
    return { rank: HandRank.Flush, kickers: ranksDesc, cards };
  }
  if (straightHigh !== null) {
    return { rank: HandRank.Straight, kickers: [straightHigh], cards };
  }
  if (counts[0] === 3) {
    const [trips] = groups[0];
    const kickers = groups.slice(1).map(([rank]) => rank);
    return { rank: HandRank.ThreeOfAKind, kickers: [trips, ...kickers], cards };
  }
  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    const [kicker] = groups[2];
    return { rank: HandRank.TwoPair, kickers: [...pairs, kicker], cards };
  }
  if (counts[0] === 2) {
    const [pair] = groups[0];
    const kickers = groups.slice(1).map(([rank]) => rank);
    return { rank: HandRank.Pair, kickers: [pair, ...kickers], cards };
  }
  return { rank: HandRank.HighCard, kickers: ranksDesc, cards };
}

/** Finds the best possible 5-card hand out of 5-7 cards (hole cards + community cards). */
export function evaluateHand(cards: Card[]): HandResult {
  if (cards.length < 5) {
    throw new Error('Need at least 5 cards to evaluate a hand');
  }
  if (cards.length === 5) {
    return evaluateFiveCardHand(cards);
  }

  let best: HandResult | null = null;
  for (const combo of combinations(cards, 5)) {
    const result = evaluateFiveCardHand(combo);
    if (!best || compareHands(result, best) > 0) {
      best = result;
    }
  }
  return best as HandResult;
}

/** Returns >0 if `a` beats `b`, <0 if `b` beats `a`, 0 if it's a tie. */
export function compareHands(a: HandResult, b: HandResult): number {
  if (a.rank !== b.rank) {
    return a.rank - b.rank;
  }
  const length = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < length; i++) {
    const diff = (a.kickers[i] ?? 0) - (b.kickers[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
