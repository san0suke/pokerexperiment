import Phaser from 'phaser';

/**
 * Mantém o canvas do tamanho da área visível **e** na densidade real da tela.
 *
 * O `Scale.RESIZE` do Phaser dimensiona o canvas em pixels de CSS: num celular
 * com densidade 3, o jogo desenha uma imagem com um terço dos pixels da tela e o
 * navegador a amplia — texto e cartas saem borrados, como se o aparelho fosse de
 * baixa resolução. O mesmo acontece no desktop com o Windows em 125%.
 *
 * Aqui o tamanho é gerenciado na mão: o jogo tem `área visível x densidade`
 * pixels de desenho e o `zoom` do Phaser devolve o canvas ao tamanho certo no
 * CSS. O Phaser converte as coordenadas do ponteiro sozinho a partir do canvas
 * renderizado, então o toque continua caindo onde deve.
 *
 * As cenas continuam ouvindo `Phaser.Scale.Events.RESIZE` — `scale.resize()`
 * emite o mesmo evento — e leem as medidas por `readLayout` (`ui/layout.ts`).
 */

/**
 * Teto da densidade. Acima de 3 o ganho é invisível e a área de desenho cresce
 * ao quadrado; nenhum aparelho atual passa disso de qualquer forma.
 */
const MAX_PIXEL_RATIO = 3;

/**
 * A área que o jogador realmente vê. O `visualViewport` já desconta a barra de
 * endereço e o teclado, pela mesma razão descrita em `viewport-height.ts`.
 */
function readViewport(): { width: number; height: number } {
  const visual = window.visualViewport;
  return {
    width: visual ? visual.width : window.innerWidth,
    height: visual ? visual.height : window.innerHeight,
  };
}

function readPixelRatio(): number {
  return Math.min(MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1));
}

export function trackCanvasScale(game: Phaser.Game): void {
  const apply = (): void => {
    // O Phaser sobe o jogo de forma assíncrona (espera o DOM): antes disso não
    // existe canvas para medir, e o tamanho da configuração já está certo.
    if (!game.isBooted || !game.canvas) {
      return;
    }

    const { width, height } = readViewport();
    const ratio = readPixelRatio();

    // O estilo vem antes do `resize`: ele recalcula a escala do ponteiro a
    // partir do canvas já posicionado.
    game.canvas.style.width = `${width}px`;
    game.canvas.style.height = `${height}px`;

    // O zoom acompanha a densidade — muda quando o jogador usa o zoom do
    // navegador ou arrasta a janela para um monitor com outra escala.
    game.scale.zoom = 1 / ratio;
    game.scale.resize(Math.round(width * ratio), Math.round(height * ratio));
  };

  if (game.isBooted) {
    apply();
  } else {
    game.events.once(Phaser.Core.Events.READY, apply);
  }

  const visual = window.visualViewport;
  if (visual) {
    visual.addEventListener('resize', apply);
  }
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => {
    // Alguns navegadores só reportam o tamanho novo depois que o giro assenta.
    apply();
    setTimeout(apply, 300);
  });
}
