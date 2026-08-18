export enum Suit {
  Clubs = 'clubs',
  Diamonds = 'diamonds',
  Hearts = 'hearts',
  Spades = 'spades',
}

/** Numeric value, Ace high (14). Straight evaluation handles the Ace-low (wheel) case separately. */
export enum Rank {
  Two = 2,
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
  Nine = 9,
  Ten = 10,
  Jack = 11,
  Queen = 12,
  King = 13,
  Ace = 14,
}

export interface Card {
  suit: Suit;
  rank: Rank;
}

export function createCard(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

export function cardToString(card: Card): string {
  const rankLabels: Record<Rank, string> = {
    [Rank.Two]: '2',
    [Rank.Three]: '3',
    [Rank.Four]: '4',
    [Rank.Five]: '5',
    [Rank.Six]: '6',
    [Rank.Seven]: '7',
    [Rank.Eight]: '8',
    [Rank.Nine]: '9',
    [Rank.Ten]: 'T',
    [Rank.Jack]: 'J',
    [Rank.Queen]: 'Q',
    [Rank.King]: 'K',
    [Rank.Ace]: 'A',
  };
  const suitLabels: Record<Suit, string> = {
    [Suit.Clubs]: 'c',
    [Suit.Diamonds]: 'd',
    [Suit.Hearts]: 'h',
    [Suit.Spades]: 's',
  };
  return `${rankLabels[card.rank]}${suitLabels[card.suit]}`;
}
