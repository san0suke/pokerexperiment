import Phaser from 'phaser';
import { LoginScene } from '../scenes/LoginScene.js';
import { LobbyScene } from '../scenes/LobbyScene.js';
import { TableScene } from '../scenes/TableScene.js';

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b3d2e',
  scale: {
    /*
     * RESIZE, e não FIT: com uma resolução de projeto fixa (1280x720) o celular
     * em pé recebia uma faixa letterboxed no meio da tela — texto minúsculo e
     * duas tarjas verdes ocupando a maior parte do aparelho. Aqui o canvas tem o
     * tamanho real da área visível e cada cena se redesenha a partir dele
     * (`ui/layout.ts`), então retrato e paisagem recebem layouts próprios.
     */
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  scene: [LoginScene, LobbyScene, TableScene],
};
