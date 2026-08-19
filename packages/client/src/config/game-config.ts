import Phaser from 'phaser';
import { LoginScene } from '../scenes/LoginScene.js';
import { LobbyScene } from '../scenes/LobbyScene.js';
import { TableScene } from '../scenes/TableScene.js';

/**
 * `NONE`, e não `FIT` nem `RESIZE`.
 *
 * Com uma resolução de projeto fixa (1280x720) o celular em pé recebia uma faixa
 * letterboxed no meio da tela — texto minúsculo e duas tarjas verdes ocupando a
 * maior parte do aparelho. O `RESIZE` resolveu isso, mas dimensiona o canvas em
 * pixels de CSS e ignora o `zoom`: numa tela de densidade 2 ou 3 o jogo desenha
 * menos pixels do que a tela tem e o navegador amplia o resultado, que é o que
 * faz o jogo parecer de baixa resolução.
 *
 * Então o tamanho é controlado por `services/canvas-scale.ts`, que a cada
 * mudança da área visível chama `scale.resize()` com o tamanho já multiplicado
 * pela densidade. As cenas continuam se redesenhando a partir das medidas reais
 * (`ui/layout.ts`), então retrato e paisagem recebem layouts próprios.
 *
 * É uma função, e não uma constante: as medidas iniciais só valem depois que o
 * `--app-height` foi calculado, no começo do `main.ts`.
 */
export function createGameConfig(): Phaser.Types.Core.GameConfig {
  const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const visual = window.visualViewport;
  const width = visual ? visual.width : window.innerWidth;
  const height = visual ? visual.height : window.innerHeight;

  return {
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#0b3d2e',
    render: {
      /*
       * Precisa vir escrito: o Phaser liga o modo pixel art sozinho sempre que o
       * zoom é diferente de 1 — e aqui ele nunca é, porque é justamente o zoom
       * que devolve o canvas ao tamanho de CSS. Ligado, ele desliga o antialias
       * e deixa os círculos dos assentos e as bordas das cartas serrilhados.
       */
      pixelArt: false,
    },
    scale: {
      mode: Phaser.Scale.NONE,
      width: Math.round(width * ratio),
      height: Math.round(height * ratio),
      zoom: 1 / ratio,
    },
    scene: [LoginScene, LobbyScene, TableScene],
  };
}
