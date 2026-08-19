import type Phaser from 'phaser';

/**
 * Medidas da tela usadas por todas as cenas.
 *
 * O jogo roda com `Scale.RESIZE`, ou seja, o canvas tem exatamente o tamanho da
 * área visível em pixels de CSS. Não existe mais uma resolução de projeto fixa:
 * cada cena pergunta as medidas aqui e se desenha em cima delas, tanto em
 * retrato quanto em paisagem.
 */
export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Layout {
  width: number;
  height: number;
  /** Altura maior ou igual à largura — celular em pé. */
  portrait: boolean;
  /** Tela baixa (celular deitado, ou teclado aberto): sobra pouca altura. */
  short: boolean;
  /** Multiplicador de fontes e controles. 1 = desktop. */
  ui: number;
  /** Margem lateral, já somada ao recorte do aparelho (notch em paisagem). */
  padX: number;
  padTop: number;
  padBottom: number;
  safe: SafeInsets;
}

/** Lado menor de referência: a partir dele a interface encolhe proporcionalmente. */
const REFERENCE_MIN_SIDE = 720;
/** Área mínima de toque recomendada em celulares. */
export const MIN_TOUCH_SIZE = 44;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

let insetProbe: HTMLElement | null = null;

/**
 * `env(safe-area-inset-*)` só existe no CSS. Como o canvas ocupa a tela inteira,
 * inclusive por baixo do notch e da barra de gestos, medimos os recortes com um
 * elemento invisível e usamos os valores no posicionamento do Phaser.
 */
function readSafeInsets(): SafeInsets {
  if (typeof document === 'undefined') {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  if (!insetProbe) {
    insetProbe = document.createElement('div');
    insetProbe.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:0',
      'height:0',
      'visibility:hidden',
      'pointer-events:none',
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)',
    ].join(';');
    document.body.appendChild(insetProbe);
  }

  const style = getComputedStyle(insetProbe);
  return {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
}

export function readLayout(scale: Phaser.Scale.ScaleManager): Layout {
  const width = Math.round(scale.width);
  const height = Math.round(scale.height);
  const safe = readSafeInsets();

  // Margem lateral simétrica: mantém o conteúdo centralizado mesmo quando só um
  // dos lados tem recorte (celular deitado com o notch à esquerda).
  const sideInset = Math.max(safe.left, safe.right);
  const gutter = clamp(Math.round(Math.min(width, height) * 0.045), 12, 40);

  return {
    width,
    height,
    portrait: height >= width,
    short: height < 480,
    ui: clamp(Math.min(width, height) / REFERENCE_MIN_SIDE, 0.7, 1.15),
    padX: gutter + sideInset,
    padTop: clamp(Math.round(height * 0.03), 10, 32) + safe.top,
    padBottom: clamp(Math.round(height * 0.03), 10, 32) + safe.bottom,
    safe,
  };
}

/** Tamanho de fonte proporcional, com piso para não ficar ilegível no celular. */
export function px(layout: Layout, base: number, min = 12): number {
  return Math.max(min, Math.round(base * layout.ui));
}

/** Espaçamento proporcional. */
export function space(layout: Layout, base: number, min = 4): number {
  return Math.max(min, Math.round(base * layout.ui));
}
