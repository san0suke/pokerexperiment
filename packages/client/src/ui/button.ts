import Phaser from 'phaser';
import { MIN_TOUCH_SIZE, dp, px, space, type Layout } from './layout.js';

export type ButtonVariant = 'primary' | 'ghost' | 'disabled';

export interface ButtonConfig {
  label: string;
  x: number;
  y: number;
  /** Medidas da tela: o botão desenha em unidades do canvas, como as cenas. */
  layout: Layout;
  /** Tamanho da fonte em pixels de CSS, antes da escala do `Layout`. */
  fontSize?: number;
  /** 0 = alinha pela esquerda, 0.5 = pelo centro, 1 = pela direita. */
  anchorX?: number;
  anchorY?: number;
  minWidth?: number;
  variant?: ButtonVariant;
  onClick?: () => void;
}

interface Palette {
  fill: number;
  fillAlpha: number;
  stroke: number;
  text: string;
}

const PALETTES: Record<ButtonVariant, Palette> = {
  primary: { fill: 0xf5d47a, fillAlpha: 1, stroke: 0xf5d47a, text: '#0b3d2e' },
  ghost: { fill: 0xffffff, fillAlpha: 0.1, stroke: 0x5f8c7c, text: '#e6f4ee' },
  disabled: { fill: 0xffffff, fillAlpha: 0.05, stroke: 0x3b5c50, text: '#7d9c90' },
};

/**
 * Botão de toque. Existe porque um `Text` interativo vira um alvo de poucos
 * pixels no celular: aqui o retângulo garante os 44px de CSS mínimos de altura
 * e uma área clicável folgada em volta do rótulo, em qualquer orientação.
 *
 * O container é posicionado em (x, y) e desenhado a partir das âncoras, então
 * dá para encostá-lo no canto direito sem medir o texto antes.
 */
export function createButton(
  scene: Phaser.Scene,
  config: ButtonConfig,
): Phaser.GameObjects.Container {
  const {
    label,
    x,
    y,
    layout,
    anchorX = 0,
    anchorY = 0,
    minWidth = 0,
    variant = 'ghost',
    onClick,
  } = config;

  const palette = PALETTES[variant];
  const fontSize = px(layout, config.fontSize ?? 18, 13);
  const paddingX = space(layout, 18, 12);
  const height = Math.max(dp(layout, MIN_TOUCH_SIZE), Math.round(fontSize * 2.4));
  const strokeWidth = dp(layout, 2);

  const text = scene.add
    .text(0, 0, label, { fontSize: `${fontSize}px`, color: palette.text, fontStyle: 'bold' })
    .setOrigin(0.5);

  const width = Math.max(minWidth, Math.round(text.width + paddingX * 2));
  const left = -width * anchorX;
  const top = -height * anchorY;
  const radius = Math.round(height / 3);

  const background = scene.add.graphics();
  background.fillStyle(palette.fill, palette.fillAlpha);
  background.fillRoundedRect(left, top, width, height, radius);
  background.lineStyle(strokeWidth, palette.stroke, variant === 'primary' ? 1 : 0.7);
  background.strokeRoundedRect(left, top, width, height, radius);

  text.setPosition(left + width / 2, top + height / 2);

  const container = scene.add.container(x, y, [background, text]);
  container.setSize(width, height);

  if (onClick && variant !== 'disabled') {
    container.setInteractive({
      // O Phaser soma o `displayOrigin` do container — metade do tamanho, porque
      // container é tratado como centrado — ao ponto local antes de testar a
      // hitArea. Então o retângulo precisa vir somado do mesmo tanto: informar as
      // mesmas coordenadas do desenho deixa a área clicável meio botão acima e à
      // esquerda dele, e no celular ela sai de cima do botão por completo.
      hitArea: new Phaser.Geom.Rectangle(left + width / 2, top + height / 2, width, height),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    container.on('pointerup', onClick);
  }

  return container;
}
