import Phaser from 'phaser';
import { Rank, Suit, type Card } from '@poker/shared';

const RANK_LABELS: Record<Rank, string> = {
  [Rank.Two]: '2',
  [Rank.Three]: '3',
  [Rank.Four]: '4',
  [Rank.Five]: '5',
  [Rank.Six]: '6',
  [Rank.Seven]: '7',
  [Rank.Eight]: '8',
  [Rank.Nine]: '9',
  [Rank.Ten]: '10',
  [Rank.Jack]: 'J',
  [Rank.Queen]: 'Q',
  [Rank.King]: 'K',
  [Rank.Ace]: 'A',
};

const SUIT_LABELS: Record<Suit, string> = {
  [Suit.Clubs]: '♣',
  [Suit.Diamonds]: '♦',
  [Suit.Hearts]: '♥',
  [Suit.Spades]: '♠',
};

const RED_SUITS = new Set<Suit>([Suit.Diamonds, Suit.Hearts]);

/** Proporção de baralho de verdade (63x88mm), arredondada. */
export const CARD_ASPECT = 1.4;

export interface CardFaceConfig {
  /** `null` desenha o verso — o cliente nunca recebe a carta do adversário. */
  card: Card | null;
  x: number;
  y: number;
  width: number;
}

/**
 * Uma carta desenhada com formas do Phaser, sem sprite: o jogo ainda não carrega
 * atlas, e um baralho vetorial escala bem em qualquer densidade de tela.
 *
 * O container é centrado em (x, y) e tem `width x width * CARD_ASPECT`.
 */
export function createCardFace(
  scene: Phaser.Scene,
  config: CardFaceConfig,
): Phaser.GameObjects.Container {
  const { card, x, y, width } = config;
  const height = Math.round(width * CARD_ASPECT);
  const radius = Math.max(2, Math.round(width * 0.12));
  // Traço proporcional à carta: `width` vem em unidades do canvas, então uma
  // espessura fixa sumiria nas telas de densidade alta.
  const stroke = Math.max(1, Math.round(width * 0.035));
  const left = -width / 2;
  const top = -height / 2;

  const background = scene.add.graphics();
  if (card) {
    background.fillStyle(0xfdfbf5, 1);
    background.fillRoundedRect(left, top, width, height, radius);
    background.lineStyle(stroke, 0x1b1b1b, 0.35);
    background.strokeRoundedRect(left, top, width, height, radius);
  } else {
    background.fillStyle(0x1d3f8f, 1);
    background.fillRoundedRect(left, top, width, height, radius);
    background.lineStyle(stroke, 0xf5d47a, 0.8);
    background.strokeRoundedRect(left, top, width, height, radius);
    background.lineStyle(stroke, 0xffffff, 0.18);
    background.strokeRoundedRect(
      left + width * 0.14,
      top + height * 0.1,
      width * 0.72,
      height * 0.8,
      radius / 2,
    );
  }

  const container = scene.add.container(x, y, [background]);
  container.setSize(width, height);

  if (!card) {
    return container;
  }

  const color = RED_SUITS.has(card.suit) ? '#c62828' : '#1b1b1b';

  const rank = scene.add
    .text(0, -height * 0.18, RANK_LABELS[card.rank], {
      fontSize: `${Math.round(width * 0.52)}px`,
      fontStyle: 'bold',
      color,
    })
    .setOrigin(0.5);

  const suit = scene.add
    .text(0, height * 0.24, SUIT_LABELS[card.suit], {
      fontSize: `${Math.round(width * 0.44)}px`,
      color,
    })
    .setOrigin(0.5);

  container.add([rank, suit]);
  return container;
}
