import Phaser from 'phaser';
import { LoginScene } from '../scenes/LoginScene.js';
import { LobbyScene } from '../scenes/LobbyScene.js';
import { TableScene } from '../scenes/TableScene.js';

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b3d2e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Fixed design resolution; FIT letterboxes it onto phones and desktops alike.
    width: 1280,
    height: 720,
  },
  scene: [LoginScene, LobbyScene, TableScene],
};
