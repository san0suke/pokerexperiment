export enum HandRank {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

/** Nome de cada jogada para mostrar no showdown. */
export const HAND_RANK_LABELS: Record<HandRank, string> = {
  [HandRank.HighCard]: 'Carta alta',
  [HandRank.Pair]: 'Um par',
  [HandRank.TwoPair]: 'Dois pares',
  [HandRank.ThreeOfAKind]: 'Trinca',
  [HandRank.Straight]: 'Sequência',
  [HandRank.Flush]: 'Flush',
  [HandRank.FullHouse]: 'Full house',
  [HandRank.FourOfAKind]: 'Quadra',
  [HandRank.StraightFlush]: 'Straight flush',
  [HandRank.RoyalFlush]: 'Royal flush',
};
