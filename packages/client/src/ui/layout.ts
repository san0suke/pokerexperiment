import type Phaser from 'phaser';

/**
 * Medidas da tela usadas por todas as cenas.
 *
 * O canvas tem exatamente a área visível, mas **em pixels do aparelho**: o jogo
 * roda com o tamanho multiplicado pela densidade da tela e o CSS o encolhe de
 * volta (`services/canvas-scale.ts`), senão o navegador amplia uma imagem menor
 * que a tela e tudo sai borrado. Não existe resolução de projeto fixa: cada cena
 * pergunta as medidas aqui e se desenha em cima delas, em retrato ou paisagem.
 *
 * Consequência para quem desenha: `width`, `height` e todos os espaçamentos daqui
 * já vêm em unidades do canvas. Números crus pensados em pixels de CSS — um piso
 * de 44px de toque, um limite de 600px de largura — passam por `dp()` antes de
 * serem comparados ou somados a qualquer medida.
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
  /** Multiplicador de fontes e controles, já com a densidade da tela embutida. */
  ui: number;
  /** Unidades do canvas por pixel de CSS (densidade da tela). */
  dpr: number;
  /** Margem lateral, já somada ao recorte do aparelho (notch em paisagem). */
  padX: number;
  padTop: number;
  padBottom: number;
  safe: SafeInsets;
}

/** Lado menor de referência, em pixels de CSS: a interface encolhe a partir daí. */
const REFERENCE_MIN_SIDE = 720;
/** Área mínima de toque recomendada em celulares, em pixels de CSS. */
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
  // `displaySize` é o tamanho do canvas no CSS e `width` o do desenho: a razão
  // entre os dois é a densidade. Medida daqui em vez de `devicePixelRatio` para
  // que o layout continue certo se o modo de escala mudar (em `RESIZE` os dois
  // são iguais e tudo volta a ser pixel de CSS).
  const dpr = scale.displaySize.width > 0 ? scale.width / scale.displaySize.width : 1;
  const width = Math.round(scale.width);
  const height = Math.round(scale.height);
  const cssInsets = readSafeInsets();
  const safe: SafeInsets = {
    top: Math.round(cssInsets.top * dpr),
    right: Math.round(cssInsets.right * dpr),
    bottom: Math.round(cssInsets.bottom * dpr),
    left: Math.round(cssInsets.left * dpr),
  };

  // Margem lateral simétrica: mantém o conteúdo centralizado mesmo quando só um
  // dos lados tem recorte (celular deitado com o notch à esquerda).
  const sideInset = Math.max(safe.left, safe.right);
  const minSide = Math.min(width, height);
  const gutter = clamp(Math.round(minSide * 0.045), 12 * dpr, 40 * dpr);

  return {
    width,
    height,
    portrait: height >= width,
    short: height / dpr < 480,
    ui: clamp(minSide / dpr / REFERENCE_MIN_SIDE, 0.7, 1.15) * dpr,
    dpr,
    padX: Math.round(gutter + sideInset),
    padTop: Math.round(clamp(Math.round(height * 0.03), 10 * dpr, 32 * dpr) + safe.top),
    padBottom: Math.round(clamp(Math.round(height * 0.03), 10 * dpr, 32 * dpr) + safe.bottom),
    safe,
  };
}

/**
 * Uma medida pensada em pixels de CSS, convertida para unidades do canvas. Use
 * em todo número cru que vem de fora do `Layout`: pisos de tamanho, limites de
 * largura, espessura de traço.
 */
export function dp(layout: Layout, value: number): number {
  return Math.round(value * layout.dpr);
}

/** Tamanho de fonte proporcional, com piso para não ficar ilegível no celular. */
export function px(layout: Layout, base: number, min = 12): number {
  return Math.round(Math.max(min * layout.dpr, base * layout.ui));
}

/** Espaçamento proporcional. */
export function space(layout: Layout, base: number, min = 4): number {
  return Math.round(Math.max(min * layout.dpr, base * layout.ui));
}
