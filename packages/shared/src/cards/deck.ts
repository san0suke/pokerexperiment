import { Card, Rank, Suit, createCard } from './card.js';

export class Deck {
  private cards: Card[];

  constructor() {
    this.cards = Deck.freshCards();
  }

  private static freshCards(): Card[] {
    const cards: Card[] = [];
    for (const suit of Object.values(Suit)) {
      for (const rank of Object.values(Rank).filter(
        (value): value is Rank => typeof value === 'number',
      )) {
        cards.push(createCard(suit, rank));
      }
    }
    return cards;
  }

  /** Fisher-Yates shuffle. Pass `random` (e.g. a crypto-backed RNG) to control fairness on the server. */
  shuffle(random: () => number = Math.random): this {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    return this;
  }

  draw(count: number): Card[] {
    if (count > this.cards.length) {
      throw new Error(`Cannot draw ${count} cards, only ${this.cards.length} remain`);
    }
    return this.cards.splice(0, count);
  }

  get remaining(): number {
    return this.cards.length;
  }
}
